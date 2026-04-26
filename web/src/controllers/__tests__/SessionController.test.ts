import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentBus } from '@/lib/AgentBus';
import { SessionController } from '../SessionController';
import { ScenarioCache } from '@/agents/ScenarioAgent';
import {
  __TESTING__ as offlineCacheTesting,
  loadFixtures,
} from '@/lib/OfflineCache';
import type {
  CoachPhrase,
  CompressionBatch,
  PatientState,
  Scenario,
} from '@/types/contracts';
import type { StateTransitionEventDetail as _STD } from '../SessionController';

const PUBLIC_DIR = join(process.cwd(), 'public');

const realFetch = (async (input: RequestInfo | URL): Promise<Response> => {
  const url = typeof input === 'string' ? input : input.toString();
  const path = join(PUBLIC_DIR, url.replace(/^\//, ''));
  return new Response(readFileSync(path, 'utf-8'), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;

const TEST_SCENARIO: Scenario = {
  scenario_id: '99999999-9999-4999-8999-999999999999',
  scenario_type: 'cardiac_arrest',
  location: 'Test setting',
  patient_profile: { age: 45, sex: 'male', body_type: 'adult_average' },
  decision_tree: [
    {
      id: 'd1',
      prompt: 'First decision',
      options: [
        { id: 'a', label: 'Right' },
        { id: 'b', label: 'Wrong' },
      ],
      correct_choice_id: 'a',
      penalty_delta: { hr: -10, o2: -5 },
    },
    {
      id: 'd2',
      prompt: 'Second decision',
      options: [
        { id: 'a', label: 'Right' },
        { id: 'b', label: 'Wrong' },
      ],
      correct_choice_id: 'a',
      penalty_delta: { hr: -10, o2: -5 },
    },
    {
      id: 'd3',
      prompt: 'Third decision',
      options: [
        { id: 'a', label: 'Right' },
        { id: 'b', label: 'Wrong' },
      ],
      correct_choice_id: 'a',
      penalty_delta: { hr: -10, o2: -5 },
    },
  ],
};

const ADEQUATE_BATCH: CompressionBatch = {
  avg_depth: 0.7,
  avg_rate: 110,
  consistency: 0.85,
  classification: 'adequate',
};

const VITALS_BAD: PatientState = {
  hr: 0,
  bp: '0/0',
  o2: 60,
  rhythm: 'v_fib',
  complication: null,
  patient_speech: null,
  body_type_feedback: null,
};

const VITALS_GOOD_ROSC: PatientState = {
  hr: 75,
  bp: '110/70',
  o2: 95,
  rhythm: 'sinus',
  complication: null,
  patient_speech: 'Where am I?',
  body_type_feedback: null,
};

const PHRASE_LOW: CoachPhrase = {
  feedback: 'Stay here. Both green.',
  priority: 'low',
};

function makeDeps(overrides: Partial<{
  scenario: Scenario;
  patientState: PatientState;
  phrase: CoachPhrase;
}> = {}) {
  const bus = new AgentBus({ baseBackoffMs: 1 });
  const callGemini = vi.fn(async () => '{}');
  const runScenarioAgentFn = vi.fn(async () => overrides.scenario ?? TEST_SCENARIO);
  const runPatientAgentFn = vi.fn(async () => overrides.patientState ?? VITALS_BAD);
  const runCoachAgentFn = vi.fn(async () => overrides.phrase ?? PHRASE_LOW);
  let nowValue = 1_000_000;
  const now = vi.fn(() => {
    const v = nowValue;
    nowValue += 1500;
    return v;
  });
  return {
    bus,
    callGemini,
    runScenarioAgentFn,
    runPatientAgentFn,
    runCoachAgentFn,
    now,
    scenarioCache: new ScenarioCache(),
  };
}

beforeEach(async () => {
  offlineCacheTesting.reset();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  await loadFixtures(realFetch);
});

afterEach(() => {
  offlineCacheTesting.reset();
  vi.restoreAllMocks();
});

describe('SessionController state transitions (Step 5 unit test a)', () => {
  it('starts in cold_start', () => {
    const deps = makeDeps();
    const c = new SessionController(deps);
    expect(c.state).toBe('cold_start');
  });

  it('transitions cold_start -> scenario_intro -> decision when start() succeeds', async () => {
    const deps = makeDeps();
    const c = new SessionController(deps);
    const transitions: _STD[] = [];
    c.addEventListener('state', (e) =>
      transitions.push((e as CustomEvent<_STD>).detail),
    );
    await c.start('seed-x');
    expect(c.state).toBe('decision');
    expect(transitions.map((t) => t.to)).toEqual(['scenario_intro', 'decision']);
    expect(c.scenario?.scenario_id).toBe(TEST_SCENARIO.scenario_id);
  });

  it('transitions decision -> compression after every decision is recorded', async () => {
    const deps = makeDeps();
    const c = new SessionController(deps);
    await c.start();
    c.selectDecision('d1', 'a');
    c.selectDecision('d2', 'a');
    expect(c.state).toBe('decision');
    c.selectDecision('d3', 'a');
    expect(c.state).toBe('compression');
  });

  it('transitions compression -> rosc -> debrief (auto-end) when patient crosses ROSC thresholds', async () => {
    const deps = makeDeps({ patientState: VITALS_GOOD_ROSC });
    const c = new SessionController(deps);
    await c.start();
    c.selectDecision('d1', 'a');
    c.selectDecision('d2', 'a');
    c.selectDecision('d3', 'a');
    expect(c.state).toBe('compression');
    await c.ingestCompressionBatch(ADEQUATE_BATCH);
    // ROSC is now a transient state — we auto-debrief immediately on entry
    // so the live UI freezes and the user sees their survived screen.
    expect(c.state).toBe('debrief');
    expect(c.outcome).toBe('survived');
  });
});

describe('SessionController scenario start triggers PatientAgent + CoachAgent at right cadence (Step 5 unit test b)', () => {
  it('does NOT call agents during scenario_intro or decision', async () => {
    const deps = makeDeps();
    const c = new SessionController(deps);
    await c.start();
    expect(deps.runPatientAgentFn).not.toHaveBeenCalled();
    expect(deps.runCoachAgentFn).not.toHaveBeenCalled();
  });

  it('calls both agents per compression batch ingested in compression state', async () => {
    const deps = makeDeps();
    const c = new SessionController(deps);
    await c.start();
    c.selectDecision('d1', 'a');
    c.selectDecision('d2', 'a');
    c.selectDecision('d3', 'a');
    await c.ingestCompressionBatch(ADEQUATE_BATCH);
    expect(deps.runPatientAgentFn).toHaveBeenCalledTimes(1);
    expect(deps.runCoachAgentFn).toHaveBeenCalledTimes(1);
  });
});

describe('SessionController duplicate decision rejection (Step 5 unit test c)', () => {
  it('rejects a second selectDecision call on the same node id', async () => {
    const deps = makeDeps();
    const c = new SessionController(deps);
    await c.start();
    c.selectDecision('d1', 'a');
    expect(() => c.selectDecision('d1', 'b')).toThrow(/already recorded/);
  });

  it('rejects an unknown node id', async () => {
    const deps = makeDeps();
    const c = new SessionController(deps);
    await c.start();
    expect(() => c.selectDecision('d999', 'a')).toThrow(/Unknown decision node/);
  });

  it('rejects selectDecision called outside the decision state', async () => {
    const deps = makeDeps();
    const c = new SessionController(deps);
    expect(() => c.selectDecision('d1', 'a')).toThrow(/expected decision/);
  });
});

describe('SessionController reset (Step 5 unit test d)', () => {
  it('clears scenario and decision history but allows a new start', async () => {
    const deps = makeDeps();
    const c = new SessionController(deps);
    await c.start();
    c.selectDecision('d1', 'a');
    c.reset();
    expect(c.state).toBe('reset');
    expect(c.scenario).toBeNull();
    expect(c.decisionHistory).toEqual([]);
    await c.start('new-seed');
    expect(c.state).toBe('decision');
    expect(deps.runScenarioAgentFn).toHaveBeenCalledTimes(2);
  });
});

describe('SessionController integration: emits events in the right order (Step 5 integration test)', () => {
  it('emits scenario, then state -> decision, then vitals + phrase per batch', async () => {
    const deps = makeDeps();
    const c = new SessionController(deps);
    const log: string[] = [];
    c.addEventListener('scenario', () => log.push('scenario'));
    c.addEventListener('state', (e) =>
      log.push(`state:${(e as CustomEvent<_STD>).detail.to}`),
    );
    c.addEventListener('vitals', () => log.push('vitals'));
    c.addEventListener('phrase', () => log.push('phrase'));

    await c.start();
    c.selectDecision('d1', 'a');
    c.selectDecision('d2', 'a');
    c.selectDecision('d3', 'a');
    await c.ingestCompressionBatch(ADEQUATE_BATCH);

    expect(log).toEqual([
      'state:scenario_intro',
      'scenario',
      'state:decision',
      'state:compression',
      // Two vitals events per batch: rule-based (synchronous, immediate
      // visual update) followed by agent (which may override or match).
      'vitals',
      'vitals',
      'phrase',
    ]);
  });
});

describe('SessionController edge cases (Step 5 edge cases)', () => {
  it('ignores compression batches outside the compression state', async () => {
    const deps = makeDeps();
    const c = new SessionController(deps);
    await c.ingestCompressionBatch(ADEQUATE_BATCH);
    expect(deps.runPatientAgentFn).not.toHaveBeenCalled();
    expect(c.state).toBe('cold_start');
  });

  it('forwards whatever PatientAgent returned to the vitals event', async () => {
    const deps = makeDeps({ patientState: VITALS_BAD });
    const c = new SessionController(deps);
    await c.start();
    c.selectDecision('d1', 'a');
    c.selectDecision('d2', 'a');
    c.selectDecision('d3', 'a');
    let lastVitals: PatientState | null = null;
    c.addEventListener('vitals', (e) => {
      lastVitals = (e as CustomEvent<PatientState>).detail;
    });
    await c.ingestCompressionBatch(ADEQUATE_BATCH);
    expect(lastVitals).toEqual(VITALS_BAD);
  });
});
