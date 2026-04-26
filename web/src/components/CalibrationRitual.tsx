'use client';

import { useState, useCallback, useEffect } from 'react';
import { writeCalibration, type CalibrationCapture } from '@/lib/Calibrator';
import type { SerialFrame } from '@/types/contracts';

const STEPS = [
  { id: 'start', label: 'Light press', hint: 'Press as gently as still feels like a press.' },
  { id: 'target', label: 'Target press', hint: 'Press as if doing real CPR.' },
  { id: 'max', label: 'Maximum press', hint: 'Press as hard as you can sustain.' },
] as const;

type StepId = (typeof STEPS)[number]['id'];

type Subscribe = (handler: (frame: SerialFrame) => void) => () => void;

export type CalibrationRitualProps = {
  subscribe: Subscribe;
  onComplete: (profile: CalibrationCapture) => void;
  onAbort?: () => void;
};

export function CalibrationRitual({ subscribe, onComplete, onAbort }: CalibrationRitualProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [captured, setCaptured] = useState<Partial<Record<StepId, number>>>({});
  const [livePeak, setLivePeak] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribe((frame) => setLivePeak(frame.depth));
    return unsubscribe;
  }, [subscribe]);

  const currentStep = STEPS[stepIndex];

  const captureCurrentStep = useCallback(() => {
    if (livePeak === null) {
      setError('No press detected yet. Press the pad once and try again.');
      return;
    }
    const next = { ...captured, [currentStep.id]: livePeak };
    setCaptured(next);
    setError(null);
    if (stepIndex < STEPS.length - 1) {
      setStepIndex(stepIndex + 1);
      return;
    }
    const profile = next as Record<StepId, number>;
    try {
      writeCalibration(profile);
      onComplete(profile);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [captured, currentStep.id, livePeak, onComplete, stepIndex]);

  const reset = useCallback(() => {
    setStepIndex(0);
    setCaptured({});
    setLivePeak(null);
    setError(null);
    onAbort?.();
  }, [onAbort]);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-6 text-zinc-100">
      <h2 className="mb-2 text-lg font-semibold">Calibration: {currentStep.label}</h2>
      <p className="mb-4 text-sm text-zinc-400">{currentStep.hint}</p>
      <p className="mb-4 text-sm">
        Live depth:{' '}
        <span className="font-mono">{livePeak === null ? '—' : livePeak.toFixed(3)}</span>
      </p>
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={captureCurrentStep}
          className="rounded bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400"
        >
          Capture {currentStep.label}
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-900"
        >
          Reset
        </button>
      </div>
      <p className="mt-4 text-xs text-zinc-500">
        Step {stepIndex + 1} of {STEPS.length}
      </p>
    </div>
  );
}
