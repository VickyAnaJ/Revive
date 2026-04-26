// C5c ScenarioAgent (FT-C5c). Realises FR4.
//
// Generates one Scenario per session including location, demographics, body
// type, and 3-4 decision points. Cached at the session level: same seed
// returns the same scenario without re-calling Gemini, so a judge replaying
// from a "Reset" button does not burn quota and does not get an inconsistent
// scenario after partial progression.

import {
  ScenarioSchema,
  type Scenario,
} from '@/types/contracts';
import type { AgentBus } from '@/lib/AgentBus';
import { getScenario as getCachedScenario } from '@/lib/OfflineCache';

export type Difficulty = 'beginner' | 'intermediate' | 'advanced';

export function buildScenarioAgentPrompt(
  seed: string,
  difficulty: Difficulty,
): string {
  return [
    'You generate a CPR training scenario for a foam-pad simulator.',
    '',
    'The simulator teaches rhythm, force calibration, and emergency decision making.',
    'It does NOT teach hand placement or rescue breath mechanics.',
    'Scenarios should test the user\'s ability to act under pressure and choose correctly.',
    '',
    `Seed: ${seed}`,
    `Difficulty: ${difficulty}`,
    '',
    'Generate a unique scenario with these fields:',
    '  - scenario_id: a UUID (version 4 format).',
    '  - scenario_type: short snake_case label, for example "cardiac_arrest".',
    '  - location: a short descriptive string (one phrase).',
    '  - patient_profile:',
    '      age: integer years',
    '      sex: short string',
    '      body_type: one of "adult_large", "adult_average", "child", "elderly"',
    '  - decision_tree: 3 or 4 decision nodes. Each node:',
    '      id: short string (e.g. "d1", "d2", "d3", "d4")',
    '      prompt: one or two sentences describing the situation',
    '      options: 2 to 4 choices, each with id and label',
    '      correct_choice_id: string matching one of the option ids',
    '      penalty_delta: { hr: signed integer, o2: signed integer }',
    '',
    'Difficulty rules:',
    '  beginner: 3 decisions, options clearly correct or clearly wrong, low penalties',
    '  intermediate: 3-4 decisions, some plausible distractors, moderate penalties',
    '  advanced: 4 decisions, complications mid-scenario, sharp penalties',
    '',
    'Return JSON only, exactly this shape, no prose around it.',
  ].join('\n');
}

export interface RunScenarioAgentDeps {
  bus: AgentBus;
  callGemini: (prompt: string) => Promise<string>;
}

export class ScenarioCache {
  private readonly entries = new Map<string, Scenario>();

  has(seed: string): boolean {
    return this.entries.has(seed);
  }

  get(seed: string): Scenario | undefined {
    return this.entries.get(seed);
  }

  set(seed: string, scenario: Scenario): void {
    this.entries.set(seed, scenario);
  }

  clear(): void {
    this.entries.clear();
  }
}

export async function runScenarioAgent(
  seed: string,
  difficulty: Difficulty,
  deps: RunScenarioAgentDeps,
  cache: ScenarioCache,
): Promise<Scenario> {
  const cached = cache.get(seed);
  if (cached) {
    return cached;
  }

  const prompt = buildScenarioAgentPrompt(seed, difficulty);
  const scenario = await deps.bus.call({
    agent: 'scenario',
    schema: ScenarioSchema,
    performCall: () => deps.callGemini(prompt),
    fallback: () => getCachedScenario(seed),
  });
  cache.set(seed, scenario);
  return scenario;
}
