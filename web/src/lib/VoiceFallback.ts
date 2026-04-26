// C7c VoiceFallback (S3-T04). Realises pulsehero-design.md §10.8 (FM6 final tier).
//
// Browser SpeechSynthesis adapter. Final tier in the FM6 cascade — when
// ElevenLabs flash_v2 streaming AND cached mp3 lookup both fail, this keeps
// the demo audible. Pattern adapted from REPLAI elevenlabs.ts L8-168 (which
// shipped with browser TTS at USF and won — battle-tested fallback).
//
// Three behaviours that matter:
// 1. Sentence-by-sentence speech with abort flag (REPLAI L62-79, L8-11) —
//    so barge-in cuts cleanly mid-sentence rather than mid-word.
// 2. 30s hard timeout per utterance (REPLAI L81-84) — speechSynthesis is
//    known to occasionally hang silently; the timeout guarantees we always
//    resolve.
// 3. Voice selection prefers non-default English voices (REPLAI L21-38) —
//    Samantha/Karen-class voices sound robotic; David/Aaron sound cleaner.

const PREFERRED_VOICE_NAMES = [
  'Google UK English Male',
  'Google US English',
  'Aaron',
  'Microsoft David',
  'Alex',
] as const;

const SKIP_VOICE_NAMES = [
  'Samantha',
  'Victoria',
  'Karen',
  'Moira',
  'Tessa',
  'Fiona',
  'Kate',
  'Susan',
  'Siri',
] as const;

const HARD_TIMEOUT_MS = 30_000;

export class VoiceFallback {
  private selectedVoice: SpeechSynthesisVoice | null = null;
  private abortFlag = false;

  // Lazy-resolves the best available English voice. Browsers populate
  // getVoices() asynchronously on first call, so we re-check each speak().
  private pickVoice(): SpeechSynthesisVoice | null {
    if (this.selectedVoice) return this.selectedVoice;
    if (typeof window === 'undefined' || !window.speechSynthesis) return null;

    const voices = window.speechSynthesis.getVoices() ?? [];
    if (voices.length === 0) return null;

    for (const name of PREFERRED_VOICE_NAMES) {
      const match = voices.find((v) => v.name.includes(name));
      if (match) {
        this.selectedVoice = match;
        return match;
      }
    }

    const fallback =
      voices.find((v) => v.lang.startsWith('en') && !SKIP_VOICE_NAMES.some((s) => v.name.includes(s))) ??
      voices[0];
    this.selectedVoice = fallback ?? null;
    return this.selectedVoice;
  }

  // Splits on terminal punctuation only (. ! ?). Commas create choppy
  // fragments — REPLAI L90-106. Trailing fragment without punctuation gets
  // appended to the last sentence.
  private splitSentences(text: string): string[] {
    const parts = text.match(/[^.!?]+[.!?]+\s*/g);
    if (!parts) return [text];

    const joined = parts.join('');
    const leftover = text.slice(joined.length).trim();
    if (leftover) {
      parts[parts.length - 1] = parts[parts.length - 1] + ' ' + leftover;
    }

    return parts.map((s) => s.trim()).filter((s) => s.length > 0);
  }

  abort(): void {
    this.abortFlag = true;
    try {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    } catch {
      // Best-effort.
    }
  }

  // Speaks text sentence-by-sentence. Resolves when finished, rejects on
  // abort. Always settles within HARD_TIMEOUT_MS — guards against the known
  // speechSynthesis hang behaviour. Single settle point per call (settled
  // flag guards against double-resolve / double-reject).
  speak(text: string, signal?: AbortSignal): Promise<void> {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      console.warn('[C7c] FM6 fallback engaged: speechSynthesis unavailable');
      return Promise.resolve();
    }

    if (signal?.aborted) {
      return Promise.reject(new DOMException('aborted before speak', 'AbortError'));
    }

    this.abortFlag = false;
    const voice = this.pickVoice();
    const sentences = this.splitSentences(text);

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const safeResolve = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const safeReject = (e: Error) => {
        if (settled) return;
        settled = true;
        reject(e);
      };

      const onAbort = () => {
        this.abort();
        safeReject(new DOMException('aborted', 'AbortError'));
      };
      if (signal) signal.addEventListener('abort', onAbort);

      const hardTimeout = setTimeout(safeResolve, HARD_TIMEOUT_MS);

      console.warn('[C7c] FM6 fallback engaged');

      (async () => {
        try {
          for (const sentence of sentences) {
            if (this.abortFlag || signal?.aborted) return;
            if (!sentence.trim()) continue;
            await this.speakOne(sentence, voice);
          }
          safeResolve();
        } catch (e) {
          safeReject(e as Error);
        } finally {
          clearTimeout(hardTimeout);
          if (signal) signal.removeEventListener('abort', onAbort);
        }
      })();
    });
  }

  private speakOne(text: string, voice: SpeechSynthesisVoice | null): Promise<void> {
    return new Promise<void>((resolve) => {
      try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.95;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;
        if (voice) utterance.voice = voice;

        const perUtteranceTimer = setTimeout(() => {
          try {
            window.speechSynthesis.cancel();
          } catch {
            // Best-effort.
          }
          resolve();
        }, 10_000);

        utterance.onend = () => {
          clearTimeout(perUtteranceTimer);
          resolve();
        };
        utterance.onerror = () => {
          clearTimeout(perUtteranceTimer);
          resolve();
        };

        window.speechSynthesis.speak(utterance);

        // Dead-speech detection: if speechSynthesis silently no-ops, the
        // 800ms check will catch it and resolve cleanly.
        setTimeout(() => {
          if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
            clearTimeout(perUtteranceTimer);
            resolve();
          }
        }, 800);
      } catch {
        resolve();
      }
    });
  }
}

export const voiceFallback = new VoiceFallback();
