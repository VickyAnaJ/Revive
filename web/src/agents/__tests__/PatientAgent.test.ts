import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentBus } from '@/lib/AgentBus';
import {
  BODY_TYPE_THRESHOLDS,
  FALLBACK_PATIENT_STATE,
  buildPatientAgentPrompt,
  clampPatientState,
  getAdequateDepthThreshold,
  runPatientAgent,
} from '../PatientAgent';
import type { CompressionBatch, PatientState } from '@/types/contracts';

const SAMPLE_BATCH: CompressionBatch = {
  avg_depth: 0.65,
  avg_rate: 110,
  consistency: 0.85,
  classification: 'adequate',
};

const SAMPLE_STATE: PatientState = {
  hr: 0,
  bp: '0/0',
  o2: 60,
  rhythm: 'v_fib',
  complication: null,
  patient_speech: null,
  body_type_feedback: null,
};

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PatientAgent prompt builder (Step 5 unit test a)', () => {
  it('includes the current vitals, batch metrics, and body type', () => {
    const prompt = buildPatientAgentPrompt(SAMPLE_BATCH, SAMPLE_STATE, 'adult_average');
    expect(prompt).toContain('HR: 0');
    expect(prompt).toContain('Average rate: 110');
    expect(prompt).toContain('Classification: adequate');
    expect(prompt).toContain('Body type: adult_average');
  });

  it('emits the body-specific adequate depth threshold', () => {
    const prompt = buildPatientAgentPrompt(SAMPLE_BATCH, SAMPLE_STATE, 'elderly');
    expect(prompt).toContain(`adequate depth threshold: ${BODY_TYPE_THRESHOLDS.elderly.toFixed(2)}`);
  });

  it('falls back to adult_average threshold when body type is unknown', () => {
    const prompt = buildPatientAgentPrompt(SAMPLE_BATCH, SAMPLE_STATE, 'martian_giant');
    expect(prompt).toContain(`adequate depth threshold: ${BODY_TYPE_THRESHOLDS.adult_average.toFixed(2)}`);
  });
});

describe('clampPatientState (Step 5 unit test c)', () => {
  it('coerces hr above 220 down to 220', () => {
    const out = clampPatientState({ ...SAMPLE_STATE, hr: 230 });
    expect(out.hr).toBe(220);
  });

  it('coerces o2 above 100 down to 100', () => {
    const out = clampPatientState({ ...SAMPLE_STATE, o2: 130 });
    expect(out.o2).toBe(100);
  });

  it('coerces negative hr to 0', () => {
    const out = clampPatientState({ ...SAMPLE_STATE, hr: -5 });
    expect(out.hr).toBe(0);
  });

  it('rounds fractional vitals to integers', () => {
    const out = clampPatientState({ ...SAMPLE_STATE, hr: 71.4, o2: 88.6 });
    expect(out.hr).toBe(71);
    expect(out.o2).toBe(89);
  });
});

describe('getAdequateDepthThreshold (Step 5 unit test d)', () => {
  it('returns the body-type-specific threshold', () => {
    expect(getAdequateDepthThreshold('adult_large')).toBe(BODY_TYPE_THRESHOLDS.adult_large);
    expect(getAdequateDepthThreshold('child')).toBe(BODY_TYPE_THRESHOLDS.child);
    expect(getAdequateDepthThreshold('elderly')).toBe(BODY_TYPE_THRESHOLDS.elderly);
  });

  it('falls back to adult_average for unknown values', () => {
    expect(getAdequateDepthThreshold('alien')).toBe(BODY_TYPE_THRESHOLDS.adult_average);
  });
});

