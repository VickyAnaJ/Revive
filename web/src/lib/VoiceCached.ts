// C7b VoiceCached (S3-T03). Realises pulsehero-design.md §10.3 (Tier 1) and §10.4.
//
// Plays static mp3 clips from `web/public/audio/`. Tier 1 of the FR2 latency
// strategy — cached audio plays at ~50ms latency, well inside the 2.0s p95
// budget. Per design §10.3, fires per batch (not per peak) on classification
// labels: push_harder / faster / slower / allow_recoil / good_keep_going.
// Bystander emotional variants (§10.4) also resolve through this component.
//
// Design choice: takes the clip name (not full URL) to keep call sites
// readable and to centralise the path convention. Missing files reject the
// promise, letting C8 escalate to the next FM6 cascade tier.

export interface PlayResult {
  durationMs: number;
}

export class VoiceCached {
  private readonly basePath: string;

  constructor(basePath = '/audio') {
    this.basePath = basePath;
  }

  // Plays clipName from `${basePath}/${clipName}.mp3`. Resolves on `ended`,
  // rejects on `error`, aborts on signal.abort. Concurrent calls are safe;
  // each gets its own `<audio>` element and resolves independently. C8
  // serialises at the queue level, not here.
  async play(clipName: string, signal?: AbortSignal): Promise<PlayResult> {
    if (signal?.aborted) {
      throw new DOMException('aborted before play', 'AbortError');
    }

    const url = `${this.basePath}/${clipName}.mp3`;
    const audio = new Audio(url);
    const start = Date.now();

    return new Promise<PlayResult>((resolve, reject) => {
      const cleanup = () => {
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
        if (signal) signal.removeEventListener('abort', onAbort);
      };

      const onEnded = () => {
        cleanup();
        console.info(`[C7b] played: ${clipName}`);
        resolve({ durationMs: Date.now() - start });
      };

      const onError = () => {
        cleanup();
        reject(new Error(`[C7b] failed to play ${clipName}`));
      };

      const onAbort = () => {
        cleanup();
        try {
          audio.pause();
          audio.currentTime = 0;
        } catch {
          // Best-effort — element may not have started yet.
        }
        reject(new DOMException('aborted', 'AbortError'));
      };

      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);
      if (signal) signal.addEventListener('abort', onAbort);

      audio.play().catch((err) => {
        cleanup();
        reject(err);
      });
    });
  }
}

export const voiceCached = new VoiceCached();
