import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoiceFallback } from '@/lib/VoiceFallback';

class MockUtterance {
  text: string;
  rate = 1;
  pitch = 1;
  volume = 1;
  voice: unknown = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

interface MockSpeechSynthesis {
  speaking: boolean;
  pending: boolean;
  cancelled: number;
  spoke: MockUtterance[];
  speak(u: MockUtterance): void;
  cancel(): void;
  getVoices(): SpeechSynthesisVoice[];
  finishLast(): void;
  errorLast(): void;
}

let synth: MockSpeechSynthesis;

function installSynth(opts: { voices?: SpeechSynthesisVoice[]; deadSpeech?: boolean } = {}): void {
  const voices: SpeechSynthesisVoice[] = opts.voices ?? [
    { name: 'Aaron', lang: 'en-US', default: false } as SpeechSynthesisVoice,
    { name: 'Samantha', lang: 'en-US', default: true } as SpeechSynthesisVoice,
  ];

  synth = {
    speaking: false,
    pending: false,
    cancelled: 0,
    spoke: [],
    speak(u: MockUtterance) {
      this.spoke.push(u);
      if (!opts.deadSpeech) {
        this.speaking = true;
      }
    },
    cancel() {
      this.cancelled++;
      this.speaking = false;
    },
    getVoices() {
      return voices;
    },
    finishLast() {
      const u = this.spoke[this.spoke.length - 1];
      this.speaking = false;
      u?.onend?.();
    },
    errorLast() {
      const u = this.spoke[this.spoke.length - 1];
      this.speaking = false;
      u?.onerror?.();
    },
  };

  (globalThis as unknown as { window: unknown }).window = {
    speechSynthesis: synth,
    SpeechSynthesisUtterance: MockUtterance,
  };
  (globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance =
    MockUtterance;
}

describe('VoiceFallback (S3-T04)', () => {
  beforeEach(() => {
    installSynth();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (globalThis as unknown as { window?: unknown }).window;
    delete (globalThis as unknown as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;
  });

  it('speaks short text and resolves on utterance end', async () => {
    const fallback = new VoiceFallback();
    const promise = fallback.speak('Push harder.');
    await Promise.resolve();
    await Promise.resolve();
    synth.finishLast();
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeUndefined();
    expect(synth.spoke).toHaveLength(1);
    expect(synth.spoke[0].text).toBe('Push harder.');
  });

  it('selects a non-default English voice (Aaron over Samantha)', async () => {
    const fallback = new VoiceFallback();
    const promise = fallback.speak('Test.');
    await Promise.resolve();
    await Promise.resolve();
    expect((synth.spoke[0].voice as SpeechSynthesisVoice).name).toBe('Aaron');
    synth.finishLast();
    await vi.runAllTimersAsync();
    await promise;
  });

  it('aborts via signal mid-sentence and rejects with AbortError', async () => {
    const controller = new AbortController();
    const fallback = new VoiceFallback();
    const promise = fallback.speak('Push harder. Slow down.', controller.signal);
    // Attach the rejection expectation BEFORE running timers so vitest's
    // unhandled-rejection detector sees a handler attached when abort fires.
    const expectation = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    await vi.runAllTimersAsync();
    await expectation;
    expect(synth.cancelled).toBeGreaterThanOrEqual(1);
  });

  it('rejects immediately if signal already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fallback = new VoiceFallback();
    await expect(fallback.speak('hi', controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('handles text without terminal punctuation as a single sentence', async () => {
    const fallback = new VoiceFallback();
    const promise = fallback.speak('no punctuation here');
    await Promise.resolve();
    await Promise.resolve();
    expect(synth.spoke).toHaveLength(1);
    expect(synth.spoke[0].text).toBe('no punctuation here');
    synth.finishLast();
    await vi.runAllTimersAsync();
    await promise;
  });

  it('splits multiple sentences across separate utterances', async () => {
    const fallback = new VoiceFallback();
    const promise = fallback.speak('Push harder. Slow down.');
    // First sentence
    await Promise.resolve();
    await Promise.resolve();
    expect(synth.spoke[0].text.trim()).toBe('Push harder.');
    synth.finishLast();
    // Second sentence
    await vi.runAllTimersAsync();
    expect(synth.spoke[1]?.text.trim()).toBe('Slow down.');
    synth.finishLast();
    await vi.runAllTimersAsync();
    await promise;
  });

  it('30s hard timeout still resolves even if speechSynthesis hangs', async () => {
    installSynth({ deadSpeech: true });
    const fallback = new VoiceFallback();
    const promise = fallback.speak('Push harder.');
    await vi.advanceTimersByTimeAsync(800);
    await vi.advanceTimersByTimeAsync(31_000);
    await expect(promise).resolves.toBeUndefined();
  });
});
