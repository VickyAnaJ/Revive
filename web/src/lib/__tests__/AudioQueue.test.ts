import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioQueue, type VoiceLiveLike } from '@/lib/AudioQueue';
import type { VoiceCached } from '@/lib/VoiceCached';
import type { VoiceFallback } from '@/lib/VoiceFallback';
import type { AudioRequest } from '@/lib/voiceTypes';

// Controllable stub for an awaitable async player. Each call exposes a
// `resolve` and `reject` so tests can drive timing precisely.
function makeStubPlayer<T>() {
  const calls: Array<{
    args: unknown[];
    resolve: (v: T) => void;
    reject: (e: Error) => void;
    aborted: boolean;
  }> = [];

  const fn = vi.fn(
    (...args: unknown[]) =>
      new Promise<T>((resolve, reject) => {
        const entry: (typeof calls)[number] = { args, resolve, reject, aborted: false };
        calls.push(entry);

        // Last arg should be AbortSignal (by convention in this codebase)
        const sig = args[args.length - 1] as AbortSignal | undefined;
        if (sig && typeof sig === 'object' && 'addEventListener' in sig) {
          sig.addEventListener('abort', () => {
            entry.aborted = true;
            reject(new DOMException('aborted', 'AbortError'));
          });
        }
      }),
  );

  return { fn, calls };
}

