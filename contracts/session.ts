// Session record schema written by C11 LocalSessionLog at scenario debrief (FR9).
// Per design §6f Backend → File system contract row.
// Mirror of contracts/session.py.
import { z } from 'zod';

export const CompressionEventSchema = z.object({
  ts: z.number().int(),
  depth: z.number(),
  rate: z.number().int(),
  is_adequate: z.boolean(),
  recoil_complete: z.boolean(),
});

export const DecisionEventSchema = z.object({
  decision_point: z.string(),
  choice_made: z.string().nullable(),
  correct_choice: z.string(),
  is_correct: z.boolean(),
  time_to_decide_seconds: z.number(),
});

export const ErrorEventSchema = z.object({
  ts: z.number().int(),
  component: z.string(),
  error_code: z.string(),
  fallback_used: z.string().nullable(),
});

export const SessionRecordSchema = z.object({
  session_id: z.string().uuid(),
  scenario_type: z.string(),
  started_at: z.string().datetime(),
  ended_at: z.string().datetime(),
  patient_survived: z.boolean(),
  overall_score: z.number(),
  response_time_seconds: z.number(),
  compressions: z.array(CompressionEventSchema),
  decisions: z.array(DecisionEventSchema),
  errors: z.array(ErrorEventSchema),
});

export type CompressionEvent = z.infer<typeof CompressionEventSchema>;
export type DecisionEvent = z.infer<typeof DecisionEventSchema>;
export type ErrorEvent = z.infer<typeof ErrorEventSchema>;
export type SessionRecord = z.infer<typeof SessionRecordSchema>;
