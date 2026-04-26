// C7d AudioContextManager (S3-T02). Realises pulsehero-design.md §10.9.
//
// Browser autoplay policy blocks any audio playback until the first user
// gesture resumes the AudioContext. Without this gate, the Bystander mp3
// fired at session start would be silent. C7d owns one shared AudioContext
// per page lifecycle and exposes an `unlocked` gate the Start button reads.
//
// Pattern reference: REPLAI useLiveKitVoice.ts L24 audioContextRef. We use a
// class instead of a React ref so non-component code (C8 AudioQueue,
// SessionController) can read the same instance without prop drilling.

export class AudioContextManager {
  private ctx: AudioContext | null = null;
  private _unlocked = false;
  private subscribers = new Set<() => void>();

  get unlocked(): boolean {
    return this._unlocked;
  }

  // Returns null until resume() succeeds. Consumers should gate on `unlocked`
  // before reading this. Returning null instead of throwing keeps cold-start
  // call sites simple — they can no-op rather than try/catch.
  get context(): AudioContext | null {
    return this.ctx;
  }

  // Idempotent. Safe to call from multiple Start handlers, useEffect mounts,
  // or rapid double-clicks. Subscribers fire exactly once per unlock.
  async resume(): Promise<void> {
    if (this._unlocked) return;

    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch (err) {
        console.warn('[C7d] AudioContext construction failed:', err);
        return;
      }
    }

    try {
      await this.ctx.resume();
      this._unlocked = true;
      console.info('[C7d] AudioContext unlocked');
      this.subscribers.forEach((fn) => fn());
    } catch (err) {
      // resume() rejection means autoplay policy is still blocking — the
      // user gesture didn't propagate. Stay locked, let the next click retry.
      console.warn('[C7d] AudioContext locked: resume rejected', err);
    }
  }

  // Returns an unsubscribe function. React effects can wire cleanup directly:
  //   useEffect(() => audioContextManager.subscribe(handler), []);
  subscribe(fn: () => void): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }
}

export const audioContextManager = new AudioContextManager();