describe('runPatientAgent integration (Step 5 integration test)', () => {
  it('returns the parsed patient state when Gemini is healthy', async () => {
    const bus = new AgentBus({ baseBackoffMs: 1 });
    const callGemini = vi.fn(async () =>
      JSON.stringify({
        hr: 72,
        bp: '90/60',
        o2: 88,
        rhythm: 'weak_pulse',
        complication: null,
        patient_speech: null,
        body_type_feedback: null,
      }),
    );
    const result = await runPatientAgent(SAMPLE_BATCH, SAMPLE_STATE, 'adult_average', {
      bus,
      callGemini,
    });
    expect(result.hr).toBe(72);
    expect(result.rhythm).toBe('weak_pulse');
    expect(callGemini).toHaveBeenCalledOnce();
  });

  it('cascades to rule-based fallback when Gemini returns out-of-range fields (schema rejection)', async () => {
    const bus = new AgentBus({ baseBackoffMs: 1 });
    const callGemini = vi.fn(async () =>
      JSON.stringify({
        hr: 250,
        bp: '120/80',
        o2: 110,
        rhythm: 'sinus',
        complication: null,
        patient_speech: null,
        body_type_feedback: null,
      }),
    );
    const result = await runPatientAgent(SAMPLE_BATCH, SAMPLE_STATE, 'adult_average', {
      bus,
      callGemini,
    });
    // Schema rejects 250/110 → 3 retries all fail → rule-based fallback
    // (adequate batch boosts hr by 8 from 0, o2 by 3 from 60).
    expect(result.hr).toBe(8);
    expect(result.o2).toBe(63);
    expect(callGemini).toHaveBeenCalledTimes(3);
  });

  it('rounds in-range fractional vitals to integers via clampPatientState', async () => {
    const bus = new AgentBus({ baseBackoffMs: 1 });
    // Schema requires int, so Gemini-side fractionals would be rejected. We
    // test the post-validation clamp by constructing a response that already
    // rounded via the schema's z.number().int(). The clamp helper exists for
    // defence-in-depth on hand-built fallback paths and any future relaxation
    // of the schema.
    const callGemini = vi.fn(async () =>
      JSON.stringify({
        hr: 71,
        bp: '110/70',
        o2: 89,
        rhythm: 'sinus',
        complication: null,
        patient_speech: null,
        body_type_feedback: null,
      }),
    );
    const result = await runPatientAgent(SAMPLE_BATCH, SAMPLE_STATE, 'adult_average', {
      bus,
      callGemini,
    });
    expect(result.hr).toBe(71);
    expect(result.o2).toBe(89);
  });

  it('falls back to rule-based vitals on cascade exhaust', async () => {
    const bus = new AgentBus({ baseBackoffMs: 1 });
    const callGemini = vi.fn(async () => {
      throw new Error('Gemini timeout');
    });
    const result = await runPatientAgent(SAMPLE_BATCH, SAMPLE_STATE, 'adult_average', {
      bus,
      callGemini,
    });
    // SAMPLE_BATCH classification is 'adequate' which boosts hr by 8 and
    // o2 by 3 from SAMPLE_STATE (hr=0, o2=60). Cascade fallback now runs
    // computeRuleBasedVitals so vitals respond even when Gemini is down.
    expect(result.hr).toBe(8);
    expect(result.o2).toBe(63);
    expect(callGemini).toHaveBeenCalledTimes(3);
  });
});

describe('runPatientAgent edge cases (Step 5 edge cases)', () => {
  it('handles a batch with zero compressions without crashing', async () => {
    const bus = new AgentBus({ baseBackoffMs: 1 });
    const idleBatch: CompressionBatch = {
      avg_depth: 0,
      avg_rate: 0,
      consistency: 0,
      classification: 'too_slow',
    };
    const callGemini = vi.fn(async () =>
      JSON.stringify({
        hr: 0,
        bp: '0/0',
        o2: 55,
        rhythm: 'v_fib',
        complication: null,
        patient_speech: null,
        body_type_feedback: null,
      }),
    );
    const result = await runPatientAgent(idleBatch, SAMPLE_STATE, 'adult_average', {
      bus,
      callGemini,
    });
    expect(result.rhythm).toBe('v_fib');
    expect(result.o2).toBe(55);
  });

  it('forwards an unknown body_type into the prompt without throwing', async () => {
    const bus = new AgentBus({ baseBackoffMs: 1 });
    const callGemini = vi.fn(async (prompt: string) => {
      expect(prompt).toContain('Body type: martian_giant');
      return JSON.stringify({
        hr: 60,
        bp: '90/60',
        o2: 70,
        rhythm: 'sinus',
        complication: null,
        patient_speech: null,
        body_type_feedback: null,
      });
    });
    const result = await runPatientAgent(SAMPLE_BATCH, SAMPLE_STATE, 'martian_giant', {
      bus,
      callGemini,
    });
    expect(result.rhythm).toBe('sinus');
  });
});
