'use client';

import { motion, AnimatePresence } from 'framer-motion';
import type { CompressionBatch, CompressionClassification } from '@/types/contracts';

export type CompressionFeedbackProps = {
  batch: CompressionBatch | null;
  bodyType?: string;
};

type Tone = 'good' | 'warn' | 'bad';

const COPY: Record<CompressionClassification, { label: string; hint: string; tone: Tone }> = {
  adequate: { label: 'Adequate', hint: 'Good rhythm — keep this pace.', tone: 'good' },
  too_shallow: { label: 'Too shallow', hint: 'Press deeper into the pad.', tone: 'warn' },
  too_fast: { label: 'Too fast', hint: 'Slow down — aim 100–120 bpm.', tone: 'warn' },
  too_slow: { label: 'Too slow', hint: 'Speed up — aim 95–120 bpm.', tone: 'warn' },
  force_ceiling: {
    label: 'Too hard',
    hint: 'Ease up — release fully between presses.',
    tone: 'bad',
  },
};

function ceilingHint(bodyType: string | undefined): string {
  switch (bodyType) {
    case 'child':
      return 'Ease up — gentler on a child\'s chest.';
    case 'elderly':
      return 'Ease up — fragile chest, gentler force.';
    default:
      return 'Ease up — release fully between presses.';
  }
}

const TONE_STYLES: Record<Tone, string> = {
  good: 'border-emerald-700 bg-emerald-950 text-emerald-200',
  warn: 'border-amber-700 bg-amber-950 text-amber-200',
  bad: 'border-red-800 bg-red-950 text-red-200',
};

export function CompressionFeedback({ batch, bodyType }: CompressionFeedbackProps) {
  const copy = batch
    ? batch.classification === 'force_ceiling'
      ? { ...COPY.force_ceiling, hint: ceilingHint(bodyType) }
      : COPY[batch.classification]
    : null;
  return (
    <div className="flex min-h-[2.25rem] items-center justify-center">
      <AnimatePresence mode="wait">
        {batch && copy ? (
          <motion.div
            key={`${batch.classification}-${batch.avg_rate}-${batch.avg_depth.toFixed(2)}`}
            data-testid="compression-feedback"
            data-classification={batch.classification}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className={`flex items-center gap-2 rounded border px-3 py-1.5 text-xs font-medium ${TONE_STYLES[copy.tone]}`}
          >
            <span className="uppercase tracking-wider">{copy.label}</span>
            <span aria-hidden="true" className="opacity-50">·</span>
            <span className="font-normal opacity-90">{copy.hint}</span>
            <span aria-hidden="true" className="opacity-50">·</span>
            <span className="font-mono tabular-nums opacity-70">
              {batch.avg_rate} bpm · d={batch.avg_depth.toFixed(2)}
            </span>
          </motion.div>
        ) : (
          <motion.span
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-xs text-zinc-600"
          >
            Press the pad to begin scoring.
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
