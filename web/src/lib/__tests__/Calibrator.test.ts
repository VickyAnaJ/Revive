import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  readCalibration,
  writeCalibration,
  clearCalibration,
  detectDrift,
  getDefaultProfile,
  __TESTING__,
} from '../Calibrator';

const KEY = __TESTING__.STORAGE_KEY;

describe('Calibrator read/write (Step 5 unit tests a-c)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('a) writeCalibration then readCalibration round-trips', () => {
    const t0 = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(t0);
    const written = writeCalibration({ start: 0.4, target: 0.7, max: 0.9 });
    expect(written.capturedAt).toBe(t0);

    const read = readCalibration();
    expect(read).toEqual({ start: 0.4, target: 0.7, max: 0.9, capturedAt: t0 });
  });

  it('b) missing localStorage entry returns null', () => {
    expect(readCalibration()).toBeNull();
  });

  it('c) corrupted JSON returns null and clears the bad entry', () => {
    localStorage.setItem(KEY, '{not valid json');
    expect(readCalibration()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('c2) schema-mismatch JSON returns null and clears the bad entry', () => {
    localStorage.setItem(KEY, JSON.stringify({ start: 'not a number' }));
    expect(readCalibration()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('rejects writes where ordering invariant start < target < max is broken', () => {
    expect(() => writeCalibration({ start: 0.7, target: 0.5, max: 0.9 })).toThrow(
      /start < target < max/,
    );
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('newer profile overwrites older (Step 5 edge case c)', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    writeCalibration({ start: 0.3, target: 0.6, max: 0.85 });
    vi.spyOn(Date, 'now').mockReturnValue(2000);
    writeCalibration({ start: 0.4, target: 0.7, max: 0.9 });

    const read = readCalibration()!;
    expect(read.start).toBe(0.4);
    expect(read.capturedAt).toBe(2000);
  });
});

describe('Calibrator detectDrift (Step 5 unit test d)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  it('returns false when no profile is stored', () => {
    expect(detectDrift(0.7)).toBe(false);
  });

  it('returns true when current mean shifts beyond the drift threshold', () => {
    writeCalibration({ start: 0.4, target: 0.7, max: 0.9 });
    expect(detectDrift(0.78)).toBe(true);
  });

  it('returns false when current mean is within the drift threshold', () => {
    writeCalibration({ start: 0.4, target: 0.7, max: 0.9 });
    expect(detectDrift(0.72)).toBe(false);
    expect(detectDrift(0.68)).toBe(false);
  });

  it('uses absolute distance so drops below target also trigger drift', () => {
    writeCalibration({ start: 0.4, target: 0.7, max: 0.9 });
    expect(detectDrift(0.6)).toBe(true);
  });
});

describe('Calibrator failure modes (Step 5 edge cases a-b)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('a) abort mid-flow leaves localStorage untouched (no write happens)', () => {
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('b) localStorage quota exceeded surfaces an actionable error', () => {
    const original = localStorage.setItem.bind(localStorage);
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(() => writeCalibration({ start: 0.4, target: 0.7, max: 0.9 })).toThrow(
      /localStorage may be full/,
    );
    setItemSpy.mockRestore();
    original(KEY, JSON.stringify({ start: 0, target: 0.5, max: 1, capturedAt: 0 }));
    expect(readCalibration()).not.toBeNull();
  });
});

describe('Calibrator helpers', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  it('clearCalibration removes the stored profile', () => {
    writeCalibration({ start: 0.4, target: 0.7, max: 0.9 });
    expect(readCalibration()).not.toBeNull();
    clearCalibration();
    expect(readCalibration()).toBeNull();
  });

  it('getDefaultProfile returns the documented Step 5 defaults (normalized)', () => {
    const def = getDefaultProfile();
    expect(def.start).toBe(0.4);
    expect(def.target).toBe(0.7);
    expect(def.max).toBe(0.9);
    expect(def.capturedAt).toBe(0);
  });
});