describe('AudioQueue (S3-T05)', () => {
  let cachedStub: ReturnType<typeof makeStubPlayer<{ durationMs: number }>>;
  let fallbackStub: ReturnType<typeof makeStubPlayer<void>>;
  let liveStub: ReturnType<typeof makeStubPlayer<unknown>>;
  let cached: VoiceCached;
  let fallback: VoiceFallback;
  let live: VoiceLiveLike;
  let nowFn: () => number;
  let nowValue: number;

  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    cachedStub = makeStubPlayer<{ durationMs: number }>();
    fallbackStub = makeStubPlayer<void>();
    liveStub = makeStubPlayer<unknown>();
    cached = { play: cachedStub.fn } as unknown as VoiceCached;
    fallback = { speak: fallbackStub.fn } as unknown as VoiceFallback;
    live = { speak: liveStub.fn };
    nowValue = 1_000_000;
    nowFn = () => nowValue;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function buildQueue(opts: { withLive?: boolean; cooldownMs?: number } = {}): AudioQueue {
    return new AudioQueue({
      cached,
      fallback,
      live: opts.withLive ? live : undefined,
      cooldownMs: opts.cooldownMs ?? 5_000,
      now: nowFn,
    });
  }

  function cachedReq(clipName: string, priority: AudioRequest['priority'] = 'low', cooldownBucket?: string): AudioRequest {
    return {
      channel: 'coach',
      source: 'cached',
      priority,
      clipName,
      cooldownBucket,
    };
  }

  it('serialises concurrent enqueues into a single active stream', async () => {
    const q = buildQueue();
    q.enqueue(cachedReq('a'));
    q.enqueue(cachedReq('b'));
    q.enqueue(cachedReq('c'));

    await Promise.resolve();
    // Only the first one should be in flight.
    expect(cachedStub.calls).toHaveLength(1);
    expect(cachedStub.calls[0].args[0]).toBe('a');
    expect(q.inspect().queueLength).toBe(2);

    cachedStub.calls[0].resolve({ durationMs: 10 });
    await Promise.resolve();
    await Promise.resolve();
    // Second drains
    expect(cachedStub.calls).toHaveLength(2);
    expect(cachedStub.calls[1].args[0]).toBe('b');

    cachedStub.calls[1].resolve({ durationMs: 10 });
    await Promise.resolve();
    await Promise.resolve();
    cachedStub.calls[2].resolve({ durationMs: 10 });
    await Promise.resolve();
    await Promise.resolve();

    expect(cachedStub.calls).toHaveLength(3);
    expect(q.inspect().queueLength).toBe(0);
    expect(q.inspect().activeChannel).toBeNull();
  });

  it('high-priority enqueue preempts active low-priority via abort', async () => {
    const q = buildQueue();
    q.enqueue(cachedReq('low_a', 'low'));
    await Promise.resolve();
    expect(cachedStub.calls[0].args[0]).toBe('low_a');

    q.enqueue(cachedReq('high_b', 'high'));
    await Promise.resolve();
    // First call should have been aborted.
    expect(cachedStub.calls[0].aborted).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    // High-priority request now playing.
    expect(cachedStub.calls).toHaveLength(2);
    expect(cachedStub.calls[1].args[0]).toBe('high_b');
  });

  it('drops same-bucket request within 5s cooldown window', async () => {
    const q = buildQueue();
    const accepted1 = q.enqueue(cachedReq('push_harder', 'low', 'too_shallow'));
    expect(accepted1).toBe(true);
    await Promise.resolve();
    cachedStub.calls[0].resolve({ durationMs: 100 });
    await Promise.resolve();
    await Promise.resolve();

    // Within cooldown — should be dropped.
    nowValue += 3_000;
    const accepted2 = q.enqueue(cachedReq('push_harder', 'low', 'too_shallow'));
    expect(accepted2).toBe(false);
    expect(cachedStub.calls).toHaveLength(1);
  });

  it('different buckets play independently within the cooldown window', async () => {
    const q = buildQueue();
    q.enqueue(cachedReq('push_harder', 'low', 'too_shallow'));
    await Promise.resolve();
    cachedStub.calls[0].resolve({ durationMs: 10 });
    await Promise.resolve();
    await Promise.resolve();

    nowValue += 1_000;
    const accepted = q.enqueue(cachedReq('faster', 'low', 'too_slow'));
    expect(accepted).toBe(true);
    await Promise.resolve();
    expect(cachedStub.calls).toHaveLength(2);
    cachedStub.calls[1].resolve({ durationMs: 10 });
  });

  it('cascade routing: streaming source falls through live → fallback when live rejects', async () => {
    const q = buildQueue({ withLive: true });
    q.enqueue({
      channel: 'coach',
      source: 'streaming',
      priority: 'low',
      text: 'Push harder.',
    });

    await Promise.resolve();
    expect(liveStub.calls).toHaveLength(1);
    // Live fails (network error)
    liveStub.calls[0].reject(new Error('network down'));
    await Promise.resolve();
    await Promise.resolve();
    // Fallback called
    expect(fallbackStub.calls).toHaveLength(1);
    expect(fallbackStub.calls[0].args[0]).toBe('Push harder.');
    fallbackStub.calls[0].resolve();
  });

  it('cancelAll() aborts active stream and clears queue', async () => {
    const q = buildQueue();
    q.enqueue(cachedReq('a'));
    q.enqueue(cachedReq('b'));
    q.enqueue(cachedReq('c'));
    await Promise.resolve();
    expect(q.inspect().queueLength).toBe(2);
    expect(q.inspect().activeChannel).toBe('coach');

    q.cancelAll();
    expect(cachedStub.calls[0].aborted).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(q.inspect().queueLength).toBe(0);
    expect(q.inspect().activeChannel).toBeNull();
    // No further plays should occur.
    expect(cachedStub.calls).toHaveLength(1);
  });

  it('exclusive owner mode drops requests from non-owner channels', async () => {
    const q = buildQueue();
    q.setExclusiveOwner('dispatcher');

    const acceptedCoach = q.enqueue(cachedReq('push_harder')); // channel=coach
    expect(acceptedCoach).toBe(false);

    const acceptedDispatcher = q.enqueue({
      channel: 'dispatcher',
      source: 'cached',
      priority: 'high',
      clipName: 'dispatcher_intro',
    });
    expect(acceptedDispatcher).toBe(true);
    await Promise.resolve();
    expect(cachedStub.calls).toHaveLength(1);
    expect(cachedStub.calls[0].args[0]).toBe('dispatcher_intro');

    // Releasing exclusive mode allows other channels again.
    q.setExclusiveOwner(null);
    cachedStub.calls[0].resolve({ durationMs: 10 });
    await Promise.resolve();
    await Promise.resolve();
    const acceptedCoachAfter = q.enqueue(cachedReq('faster'));
    expect(acceptedCoachAfter).toBe(true);
  });

  it('rejects requests with missing payload (cached without clipName, streaming without text)', () => {
    const q = buildQueue();
    expect(
      q.enqueue({ channel: 'coach', source: 'cached', priority: 'low' }),
    ).toBe(false);
    expect(
      q.enqueue({ channel: 'coach', source: 'streaming', priority: 'low' }),
    ).toBe(false);
    expect(
      q.enqueue({ channel: 'coach', source: 'cached', priority: 'low', clipName: 'ok' }),
    ).toBe(true);
  });

  it('integration: cached + streaming + dispatcher serialise in order', async () => {
    const q = buildQueue({ withLive: true });
    q.enqueue(cachedReq('a'));
    q.enqueue({ channel: 'coach', source: 'streaming', priority: 'low', text: 'b' });
    q.enqueue({ channel: 'dispatcher', source: 'cached', priority: 'low', clipName: 'c' });

    await Promise.resolve();
    // First (cached a) plays
    expect(cachedStub.calls).toHaveLength(1);
    cachedStub.calls[0].resolve({ durationMs: 10 });
    await Promise.resolve();
    await Promise.resolve();
    // Second (streaming b) plays via live
    expect(liveStub.calls).toHaveLength(1);
    liveStub.calls[0].resolve(undefined);
    await Promise.resolve();
    await Promise.resolve();
    // Third (cached c) plays
    expect(cachedStub.calls).toHaveLength(2);
    expect(cachedStub.calls[1].args[0]).toBe('c');
    cachedStub.calls[1].resolve({ durationMs: 10 });
    await Promise.resolve();
    await Promise.resolve();

    expect(q.inspect().queueLength).toBe(0);
    expect(q.inspect().activeChannel).toBeNull();
  });
});
