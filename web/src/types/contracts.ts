// Browser-side mirror of `revive/contracts/serial.ts` (the canonical zod contract
// per design §6f Contract Registry "Arduino → Browser"). Kept local so the web
// bundle resolves `zod` from `web/node_modules` without crossing the workspace
// boundary. Any change here must be mirrored in `contracts/serial.ts` and
// `contracts/serial.py`; drift checked manually in Step 7 review.
import { z } from 'zod';

export const SerialFrameSchema = z.object({
  depth: z.number().min(0).max(1),
  rate: z.number().int().min(0).max(220),
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
