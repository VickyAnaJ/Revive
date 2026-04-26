'use client';

import type { CompressionStats } from '@/controllers/SessionController';
import type { PatientState } from '@/types/contracts';

export type CompressionGoalProps = {
  vitals: PatientState;
  stats: CompressionStats;
};

const TARGET_HR = 70;
const TARGET_O2 = 92;

export function CompressionGoal({ vitals, stats }: CompressionGoalProps) {
  const hrOk = vitals.hr >= TARGET_HR;
  const o2Ok = vitals.o2 >= TARGET_O2;
  const sinusOk = vitals.rhythm === 'sinus' || vitals.rhythm === 'rosc';
  const adequatePct =
    stats.totalBatches === 0
      ? 0
      : Math.round((stats.adequateBatches / stats.totalBatches) * 100);

  return (
    <section
      data-testid="compression-goal"
      aria-label="Resuscitation goal"
      className="flex w-full flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3"
    >
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wider text-cyan-400">
          Resuscitation goal
        </span>
        <span
          data-testid="compression-goal-progress"
          className="font-mono text-xs tabular-nums text-zinc-400"
        >
          {stats.adequateBatches}/{stats.totalBatches} adequate · {adequatePct}%
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Pill label="Sinus rhythm" ok={sinusOk} />
        <Pill label={`HR ≥ ${TARGET_HR}`} ok={hrOk} />
        <Pill label={`O₂ ≥ ${TARGET_O2}`} ok={o2Ok} />
      </div>
    </section>
  );
}

function Pill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className={
        ok
          ? 'rounded border border-emerald-700 bg-emerald-950 px-2 py-0.5 text-emerald-200'
          : 'rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-zinc-400'
      }
    >
      <span aria-hidden="true">{ok ? '✓ ' : '· '}</span>
      {label}
    </span>
  );
}
