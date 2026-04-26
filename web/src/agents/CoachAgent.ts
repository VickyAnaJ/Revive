// C5b CoachAgent (FT-C5b). Realises the text-emission half of FR2 (voice
// playback wraps this in S3).
//
// Generates one corrective phrase per qualifying CompressionBatch, returned as
// `{feedback: string <=200 chars, priority: enum}`. The prompt is constrained
// to simulator-honest language: phrases reference UI elements (depth bar
// lines, rate-counter color, ceiling flash), never clinical metrics like
// "two inches" or "110 BPM as a clinical target." This honors design §1
// scope boundary which says PulseHero teaches rhythm and force calibration
// only, not clinical depth.

import {
  CoachPhraseSchema,
  type CoachPhrase,
  type CompressionBatch,
  type PatientState,
} from '@/types/contracts';
import type { AgentBus } from '@/lib/AgentBus';
import { getCoachPhrase } from '@/lib/OfflineCache';

export function buildCoachAgentPrompt(
  batch: CompressionBatch,
  patientRhythm: PatientState['rhythm'],
): string {
  return [
    'You are a CPR simulator coach. The user trains on a foam pad with a screen showing:',
    '  - A vertical depth bar with a gray "minimum" line and an emerald "target" line.',
    '  - A rate counter that turns emerald between 100 and 120 compressions per minute.',
    '  - The depth bar turns red on a sustained press above the safe ceiling.',
    '',
    'Speak in SCREEN TERMS only. Reference the bar lines, the green target band, and the red ceiling flash.',
    'Do NOT reference clinical metrics like "two inches", "millimeters", "millimoles", or "X BPM" as a depth measurement.',
    'Reinforce rhythm first, force consistency second.',
    'Keep the phrase to ONE sentence. Maximum 200 characters.',
    '',
    `Latest compression batch:`,
    `  Average depth: ${batch.avg_depth.toFixed(2)} normalized 0 to 1`,
    `  Average rate: ${batch.avg_rate}`,
    `  Consistency: ${batch.consistency.toFixed(2)}`,
    `  Classification: ${batch.classification}`,
    `Patient rhythm: ${patientRhythm}`,
    '',
    'Return JSON only with this shape:',
    '{',
    '  "feedback": one sentence string under 200 characters,',
    '  "priority": "low" or "medium" or "high" or "critical"',
    '}',
    '',
    'Priority guide:',
    '  low: rhythm green and depth above target line - praise and hold.',
    '  medium: minor drift outside the green band.',
    '  high: classification too_shallow or too_slow that can be fixed in one cycle.',
    '  critical: force_ceiling, sustained flatline, or rib fracture risk.',
  ].join('\n');
}

export interface RunCoachAgentDeps {
  bus: AgentBus;
  callGemini: (prompt: string) => Promise<string>;
}

export async function runCoachAgent(
  batch: CompressionBatch,
  patientRhythm: PatientState['rhythm'],
  deps: RunCoachAgentDeps,
): Promise<CoachPhrase> {
  const prompt = buildCoachAgentPrompt(batch, patientRhythm);
  return deps.bus.call({
    agent: 'coach',
    schema: CoachPhraseSchema,
    performCall: () => deps.callGemini(prompt),
    fallback: () => getCoachPhrase(batch.classification),
  });
}
