'use client';

import { motion } from 'framer-motion';
import type {
  CompressionStats,
  DecisionRecord,
  SessionOutcome,
} from '@/controllers/SessionController';
import type { Scenario, PatientState } from '@/types/contracts';

export type ResultsScreenProps = {
  scenario: Scenario | null;
  decisions: readonly DecisionRecord[];
  finalVitals: PatientState;
  stats: CompressionStats;
  outcome: SessionOutcome;
  durationMs: number;
  onReset: () => void;
};

function formatDuration(ms: number): string {
  if (ms <= 0) return '0:00';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function decisionLookup(scenario: Scenario | null, nodeId: string) {
  if (!scenario) return null;
  return scenario.decision_tree.find((n) => n.id === nodeId) ?? null;
}

function optionLabel(scenario: Scenario | null, nodeId: string, choiceId: string): string {
  const node = decisionLookup(scenario, nodeId);
  if (!node) return choiceId;
  return node.options.find((o) => o.id === choiceId)?.label ?? choiceId;
}

export function ResultsScreen({
  scenario,
  decisions,
  finalVitals,
  stats,
  outcome,
  durationMs,
  onReset,
}: ResultsScreenProps) {
  const total = decisions.length;
  const correct = decisions.filter((d) => d.correct).length;
  const accuracyPct = total === 0 ? 0 : Math.round((correct / total) * 100);
  const avgTimeMs =
    total === 0
      ? 0
      : Math.round(decisions.reduce((s, d) => s + d.timeToDecideMs, 0) / total);

  const compAccuracyPct =
    stats.totalBatches === 0
      ? 0
      : Math.round((stats.adequateBatches / stats.totalBatches) * 100);
  const compTotalSeconds = stats.totalBatches * 2;
  const adequateSeconds = stats.adequateBatches * 2;

  const survived = outcome === 'survived';
  const headerTitle = survived ? 'Patient survived' : 'Patient lost';
  const headerClass = survived ? 'text-emerald-300' : 'text-red-300';
  const badgeClass = survived
    ? 'rounded bg-emerald-900 px-2 py-0.5 text-xs uppercase tracking-wider text-emerald-200'
    : 'rounded bg-red-900 px-2 py-0.5 text-xs uppercase tracking-wider text-red-200';
  const badgeText = survived ? 'ROSC ACHIEVED' : finalVitals.rhythm.toUpperCase();
  const borderClass = survived ? 'border-emerald-800' : 'border-red-900';

  return (
    <motion.section
      data-testid="results-screen"
      data-outcome={outcome}
      aria-label="Session debrief"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: 'easeOut' }}
      className={`flex w-full max-w-3xl flex-col gap-5 rounded-lg border ${borderClass} bg-zinc-950 px-6 py-5`}
    >
      <header className="flex items-baseline justify-between">
        <h2 className={`text-2xl font-semibold ${headerClass}`}>{headerTitle}</h2>
        <span data-testid="results-survival" className={badgeClass}>
          {badgeText}
        </span>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="rounded border border-zinc-800 bg-zinc-900 px-3 py-2">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">
            Total time
          </span>
          <p
            data-testid="results-duration"
            className="font-mono text-2xl tabular-nums text-zinc-100"
          >
            {formatDuration(durationMs)}
          </p>
          <span className="text-xs text-zinc-500">start to debrief</span>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-900 px-3 py-2">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">
            Decision accuracy
          </span>
          <p
            data-testid="results-accuracy"
            className="font-mono text-2xl tabular-nums text-zinc-100"
          >
            {accuracyPct}%
          </p>
          <span className="text-xs text-zinc-500">
            {correct} of {total} correct
          </span>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-900 px-3 py-2">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">
            Compression accuracy
          </span>
          <p
            data-testid="results-comp-accuracy"
            className="font-mono text-2xl tabular-nums text-zinc-100"
          >
            {compAccuracyPct}%
          </p>
          <span className="text-xs text-zinc-500">
            {adequateSeconds}s of {compTotalSeconds}s adequate
          </span>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-900 px-3 py-2">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">
            Avg time / decision
          </span>
          <p className="font-mono text-2xl tabular-nums text-zinc-100">
            {(avgTimeMs / 1000).toFixed(1)}s
          </p>
          <span className="text-xs text-zinc-500">{total} decisions</span>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-900 px-3 py-2">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">
            Final HR / O₂
          </span>
          <p className="font-mono text-2xl tabular-nums text-zinc-100">
            {finalVitals.hr} / {finalVitals.o2}
          </p>
          <span className="text-xs text-zinc-500">{finalVitals.bp}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded border border-zinc-800 bg-zinc-900 px-3 py-2">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">
            Too shallow
          </span>
          <p data-testid="results-too-shallow" className="font-mono text-base text-amber-300">
            {stats.tooShallowBatches}
          </p>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-900 px-3 py-2">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">
            Off-rhythm
          </span>
          <p className="font-mono text-base text-amber-300">
            {stats.tooFastBatches + stats.tooSlowBatches}
          </p>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-900 px-3 py-2">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">
            Too hard
          </span>
          <p data-testid="results-force-ceiling" className="font-mono text-base text-red-400">
            {stats.forceCeilingBatches}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">
          Decision review
        </span>
        <ul data-testid="results-decision-list" className="flex flex-col gap-2">
          {decisions.map((d, i) => {
            const node = decisionLookup(scenario, d.nodeId);
            const userPick = optionLabel(scenario, d.nodeId, d.choiceId);
            const correctPick = node
              ? optionLabel(scenario, d.nodeId, node.correct_choice_id)
              : '?';
            return (
              <li
                key={d.nodeId}
                data-testid={`results-decision-${d.nodeId}`}
                className={
                  d.correct
                    ? 'rounded border border-emerald-900 bg-emerald-950 px-3 py-2 text-sm'
                    : 'rounded border border-red-900 bg-red-950 px-3 py-2 text-sm'
                }
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-zinc-100">
                    {i + 1}. {node?.prompt ?? d.nodeId}
                  </span>
                  <span aria-hidden="true">{d.correct ? '✓' : '✗'}</span>
                </div>
                <div className="mt-1 text-xs text-zinc-300">You: {userPick}</div>
                {!d.correct && (
                  <div className="mt-0.5 text-xs text-emerald-300">
                    Right call: {correctPick}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <button
        type="button"
        onClick={onReset}
        data-testid="results-reset-button"
        className="self-start rounded bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400"
      >
        Run another scenario
      </button>
    </motion.section>
  );
}
