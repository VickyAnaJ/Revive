// C3 SessionController (FT-C3). Drives the §3 State Machine.
//
// Owns the session-scope state (scenario, current state, decision history,
// patient state cache) that S1's page.tsx had bolted into a React component.
// Lifting it out of the view fixes the boundary the S1 review flagged in
// 7.28a (page.tsx was doing double duty — view AND state coordination).
//
// Exposes typed events on a host EventTarget so C9 sub components (VitalsStrip,
// ScenarioCard, CoachText) subscribe with `useEffect` instead of reading from
// shared mutable state.

import type { AgentBus } from '@/lib/AgentBus';
import { ScenarioCache, type Difficulty, runScenarioAgent } from '@/agents/ScenarioAgent';
import {
  runPatientAgent,
  FALLBACK_PATIENT_STATE,
  computeRuleBasedVitals,
} from '@/agents/PatientAgent';
import { runCoachAgent } from '@/agents/CoachAgent';
import type {
  CompressionBatch,
  CoachPhrase,
  PatientState,
  Scenario,
} from '@/types/contracts';

export type SessionState =
  | 'cold_start'
  | 'scenario_intro'
  | 'decision'
  | 'compression'
  | 'complication'
  | 'aed_apply'
  | 'rosc'
  | 'debrief'
  | 'reset'
  | 'offline_fallback';

export interface DecisionRecord {
  nodeId: string;
  choiceId: string;
  correct: boolean;
  timeToDecideMs: number;
}

export interface CompressionStats {
  totalBatches: number;
  adequateBatches: number;
  tooShallowBatches: number;
  tooFastBatches: number;
  tooSlowBatches: number;
  forceCeilingBatches: number;
}

export type SessionOutcome = 'survived' | 'lost' | 'in_progress';

// Each wrong decision applies the scenario fixture's penalty_delta scaled by
// this multiplier. ×2 means a wrong call drops O₂ ~10 points (vs ~5 raw),
// which materially extends the rule-based ladder's recovery time without
// adding a separate ROSC gate. See pulsehero-design §8.13.
const DECISION_PENALTY_MULTIPLIER = 2;

export interface StateTransitionEventDetail {
  from: SessionState;
  to: SessionState;
  reason: string;
}

export interface SessionControllerDeps {
  bus: AgentBus;
  callGemini: (prompt: string) => Promise<string>;
  scenarioCache?: ScenarioCache;
  difficulty?: Difficulty;
  // Override hooks for testing without mocking individual agents
  runScenarioAgentFn?: typeof runScenarioAgent;
  runPatientAgentFn?: typeof runPatientAgent;
  runCoachAgentFn?: typeof runCoachAgent;
  now?: () => number;
}

export class SessionController extends EventTarget {
  private _state: SessionState = 'cold_start';
  private _scenario: Scenario | null = null;
  private _patientState: PatientState = { ...FALLBACK_PATIENT_STATE };
  private _decisionHistory: DecisionRecord[] = [];
  private _decisionStartedAt: number | null = null;
  private _adequateStreak = 0;
  private _stats: CompressionStats = emptyStats();
  private _outcome: SessionOutcome = 'in_progress';
  // Wall-clock bounds of the active session — set on start(), frozen on
  // entering debrief. Surfaced to the debrief UI as Total time so the user
  // can see the full arc length, not just the compression-only seconds.
  private _sessionStartedAt: number | null = null;
  private _sessionEndedAt: number | null = null;

  private readonly bus: AgentBus;
  private readonly callGemini: (prompt: string) => Promise<string>;
  private readonly scenarioCache: ScenarioCache;
  private readonly difficulty: Difficulty;
  private readonly runScenarioAgentFn: typeof runScenarioAgent;
  private readonly runPatientAgentFn: typeof runPatientAgent;
  private readonly runCoachAgentFn: typeof runCoachAgent;
  private readonly now: () => number;
  private sessionId: string;

  constructor(deps: SessionControllerDeps) {
    super();
    this.bus = deps.bus;
    this.callGemini = deps.callGemini;
    this.scenarioCache = deps.scenarioCache ?? new ScenarioCache();
    this.difficulty = deps.difficulty ?? 'intermediate';
    this.runScenarioAgentFn = deps.runScenarioAgentFn ?? runScenarioAgent;
    this.runPatientAgentFn = deps.runPatientAgentFn ?? runPatientAgent;
    this.runCoachAgentFn = deps.runCoachAgentFn ?? runCoachAgent;
    this.now = deps.now ?? Date.now;
    this.sessionId = mintSessionId();
  }

