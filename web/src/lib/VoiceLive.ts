// C7a VoiceLive (S3-T06). Realises pulsehero-design.md §10.3 (Tier 2).
//
// ElevenLabs flash_v2 streaming TTS. Pinned settings per
// winner-code-patterns.md L1107-1138:
//   model_id="eleven_flash_v2", stability=0.5, similarity_boost=0.8,
//   output_format=mp3_22050_32 (cheapest while clear).
//
// Maps voice keys (instructor / dispatcher / bystander) to ElevenLabs voice
// IDs supplied at construction from `.env.local`. The Calm Instructor voice
// reads coach phrases; the 911 Dispatcher reads scenarios. Bystander
// emotional variants normally play via cached mp3s (C7b) — the bystander
// key here exists for future runtime-generated lines if needed.

import type { VoiceKey, VoiceLiveLike } from './AudioQueue';

export interface VoiceLiveDeps {
  apiKey: string;
  voiceIds: Record<VoiceKey, string>;
  fetcher?: typeof fetch;
  audioFactory?: (src: string) => HTMLAudioElement;
  urlFactory?: { create(blob: Blob): string; revoke(url: string): void };
  baseUrl?: string;
}

const DEFAULT_BASE_URL = 'https://api.elevenlabs.io/v1';
const MODEL_ID = 'eleven_flash_v2';
const OUTPUT_FORMAT = 'mp3_22050_32';
const STABILITY = 0.5;
const SIMILARITY_BOOST = 0.8;

export class VoiceLive implements VoiceLiveLike {
  private readonly apiKey: string;
  private readonly voiceIds: Record<VoiceKey, string>;
  private readonly fetcher: typeof fetch;
  private readonly audioFactory: (src: string) => HTMLAudioElement;
  private readonly urlFactory: { create(blob: Blob): string; revoke(url: string): void };
  private readonly baseUrl: string;

  constructor(deps: VoiceLiveDeps) {
    this.apiKey = deps.apiKey;
    this.voiceIds = deps.voiceIds;
    this.fetcher = deps.fetcher ?? fetch;
    this.audioFactory = deps.audioFactory ?? ((src) => new Audio(src));
    this.urlFactory =
      deps.urlFactory ?? {
        create: (blob) => URL.createObjectURL(blob),
        revoke: (url) => URL.revokeObjectURL(url),
      };
    this.baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL;
  }

  async speak(text: string, voiceKey: VoiceKey, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new DOMException('aborted before speak', 'AbortError');
    }

    const voiceId = this.voiceIds[voiceKey];
    if (!voiceId) {
      throw new Error(`[C7a] no voice ID configured for ${voiceKey}`);
    }

    const url = `${this.baseUrl}/text-to-speech/${voiceId}/stream?output_format=${OUTPUT_FORMAT}`;
    const start = Date.now();

    const response = await this.fetcher(url, {
      method: 'POST',
      signal,
      headers: {
        'xi-api-key': this.apiKey,
        'Content-Type': 'application/json',
        accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: {
          stability: STABILITY,
          similarity_boost: SIMILARITY_BOOST,
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`[C7a] ElevenLabs ${response.status}: ${detail.slice(0, 200)}`);
    }

    const blob = await response.blob();
    const objectUrl = this.urlFactory.create(blob);

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const audio = this.audioFactory(objectUrl);
      const cleanup = () => {
        try {
          this.urlFactory.revoke(objectUrl);
        } catch {
          // best-effort
        }
        if (signal) signal.removeEventListener('abort', onAbort);
      };
      const safeResolve = () => {
        if (settled) return;
        settled = true;
        cleanup();
        const ms = Date.now() - start;
        console.warn(`[C7a] flash_v2 stream end voice=${voiceKey} ms=${ms}`);
        resolve();
      };
      const safeReject = (err: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };
      const onAbort = () => {
        try {
          audio.pause();
          audio.currentTime = 0;
        } catch {
          // best-effort
        }
        safeReject(new DOMException('aborted', 'AbortError'));
      };

      audio.addEventListener('ended', safeResolve);
      audio.addEventListener('error', () => safeReject(new Error('[C7a] audio playback failed')));
      if (signal) signal.addEventListener('abort', onAbort);

      console.warn(`[C7a] flash_v2 stream start voice=${voiceKey} chars=${text.length}`);
      audio.play().catch((err) => safeReject(err as Error));
    });
  }
}
