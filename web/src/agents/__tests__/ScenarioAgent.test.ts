import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentBus } from '@/lib/AgentBus';
import {
  buildScenarioAgentPrompt,
  runScenarioAgent,
  ScenarioCache,
} from '../ScenarioAgent';
import { __TESTING__ as offlineCacheTesting, loadFixtures } from '@/lib/OfflineCache';
import type { Scenario } from '@/types/contracts';

const PUBLIC_DIR = join(process.cwd(), 'public');

const realFetch = (async (input: RequestInfo | URL): Promise<Response> => {
  const url = typeof input === 'string' ? input : input.toString();
  const path = join(PUBLIC_DIR, url.replace(/^\//, ''));
  return new Response(readFileSync(path, 'utf-8'), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;

const VALID_SCENARIO: Scenario = {
  scenario_id: '00000000-0000-4000-8000-000000000abc',
  scenario_type: 'cardiac_arrest',
  location: 'Coffee shop, weekday morning',
  patient_profile: { age: 52, sex: 'female', body_type: 'adult_average' },
  decision_tree: [
    {
      id: 'd1',
      prompt: 'Patient slumps over their laptop. What do you do?',
      options: [
        { id: 'a', label: 'Call 911 and check breathing' },
        { id: 'b', label: 'Wait for a manager' },
      ],
      correct_choice_id: 'a',
      penalty_delta: { hr: -10, o2: -5 },
    },
    {
      id: 'd2',
      prompt: 'No pulse. AED is across the room.',
      options: [
        { id: 'a', label: 'Send a bystander to fetch the AED, start compressions' },
        { id: 'b', label: 'Run for the AED yourself' },
      ],
      correct_choice_id: 'a',
      penalty_delta: { hr: -15, o2: -10 },
    },
    {
      id: 'd3',
      prompt: 'AED arrives. Pads on. Shock advised.',
      options: [
        { id: 'a', label: 'Clear, deliver shock, resume' },
        { id: 'b', label: 'Skip the shock' },
      ],
      correct_choice_id: 'a',
      penalty_delta: { hr: -5, o2: -5 },
    },
  ],
};

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

describe('ScenarioAgent prompt builder (Step 5 unit test a)', () => {
  it('includes seed and difficulty', () => {
    const prompt = buildScenarioAgentPrompt('abc-123', 'intermediate');
    expect(prompt).toContain('Seed: abc-123');
    expect(prompt).toContain('Difficulty: intermediate');
  });

  it('declares the body_type enum constraint', () => {
    const prompt = buildScenarioAgentPrompt('seed', 'beginner');
    expect(prompt).toContain('"adult_large"');
    expect(prompt).toContain('"adult_average"');
    expect(prompt).toContain('"child"');
    expect(prompt).toContain('"elderly"');
  });

  it('declares the decision tree size constraint (3 or 4)', () => {
    const prompt = buildScenarioAgentPrompt('seed', 'advanced');
    expect(prompt).toContain('3 or 4 decision nodes');
  });
});

describe('runScenarioAgent integration (Step 5 integration test)', () => {
  it('returns the parsed scenario when Gemini is healthy', async () => {
    const bus = new AgentBus({ baseBackoffMs: 1 });
    const cache = new ScenarioCache();
    const callGemini = vi.fn(async () => JSON.stringify(VALID_SCENARIO));
    const result = await runScenarioAgent('seed-1', 'intermediate', { bus, callGemini }, cache);
    expect(result.scenario_type).toBe('cardiac_arrest');
    expect(result.decision_tree).toHaveLength(3);
    expect(callGemini).toHaveBeenCalledOnce();
  });

  it('caches the scenario per session: a second call with the same seed reuses the result', async () => {
    const bus = new AgentBus({ baseBackoffMs: 1 });
    const cache = new ScenarioCache();
    const callGemini = vi.fn(async () => JSON.stringify(VALID_SCENARIO));
    const first = await runScenarioAgent('seed-1', 'intermediate', { bus, callGemini }, cache);
    const second = await runScenarioAgent('seed-1', 'intermediate', { bus, callGemini }, cache);
    expect(first.scenario_id).toBe(second.scenario_id);
    expect(callGemini).toHaveBeenCalledTimes(1);
  });

  it('rejects a scenario with too many decision nodes (5) and cascades to fallback', async () => {
    const bus = new AgentBus({ baseBackoffMs: 1 });
    const cache = new ScenarioCache();
    const oversize = {
      ...VALID_SCENARIO,
      decision_tree: [
        ...VALID_SCENARIO.decision_tree,
        VALID_SCENARIO.decision_tree[0],
        VALID_SCENARIO.decision_tree[1],
      ],
    };
    const callGemini = vi.fn(async () => JSON.stringify(oversize));
    const result = await runScenarioAgent('seed-1', 'intermediate', { bus, callGemini }, cache);
    expect(result.decision_tree.length).toBeLessThanOrEqual(4);
    expect(callGemini).toHaveBeenCalledTimes(3);
  });

  it('rejects a scenario with too few decision nodes (2) and cascades to fallback', async () => {
    const bus = new AgentBus({ baseBackoffMs: 1 });
    const cache = new ScenarioCache();
    const undersize = {
      ...VALID_SCENARIO,
      decision_tree: VALID_SCENARIO.decision_tree.slice(0, 2),
    };
    const callGemini = vi.fn(async () => JSON.stringify(undersize));
    const result = await runScenarioAgent('seed-1', 'intermediate', { bus, callGemini }, cache);
    expect(result.decision_tree.length).toBeGreaterThanOrEqual(3);
    expect(callGemini).toHaveBeenCalledTimes(3);
  });

  it('falls back to OfflineCache scenario keyed by seed on cascade exhaust', async () => {
    const bus = new AgentBus({ baseBackoffMs: 1 });
    const cache = new ScenarioCache();
    const callGemini = vi.fn(async () => {
      throw new Error('Gemini timeout');
    });
    const result = await runScenarioAgent('any-seed', 'beginner', { bus, callGemini }, cache);
    expect(result.scenario_type).toBe('cardiac_arrest');
    expect(result.decision_tree.length).toBeGreaterThanOrEqual(3);
    expect(callGemini).toHaveBeenCalledTimes(3);
  });
});

describe('ScenarioCache unit tests', () => {
  it('returns undefined for an unseen seed', () => {
    const cache = new ScenarioCache();
    expect(cache.get('missing')).toBeUndefined();
    expect(cache.has('missing')).toBe(false);
  });

  it('persists a scenario after set', () => {
    const cache = new ScenarioCache();
    cache.set('seed-x', VALID_SCENARIO);
    expect(cache.has('seed-x')).toBe(true);
    expect(cache.get('seed-x')?.scenario_id).toBe(VALID_SCENARIO.scenario_id);
  });

  it('clears all entries', () => {
    const cache = new ScenarioCache();
    cache.set('a', VALID_SCENARIO);
    cache.set('b', VALID_SCENARIO);
    cache.clear();
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(false);
  });
});
