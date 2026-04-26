// Browser-side mirror of `revive/contracts/serial.ts` (the canonical zod contract
// per design §6f Contract Registry "Arduino → Browser"). Kept local so the web
// bundle resolves `zod` from `web/node_modules` without crossing the workspace
// boundary. Any change here must be mirrored in `contracts/serial.ts` and
// `contracts/serial.py`; drift checked manually in Step 7 review.
import { z } from 'zod';

export const SerialFrameSchema = z.object({
  depth: z.number().min(0).max(1),
  // Firmware can emit rates above 220 during sticky-foam wobble when two
  // peaks fire within ~70 ms. We accept the wide range here and clamp
  // downstream in SerialBridge so the public contract for consumers stays
  // [0, 220].
  rate: z.number().int().min(0).max(2000),
  ts: z.number().int().nonnegative(),
});

export type SerialFrame = z.infer<typeof SerialFrameSchema>;

export const SerialReadyFrameSchema = z.object({
  type: z.literal('ready'),
  fw: z.string(),
});

export type SerialReadyFrame = z.infer<typeof SerialReadyFrameSchema>;

export const SerialCeilingFrameSchema = z.object({
  type: z.literal('ceiling'),
  ts: z.number().int().nonnegative(),
});

export type SerialCeilingFrame = z.infer<typeof SerialCeilingFrameSchema>;

// Browser-side mirror of the relevant slice of `revive/contracts/agents.ts`.
// Only `CompressionBatchSchema` lands in S1 (T3 producer; T5 consumer).
// PatientState, CoachPhrase, Scenario schemas are deferred to S2/S3.
export const CompressionBatchSchema = z.object({
  avg_depth: z.number().min(0).max(1),
  avg_rate: z.number().int().min(0).max(220),
  consistency: z.number().min(0).max(1),
  classification: z.enum([
    'adequate',
    'too_shallow',
    'too_fast',
    'too_slow',
    'force_ceiling',
  ]),
});

export type CompressionBatch = z.infer<typeof CompressionBatchSchema>;
export type CompressionClassification = CompressionBatch['classification'];

export const PatientStateSchema = z.object({
  hr: z.number().int().min(0).max(220),
  bp: z.string(),
  o2: z.number().int().min(0).max(100),
  rhythm: z.enum(['flatline', 'v_fib', 'v_tach', 'weak_pulse', 'sinus', 'rosc']),
  complication: z.string().nullable(),
  patient_speech: z.string().nullable(),
  body_type_feedback: z.string().nullable(),
});

export type PatientState = z.infer<typeof PatientStateSchema>;

export const CoachPhraseSchema = z.object({
  feedback: z.string().max(200),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
});

export type CoachPhrase = z.infer<typeof CoachPhraseSchema>;

export const DecisionNodeSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  options: z
    .array(z.object({ id: z.string(), label: z.string() }))
    .min(2)
    .max(4),
  correct_choice_id: z.string(),
  penalty_delta: z.object({
    hr: z.number().int(),
    o2: z.number().int(),
  }),
});

export const ScenarioSchema = z.object({
  scenario_id: z.string().uuid(),
  scenario_type: z.string(),
  location: z.string(),
  patient_profile: z.object({
    age: z.number().int(),
    sex: z.string(),
    body_type: z.string(),
  }),
  decision_tree: z.array(DecisionNodeSchema).min(3).max(4),
});

export type DecisionNode = z.infer<typeof DecisionNodeSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;