  get state(): SessionState {
    return this._state;
  }

  get scenario(): Scenario | null {
    return this._scenario;
  }

  get patientState(): PatientState {
    return { ...this._patientState };
  }

  get decisionHistory(): readonly DecisionRecord[] {
    return [...this._decisionHistory];
  }

  get stats(): CompressionStats {
    return { ...this._stats };
  }

  get outcome(): SessionOutcome {
    return this._outcome;
  }

  get durationMs(): number {
    if (this._sessionStartedAt === null) return 0;
    const end = this._sessionEndedAt ?? this.now();
    return Math.max(0, end - this._sessionStartedAt);
  }

  async start(seed?: string): Promise<void> {
    if (this._state !== 'cold_start' && this._state !== 'reset') {
      throw new Error(
        `[C3] start() called in state=${this._state}; expected cold_start or reset`,
      );
    }
    this._sessionStartedAt = this.now();
    this._sessionEndedAt = null;
    const useSeed = seed ?? `session-${this.sessionId}`;
    const scenario = await this.runScenarioAgentFn(
      useSeed,
      this.difficulty,
      { bus: this.bus, callGemini: this.callGemini },
      this.scenarioCache,
    );
    this._scenario = scenario;
    this.transition('scenario_intro', 'scenario_loaded');
    this.dispatchScenario(scenario);
    this.transition('decision', 'scenario_intro_complete');
    this._decisionStartedAt = this.now();
  }

  selectDecision(nodeId: string, choiceId: string): void {
    if (this._state !== 'decision') {
      throw new Error(
        `[C3] selectDecision() called in state=${this._state}; expected decision`,
      );
    }
    if (!this._scenario) {
      throw new Error('[C3] selectDecision() called before scenario loaded');
    }
    const node = this._scenario.decision_tree.find((n) => n.id === nodeId);
    if (!node) {
      throw new Error(`[C3] Unknown decision node id: ${nodeId}`);
    }
    if (this._decisionHistory.some((d) => d.nodeId === nodeId)) {
      throw new Error(`[C3] Decision ${nodeId} already recorded`);
    }
    const correct = node.correct_choice_id === choiceId;
    const timeToDecideMs = this.now() - (this._decisionStartedAt ?? this.now());
    this._decisionHistory.push({ nodeId, choiceId, correct, timeToDecideMs });

    if (!correct) {
      // Apply the scenario-defined penalty to the live patient state. Wrong
      // decisions cost vitals (per scenario fixture penalty_delta) and the
      // ×2 multiplier deepens starting hypoxia so the rule-based ladder
      // takes more adequate batches to climb back to the ROSC threshold.
      // No HR→O₂ redistribution: with decision-phase decay also draining
      // O₂, redistribution made 2 wrong decisions an instant-death sentence
      // before the user could even reach compression. Keep penalty simple.
      this._patientState = {
        ...this._patientState,
        hr: Math.max(0, Math.min(220, this._patientState.hr + node.penalty_delta.hr * DECISION_PENALTY_MULTIPLIER)),
        o2: Math.max(0, Math.min(100, this._patientState.o2 + node.penalty_delta.o2 * DECISION_PENALTY_MULTIPLIER)),
      };
      this.dispatchVitals(this._patientState);
      // Coach feedback so the user connects the wrong call to the vitals dip
      // they just saw. CoachText is visible during decision state, so the
      // phrase shows immediately. Priority=high → the red urgency tone.
      this.dispatchPhrase({
        feedback: 'Wrong call — vitals dropping.',
        priority: 'high',
      });
    }

    if (this._decisionHistory.length >= this._scenario.decision_tree.length) {
      this.transition('compression', 'all_decisions_recorded');
    } else {
      this._decisionStartedAt = this.now();
    }
  }

