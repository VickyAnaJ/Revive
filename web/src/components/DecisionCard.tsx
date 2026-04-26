'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Scenario, DecisionNode } from '@/types/contracts';

export type DecisionCardProps = {
  scenario: Scenario | null;
  visible: boolean;
  recordedNodeIds: readonly string[];
  onSelect: (nodeId: string, choiceId: string) => void;
};

type FeedbackState = {
  nodeId: string;
  choiceId: string;
  correct: boolean;
  correctLabel: string;
  whyText: string;
};

const FEEDBACK_HOLD_MS = 2000;

function nextNode(
  scenario: Scenario,
  recorded: readonly string[],
): DecisionNode | null {
  return scenario.decision_tree.find((n) => !recorded.includes(n.id)) ?? null;
}

export function DecisionCard({
  scenario,
  visible,
  recordedNodeIds,
  onSelect,
}: DecisionCardProps) {
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  const handleClick = useCallback(
    (node: DecisionNode, choiceId: string) => {
      if (feedback) return;
      const correctOption = node.options.find((o) => o.id === node.correct_choice_id);
      const correct = node.correct_choice_id === choiceId;
      setFeedback({
        nodeId: node.id,
        choiceId,
        correct,
        correctLabel: correctOption?.label ?? '',
        whyText: correct
          ? 'Locked in. Move on.'
          : `The right call was: ${correctOption?.label ?? '?'}`,
      });
      window.setTimeout(() => {
        onSelect(node.id, choiceId);
        setFeedback(null);
      }, FEEDBACK_HOLD_MS);
    },
    [feedback, onSelect],
  );

  if (!scenario || !visible) return null;
  const node = nextNode(scenario, recordedNodeIds);
  if (!node) return null;

  const totalSteps = scenario.decision_tree.length;
  const stepNumber = recordedNodeIds.length + 1;

  return (
    <AnimatePresence mode="wait">
      <motion.section
        key={node.id}
        data-testid="decision-card"
        aria-label="Active decision"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="relative flex w-full flex-col gap-3 rounded-lg border border-cyan-900 bg-zinc-950 px-4 py-3"
      >
        <header className="flex items-baseline justify-between gap-2">
          <span
            data-testid="decision-step"
            className="text-[10px] uppercase tracking-wider text-cyan-400"
          >
            Decision {stepNumber} of {totalSteps}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">
            choose one
          </span>
        </header>
        <p
          data-testid="decision-prompt"
          className="text-base font-medium leading-snug text-zinc-100"
        >
          {node.prompt}
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {node.options.map((opt) => {
            const isPicked = feedback?.choiceId === opt.id;
            const isAnswer = feedback && opt.id === node.correct_choice_id;
            const tone = !feedback
              ? 'border-zinc-800 bg-zinc-900 hover:border-cyan-700 hover:bg-zinc-800'
              : isAnswer
                ? 'border-emerald-700 bg-emerald-950 text-emerald-200'
                : isPicked
                  ? 'border-red-800 bg-red-950 text-red-200'
                  : 'border-zinc-900 bg-zinc-950 text-zinc-600';
            return (
              <button
                key={opt.id}
                type="button"
                disabled={!!feedback}
                data-testid={`decision-option-${opt.id}`}
                onClick={() => handleClick(node, opt.id)}
                className={`rounded border px-3 py-2 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${tone}`}
              >
                <span className="mr-2 font-mono text-xs text-cyan-400">
                  {opt.id.toUpperCase()}
                </span>
                {opt.label}
              </button>
            );
          })}
        </div>
        <AnimatePresence>
          {feedback && (
            <motion.div
              key="feedback"
              data-testid="decision-feedback"
              data-correct={feedback.correct}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className={
                feedback.correct
                  ? 'flex items-center gap-2 rounded border border-emerald-700 bg-emerald-950 px-3 py-2 text-sm text-emerald-200'
                  : 'flex items-center gap-2 rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200'
              }
            >
              <span aria-hidden="true">{feedback.correct ? '✓' : '✗'}</span>
              <span>{feedback.whyText}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>
    </AnimatePresence>
  );
}
