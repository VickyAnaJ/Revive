// Gemini agent JSON schemas (FR3, FR4, FR2, FR11).
// Per design §6f Browser → PatientAgent / CoachAgent / ScenarioAgent contracts.
// Mirror of contracts/agents.py.
import { z } from 'zod';

// PatientAgent input + output (FR3).
export const CompressionBatchSchema = z.object({
  avg_depth: z.number().min(0).max(1),
  avg_rate: z.number().int().min(0).max(220),
  consistency: z.number().min(0).max(1),
  classification: z.enum(['adequate', 'too_shallow', 'too_fast', 'too_slow', 'force_ceiling']),
});

export const PatientStateSchema = z.object({
  hr: z.number().int().min(0).max(220),
  bp: z.string(),  // e.g., "90/60"
  o2: z.number().int().min(0).max(100),
  rhythm: z.enum(['flatline', 'v_fib', 'v_tach', 'weak_pulse', 'sinus', 'rosc']),
  complication: z.string().nullable(),
  patient_speech: z.string().nullable(),
  body_type_feedback: z.string().nullable(),
});

// CoachAgent output (FR2).
export const CoachPhraseSchema = z.object({
  feedback: z.string().max(200),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
});

// ScenarioAgent output (FR4).
export const DecisionNodeSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  options: z.array(z.object({
    id: z.string(),
    label: z.string(),
  })).min(2).max(4),
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

export type CompressionBatch = z.infer<typeof CompressionBatchSchema>;
export type PatientState = z.infer<typeof PatientStateSchema>;
export type CoachPhrase = z.infer<typeof CoachPhraseSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;
export type DecisionNode = z.infer<typeof DecisionNodeSchema>;
