'use client';

export type RateCounterProps = {
  rate: number;
  target?: number;
  depthOk?: boolean;
};

export function RateCounter({ rate, target = 110, depthOk = true }: RateCounterProps) {
  const display = Math.max(0, Math.min(220, Math.round(rate)));
  const inTargetBand = display >= 100 && display <= 120 && depthOk;

  return (
    <div
      data-testid="rate-counter"
      className="flex flex-col items-center rounded-lg border border-zinc-800 bg-zinc-950 px-6 py-4 text-zinc-100"
    >
      <span className="text-xs uppercase tracking-wider text-zinc-500">Rate</span>
      <span
        className={
          inTargetBand
            ? 'font-mono text-5xl tabular-nums text-emerald-400'
            : 'font-mono text-5xl tabular-nums text-zinc-100'
        }
        data-testid="rate-counter-value"
      >
        {display}
      </span>
      <span className="text-xs text-zinc-500">target {target} BPM</span>
    </div>
  );
}
