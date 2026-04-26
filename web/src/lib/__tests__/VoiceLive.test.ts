import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoiceLive } from '@/lib/VoiceLive';
import type { VoiceKey } from '@/lib/AudioQueue';

// Mock Audio element with controllable lifecycle.
class MockAudio {
  src: string;
  currentTime = 0;
  private listeners: Record<string, Array<() => void>> = {};
  constructor(src: string) {
    this.src = src;
  }
  addEventListener(event: string, fn: () => void): void {
    (this.listeners[event] ||= []).push(fn);
  }
  play = vi.fn(async () => undefined);
  pause = vi.fn();
  fire(event: 'ended' | 'error'): void {
    (this.listeners[event] || []).forEach((fn) => fn());
  }
}

const VOICE_IDS: Record<VoiceKey, string> = {
  instructor: 'voice-instructor-id',
  dispatcher: 'voice-dispatcher-id',
  bystander: 'voice-bystander-id',
};

function makeVoiceLive(overrides: { fetcher?: typeof fetch } = {}): {
  voiceLive: VoiceLive;
  audios: MockAudio[];
  fetcher: typeof fetch;
  fetcherMock: ReturnType<typeof vi.fn>;
} {
  const audios: MockAudio[] = [];
  const audioFactory = (src: string) => {
    const a = new MockAudio(src);
    audios.push(a);
    return a as unknown as HTMLAudioElement;
  };

  const okBlobResponse = (): Response =>
    ({
      ok: true,
      status: 200,
      blob: async () => new Blob([new Uint8Array([0x49, 0x44, 0x33])], { type: 'audio/mpeg' }),
      text: async () => '',
    }) as unknown as Response;

  const fetcherMock = overrides.fetcher
    ? (overrides.fetcher as unknown as ReturnType<typeof vi.fn>)
    : vi.fn(async () => okBlobResponse());
  const fetcher = fetcherMock as unknown as typeof fetch;

  const urlFactory = {
    create: vi.fn((blob: Blob) => `blob:mock:${blob.type}`),
    revoke: vi.fn(),
  };

  const voiceLive = new VoiceLive({
    apiKey: 'test-key',
    voiceIds: VOICE_IDS,
    fetcher,
    audioFactory,
    urlFactory,
  });

  return { voiceLive, audios, fetcher, fetcherMock };
}

describe('VoiceLive (S3-T06)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('streams successfully and resolves on audio ended', async () => {
    const { voiceLive, audios } = makeVoiceLive();
    const promise = voiceLive.speak('Push harder.', 'instructor');
    // Wait for fetch + blob + play microtasks to settle
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    audios[0].fire('ended');
    await expect(promise).resolves.toBeUndefined();
  });

  it('sends pinned ElevenLabs settings (model + stability + similarity_boost + output format)', async () => {
    const { voiceLive, audios, fetcherMock } = makeVoiceLive();
    const promise = voiceLive.speak('Slow down.', 'instructor');
    await Promise.resolve();
    expect(fetcherMock).toHaveBeenCalledOnce();
    const [url, init] = fetcherMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('voice-instructor-id');
    expect(url).toContain('output_format=mp3_22050_32');
    const body = JSON.parse(init.body as string);
    expect(body.model_id).toBe('eleven_flash_v2');
    expect(body.voice_settings.stability).toBe(0.5);
    expect(body.voice_settings.similarity_boost).toBe(0.8);
    await Promise.resolve();
    await Promise.resolve();
    audios[0].fire('ended');
    await promise;
  });

  it('selects voice ID based on voiceKey (dispatcher vs instructor)', async () => {
    const { voiceLive, audios, fetcherMock } = makeVoiceLive();
    const promise = voiceLive.speak('Decide now.', 'dispatcher');
    await Promise.resolve();
    const [url] = fetcherMock.mock.calls[0] as [string];
    expect(url).toContain('voice-dispatcher-id');
    await Promise.resolve();
    await Promise.resolve();
    audios[0].fire('ended');
    await promise;
  });

  it('rejects when ElevenLabs returns non-OK status', async () => {
    const failingFetcher = vi.fn(
      async () =>
        ({
          ok: false,
          status: 429,
          blob: async () => new Blob(),
          text: async () => 'rate limited',
        }) as unknown as Response,
    );
    const { voiceLive } = makeVoiceLive({ fetcher: failingFetcher as unknown as typeof fetch });
    const expectation = expect(voiceLive.speak('hi', 'instructor')).rejects.toThrow(/429/);
    await expectation;
  });

  it('rejects with AbortError when signal aborts before fetch', async () => {
    const { voiceLive } = makeVoiceLive();
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(voiceLive.speak('hi', 'instructor', ctrl.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('rejects with AbortError when signal aborts mid-playback', async () => {
    const { voiceLive, audios } = makeVoiceLive();
    const ctrl = new AbortController();
    const promise = voiceLive.speak('long phrase', 'instructor', ctrl.signal);
    const expectation = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    ctrl.abort();
    await expectation;
    expect(audios[0].pause).toHaveBeenCalled();
  });

  it('throws when voiceKey has no configured voice ID', async () => {
    const { voiceLive } = makeVoiceLive();
    await expect(
      voiceLive.speak('hi', 'unknown' as unknown as VoiceKey),
    ).rejects.toThrow(/no voice ID/);
  });
});
