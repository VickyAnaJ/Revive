'use client';

import { motion } from 'framer-motion';

export type DepthBarProps = {
  depth: number;
  forceCeiling?: boolean;
};

export function DepthBar({ depth, forceCeiling = false }: DepthBarProps) {
  const clamped = Math.max(0, Math.min(1, depth));
  const heightPct = clamped * 100;

  return (
    <div
      data-testid="depth-bar"
      className="relative flex h-64 w-16 flex-col-reverse overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950"
    >
      <motion.div
        data-testid="depth-bar-fill"
        className={
          forceCeiling
            ? 'w-full bg-red-500'
            : 'w-full bg-emerald-500'
        }
        style={{ height: `${heightPct}%` }}
        animate={{ height: `${heightPct}%` }}
        transition={{ type: 'spring', stiffness: 300, damping: 20, mass: 0.5 }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 h-px bg-zinc-600"
        style={{ bottom: '40%' }}
        title="minimum depth"
      />
      <div
        className="pointer-events-none absolute inset-x-0 h-px bg-emerald-700"
        style={{ bottom: '75%' }}
        title="target depth"
      />
    </div>
  );
}
