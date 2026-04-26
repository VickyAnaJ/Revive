import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CompressionScorer } from '../CompressionScorer';
import {
  CompressionBatchSchema,
  type CompressionBatch,
  type SerialFrame,
} from '@/types/contracts';

function peak(ts: number, depth: number, rate: number): SerialFrame {
  return { depth, rate, ts };
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

describe('CompressionScorer (Step 5 unit tests a-f)', () => {
  let scorer: CompressionScorer;

  beforeEach(() => {
    scorer = new CompressionScorer();
  });

  it('a) empty buffer with no peaks ever received does not emit a batch', () => {
    const batchListener = vi.fn();
    scorer.addEventListener('batch', batchListener as EventListener);
    const result = scorer.emitBatch(2000);
    expect(result).toBeNull();
    expect(batchListener).not.toHaveBeenCalled();
  });

  it('b) single sample in window emits a batch reflecting that sample', () => {
    const batchListener = vi.fn();
    scorer.addEventListener('batch', batchListener as EventListener);
    scorer.addPeak(peak(1000, 0.65, 110));
    const batch = scorer.emitBatch(2000);
    expect(batch).not.toBeNull();
    expect(batch!.avg_depth).toBeCloseTo(0.65, 5);
    expect(batch!.avg_rate).toBe(110);
    expect(batch!.classification).toBe('adequate');
    expect(batchListener).toHaveBeenCalledOnce();
  });

  it('c) mixed shallow + adequate samples → classification reflects average', () => {
    scorer.addPeak(peak(500, 0.4, 110));
    scorer.addPeak(peak(1000, 0.45, 110));
    scorer.addPeak(peak(1500, 0.5, 110));
    const batch = scorer.emitBatch(2000)!;
    expect(batch.avg_depth).toBeCloseTo(0.45, 5);
    expect(batch.classification).toBe('too_shallow');
  });

  it('d) sticky floor: once adequate, depth in [0.55, 0.6) stays adequate', () => {
    scorer.addPeak(peak(500, 0.7, 110));
    scorer.addPeak(peak(1000, 0.7, 110));
    expect(scorer.emitBatch(2000)!.classification).toBe('adequate');

    scorer.addPeak(peak(2500, 0.57, 110));
    scorer.addPeak(peak(3000, 0.58, 110));
    const sticky = scorer.emitBatch(4000)!;
    expect(sticky.classification).toBe('adequate');

    scorer.addPeak(peak(4500, 0.52, 110));
    scorer.addPeak(peak(5000, 0.5, 110));
    const dropped = scorer.emitBatch(6000)!;
    expect(dropped.classification).toBe('too_shallow');
  });

  it('e) force ceiling event in window → batch tagged force_ceiling regardless', () => {
    scorer.addPeak(peak(500, 0.7, 110));
    scorer.addPeak(peak(1000, 0.7, 110));
    scorer.addCeiling({ type: 'ceiling', ts: 1500 });
    const batch = scorer.emitBatch(2000)!;
    expect(batch.classification).toBe('force_ceiling');
  });

  it('f) rate calculation: 6 peaks averaging 180 BPM → avg_rate ≈ 180 (±5%)', () => {
    for (let i = 0; i < 6; i += 1) {
      scorer.addPeak(peak(i * 333, 0.7, 180));
    }
    const batch = scorer.emitBatch(2000)!;
    expect(Math.abs(batch.avg_rate - 180) / 180).toBeLessThan(0.05);
  });
});

describe('CompressionScorer edge cases (Step 5 edge cases a-c)', () => {
  let scorer: CompressionScorer;

  beforeEach(() => {
    scorer = new CompressionScorer();
  });

  it('a) zero peaks in window (after they age out) → batch with too_slow', () => {
    scorer.addPeak(peak(0, 0.7, 110));
    const aged = scorer.emitBatch(5000)!;
    expect(aged.avg_depth).toBe(0);
    expect(aged.avg_rate).toBe(0);
    expect(aged.classification).toBe('too_slow');
  });

  it('b) rate spike above 200 BPM → classification too_fast', () => {
    scorer.addPeak(peak(500, 0.7, 210));
    scorer.addPeak(peak(1000, 0.7, 210));
    const batch = scorer.emitBatch(2000)!;
    expect(batch.classification).toBe('too_fast');
  });

  it('c) FIFO eviction: peaks older than window are dropped', () => {
    scorer.addPeak(peak(0, 0.4, 60));
    scorer.addPeak(peak(500, 0.4, 60));
    scorer.addPeak(peak(3500, 0.7, 110));
    const batch = scorer.emitBatch(4000)!;
    expect(batch.avg_depth).toBeCloseTo(0.7, 5);
    expect(batch.avg_rate).toBe(110);
  });

  it('ceiling event ages out after the window passes', () => {
    scorer.addPeak(peak(500, 0.7, 110));
    scorer.addCeiling({ type: 'ceiling', ts: 500 });
    expect(scorer.emitBatch(1500)!.classification).toBe('force_ceiling');

    scorer.addPeak(peak(3500, 0.7, 110));
    expect(scorer.emitBatch(4500)!.classification).toBe('adequate');
  });
});

describe('CompressionScorer contract validation (Step 5 contract test)', () => {
  it('every emitted batch validates against CompressionBatchSchema', () => {
    const scorer = new CompressionScorer();
    const batches: CompressionBatch[] = [];
    scorer.addEventListener('batch', (event) => {
      batches.push((event as CustomEvent<CompressionBatch>).detail);
    });

    const fixtures: SerialFrame[] = [
      peak(100, 0.65, 110),
      peak(700, 0.62, 115),
      peak(1300, 0.4, 95),
      peak(2500, 0.7, 130),
      peak(3500, 0.75, 110),
    ];
    fixtures.forEach((p) => scorer.addPeak(p));
    scorer.emitBatch(2000);
    scorer.emitBatch(4000);
    scorer.emitBatch(6000);

    expect(batches.length).toBe(3);
    batches.forEach((b) => {
      const parsed = CompressionBatchSchema.safeParse(b);
      expect(parsed.success).toBe(true);
    });
  });
});

describe('CompressionScorer cadence (Step 5 NFR2 verification: 2.0 s ± 0.3 s)', () => {
  let scorer: CompressionScorer;

  beforeEach(() => {
    vi.useFakeTimers();
    scorer = new CompressionScorer();
    scorer.addPeak(peak(0, 0.7, 110));
    scorer.start();
  });

  afterEach(() => {
    scorer.stop();
    vi.useRealTimers();
  });

  it('30 fake-timer ticks at 2 s cadence → 30 batch emits', () => {
    const batchListener = vi.fn();
    scorer.addEventListener('batch', batchListener as EventListener);
    for (let i = 0; i < 30; i += 1) {
      vi.advanceTimersByTime(2000);
    }
    expect(batchListener).toHaveBeenCalledTimes(30);
  });
});
