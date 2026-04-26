// C5a PatientAgent (FT-C5a). Realises FR3.
//
// Consumes a CompressionBatch every 2 seconds and returns updated simulated
// patient vitals as a `PatientState`. Calls Gemini through the C5d AgentBus
// so retry, JSON repair, and cascade fallback are uniform across all agents.

import {
  PatientStateSchema,
  type PatientState,
  type CompressionBatch,
} from '@/types/contracts';
import type { AgentBus } from '@/lib/AgentBus';

// Tuned to real FSR-through-1.5"-foam hardware. Matches BODY_TYPE_TARGET in
// CompressionScorer so the Gemini prompt and the local classifier agree on
// what depth is "adequate" for each body type.
export const BODY_TYPE_THRESHOLDS = {
  adult_large: 0.22,
  adult_average: 0.16,
  elderly: 0.12,
  child: 0.09,
} as const;

export type BodyType = keyof typeof BODY_TYPE_THRESHOLDS;

export const FALLBACK_PATIENT_STATE: PatientState = {
  hr: 0,
  bp: '0/0',
  o2: 60,
  rhythm: 'v_fib',
  complication: null,
  patient_speech: null,
  body_type_feedback: null,
};

// Rhythm-aware BP. Real BP is driven by perfusion state, not just HR. The old
// `HR × 1.4` formula clamped at 180/110 produced BP = 180/110 at HR > 128 —
// a hypertensive-crisis number that misrepresented every successful ROSC.
// Now BP follows rhythm: pulseless → poor perfusion, weak_pulse → low,
// sinus → climbs modestly with HR, rosc → settled stable.
export function computeBP(hr: number, rhythm: PatientState['rhythm']): string {
  if (hr === 0 || rhythm === 'flatline') return '0/0';
  switch (rhythm) {
    case 'v_fib':
    case 'v_tach':
      return '60/40';
    case 'weak_pulse':
      return '80/55';
    case 'sinus': {
      const sys = Math.max(80, Math.min(140, 90 + Math.round((hr - 60) * 0.4)));
      const dia = Math.max(50, Math.min(90, 60 + Math.round((hr - 60) * 0.2)));
      return `${sys}/${dia}`;
    }
    case 'rosc':
      return '120/78';
  }
  return '90/60';
}

// Deterministic rule-based vitals used when Gemini cascades exhaust (FM3
// recovery class per design §6g). Updates HR / O2 / rhythm based on the
// latest CompressionBatch so the demo still shows responsive vitals when
// the cloud is rate limited or unreachable.
export function computeRuleBasedVitals(
  batch: CompressionBatch,
  current: PatientState,
): PatientState {
  let hr = current.hr;
  let o2 = current.o2;
  let rhythm = current.rhythm;
  let speech: string | null = null;

  // Post-ROSC settling: drift toward stable HR 80 / O2 95 instead of
  // continuing the +12/+4 climb that produced runaway sinus tachycardia
  // (HR 166 with rhythm=rosc — clinically nonsensical).
  if (rhythm === 'rosc') {
    if (batch.avg_rate === 0 && batch.avg_depth === 0) {
      hr = Math.max(60, hr - 1);
      o2 = Math.max(90, o2 - 1);
    } else {
      if (hr > 85) hr -= 1;
      else if (hr < 75) hr += 1;
      if (o2 < 96) o2 += 1;
    }
  } else {
    // Tuned for a 30-50s demo arc — judges need to feel the recovery
    // happen, not blink and miss it. +8/+3 means 0-wrong takes ~22s adequate
    // CPR to ROSC, 3-wrong takes ~42s. Was +12/+4 (16s / 32s) which felt
    // rushed on the booth floor.
    if (batch.classification === 'adequate') {
      hr += 8;
      o2 += 3;
    } else if (batch.classification === 'too_shallow') {
      hr += 1;
      o2 += 1;
    } else if (batch.classification === 'too_fast' || batch.classification === 'too_slow') {
      hr += 3;
      o2 += 1;
    } else if (batch.classification === 'force_ceiling') {
      // Sustained over-pressure does not help and harms an elderly chest.
      o2 -= 2;
    }

    if (batch.avg_rate === 0 && batch.avg_depth === 0) {
      hr = Math.max(0, hr - 6);
      o2 = Math.max(0, o2 - 2);
    }
  }

  hr = Math.max(0, Math.min(220, hr));
  o2 = Math.max(0, Math.min(100, o2));

  if (rhythm === 'v_fib' && hr >= 40 && o2 >= 80) {
    rhythm = 'weak_pulse';
  }
  if (rhythm === 'weak_pulse' && hr >= 60 && o2 >= 90) {
    rhythm = 'sinus';
    speech = 'Where am I?';
  }
  if (rhythm === 'sinus' && hr >= 70 && o2 >= 92) {
    rhythm = 'rosc';
    // Clinical realism on the rule-based path. Without this clamp, the
    // promotion tick can carry HR=158 / O₂=99 into ROSC because the +8
    // delta was applied this same tick. clampPatientState catches the
    // Gemini path; this catches the rule-based path.
    hr = Math.max(60, Math.min(100, hr));
    o2 = Math.max(92, Math.min(100, o2));
  }

  // Pre-ROSC sinus clamp. Without this, the +8 HR per adequate batch climbs
  // unbounded during the sinus phase and the live UI shows HR=223 before
  // promotion fires. Real sinus tachycardia maxes around 130. Mirrors the
  // sinus clamp in clampPatientState so both rule-based and Gemini paths
  // produce the same physiologic bounds.
  if (rhythm === 'sinus') {
    hr = Math.max(50, Math.min(130, hr));
  }
  // Terminal flatline rule. Gemini PatientAgent normally calls time-of-death
  // when it sees sustained no-CPR or sustained over-pressure (FM3 first line),
  // but when the agent cascades — quota exhaustion, network failure, JSON
  // parse fail × 3 — execution lands here. Without this fallback the patient
  // would be stuck at v_fib forever and the lose path would never trigger.
  // HR and O2 are both clamped at 0 → no perfusion at all → flatline.
  if (hr === 0 && o2 === 0) {
    rhythm = 'flatline';
    speech = null;
  }

  return {
    hr,
    bp: computeBP(hr, rhythm),
    o2,
    rhythm,
    complication: null,
    patient_speech: speech,
    body_type_feedback: null,
  };
}

