import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadFixtures,
  getScenario,
  getCoachPhrase,
  __TESTING__,
} from '../OfflineCache';
import type { Scenario, CoachPhrase } from '@/types/contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PUBLIC_DIR = join(process.cwd(), 'public');

function fixtureBody(relativePath: string): string {
  return readFileSync(join(PUBLIC_DIR, relativePath), 'utf-8');
}

function makeFetch(overrides: Record<string, () => Response> = {}): typeof fetch {
  return (async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    if (overrides[url]) return overrides[url]();
    const path = url.replace(/^\//, '');
    const body = fixtureBody(path);
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

beforeEach(() => {
  __TESTING__.reset();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  __TESTING__.reset();
  vi.restoreAllMocks();
});

describe('OfflineCache loader (Step 5 unit tests)', () => {
  it('a) loads all five scenario fixtures and the phrases bundle', async () => {
    const fetchImpl = makeFetch();
    await loadFixtures(fetchImpl);
    const s = getScenario('any-seed');
    expect(s).toBeDefined();
    expect(s.scenario_type).toBe('cardiac_arrest');
  });

  it('a) rejects a fixture that fails its schema', async () => {
    const broken = JSON.stringify({ scenario_id: 'not-a-uuid' });
    const fetchImpl = makeFetch({
      '/fallback/scenarios/cardiac_arrest_park.json': () =>
        new Response(broken, { status: 200 }),
    });
    await expect(loadFixtures(fetchImpl)).rejects.toThrow(/Cache rot detected/);
  });

  it('a) rejects a phrases entry that fails its schema', async () => {
    const broken = JSON.stringify({
      adequate: { feedback: 'ok', priority: 'low' },
      too_shallow: { feedback: 'x', priority: 'invalid_priority' },
      too_fast: { feedback: 'y', priority: 'low' },
      too_slow: { feedback: 'z', priority: 'low' },
      force_ceiling: { feedback: 'q', priority: 'low' },
    });
    const fetchImpl = makeFetch({
      '/fallback/phrases.json': () => new Response(broken, { status: 200 }),
    });
    await expect(loadFixtures(fetchImpl)).rejects.toThrow(/Cache rot detected/);
  });

  it('throws an actionable error when a fixture file is missing', async () => {
    const fetchImpl = makeFetch({
      '/fallback/scenarios/cardiac_arrest_park.json': () => new Response('', { status: 404 }),
    });
    await expect(loadFixtures(fetchImpl)).rejects.toThrow(/status 404/);
  });
});

describe('OfflineCache getters (Step 5 unit tests)', () => {
  beforeEach(async () => {
    await loadFixtures(makeFetch());
  });

  it('b) getScenario(seed) is deterministic for a given seed', () => {
    const a = getScenario('seed-alpha');
    const b = getScenario('seed-alpha');
    expect(a.scenario_id).toBe(b.scenario_id);
  });

  it('b) different seeds can return different scenarios', () => {
    const seeds = ['s1', 's2', 's3', 's4', 's5'];
    const ids = new Set(seeds.map((s) => getScenario(s).scenario_id));
    expect(ids.size).toBeGreaterThan(1);
  });

  it('c) getCoachPhrase("too_shallow") returns the phrase matching that classification', () => {
    const phrase: CoachPhrase = getCoachPhrase('too_shallow');
    expect(phrase.feedback.toLowerCase()).toContain('line');
    expect(phrase.priority).toBe('high');
  });

  it('c) getCoachPhrase covers every classification', () => {
    const classes = ['adequate', 'too_shallow', 'too_fast', 'too_slow', 'force_ceiling'] as const;
    for (const c of classes) {
      const p = getCoachPhrase(c);
      expect(p.feedback.length).toBeGreaterThan(0);
      expect(p.feedback.length).toBeLessThanOrEqual(200);
    }
  });
});

describe('OfflineCache pre-load guard', () => {
  it('throws when getScenario is called before loadFixtures', () => {
    expect(() => getScenario('x')).toThrow(/not loaded/);
  });

  it('throws when getCoachPhrase is called before loadFixtures', () => {
    expect(() => getCoachPhrase('adequate')).toThrow(/not loaded/);
  });
});

describe('OfflineCache contract round-trip (Step 5 contract test)', () => {
  it('every loaded scenario has a valid decision_tree size and unique correct_choice', async () => {
    await loadFixtures(makeFetch());
    const seeds = Array.from({ length: 10 }, (_, i) => `seed-${i}`);
    for (const seed of seeds) {
      const s: Scenario = getScenario(seed);
      expect(s.decision_tree.length).toBeGreaterThanOrEqual(3);
      expect(s.decision_tree.length).toBeLessThanOrEqual(4);
      for (const node of s.decision_tree) {
        const validChoiceIds = new Set(node.options.map((o) => o.id));
        expect(validChoiceIds.has(node.correct_choice_id)).toBe(true);
      }
    }
  });
});