  async ingestCompressionBatch(batch: CompressionBatch): Promise<void> {
    if (this._state !== 'compression' && this._state !== 'complication') {
      // Silently ignore batches outside the compression phase. This prevents
      // late-arriving Arduino frames from accidentally restarting a debriefed
      // session.
      return;
    }

    // Immediate-update path. Compute rule-based vitals synchronously and
    // emit them BEFORE awaiting the (potentially slow or rate-limited) agent
    // call. This guarantees the UI sees a vitals tick within ~1 frame of
    // every batch event, regardless of Gemini availability. The agent call
    // still runs after this and may emit a richer follow-up vitals event.
    const ruleBased = computeRuleBasedVitals(batch, this._patientState);
    this._patientState = ruleBased;
    this.dispatchVitals(ruleBased);

    this.recordBatchStat(batch.classification);
    if (batch.classification === 'adequate') {
      this._adequateStreak += 1;
    } else {
      this._adequateStreak = 0;
    }
    this.dispatchStats(this._stats);

    if (ruleBased.rhythm === 'rosc') {
      this._outcome = 'survived';
      this.transition('rosc', 'rosc_thresholds_met');
      this.transition('debrief', 'auto_end_rosc');
      return;
    }
    if (ruleBased.rhythm === 'flatline') {
      this._outcome = 'lost';
      this.transition('debrief', 'auto_end_flatline');
      return;
    }
    if (ruleBased.rhythm === 'sinus' && ruleBased.o2 >= 90) {
      // Force rhythm forward AND clamp so the debrief vitals match the
      // ROSC outcome. Without the rewrite the live strip would freeze at
      // sinus + whatever HR the path emitted (e.g., 158).
      this._patientState = {
        ...this._patientState,
        rhythm: 'rosc',
        hr: Math.max(60, Math.min(100, this._patientState.hr)),
        o2: Math.max(92, Math.min(100, this._patientState.o2)),
        bp: '120/78',
      };
      this.dispatchVitals(this._patientState);
      this._outcome = 'survived';
      this.transition('rosc', 'rosc_thresholds_met');
    }

    // Agent path. Runs in parallel with the rule-based update above. If the
    // agent returns valid vitals (Gemini healthy), they override the
    // rule-based values via a second vitals event. If the agent cascades to
    // its own rule-based fallback, the values match what we already emitted.
    const newState = await this.runPatientAgentFn(
      batch,
      this._patientState,
      this._scenario?.patient_profile.body_type ?? 'adult_average',
      { bus: this.bus, callGemini: this.callGemini },
    );
    this._patientState = newState;
    this.dispatchVitals(newState);

    const phrase = await this.runCoachAgentFn(batch, newState.rhythm, {
      bus: this.bus,
      callGemini: this.callGemini,
    });
    this.dispatchPhrase(phrase);

    if (newState.rhythm === 'rosc') {
      this._outcome = 'survived';
      this.transition('rosc', 'rosc_thresholds_met_agent');
      this.transition('debrief', 'auto_end_rosc_agent');
      return;
    }
    if (newState.rhythm === 'flatline') {
      this._outcome = 'lost';
      this.transition('debrief', 'auto_end_flatline_agent');
      return;
    }
    if (newState.rhythm === 'sinus' && newState.o2 >= 90) {
      // Same rewrite as the rule-based path. Gemini sometimes emits sinus
      // with HR=220 + o2=93 and trips this branch; without rewriting the
      // rhythm + clamping HR, the user sees "sinus 220" frozen on the
      // debrief screen even though outcome=survived.
      this._patientState = {
        ...this._patientState,
        rhythm: 'rosc',
        hr: Math.max(60, Math.min(100, this._patientState.hr)),
        o2: Math.max(92, Math.min(100, this._patientState.o2)),
        bp: '120/78',
      };
      this.dispatchVitals(this._patientState);
      this._outcome = 'survived';
      this.transition('rosc', 'rosc_thresholds_met_agent');
    } else if (newState.complication && this._state === 'compression') {
      this.transition('complication', `complication=${newState.complication}`);
    }
  }

  reset(): void {
    const before = this._state;
    this._scenario = null;
    this._patientState = { ...FALLBACK_PATIENT_STATE };
    this._decisionHistory = [];
    this._decisionStartedAt = null;
    this._adequateStreak = 0;
    this._stats = emptyStats();
    this._outcome = 'in_progress';
    this._sessionStartedAt = null;
    this._sessionEndedAt = null;
    // Re-mint the session id so the next start() generates a fresh seed and
    // the user gets a different scenario instead of the cached one.
    this.sessionId = mintSessionId();
    this.dispatchStats(this._stats);
    this.transition('reset', `reset_from_${before}`);
  }

