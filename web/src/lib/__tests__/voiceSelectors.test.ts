import { describe, it, expect } from 'vitest';
import { pickBystanderTier, pickBystanderClip } from '@/lib/voiceSelectors';

describe('voiceSelectors (S3-T07)', () => {
  describe('pickBystanderTier', () => {
    it('returns scared for high O₂ (>=80)', () => {
      expect(pickBystanderTier(95, false)).toBe('scared');
      expect(pickBystanderTier(80, false)).toBe('scared');
    });

    it('returns panicked for medium O₂ (50–79)', () => {
      expect(pickBystanderTier(75, false)).toBe('panicked');
      expect(pickBystanderTier(50, false)).toBe('panicked');
    });

    it('returns hysterical for low O₂ (<50)', () => {
      expect(pickBystanderTier(40, false)).toBe('hysterical');
      expect(pickBystanderTier(0, false)).toBe('hysterical');
    });

    it('returns relieved when isRosc is true regardless of O₂', () => {
      expect(pickBystanderTier(95, true)).toBe('relieved');
      expect(pickBystanderTier(40, true)).toBe('relieved');
      expect(pickBystanderTier(0, true)).toBe('relieved');
    });
  });

  describe('pickBystanderClip', () => {
    it('cycles through variants deterministically', () => {
      expect(pickBystanderClip('scared', 0)).toBe('scared_1');
      expect(pickBystanderClip('scared', 1)).toBe('scared_2');
      expect(pickBystanderClip('scared', 2)).toBe('scared_3');
      expect(pickBystanderClip('scared', 3)).toBe('scared_1'); // wraps
    });

    it('returns a valid clip for each tier', () => {
      expect(pickBystanderClip('panicked', 0)).toMatch(/^panicked_/);
      expect(pickBystanderClip('hysterical', 0)).toMatch(/^hysterical_/);
      expect(pickBystanderClip('relieved', 0)).toMatch(/^relieved_/);
    });
  });
});
