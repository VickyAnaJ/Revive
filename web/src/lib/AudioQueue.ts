// C8 AudioQueue (S3-T05). Realises pulsehero-design.md §10.7.
//
// Single-stream serializer for all voice-emitting sites. Enforces NFR4
// (one concurrent stream) and FR2 latency by:
//
// 1. Priority preemption — high-priority requests abort lower-priority active
//    streams. Coach barks ("push harder") can cut a Tier 2 narrative phrase
//    mid-sentence. Pattern: REPLAI abortSpeech() (elevenlabs.ts L8-11).
//
// 2. Per-bucket cooldown — identical `cooldownBucket` within window is
//    dropped. Prevents "push harder push harder push harder" spam under
//    sustained bad-press cadence. Pattern: HappyHead cooldown counter
//    (winner-code-patterns.md L1246-1275).
//
// 3. Cascade routing — on tier failure, escalate. Pattern: FloodGuard
//    fallback chain (winner-code-patterns.md L934-967).
//
// 4. Exclusive owner mode — during decision phase, only the dispatcher
//    channel may play. Other channels are dropped. Prevents Tier 1/2 from
//    clobbering CAI mid-conversation.

import type { AudioRequest, VoiceChannel, VoicePriority } from './voiceTypes';
import type { VoiceCached } from './VoiceCached';
import type { VoiceFallback } from './VoiceFallback';

// Voice key passed to VoiceLive's speak() — abstracts the actual ElevenLabs
// voice ID (resolved by VoiceLive at construction). Mapped from
// AudioRequest.channel by `channelToVoiceKey` below.
export type VoiceKey = 'instructor' | 'dispatcher' | 'bystander';

export interface VoiceLiveLike {
  speak(text: string, voiceKey: VoiceKey, signal?: AbortSignal): Promise<unknown>;
}

function channelToVoiceKey(channel: VoiceChannel): VoiceKey {
  switch (channel) {
    case 'coach':
      return 'instructor';
    case 'dispatcher':
      return 'dispatcher';
    case 'bystander':
      return 'bystander';
    case 'fallback':
      return 'instructor';
  }
}

export interface AudioQueueDeps {
  cached: VoiceCached;
  fallback: VoiceFallback;
  // C7a VoiceLive lands at T06. Optional until then; the cascade still works
  // by skipping streaming and using cached → fallback.
  live?: VoiceLiveLike;
  cooldownMs?: number;
  now?: () => number;
}

const DEFAULT_COOLDOWN_MS = 5_000;

const PRIORITY_VALUE: Record<VoicePriority, number> = {
  low: 1,
  med: 2,
  high: 3,
};

export class AudioQueue {
  private readonly cached: VoiceCached;
  private readonly fallback: VoiceFallback;
  private readonly live: VoiceLiveLike | undefined;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  private queue: AudioRequest[] = [];
  private active: { ctrl: AbortController; req: AudioRequest } | null = null;
  private lastPlayed = new Map<string, number>();
  private exclusiveOwner: VoiceChannel | null = null;
  private draining = false;

  constructor(deps: AudioQueueDeps) {
    this.cached = deps.cached;
    this.fallback = deps.fallback;
    this.live = deps.live;
    this.cooldownMs = deps.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.now = deps.now ?? Date.now;
  }

  // Returns false if the request was rejected (cooldown, exclusive owner,
  // missing payload). Returns true if accepted (queued or preempted active).
  enqueue(req: AudioRequest): boolean {
    if (this.exclusiveOwner && req.channel !== this.exclusiveOwner) {
      console.info(`[C8] dropped: exclusive owner=${this.exclusiveOwner}, req=${req.channel}`);
      return false;
    }

    if (req.cooldownBucket) {
      const last = this.lastPlayed.get(req.cooldownBucket);
      if (last !== undefined && this.now() - last < this.cooldownMs) {
        console.info(`[C8] dropped: ${req.cooldownBucket} in cooldown`);
        return false;
      }
    }

    if (req.source === 'cached' && !req.clipName) return false;
    if ((req.source === 'streaming' || req.source === 'conversational') && !req.text) return false;

    if (this.active && PRIORITY_VALUE[req.priority] > PRIORITY_VALUE[this.active.req.priority]) {
      // Preempt: abort current, push new request to head of queue.
      console.info(`[C8] preempt: ${req.priority} cuts ${this.active.req.priority}`);
      this.active.ctrl.abort();
      this.queue.unshift(req);
      return true;
    }

    this.queue.push(req);
    void this.drain();
    return true;
  }

