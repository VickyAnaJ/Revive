'use client';

import { motion } from 'framer-motion';
import type { PatientState } from '@/types/contracts';

export type VitalsStripProps = {
  vitals: PatientState;
  prevVitals?: PatientState | null;
  active?: boolean;
};

type Trend = 'up' | 'down' | 'flat';

function trend(current: number, previous: number | undefined): Trend {
  if (previous === undefined) return 'flat';
  if (current > previous + 1) return 'up';
  if (current < previous - 1) return 'down';
  return 'flat';
}

function rhythmTone(rhythm: PatientState['rhythm']): {
  label: string;
  className: string;
} {
  switch (rhythm) {
    case 'sinus':
    case 'rosc':
      return { label: rhythm === 'rosc' ? 'ROSC' : 'Sinus', className: 'text-emerald-400' };
    case 'weak_pulse':
      return { label: 'Weak pulse', className: 'text-amber-400' };
    case 'v_tach':
      return { label: 'V-tach', className: 'text-orange-400' };
    case 'v_fib':
      return { label: 'V-fib', className: 'text-red-400' };
    case 'flatline':
    default:
      return { label: 'Flatline', className: 'text-red-500' };
  }
}

function TrendArrow({ direction }: { direction: Trend }) {
  if (direction === 'flat') {
    return (
      <span aria-label="trend flat" className="text-zinc-600">
        →
      </span>
    );
  }
  const rotate = direction === 'up' ? -45 : 45;
  const tone = direction === 'up' ? 'text-emerald-400' : 'text-amber-400';
  return (
    <motion.span
      aria-label={`trend ${direction}`}
      className={`inline-block ${tone}`}
      initial={{ rotate: 0 }}
      animate={{ rotate }}
      transition={{ type: 'spring', stiffness: 250, damping: 18 }}
    >
      →
    </motion.span>
  );
}

export function VitalsStrip({ vitals, prevVitals, active = true }: VitalsStripProps) {
  const hrTrend = trend(vitals.hr, prevVitals?.hr);
  const o2Trend = trend(vitals.o2, prevVitals?.o2);
  const rhythm = rhythmTone(vitals.rhythm);

  return (
    <section
      data-testid="vitals-strip"
      data-active={active}
      aria-label="Patient vitals"
      className={
        active
          ? 'grid w-full grid-cols-4 gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3'
          : 'grid w-full grid-cols-4 gap-3 rounded-lg border border-zinc-900 bg-zinc-950 px-4 py-3 opacity-50'
      }
    >
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">HR</span>
        <div className="flex items-baseline gap-1">
          <span
            data-testid="vitals-hr"
            className="font-mono text-3xl tabular-nums text-zinc-100"
          >
            {active ? vitals.hr : '—'}
          </span>
          {active ? <TrendArrow direction={hrTrend} /> : null}
        </div>
      </div>
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">BP</span>
        <span
          data-testid="vitals-bp"
          className="font-mono text-2xl tabular-nums text-zinc-100"
        >
          {active ? vitals.bp : '—'}
        </span>
      </div>
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">SpO₂</span>
        <div className="flex items-baseline gap-1">
          <span
            data-testid="vitals-o2"
            className="font-mono text-3xl tabular-nums text-zinc-100"
          >
            {active ? vitals.o2 : '—'}
          </span>
          {active ? <span className="text-xs text-zinc-500">%</span> : null}
          {active ? <TrendArrow direction={o2Trend} /> : null}
        </div>
      </div>
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">Rhythm</span>
        <span
          data-testid="vitals-rhythm"
          className={
            active
              ? `font-mono text-base tracking-tight ${rhythm.className}`
              : 'font-mono text-base tracking-tight text-zinc-600'
          }
        >
          {active ? rhythm.label : '—'}
        </span>
      </div>
    </section>
  );
}
