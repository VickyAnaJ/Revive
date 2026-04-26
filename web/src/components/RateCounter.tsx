'use client';

export type RateCounterProps = {
  rate: number;
  target?: number;
};

export function RateCounter({ rate, target = 110 }: RateCounterProps) {
  const display = Math.max(0, Math.min(220, Math.round(rate)));
  // Rate band is independent of depth. Mirrors CompressionScorer's classifier
  // bounds (95-120). Coupling to depth here caused the counter to flicker
  // grey while rate was on-target but the auto-cal-scaled depth happened to
  // sit below an arbitrary 0.75.
  const inTargetBand = display >= 95 && display <= 120;
  const tooFast = display > 120;
  const tooSlow = display > 0 && display < 95;

  const valueClass = inTargetBand
    ? 'font-mono text-5xl tabular-nums text-emerald-400'
    : tooFast
      ? 'font-mono text-5xl tabular-nums text-red-400'
      : tooSlow
        ? 'font-mono text-5xl tabular-nums text-amber-400'
        : 'font-mono text-5xl tabular-nums text-zinc-100';

  return (
    <div
      data-testid="rate-counter"
      className="flex flex-col items-center rounded-lg border border-zinc-800 bg-zinc-950 px-6 py-4 text-zinc-100"
    >
      <span className="text-xs uppercase tracking-wider text-zinc-500">Rate</span>
      <span className={valueClass} data-testid="rate-counter-value">
        {display}
      </span>
      <span className="text-xs text-zinc-500">target {target} BPM</span>
    </div>
  );
}
