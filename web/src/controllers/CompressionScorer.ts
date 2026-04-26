import type {
  CompressionBatch,
  CompressionClassification,
  SerialCeilingFrame,
  SerialFrame,
} from '@/types/contracts';

export type BatchEvent = CustomEvent<CompressionBatch>;

const WINDOW_MS = 2000;
const EMIT_INTERVAL_MS = 2000;

// Lower bound is 95 (5 bpm under AHA's 100) to absorb per-peak rate jitter
// from the firmware (single-peak rate calc reports values ±30 bpm of true
// cadence). The 2-second window average lands honestly inside 100-120 even
// when individual peak rates dip into the 90s.
const RATE_TARGET_LOW = 95;
const RATE_TARGET_HIGH = 120;

// Tuned to real FSR-through-1.5"-foam hardware (capture session 2026-04-26):
// p25 normalized depth = 0.24, p50 = 0.25, p75 = 0.26, max = 0.27. Foam absorbs
// most of the press, so the analog ewma never approaches the FSR's 1023 ceiling.
// We map "adequate" so the user's normal medium-firm press counts as on-target,
// hard presses as adult_large, lighter touches as elderly/child.
const DEPTH_TARGET_DEFAULT = 0.16;
const DEPTH_STICKY_OFFSET = 0.03;

const BODY_TYPE_TARGET: Record<string, number> = {
  adult_large: 0.22,
  adult_average: 0.16,
  elderly: 0.12,
  child: 0.09,
};

// Per-body-type upper depth limit. A press above this value is treated as
// `force_ceiling` regardless of firmware-reported analog ceiling. Real CPR
// teaches that pressing too hard on a child or elderly chest causes rib
// fractures and lung damage, so the simulator must penalize over-pressure
// scaled by patient size. Adults have no upper limit (Infinity).
const DEPTH_CEILING: Record<string, number> = {
  adult_large: Infinity,
  adult_average: Infinity,
  elderly: 0.30,
  child: 0.18,
};

const CONSISTENCY_STDDEV_SCALE = 2;

export class CompressionScorer extends EventTarget {
  private buffer: SerialFrame[] = [];
  private lastCeilingMs = -Infinity;
  private lastClassification: CompressionClassification | null = null;
  private hasReceivedPeak = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private depthTarget = DEPTH_TARGET_DEFAULT;
  private depthStickyFloor = DEPTH_TARGET_DEFAULT - DEPTH_STICKY_OFFSET;
  private depthCeiling = Infinity;

  constructor(
    private readonly windowMs: number = WINDOW_MS,
    private readonly emitIntervalMs: number = EMIT_INTERVAL_MS,
  ) {
    super();
  }

  setBodyType(bodyType: string): void {
    const target = BODY_TYPE_TARGET[bodyType] ?? DEPTH_TARGET_DEFAULT;
    const ceiling = DEPTH_CEILING[bodyType] ?? Infinity;
    this.depthTarget = target;
    this.depthStickyFloor = Math.max(0, target - DEPTH_STICKY_OFFSET);
    this.depthCeiling = ceiling;
    const ceilingTxt = ceiling === Infinity ? '∞' : ceiling.toFixed(2);
    console.info(
      `[C4] body=${bodyType} target=${target.toFixed(2)} ceiling=${ceilingTxt}`,
    );
  }

  reset(): void {
    this.buffer = [];
    this.hasReceivedPeak = false;
    this.lastCeilingMs = -Infinity;
    this.lastClassification = null;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.emitBatch(Date.now()), this.emitIntervalMs);
  }

  // Open the emission gate without an actual peak. Used when the session
  // enters compression so empty batches start arriving even if the user
  // never presses the pad — without this, `hasReceivedPeak=false` would
  // block emitBatch and the do-nothing → flatline path would never fire.
  activate(): void {
    this.hasReceivedPeak = true;
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
    // Skip rate=0 peaks when averaging. Arduino's first peak after a long
    // idle has rate=0 (no prior peak to compute interval against). Without
    // this filter, that one bogus peak dragged the avg_rate to 0 and the
    // first batch always misclassified as too_slow — adding a 2-4s lag
    // before the user saw their real BPM. Now the first batch reflects the
    // true cadence as soon as Arduino has computed at least one valid rate.
    const peaksWithRate = peaks.filter((p) => p.rate > 0);
    const avgRateRaw =
      peaksWithRate.length > 0
        ? peaksWithRate.reduce((s, p) => s + p.rate, 0) / peaksWithRate.length
        : 0;
    const variance =
      peaks.reduce((s, p) => s + (p.depth - avgDepthRaw) ** 2, 0) / peaks.length;
    const stddev = Math.sqrt(variance);
    const consistency = Math.max(0, Math.min(1, 1 - stddev * CONSISTENCY_STDDEV_SCALE));

    const avgDepth = clamp01(avgDepthRaw);
    const avgRate = Math.max(0, Math.min(220, Math.round(avgRateRaw)));

    let classification: CompressionClassification;
    if (ceilingActive || avgDepth > this.depthCeiling) {
      // Either firmware reported analog saturation, OR the average press was
      // harder than this body type can tolerate. Both surface as
      // `force_ceiling` so the UI and PatientAgent treat them identically.
      classification = 'force_ceiling';
    } else if (avgRate > 0 && avgRate < RATE_TARGET_LOW) {
      classification = 'too_slow';
    } else if (avgRate > RATE_TARGET_HIGH) {
      classification = 'too_fast';
    } else if (avgDepth < this.depthTarget) {
      const sticky =
        this.lastClassification === 'adequate' && avgDepth >= this.depthStickyFloor;
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
