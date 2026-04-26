'use client';

import { motion, AnimatePresence } from 'framer-motion';
import type { CoachPhrase } from '@/types/contracts';

export type CoachTextProps = {
  phrase: CoachPhrase | null;
};

const PRIORITY_TONE: Record<CoachPhrase['priority'], string> = {
  low: 'text-emerald-400',
  medium: 'text-amber-400',
  high: 'text-orange-400',
  critical: 'text-red-400',
};

const PRIORITY_BORDER: Record<CoachPhrase['priority'], string> = {
  low: 'border-emerald-900',
  medium: 'border-amber-900',
  high: 'border-orange-900',
  critical: 'border-red-900',
};

export function CoachText({ phrase }: CoachTextProps) {
  return (
    <div
      data-testid="coach-text"
      role="status"
      aria-live="polite"
      className="min-h-[3.25rem] w-full"
    >
      <AnimatePresence mode="wait">
        {phrase ? (
          <motion.div
            key={phrase.feedback}
            data-testid="coach-text-active"
            data-priority={phrase.priority}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className={`flex items-center gap-3 rounded-lg border bg-zinc-950 px-4 py-3 ${PRIORITY_BORDER[phrase.priority]}`}
          >
            <span
              aria-hidden="true"
              className={`h-2 w-2 shrink-0 rounded-full ${
                phrase.priority === 'low'
                  ? 'bg-emerald-400'
                  : phrase.priority === 'medium'
                    ? 'bg-amber-400'
                    : phrase.priority === 'high'
                      ? 'bg-orange-400'
                      : 'bg-red-400'
              }`}
            />
            <p
              data-testid="coach-text-phrase"
              className={`text-base font-medium leading-tight ${PRIORITY_TONE[phrase.priority]}`}
            >
              {phrase.feedback}
            </p>
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            data-testid="coach-text-empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center rounded-lg border border-zinc-900 border-dashed bg-zinc-950 px-4 py-3 text-sm text-zinc-600"
          >
            Coach silent.
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
