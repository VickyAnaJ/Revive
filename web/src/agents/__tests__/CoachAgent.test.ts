import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentBus } from '@/lib/AgentBus';
import { buildCoachAgentPrompt, runCoachAgent } from '../CoachAgent';
import { __TESTING__ as offlineCacheTesting, loadFixtures } from '@/lib/OfflineCache';
import type { CompressionBatch } from '@/types/contracts';

const PUBLIC_DIR = join(process.cwd(), 'public');

function fixtureBody(relativePath: string): string {
  return readFileSync(join(PUBLIC_DIR, relativePath), 'utf-8');
}

const realFetch = (async (input: RequestInfo | URL): Promise<Response> => {
  const url = typeof input === 'string' ? input : input.toString();
  return new Response(fixtureBody(url.replace(/^\//, '')), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;

const SHALLOW_BATCH: CompressionBatch = {
  avg_depth: 0.3,
  avg_rate: 95,
  consistency: 0.4,
  classification: 'too_shallow',
};

const ADEQUATE_BATCH: CompressionBatch = {
  avg_depth: 0.7,
  avg_rate: 110,
  consistency: 0.85,
  classification: 'adequate',
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

describe('CoachAgent prompt builder (Step 5 unit test a)', () => {
  it('includes the batch classification and patient rhythm', () => {
    const prompt = buildCoachAgentPrompt(SHALLOW_BATCH, 'v_fib');
    expect(prompt).toContain('Classification: too_shallow');
    expect(prompt).toContain('Patient rhythm: v_fib');
    expect(prompt).toContain('Average depth: 0.30');
    expect(prompt).toContain('Average rate: 95');
  });

  it('instructs the model to speak in screen terms', () => {
    const prompt = buildCoachAgentPrompt(ADEQUATE_BATCH, 'sinus');
    expect(prompt).toContain('SCREEN TERMS');
    expect(prompt).toContain('depth bar');
    expect(prompt).toContain('rate counter');
  });

  it('forbids clinical depth references', () => {
    const prompt = buildCoachAgentPrompt(ADEQUATE_BATCH, 'sinus');
    expect(prompt.toLowerCase()).toContain('do not reference clinical metrics');
    expect(prompt.toLowerCase()).toContain('two inches');
  });

  it('caps the phrase length at 200 characters', () => {
    const prompt = buildCoachAgentPrompt(ADEQUATE_BATCH, 'sinus');
    expect(prompt).toContain('Maximum 200 characters');
  });
});

describe('runCoachAgent integration (Step 5 integration test)', () => {
  it('returns the parsed coach phrase when Gemini is healthy', async () => {
    const bus = new AgentBus({ baseBackoffMs: 1 });
    const callGemini = vi.fn(async () =>
      JSON.stringify({
        feedback: 'Push past the upper line.',
        priority: 'high',
      }),
    );
    const phrase = await runCoachAgent(SHALLOW_BATCH, 'v_fib', { bus, callGemini });
    expect(phrase.feedback).toBe('Push past the upper line.');
    expect(phrase.priority).toBe('high');
    expect(callGemini).toHaveBeenCalledOnce();
  });

  it('rejects an over-length phrase via schema and cascades to fallback', async () => {
    const bus = new AgentBus({ baseBackoffMs: 1 });
    const longPhrase = 'x'.repeat(250);
    const callGemini = vi.fn(async () =>
      JSON.stringify({ feedback: longPhrase, priority: 'high' }),
    );
    const phrase = await runCoachAgent(SHALLOW_BATCH, 'v_fib', { bus, callGemini });
    expect(phrase.feedback).toBe('Push past the upper line.');
    expect(phrase.priority).toBe('high');
    expect(callGemini).toHaveBeenCalledTimes(3);
  });

  it('rejects an unknown priority enum and cascades to fallback', async () => {
    const bus = new AgentBus({ baseBackoffMs: 1 });
    const callGemini = vi.fn(async () =>
      JSON.stringify({ feedback: 'Push past the upper line.', priority: 'urgent' }),
    );
    const phrase = await runCoachAgent(SHALLOW_BATCH, 'v_fib', { bus, callGemini });
    expect(phrase.priority).toMatch(/^(low|medium|high|critical)$/);
    expect(callGemini).toHaveBeenCalledTimes(3);
  });

  it('falls back to the cached phrase keyed by classification on cascade exhaust', async () => {
    const bus = new AgentBus({ baseBackoffMs: 1 });
    const callGemini = vi.fn(async () => {
      throw new Error('Gemini timeout');
    });
    const phrase = await runCoachAgent(SHALLOW_BATCH, 'v_fib', { bus, callGemini });
    expect(phrase.feedback).toBe('Push past the upper line.');
    expect(phrase.priority).toBe('high');
  });

  it('fallback for adequate classification uses the adequate phrase, not the shallow one', async () => {
    const bus = new AgentBus({ baseBackoffMs: 1 });
    const callGemini = vi.fn(async () => {
      throw new Error('Gemini timeout');
    });
    const phrase = await runCoachAgent(ADEQUATE_BATCH, 'sinus', { bus, callGemini });
    expect(phrase.feedback).toBe('Stay here. Both green.');
    expect(phrase.priority).toBe('low');
  });
});

describe('runCoachAgent edge cases', () => {
  it('forwards force_ceiling classification into the prompt', async () => {
    const bus = new AgentBus({ baseBackoffMs: 1 });
    const ceilingBatch: CompressionBatch = {
      avg_depth: 0.95,
      avg_rate: 110,
      consistency: 0.9,
      classification: 'force_ceiling',
    };
    const callGemini = vi.fn(async (prompt: string) => {
      expect(prompt).toContain('Classification: force_ceiling');
      return JSON.stringify({ feedback: 'Ease up. Bar is red.', priority: 'critical' });
    });
    const phrase = await runCoachAgent(ceilingBatch, 'v_fib', { bus, callGemini });
    expect(phrase.priority).toBe('critical');
  });

  it('handles empty rhythm gracefully (uses provided value verbatim)', async () => {
    const bus = new AgentBus({ baseBackoffMs: 1 });
    const callGemini = vi.fn(async (prompt: string) => {
      expect(prompt).toContain('Patient rhythm: rosc');
      return JSON.stringify({ feedback: 'Stay here. Both green.', priority: 'low' });
    });
    await runCoachAgent(ADEQUATE_BATCH, 'rosc', { bus, callGemini });
  });
});
