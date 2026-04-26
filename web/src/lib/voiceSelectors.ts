// Voice selectors (S3-T07). Realises pulsehero-design.md §10.4.
//
// Maps patient state to Bystander emotional tier, and decision-phase elapsed
// time to Dispatcher urgency. These are pure functions so they can be unit
// tested without the full voice stack.

const BYSTANDER_VARIANTS: Record<BystanderTier, string[]> = {
  scared: ['scared_1', 'scared_2', 'scared_3'],
  panicked: ['panicked_1', 'panicked_2', 'panicked_3'],
  hysterical: ['hysterical_1', 'hysterical_2', 'hysterical_3'],
  relieved: ['relieved_1', 'relieved_2'],
};

export type BystanderTier = 'scared' | 'panicked' | 'hysterical' | 'relieved';

// Picks an emotional tier from O₂ saturation. ROSC rhythm is a separate
// signal; pass `isRosc=true` to override into 'relieved' regardless of O₂.
export function pickBystanderTier(o2: number, isRosc: boolean): BystanderTier {
  if (isRosc) return 'relieved';
  if (o2 >= 80) return 'scared';
  if (o2 >= 50) return 'panicked';
  return 'hysterical';
}

// Picks a specific clip name from the tier's variant pool. Uses simple
// modulo cycling against an external counter so tests are deterministic
// (no Math.random in the hot path). Page.tsx tracks the counter.
export function pickBystanderClip(tier: BystanderTier, counter: number): string {
  const variants = BYSTANDER_VARIANTS[tier];
  return variants[counter % variants.length];
}