  // Drains O₂ by 1 per call. Page.tsx fires this on a 1.5s interval while
  // in decision state so indecision visibly costs perfusion — real cardiac
  // arrest doesn't pause for the bystander's reading speed. If O₂ hits 0
  // mid-decision, the patient flatlines and the session auto-ends.
  applyDecisionDecay(): void {
    if (this._state !== 'decision') return;
    const next = Math.max(0, this._patientState.o2 - 1);
    if (next === this._patientState.o2) return;
    this._patientState = { ...this._patientState, o2: next };
    if (next === 0) {
      this._patientState = { ...this._patientState, rhythm: 'flatline', bp: '0/0', hr: 0 };
      this._outcome = 'lost';
      this.dispatchVitals(this._patientState);
      this.transition('debrief', 'auto_end_decision_timeout');
      return;
    }
    this.dispatchVitals(this._patientState);
  }

  endSession(): void {
    if (this._state !== 'rosc' && this._state !== 'compression' && this._state !== 'complication') {
      console.warn(`[C3] endSession() called from unexpected state=${this._state}`);
    }
    if (this._outcome === 'in_progress') {
      this._outcome = this._patientState.rhythm === 'rosc' ? 'survived' : 'lost';
    }
    this.transition('debrief', `end_from_${this._state}`);
  }

  private transition(to: SessionState, reason: string): void {
    const from = this._state;
    if (from === to) return;
    this._state = to;
    if (to === 'debrief' && this._sessionEndedAt === null) {
      this._sessionEndedAt = this.now();
    }
    console.info(`[C3] state=${from} -> ${to} reason=${reason} sid=${this.sessionId}`);
    this.dispatchEvent(
      new CustomEvent<StateTransitionEventDetail>('state', {
        detail: { from, to, reason },
      }),
    );
    // ROSC is a terminal-success state for the demo: as soon as we reach
    // it (via any path — rule-based rhythm=rosc, agent rhythm=rosc, or
    // the legacy sinus+o2>=90 hand-off), pivot straight to the debrief so
    // the user sees their win and the live UI freezes. Without this,
    // ingestCompressionBatch's early-return for non-compression states
    // would leave vitals frozen at whatever the last batch produced.
    if (to === 'rosc') {
      if (this._outcome === 'in_progress') this._outcome = 'survived';
      this.transition('debrief', 'auto_end_from_rosc');
    }
  }

  private dispatchScenario(scenario: Scenario): void {
    this.dispatchEvent(new CustomEvent<Scenario>('scenario', { detail: scenario }));
  }

  private dispatchVitals(state: PatientState): void {
    this.dispatchEvent(new CustomEvent<PatientState>('vitals', { detail: state }));
  }

  private dispatchPhrase(phrase: CoachPhrase): void {
    this.dispatchEvent(new CustomEvent<CoachPhrase>('phrase', { detail: phrase }));
  }

  private dispatchStats(stats: CompressionStats): void {
    this.dispatchEvent(new CustomEvent<CompressionStats>('stats', { detail: stats }));
  }

  private recordBatchStat(c: CompressionBatch['classification']): void {
    this._stats = {
      ...this._stats,
      totalBatches: this._stats.totalBatches + 1,
      adequateBatches: this._stats.adequateBatches + (c === 'adequate' ? 1 : 0),
      tooShallowBatches: this._stats.tooShallowBatches + (c === 'too_shallow' ? 1 : 0),
      tooFastBatches: this._stats.tooFastBatches + (c === 'too_fast' ? 1 : 0),
      tooSlowBatches: this._stats.tooSlowBatches + (c === 'too_slow' ? 1 : 0),
      forceCeilingBatches: this._stats.forceCeilingBatches + (c === 'force_ceiling' ? 1 : 0),
    };
  }
}

function emptyStats(): CompressionStats {
  return {
    totalBatches: 0,
    adequateBatches: 0,
    tooShallowBatches: 0,
    tooFastBatches: 0,
    tooSlowBatches: 0,
    forceCeilingBatches: 0,
  };
}

function mintSessionId(): string {
  return Math.random().toString(36).slice(2, 10);
}
