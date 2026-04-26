// VoiceIntegration (S3-T07). Realises pulsehero-design.md §10.11.
//
// Bridges SessionController events to the AudioQueue. Voice subscribes,
// never replaces — every existing setCoachPhrase / setScenario /
// transitionTo call is unchanged in C3. This module only adds parallel
// audio output by listening to the events C3 already emits.
//
// Lifecycle: instantiate with (controller, queue). Listeners attach in the
// constructor. Call destroy() to detach (used on page unmount or feature
// flag toggle off mid-session).

import type {
  Scenario,
  PatientState,
  CoachPhrase,
  CompressionBatch,
  CompressionClassification,
} from '@/types/contracts';
import type { SessionController } from '@/controllers/SessionController';
import type { AudioQueue } from './AudioQueue';
import { pickBystanderTier, pickBystanderClip, type BystanderTier } from './voiceSelectors';

// Maps the scorer's classification labels to pre-rendered Tier 1 cached
// clips. Cached clips fire per-batch at ~50ms latency — judge hears the
// correction instantly. Returns null for classifications that don't have
// a cached clip (Tier 2 streaming phrase will still fire for those).
function classificationToCachedClip(c: CompressionClassification): string | null {
  switch (c) {
    case 'too_shallow':
      return 'coach/push_harder';
    case 'too_fast':
      return 'coach/slower';
    case 'too_slow':
      return 'coach/faster';
    case 'force_ceiling':
      return 'coach/allow_recoil';
    case 'adequate':
      return 'coach/good_keep_going';
    default:
      return null;
  }
}

// Light-weight scorer interface — VoiceIntegration only needs the batch
// event subscription, not the full CompressionScorer surface. Lets tests
// pass a stub EventTarget instead of constructing the full scorer.
export interface BatchEmitter {
  addEventListener(type: 'batch', listener: (e: Event) => void): void;
  removeEventListener(type: 'batch', listener: (e: Event) => void): void;
}

export interface VoiceIntegrationDeps {
  controller: SessionController;
  audioQueue: AudioQueue;
  // Optional. When provided, VoiceIntegration also listens to scorer batch
  // events to fire Tier 1 cached coach barks. Without it, coach voice falls
  // through to Tier 2 streaming only.
  scorer?: BatchEmitter;
}

// States during which voice coaching may fire. Outside these states
// (cold_start / scenario_intro / decision / debrief / etc.) the scorer
// keeps emitting batches but voice must stay silent — otherwise the user
// hears "Faster" and "Allow recoil" on the dashboard before pressing.
const VOICE_ACTIVE_STATES = new Set(['compression', 'complication', 'rosc']);

export class VoiceIntegration {
  private cleanups: Array<() => void> = [];
  private bystanderCounter = 0;
  private currentBystanderTier: BystanderTier | null = null;
  private hasFiredScenarioIntro = false;
  private hasFiredCompressionEntry = false;
  private currentState: string = 'cold_start';
  // Tier 1 cached barks fire per batch (~50ms). Tier 2 streaming phrases
  // arrive ~600ms later from the same batch. We dedupe: if a cached bark
  // fired recently, skip the streaming phrase to avoid double "push harder".
  private lastCachedBarkAt = 0;
  private static readonly CACHED_VS_STREAMING_DEDUPE_MS = 4000;

  constructor(private readonly deps: VoiceIntegrationDeps) {
    this.attach();
  }

