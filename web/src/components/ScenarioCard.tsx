'use client';

import type { Scenario } from '@/types/contracts';

export type ScenarioCardProps = {
  scenario: Scenario | null;
};

export function ScenarioCard({ scenario }: ScenarioCardProps) {
  if (!scenario) {
    return (
      <section
        data-testid="scenario-card-empty"
        aria-label="Scenario placeholder"
        className="flex w-full items-center justify-center rounded-lg border border-zinc-800 border-dashed bg-zinc-950 px-4 py-3 text-sm text-zinc-500"
      >
        Awaiting scenario...
      </section>
    );
  }

  const profile = scenario.patient_profile;
  const decisionCount = scenario.decision_tree.length;

  return (
    <section
      data-testid="scenario-card"
      aria-label="Active scenario"
      className="flex w-full flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3"
    >
      <header className="flex items-baseline justify-between gap-2">
        <h2
          data-testid="scenario-location"
          className="text-base font-semibold tracking-tight text-zinc-100"
        >
          {scenario.location}
        </h2>
        <span className="rounded bg-zinc-900 px-2 py-0.5 text-[10px] uppercase tracking-wider text-zinc-400">
          {scenario.scenario_type.replace(/_/g, ' ')}
        </span>
      </header>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
        <span data-testid="scenario-demographics">
          {profile.age}y · {profile.sex}
        </span>
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-300">
          {profile.body_type.replace(/_/g, ' ')}
        </span>
        <span data-testid="scenario-decision-count" className="text-zinc-500">
          {decisionCount} decision{decisionCount === 1 ? '' : 's'}
        </span>
      </div>
    </section>
  );
}
