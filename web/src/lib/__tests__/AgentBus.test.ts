import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { AgentBus } from '../AgentBus';
import { repairJson } from '../jsonRepair';

const TestSchema = z.object({
  value: z.string(),
  count: z.number().int(),
});

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AgentBus successful path (Step 5 unit test a)', () => {
  it('returns the parsed payload on a clean response', async () => {
    const bus = new AgentBus({ baseBackoffMs: 1 });
    const result = await bus.call({
      agent: 'patient',
      schema: TestSchema,
      performCall: async () => '{"value":"ok","count":42}',
      fallback: () => ({ value: 'fallback', count: 0 }),
    });
    expect(result).toEqual({ value: 'ok', count: 42 });
    const stats = bus.getStats('patient');
    expect(stats.attempts).toBe(1);
    expect(stats.repairedJson).toBe(false);
    expect(stats.fellBack).toBe(false);
  });
});

describe('AgentBus JSON repair (Step 5 unit test b)', () => {
  it('repairs a markdown-fenced response and parses', async () => {
    const wrapped = '```json\n{"value":"hi","count":3}\n```';
    const bus = new AgentBus({ baseBackoffMs: 1 });
    const result = await bus.call({
      agent: 'coach',
      schema: TestSchema,
      performCall: async () => wrapped,
      fallback: () => ({ value: 'fallback', count: 0 }),
    });
    expect(result.value).toBe('hi');
    expect(bus.getStats('coach').repairedJson).toBe(true);
  });

  it('repairs trailing prose around the JSON', async () => {
    const noisy = 'Sure, here you go: {"value":"x","count":1} hope that helps!';
    const bus = new AgentBus({ baseBackoffMs: 1 });
    const result = await bus.call({
      agent: 'coach',
      schema: TestSchema,
      performCall: async () => noisy,
      fallback: () => ({ value: 'fallback', count: 0 }),
    });
    expect(result.value).toBe('x');
  });

  it('repairs trailing comma before closing brace', async () => {
    const trailing = '{"value":"y","count":2,}';
    const bus = new AgentBus({ baseBackoffMs: 1 });
    const result = await bus.call({
      agent: 'coach',
      schema: TestSchema,
      performCall: async () => trailing,
      fallback: () => ({ value: 'fallback', count: 0 }),
    });
    expect(result.count).toBe(2);
  });

  it('repairs single-quoted strings', async () => {
    const single = "{'value':'z','count':5}";
    const bus = new AgentBus({ baseBackoffMs: 1 });
    const result = await bus.call({
      agent: 'coach',
      schema: TestSchema,
      performCall: async () => single,
      fallback: () => ({ value: 'fallback', count: 0 }),
    });
    expect(result.value).toBe('z');
  });
});

describe('AgentBus retry and cascade fallback (Step 5 unit test c, d)', () => {
  it('falls back after maxAttempts of timeouts', async () => {
    const bus = new AgentBus({ baseBackoffMs: 1 });
    const result = await bus.call({
      agent: 'scenario',
      schema: TestSchema,
      performCall: async () => {
        throw new Error('Gemini timeout');
      },
      fallback: () => ({ value: 'cached', count: -1 }),
    });
    expect(result).toEqual({ value: 'cached', count: -1 });
    const stats = bus.getStats('scenario');
    expect(stats.attempts).toBe(3);
    expect(stats.fellBack).toBe(true);
  });

  it('returns the first successful response after earlier failures', async () => {
    let attempt = 0;
    const bus = new AgentBus({ baseBackoffMs: 1 });
    const result = await bus.call({
      agent: 'patient',
      schema: TestSchema,
      performCall: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('Network error');
        if (attempt === 2) return 'not even close to JSON';
        return '{"value":"recovered","count":7}';
      },
      fallback: () => ({ value: 'cached', count: -1 }),
    });
    expect(result.value).toBe('recovered');
    expect(bus.getStats('patient').attempts).toBe(3);
    expect(bus.getStats('patient').fellBack).toBe(false);
  });

  it('resets attempt counter per call', async () => {
    const bus = new AgentBus({ baseBackoffMs: 1 });
    await bus.call({
      agent: 'patient',
      schema: TestSchema,
      performCall: async () => {
        throw new Error('always fail');
      },
      fallback: () => ({ value: 'cached', count: 0 }),
    });
    expect(bus.getStats('patient').attempts).toBe(3);
    await bus.call({
      agent: 'patient',
      schema: TestSchema,
      performCall: async () => '{"value":"ok","count":1}',
      fallback: () => ({ value: 'cached', count: 0 }),
    });
    expect(bus.getStats('patient').attempts).toBe(1);
    expect(bus.getStats('patient').fellBack).toBe(false);
  });
});

describe('AgentBus exponential backoff (Step 5 unit test e)', () => {
  it('respects 200/400/800 ms delays between attempts', async () => {
    const sleeps: number[] = [];
    const bus = new AgentBus({
      baseBackoffMs: 200,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    });
    await bus.call({
      agent: 'patient',
      schema: TestSchema,
      performCall: async () => {
        throw new Error('always fail');
      },
      fallback: () => ({ value: 'cached', count: 0 }),
    });
    expect(sleeps).toEqual([200, 400]);
  });
});

describe('AgentBus schema rejection (Step 5 edge case)', () => {
  it('treats schema mismatch as an error and retries', async () => {
    let attempt = 0;
    const bus = new AgentBus({ baseBackoffMs: 1 });
    await bus.call({
      agent: 'patient',
      schema: TestSchema,
      performCall: async () => {
        attempt += 1;
        if (attempt < 3) return '{"value":"missing_count_field"}';
        return '{"value":"ok","count":1}';
      },
      fallback: () => ({ value: 'cached', count: 0 }),
    });
    expect(bus.getStats('patient').attempts).toBe(3);
    expect(bus.getStats('patient').fellBack).toBe(false);
  });
});

describe('jsonRepair direct unit tests', () => {
  it('passes through a clean JSON string unchanged', () => {
    expect(repairJson('{"a":1}')).toBe('{"a":1}');
  });

  it('strips a json fence', () => {
    expect(repairJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('extracts JSON from prose', () => {
    expect(repairJson('Reply: {"a":1} thanks')).toBe('{"a":1}');
  });

  it('removes trailing commas', () => {
    expect(repairJson('{"a":1,"b":2,}')).toBe('{"a":1,"b":2}');
  });

  it('converts single quotes', () => {
    const repaired = repairJson("{'a':'x','b':2}");
    const parsed = JSON.parse(repaired);
    expect(parsed).toEqual({ a: 'x', b: 2 });
  });
});