  private attach(): void {
    const { controller, audioQueue } = this.deps;

    const onState = (e: Event) => {
      const { from, to } = (e as CustomEvent<{ from: string; to: string }>).detail;
      this.currentState = to;

      // First entry into compression — fire scared Bystander to mask the
      // scenario-gen latency window. Skipped on returns from decision phase
      // (no need to re-set the scene mid-session).
      if (to === 'compression' && from !== 'decision' && !this.hasFiredCompressionEntry) {
        this.hasFiredCompressionEntry = true;
        const tier: BystanderTier = 'scared';
        const clip = pickBystanderClip(tier, this.bystanderCounter++);
        audioQueue.enqueue({
          channel: 'bystander',
          source: 'cached',
          priority: 'high',
          clipName: `bystander/${clip}`,
          cooldownBucket: 'bystander_intro',
        });
        this.currentBystanderTier = tier;
      }

      // Reset / debrief / cold_start — flush all queued audio so a stale
      // phrase doesn't play after the session has reset.
      if (to === 'debrief' || to === 'reset' || to === 'cold_start') {
        audioQueue.cancelAll();
        this.hasFiredScenarioIntro = false;
        this.hasFiredCompressionEntry = false;
      }
    };
    controller.addEventListener('state', onState);
    this.cleanups.push(() => controller.removeEventListener('state', onState));

    // CoachAgent emitted a phrase. Stream via flash_v2 (Tier 2). Skipped if
    // a Tier 1 cached bark fired within the dedupe window — judge would
    // otherwise hear "Push harder" twice (once cached, once streamed) for
    // the same compression batch.
    const onPhrase = (e: Event) => {
      const phrase = (e as CustomEvent<CoachPhrase>).detail;
      if (!phrase.feedback) return;
      if (!VOICE_ACTIVE_STATES.has(this.currentState)) return;
      if (Date.now() - this.lastCachedBarkAt < VoiceIntegration.CACHED_VS_STREAMING_DEDUPE_MS) {
        return;
      }
      const priority =
        phrase.priority === 'critical' ? 'high' : phrase.priority === 'high' ? 'med' : 'low';
      audioQueue.enqueue({
        // Compression coach corrections route through the 'dispatcher'
        // channel so they play in the user's DISPATCHER voice, leaving
        // the INSTRUCTOR (calm nurse) voice exclusively for the intro
        // welcome line. Three distinct voices: instructor (welcome),
        // dispatcher (coach + scenario reading), bystander (reactions).
        channel: 'dispatcher',
        source: 'streaming',
        priority,
        text: phrase.feedback,
        cooldownBucket: 'coach_phrase',
      });
    };
    controller.addEventListener('phrase', onPhrase);
    this.cleanups.push(() => controller.removeEventListener('phrase', onPhrase));

    // Tier 1 cached coach barks. Fire per batch with ~50ms latency. Cuts
    // any active Tier 2 streaming phrase via priority='high' so the older
    // correction doesn't outlive its relevance.
    if (this.deps.scorer) {
      const onBatch = (e: Event) => {
        // Gate on session state — scorer keeps emitting batches between
        // sessions but voice must stay silent until the user is actually
        // doing compressions. Without this, judge hears "Faster" /
        // "Allow recoil" on the scenario / decision / debrief screens
        // because the synthetic batches default to too_slow when the pad
        // is idle.
        if (!VOICE_ACTIVE_STATES.has(this.currentState)) return;
        const batch = (e as CustomEvent<CompressionBatch>).detail;
        // Idle batches (zero rate AND zero depth) are the do-nothing path
        // — should not trigger any coach voice. The patient simulator
        // handles flatline progression on its own.
        if (batch.avg_rate === 0 && batch.avg_depth === 0) return;
        const clip = classificationToCachedClip(batch.classification);
        if (!clip) return;
        // Skip 'good_keep_going' if it would fire too often. The 5s queue
        // cooldown already enforces 5s minimum between identical clips,
        // but adequate compressions are the common case so we extend to
        // 8s for that one bucket only by piggybacking on a longer bucket.
        const isAdequate = batch.classification === 'adequate';
        const enqueued = audioQueue.enqueue({
          channel: 'coach',
          source: 'cached',
          priority: isAdequate ? 'low' : 'high',
          clipName: clip,
          cooldownBucket: clip,
        });
        if (enqueued) this.lastCachedBarkAt = Date.now();
      };
      this.deps.scorer.addEventListener('batch', onBatch);
      this.cleanups.push(() => this.deps.scorer!.removeEventListener('batch', onBatch));
    }

    // Scenario load — Dispatcher reads the scene. Plays alongside the
    // Bystander mp3 (Bystander is high-priority and fires first; Dispatcher
    // queues at med and starts when Bystander finishes). Once-per-session
    // via hasFiredScenarioIntro.
    const onScenario = (e: Event) => {
      if (this.hasFiredScenarioIntro) return;
      this.hasFiredScenarioIntro = true;
      const scenario = (e as CustomEvent<Scenario>).detail;
      // Scenario-customized Bystander panic line ONLY. Dispatcher no longer
      // reads the scenario aloud — the on-screen prompt is enough; the
      // user wants only the bystander voice on the decision screen.
      const bystanderLine = this.scenarioToBystanderText(scenario);
      if (bystanderLine) {
        audioQueue.enqueue({
          channel: 'bystander',
          source: 'streaming',
          priority: 'med',
          text: bystanderLine,
          cooldownBucket: 'bystander_scenario_intro',
        });
      }
    };
    controller.addEventListener('scenario', onScenario);
    this.cleanups.push(() => controller.removeEventListener('scenario', onScenario));

    // Vitals updates → swap Bystander tier when emotional state crosses a
    // boundary. Doesn't fire on every vitals tick (would spam audio); only
    // when the *tier* changes.
    const onVitals = (e: Event) => {
      const state = (e as CustomEvent<PatientState>).detail;
      const tier = pickBystanderTier(state.o2, state.rhythm === 'rosc');
      if (tier !== this.currentBystanderTier && this.currentBystanderTier !== null) {
        // Tier crossing — fire one variant from the new tier
        const clip = pickBystanderClip(tier, this.bystanderCounter++);
        audioQueue.enqueue({
          channel: 'bystander',
          source: 'cached',
          priority: 'med',
          clipName: `bystander/${clip}`,
          cooldownBucket: `bystander_tier_${tier}`,
        });
        this.currentBystanderTier = tier;
      }
    };
    controller.addEventListener('vitals', onVitals);
    this.cleanups.push(() => controller.removeEventListener('vitals', onVitals));
  }

  private scenarioToDispatcherText(scenario: Scenario): string {
    const profile = scenario.patient_profile;
    const ageBracket =
      profile.age >= 65 ? 'elderly' : profile.age >= 40 ? 'middle-aged' : profile.age >= 18 ? 'adult' : 'young';
    const sex = profile.sex || 'patient';
    return `${ageBracket} ${sex}, ${scenario.scenario_type}, ${scenario.location}.`;
  }

  // Bystander streaming line tailored to the loaded scenario. Voiced in
  // the BYSTANDER voice ID via flash_v2. Pure read of scenario fields
  // (patient_profile.{age,sex} + location) — no LLM call.
  private scenarioToBystanderText(scenario: Scenario): string {
    const { age, sex } = scenario.patient_profile;
    const pronoun = (sex || '').toLowerCase().startsWith('f') ? 'she' : 'he';
    const location = scenario.location || 'here';
    return `Oh god, please help — ${pronoun} just collapsed in the ${location}! ${pronoun} is ${age} years old, ${pronoun} is not breathing!`;
  }

  destroy(): void {
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
  }
}
