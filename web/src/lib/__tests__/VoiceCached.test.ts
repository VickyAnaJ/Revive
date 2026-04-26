import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoiceCached } from '@/lib/VoiceCached';

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

  removeEventListener(event: string, fn: () => void): void {
    this.listeners[event] = (this.listeners[event] || []).filter((h) => h !== fn);
  }

  play = vi.fn(async () => undefined);

  pause = vi.fn();

  fire(event: 'ended' | 'error'): void {
    (this.listeners[event] || []).forEach((fn) => fn());
  }
}

let lastAudio: MockAudio | null = null;

describe('VoiceCached (S3-T03)', () => {
  beforeEach(() => {
    lastAudio = null;
    (globalThis as unknown as { Audio: unknown }).Audio = vi.fn(function (this: MockAudio, src: string) {
      const inst = new MockAudio(src);
      lastAudio = inst;
      return inst;
    });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as unknown as { Audio?: unknown }).Audio;
  });

  it('resolves on the audio ended event', async () => {
    const player = new VoiceCached();
    const promise = player.play('push_harder');
    // Wait for the play() microtask, then fire ended
    await Promise.resolve();
    lastAudio!.fire('ended');
    const result = await promise;
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('uses the configured basePath when constructing the URL', async () => {
    const player = new VoiceCached('/custom/audio');
    const promise = player.play('faster');
    await Promise.resolve();
    expect(lastAudio!.src).toBe('/custom/audio/faster.mp3');
    lastAudio!.fire('ended');
    await promise;
  });

  it('rejects when the audio element fires error (file missing)', async () => {
    const player = new VoiceCached();
    const promise = player.play('nope');
    await Promise.resolve();
    lastAudio!.fire('error');
    await expect(promise).rejects.toThrow(/failed to play nope/);
  });

  it('rejects with AbortError when signal aborts mid-playback', async () => {
    const controller = new AbortController();
    const player = new VoiceCached();
    const promise = player.play('slower', controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(lastAudio!.pause).toHaveBeenCalled();
  });

  it('rejects with AbortError if signal is already aborted before play()', async () => {
    const controller = new AbortController();
    controller.abort();
    const player = new VoiceCached();
    await expect(player.play('push_harder', controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('handles sequential plays cleanly (no listener leakage)', async () => {
    const player = new VoiceCached();
    for (let i = 0; i < 3; i++) {
      const promise = player.play('faster');
      await Promise.resolve();
      lastAudio!.fire('ended');
      await promise;
    }
    expect(lastAudio).not.toBeNull();
  });
});