export function getAdequateDepthThreshold(bodyType: string): number {
  if (bodyType in BODY_TYPE_THRESHOLDS) {
    return BODY_TYPE_THRESHOLDS[bodyType as BodyType];
  }
  return BODY_TYPE_THRESHOLDS.adult_average;
}

export function buildPatientAgentPrompt(
  batch: CompressionBatch,
  currentState: PatientState,
  bodyType: string,
): string {
  const threshold = getAdequateDepthThreshold(bodyType);
  return [
    'You simulate a cardiac arrest patient receiving CPR.',
    '',
    'Current patient state:',
    `  HR: ${currentState.hr}`,
    `  BP: ${currentState.bp}`,
    `  O2: ${currentState.o2}`,
    `  Rhythm: ${currentState.rhythm}`,
    '',
    `Body type: ${bodyType} (adequate depth threshold: ${threshold.toFixed(2)})`,
    '',
    'Latest compression batch (2-second window):',
    `  Average depth: ${batch.avg_depth.toFixed(2)} normalized 0 to 1`,
    `  Average rate: ${batch.avg_rate} BPM`,
    `  Consistency: ${batch.consistency.toFixed(2)}`,
    `  Classification: ${batch.classification}`,
    '',
    'Update the patient state realistically. Rules:',
    '- Adequate depth + rate 100 to 120: HR climbs 5 to 15, O2 climbs 2 to 5.',
    '- Inadequate compressions: vitals drift down.',
    '- If current O2 is below 50, recovery is slow: cap HR climb at 5 and O2 climb at 2 per cycle until O2 reaches 70. This reflects deep hypoxia from delayed bystander action.',
    '- After 30 seconds of sustained adequate CPR: chance of ROSC (rhythm sinus, hr 60 to 90, o2 above 90).',
    '- Post-ROSC vitals are stable: HR 60 to 100, BP near 120/80. Do NOT let HR climb past 100 once rhythm is rosc.',
    '- Excessive force on elderly or child body type: rib fracture complication.',
    '- No compressions for two cycles: drop HR by 10 and O2 by 3 per cycle. If HR reaches 0 and O2 reaches 0, set rhythm to flatline.',
    '- Patient speech only on ROSC or near ROSC; otherwise null.',
    '',
    'Return JSON only with this exact shape:',
    '{',
    '  "hr": int 0 to 220,',
    '  "bp": "sys/dia" string,',
    '  "o2": int 0 to 100,',
    '  "rhythm": "flatline" or "v_fib" or "v_tach" or "weak_pulse" or "sinus" or "rosc",',
    '  "complication": string or null,',
    '  "patient_speech": string or null,',
    '  "body_type_feedback": string or null',
    '}',
  ].join('\n');
}

export function clampPatientState(state: PatientState): PatientState {
  let hr = Math.max(0, Math.min(220, Math.round(state.hr)));
  let o2 = Math.max(0, Math.min(100, Math.round(state.o2)));
  let rhythm = state.rhythm;
  let bp = state.bp;

  // Hard physiologic invariant: HR=0 ∧ O₂=0 means no perfusion → flatline,
  // regardless of what Gemini emitted. Hardens the FM3 lose path against
  // Gemini omitting an explicit kill rule from its prompt.
  if (hr === 0 && o2 === 0) {
    rhythm = 'flatline';
    bp = '0/0';
  }

  // Post-ROSC clinical clamps. Real ROSC has stable HR 60–100 and BP near
  // 120/80. Without this, Gemini occasionally returns runaway sinus
  // tachycardia (HR 166 with rhythm=rosc) and the rule-based BP formula
  // ceiling-clamps at 180/110. Force realism for any path that emits rosc.
  if (rhythm === 'rosc') {
    hr = Math.max(60, Math.min(100, hr));
    o2 = Math.max(92, Math.min(100, o2));
    bp = '120/78';
  }

  // Sinus rhythm clamp. Catches the case where Gemini emits rhythm=sinus
  // with HR=220 — clinically that's V-tach territory, not sinus. Real
  // sinus tachycardia maxes around 150. Clamping here also prevents the
  // legacy "sinus + o2>=90 → rosc" path from carrying a wild HR through
  // to debrief.
  if (rhythm === 'sinus') {
    hr = Math.max(50, Math.min(130, hr));
  }

  return { ...state, hr, o2, rhythm, bp };
}

export interface RunPatientAgentDeps {
  bus: AgentBus;
  callGemini: (prompt: string) => Promise<string>;
}

export async function runPatientAgent(
  batch: CompressionBatch,
  currentState: PatientState,
  bodyType: string,
  deps: RunPatientAgentDeps,
): Promise<PatientState> {
  const prompt = buildPatientAgentPrompt(batch, currentState, bodyType);
  const result = await deps.bus.call({
    agent: 'patient',
    schema: PatientStateSchema,
    performCall: () => deps.callGemini(prompt),
    fallback: () => computeRuleBasedVitals(batch, currentState),
  });
  return clampPatientState(result);
}
