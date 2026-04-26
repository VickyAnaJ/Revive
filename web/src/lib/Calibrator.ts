import { z } from 'zod';

// localStorage key for the persisted profile, per Step 5 plan T4 contract.
const STORAGE_KEY = 'pulseHero.calibration';

// Drift threshold in normalized [0,1] depth space. Step 5 plan specified ">50"
// which referenced raw FSR units (1023 max); translated to normalized as 50/1023.
const DRIFT_THRESHOLD = 0.05;

// Default thresholds used when no profile is persisted yet. Step 5 plan listed
// raw FSR defaults (start=400, target=700, max=900); converted to normalized.
const DEFAULTS = {
  start: 0.4,
  target: 0.7,
  max: 0.9,
} as const;

const CalibrationProfileSchema = z.object({
  start: z.number().min(0).max(1),
  target: z.number().min(0).max(1),
  max: z.number().min(0).max(1),
  capturedAt: z.number().int().nonnegative(),
});

export type CalibrationProfile = z.infer<typeof CalibrationProfileSchema>;
export type CalibrationCapture = Omit<CalibrationProfile, 'capturedAt'>;

export function readCalibration(): CalibrationProfile | null {
  if (typeof localStorage === 'undefined') return null;
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    console.warn('[C10] localStorage.getItem failed', err);
    return null;
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn('[C10] cleared corrupted calibration entry (invalid JSON)');
    safeRemove();
    return null;
  }
  const result = CalibrationProfileSchema.safeParse(parsed);
  if (!result.success) {
    console.warn('[C10] cleared corrupted calibration entry (schema mismatch)');
    safeRemove();
    return null;
  }
  return result.data;
}

export function writeCalibration(profile: CalibrationCapture): CalibrationProfile {
  if (profile.start >= profile.target || profile.target >= profile.max) {
    throw new Error(
      'Calibration thresholds must satisfy start < target < max. Re-run the ritual and capture distinct light, target, and max presses.',
    );
  }
  const full: CalibrationProfile = { ...profile, capturedAt: Date.now() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(full));
  } catch (err) {
    throw new Error(
      `Calibration write failed; localStorage may be full, blocked, or disabled. Original error: ${(err as Error).message}`,
    );
  }
  console.info('[C10] calibration written', full);
  return full;
}

export function clearCalibration(): void {
  safeRemove();
  console.info('[C10] calibration cleared');
}

export function detectDrift(currentMean: number): boolean {
  const profile = readCalibration();
  if (!profile) return false;
  const drift = Math.abs(currentMean - profile.target);
  if (drift > DRIFT_THRESHOLD) {
    console.info(`[C10] drift detected: mean=${currentMean.toFixed(3)} target=${profile.target.toFixed(3)} delta=${drift.toFixed(3)}`);
    return true;
  }
  return false;
}

export function getDefaultProfile(): CalibrationProfile {
  return { ...DEFAULTS, capturedAt: 0 };
}

export const __TESTING__ = {
  STORAGE_KEY,
  DRIFT_THRESHOLD,
  DEFAULTS,
};

function safeRemove(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* swallow; nothing to do if remove also fails */
  }
}