  cancelAll(): void {
    this.queue.length = 0;
    if (this.active) {
      this.active.ctrl.abort();
      this.active = null;
    }
  }

  // Decision phase calls this with `'dispatcher'`. While set, only dispatcher
  // requests are accepted; queued non-owner requests are also dropped.
  setExclusiveOwner(channel: VoiceChannel | null): void {
    this.exclusiveOwner = channel;
    if (channel) {
      this.queue = this.queue.filter((r) => r.channel === channel);
    }
  }

  // Test/debug helper. Returns shallow snapshot of state.
  inspect(): { queueLength: number; activeChannel: VoiceChannel | null; exclusiveOwner: VoiceChannel | null } {
    return {
      queueLength: this.queue.length,
      activeChannel: this.active?.req.channel ?? null,
      exclusiveOwner: this.exclusiveOwner,
    };
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const req = this.queue.shift()!;
        const ctrl = new AbortController();
        this.active = { ctrl, req };

        if (req.cooldownBucket) {
          this.lastPlayed.set(req.cooldownBucket, this.now());
        }

        try {
          await this.runCascade(req, ctrl.signal);
        } catch (err) {
          // Aborted (preempt or cancel) or all-tier-fail. Either way, move on.
          const name = (err as Error)?.name ?? 'unknown';
          console.info(`[C8] settled: ${name}`);
        } finally {
          this.active = null;
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private async runCascade(req: AudioRequest, signal: AbortSignal): Promise<void> {
    const tiers = this.buildCascade(req);

    for (const tier of tiers) {
      if (signal.aborted) {
        throw new DOMException('aborted', 'AbortError');
      }
      try {
        await tier(req, signal);
        return; // success
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') throw err;
        // Other error — try next tier. Use console.warn so failures show
        // up in the dev server CLI (console.info is filtered).
        console.warn(`[C8] tier failed, escalating: ${(err as Error)?.message ?? 'unknown'}`);
      }
    }

    throw new Error('[C8] all cascade tiers failed');
  }

  // Cascade ordering per design §10.8. CAI tier omitted here — it's the
  // entry point for `conversational` source but is owned by C5e
  // DispatcherAgent (T08), not C8. C8's responsibility is strictly the
  // playback fallbacks (live → cached → SpeechSynthesis).
  private buildCascade(req: AudioRequest): Array<(req: AudioRequest, signal: AbortSignal) => Promise<unknown>> {
    const liveTier = (r: AudioRequest, s: AbortSignal) => {
      if (!this.live) throw new Error('live tier unavailable');
      if (!r.text) throw new Error('live requires text');
      return this.live.speak(r.text, channelToVoiceKey(r.channel), s);
    };
    const cachedTier = (r: AudioRequest, s: AbortSignal) => {
      if (!r.clipName) throw new Error('cached requires clipName');
      return this.cached.play(r.clipName, s);
    };
    const fallbackTier = (r: AudioRequest, s: AbortSignal) => {
      if (!r.text) throw new Error('fallback requires text');
      return this.fallback.speak(r.text, s);
    };

    if (req.source === 'cached') {
      // Cached has a clipName, no text. Fallback would have nothing to say,
      // so cached is terminal in this branch — failure means silence.
      return [cachedTier];
    }
    if (req.source === 'streaming') {
      // Live → fallback (text-based fallback works because text is provided).
      return [liveTier, fallbackTier];
    }
    // `conversational` enters here only if C5e re-routes through C8 with
    // fallback intent. Default: just fallback.
    return [fallbackTier];
  }
}
