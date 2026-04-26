import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioContextManager } from '@/lib/AudioContextManager';

class MockAudioContext {
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  resume = vi.fn(async () => {
    this.state = 'running';
  });
}

class FailingResumeAudioContext extends MockAudioContext {
  constructor() {
    super();
    this.resume = vi.fn(async () => {
      throw new Error('autoplay-blocked');
    });
  }
}

describe('AudioContextManager (S3-T02)', () => {
  let originalAudioContext: typeof globalThis.AudioContext | undefined;

  beforeEach(() => {
    originalAudioContext = (globalThis as unknown as { AudioContext?: typeof AudioContext })
      .AudioContext;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext;
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (originalAudioContext) {
      (globalThis as unknown as { AudioContext: typeof AudioContext }).AudioContext =
        originalAudioContext;
    } else {
      delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
    }
    vi.restoreAllMocks();
  });

  it('starts locked', () => {
    const mgr = new AudioContextManager();
    expect(mgr.unlocked).toBe(false);
    expect(mgr.context).toBeNull();
  });

  it('unlocks on successful resume()', async () => {
    const mgr = new AudioContextManager();
    await mgr.resume();
    expect(mgr.unlocked).toBe(true);
    expect(mgr.context).not.toBeNull();
  });

  it('stays locked when resume() rejects (autoplay policy still blocking)', async () => {
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FailingResumeAudioContext;
    const mgr = new AudioContextManager();
    await mgr.resume();
    expect(mgr.unlocked).toBe(false);
  });

  it('notifies subscribers on unlock', async () => {
    const mgr = new AudioContextManager();
    const handler = vi.fn();
    mgr.subscribe(handler);
    await mgr.resume();
    expect(handler).toHaveBeenCalledOnce();
  });

  it('is idempotent — resume() called twice fires subscribers only once', async () => {
    const mgr = new AudioContextManager();
    const handler = vi.fn();
    mgr.subscribe(handler);
    await mgr.resume();
    await mgr.resume();
    expect(handler).toHaveBeenCalledOnce();
  });

  it('unsubscribe stops further notifications', async () => {
    const mgr = new AudioContextManager();
    const handler = vi.fn();
    const unsubscribe = mgr.subscribe(handler);
    unsubscribe();
    await mgr.resume();
    expect(handler).not.toHaveBeenCalled();
  });
});
