'use client';

import { useState, useCallback } from 'react';

export type AudioUnlockOverlayProps = {
  onUnlock?: (ctx: AudioContext) => void;
};

export function AudioUnlockOverlay({ onUnlock }: AudioUnlockOverlayProps) {
  const [dismissed, setDismissed] = useState(false);

  const handleClick = useCallback(() => {
    try {
      const Ctor =
        typeof window !== 'undefined'
          ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
          : undefined;
      if (Ctor) {
        const ctx = new Ctor();
        void ctx.resume();
        onUnlock?.(ctx);
        console.info('[C9] AudioContext unlocked');
      }
    } catch (err) {
      console.warn('[C9] AudioContext unlock failed', err);
    }
    setDismissed(true);
  }, [onUnlock]);

  if (dismissed) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      data-testid="audio-unlock-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 text-zinc-100 backdrop-blur"
    >
      <span className="rounded-lg border border-zinc-700 bg-zinc-900 px-6 py-4 text-base">
        Click anywhere to enable audio
      </span>
    </button>
  );
}
