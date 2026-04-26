import type {
  CompressionBatch,
  CompressionClassification,
  SerialCeilingFrame,
  SerialFrame,
} from '@/types/contracts';

export type BatchEvent = CustomEvent<CompressionBatch>;

const WINDOW_MS = 2000;
const EMIT_INTERVAL_MS = 2000;

const RATE_TARGET_LOW = 100;
const RATE_TARGET_HIGH = 120;

const DEPTH_TARGET = 0.6;
const DEPTH_STICKY_FLOOR = 0.55;

const CONSISTENCY_STDDEV_SCALE = 2;

export class CompressionScorer extends EventTarget {
  private buffer: SerialFrame[] = [];
  private lastCeilingMs = -Infinity;
  private lastClassification: CompressionClassification | null = null;
  private hasReceivedPeak = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly windowMs: number = WINDOW_MS,
    private readonly emitIntervalMs: number = EMIT_INTERVAL_MS,
  ) {
    super();
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.emitBatch(Date.now()), this.emitIntervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  addPeak(frame: SerialFrame): void {
    this.buffer.push(frame);
    this.hasReceivedPeak = true;
    this.trim(frame.ts);
  }

  addCeiling(frame: SerialCeilingFrame): void {
    this.lastCeilingMs = frame.ts;
    this.hasReceivedPeak = true;
  }

  emitBatch(nowMs: number): CompressionBatch | null {
    if (!this.hasReceivedPeak) return null;
    this.trim(nowMs);
    const batch = this.computeBatch(nowMs);
    this.lastClassification = batch.classification;
    this.dispatchEvent(new CustomEvent<CompressionBatch>('batch', { detail: batch }));
    console.info(
      `[C4] batch avg_depth=${batch.avg_depth.toFixed(3)} avg_rate=${batch.avg_rate} class=${batch.classification}`,
    );
    return batch;
  }

  private trim(nowMs: number): void {
    const cutoff = nowMs - this.windowMs;
    if (this.buffer.length === 0) return;
    let firstKeep = 0;
    while (firstKeep < this.buffer.length && this.buffer[firstKeep].ts <= cutoff) {
      firstKeep += 1;
    }
    if (firstKeep > 0) this.buffer.splice(0, firstKeep);
  }

  private computeBatch(nowMs: number): CompressionBatch {
    const peaks = this.buffer;
    const ceilingActive = (nowMs - this.lastCeilingMs) <= this.windowMs;

    if (peaks.length === 0) {
      return {
        avg_depth: 0,
        avg_rate: 0,
        consistency: 0,
        classification: ceilingActive ? 'force_ceiling' : 'too_slow',
      };
    }

    const avgDepthRaw = peaks.reduce((s, p) => s + p.depth, 0) / peaks.length;
    const avgRateRaw = peaks.reduce((s, p) => s + p.rate, 0) / peaks.length;
    const variance =
      peaks.reduce((s, p) => s + (p.depth - avgDepthRaw) ** 2, 0) / peaks.length;
    const stddev = Math.sqrt(variance);
    const consistency = Math.max(0, Math.min(1, 1 - stddev * CONSISTENCY_STDDEV_SCALE));

    const avgDepth = clamp01(avgDepthRaw);
    const avgRate = Math.max(0, Math.min(220, Math.round(avgRateRaw)));

    let classification: CompressionClassification;
    if (ceilingActive) {
      classification = 'force_ceiling';
    } else if (avgRate > 0 && avgRate < RATE_TARGET_LOW) {
      classification = 'too_slow';
    } else if (avgRate > RATE_TARGET_HIGH) {
      classification = 'too_fast';
    } else if (avgDepth < DEPTH_TARGET) {
      const sticky =
        this.lastClassification === 'adequate' && avgDepth >= DEPTH_STICKY_FLOOR;
      classification = sticky ? 'adequate' : 'too_shallow';
      if (sticky && this.lastClassification !== classification) {
        console.info(`[C4] sticky-floor hold avg_depth=${avgDepth.toFixed(3)}`);
      }
    } else {
      classification = 'adequate';
    }

    return {
      avg_depth: avgDepth,
      avg_rate: avgRate,
      consistency,
      classification,
    };
  }
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(1, v));
}
