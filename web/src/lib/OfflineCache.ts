import {
  ScenarioSchema,
  CoachPhraseSchema,
  type Scenario,
  type CoachPhrase,
  type CompressionClassification,
} from '@/types/contracts';

const SCENARIO_FILES = [
  'cardiac_arrest_park.json',
  'cardiac_arrest_office.json',
  'cardiac_arrest_restaurant.json',
  'cardiac_arrest_gym.json',
  'cardiac_arrest_home.json',
] as const;

type PhrasesBundle = Record<CompressionClassification, CoachPhrase>;

let scenarioCache: readonly Scenario[] | null = null;
let phrasesCache: PhrasesBundle | null = null;

export async function loadFixtures(fetchImpl: typeof fetch = fetch): Promise<void> {
  const scenarios: Scenario[] = [];
  for (const file of SCENARIO_FILES) {
    const url = `/fallback/scenarios/${file}`;
    const res = await fetchImpl(url);
    if (!res.ok) {
      throw new Error(
        `[C13] Failed to load scenario fixture ${url} (status ${res.status}). Verify the file exists at web/public/fallback/scenarios/.`,
      );
    }
    const json: unknown = await res.json();
    const parsed = ScenarioSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(
        `[C13] Scenario fixture ${file} failed schema validation. Cache rot detected. Issues: ${parsed.error.issues
          .map((i) => `${i.path.join('.')} ${i.message}`)
          .join('; ')}`,
      );
    }
    scenarios.push(parsed.data);
  }
  scenarioCache = scenarios;

  const phrasesUrl = '/fallback/phrases.json';
  const res = await fetchImpl(phrasesUrl);
  if (!res.ok) {
    throw new Error(
      `[C13] Failed to load phrases fixture ${phrasesUrl} (status ${res.status}). Verify the file exists at web/public/fallback/phrases.json.`,
    );
  }
  const phrasesJson: unknown = await res.json();
  const requiredKeys: CompressionClassification[] = [
    'adequate',
    'too_shallow',
    'too_fast',
    'too_slow',
    'force_ceiling',
  ];
  if (typeof phrasesJson !== 'object' || phrasesJson === null) {
    throw new Error('[C13] phrases.json is not an object. Cache rot detected.');
  }
  const bundle: Partial<PhrasesBundle> = {};
  for (const key of requiredKeys) {
    const entry = (phrasesJson as Record<string, unknown>)[key];
    const parsed = CoachPhraseSchema.safeParse(entry);
    if (!parsed.success) {
      throw new Error(
        `[C13] phrases.${key} failed schema validation. Cache rot detected. Issues: ${parsed.error.issues
          .map((i) => `${i.path.join('.')} ${i.message}`)
          .join('; ')}`,
      );
    }
    bundle[key] = parsed.data;
  }
  phrasesCache = bundle as PhrasesBundle;

  console.info(
    `[C13] loaded ${scenarios.length} scenarios, ${requiredKeys.length} phrases`,
  );
}

export function getScenario(seed: string): Scenario {
  if (!scenarioCache) {
    throw new Error('[C13] OfflineCache not loaded. Call loadFixtures() first.');
  }
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return scenarioCache[hash % scenarioCache.length];
}

export function getCoachPhrase(classification: CompressionClassification): CoachPhrase {
  if (!phrasesCache) {
    throw new Error('[C13] OfflineCache not loaded. Call loadFixtures() first.');
  }
  return phrasesCache[classification];
}

export const __TESTING__ = {
  reset(): void {
    scenarioCache = null;
    phrasesCache = null;
  },
};
