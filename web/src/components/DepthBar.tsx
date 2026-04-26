'use client';

import { motion } from 'framer-motion';
import type { CompressionClassification } from '@/types/contracts';

export type DepthBarTone = 'idle' | 'good' | 'warn' | 'bad';

export type DepthBarProps = {
  depth: number;
  forceCeiling?: boolean;
  classification?: CompressionClassification | null;
  /** Where the "adequate" threshold sits on the bar, 0-100. Body-type-aware. */
  targetPct?: number;
  /** Where the sticky-floor (target − 0.03) sits, 0-100. */
  floorPct?: number;
};

const TONE_FILL: Record<DepthBarTone, string> = {
  idle: 'w-full bg-zinc-700',
  good: 'w-full bg-emerald-500',
  warn: 'w-full bg-amber-400',
  bad: 'w-full bg-red-500',
};

function pickTone(
  classification: CompressionClassification | null | undefined,
  forceCeiling: boolean,
): DepthBarTone {
  if (forceCeiling) return 'bad';
  if (!classification) return 'idle';
  switch (classification) {
    case 'adequate':
      return 'good';
    case 'too_shallow':
    case 'too_fast':
    case 'too_slow':
      return 'warn';
    case 'force_ceiling':
      return 'bad';
    default:
      return 'idle';
  }
}

export function DepthBar({
  depth,
  forceCeiling = false,
  classification = null,
  targetPct,
  floorPct,
}: DepthBarProps) {
  const clamped = Math.max(0, Math.min(1, depth));
  const heightPct = clamped * 100;
  const tone = pickTone(classification, forceCeiling);

  return (
    <div
      data-testid="depth-bar"
      data-tone={tone}
      className="relative flex h-64 w-16 flex-col-reverse overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950"
    >
      <motion.div
        data-testid="depth-bar-fill"
        className={TONE_FILL[tone]}
        style={{ height: `${heightPct}%` }}
        animate={{ height: `${heightPct}%` }}
        transition={{ type: 'spring', stiffness: 300, damping: 20, mass: 0.5 }}
      />
      {floorPct !== undefined ? (
        <motion.div
          data-testid="depth-bar-floor"
          className="pointer-events-none absolute inset-x-0 h-px bg-zinc-600"
          aria-hidden="true"
          animate={{ bottom: `${floorPct}%` }}
          transition={{ type: 'spring', stiffness: 200, damping: 24 }}
        />
      ) : null}
      {targetPct !== undefined ? (
        <motion.div
          data-testid="depth-bar-target"
          className="pointer-events-none absolute inset-x-0 h-0.5 bg-emerald-500"
          aria-label="adequate threshold"
          animate={{ bottom: `${targetPct}%` }}
          transition={{ type: 'spring', stiffness: 200, damping: 24 }}
        />
      ) : null}
    </div>
  );
}
