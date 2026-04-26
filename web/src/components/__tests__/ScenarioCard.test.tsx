import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScenarioCard } from '../ScenarioCard';
import type { Scenario } from '@/types/contracts';

const SCENARIO: Scenario = {
  scenario_id: '00000000-0000-4000-8000-000000000001',
  scenario_type: 'cardiac_arrest',
  location: 'Coffee shop, weekday morning',
  patient_profile: { age: 52, sex: 'female', body_type: 'adult_average' },
  decision_tree: [
    {
      id: 'd1',
      prompt: 'p',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      correct_choice_id: 'a',
      penalty_delta: { hr: 0, o2: 0 },
    },
    {
      id: 'd2',
      prompt: 'p',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      correct_choice_id: 'a',
      penalty_delta: { hr: 0, o2: 0 },
    },
    {
      id: 'd3',
      prompt: 'p',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      correct_choice_id: 'a',
      penalty_delta: { hr: 0, o2: 0 },
    },
  ],
};

describe('ScenarioCard render (Step 5 unit test c)', () => {
  it('renders the location, demographics, and decision count', () => {
    render(<ScenarioCard scenario={SCENARIO} />);
    expect(screen.getByTestId('scenario-location').textContent).toBe('Coffee shop, weekday morning');
    expect(screen.getByTestId('scenario-demographics').textContent).toContain('52y');
    expect(screen.getByTestId('scenario-demographics').textContent).toContain('female');
    expect(screen.getByTestId('scenario-decision-count').textContent).toBe('3 decisions');
  });

  it('renders the body type badge with underscores replaced', () => {
    render(<ScenarioCard scenario={SCENARIO} />);
    const card = screen.getByTestId('scenario-card');
    expect(card.textContent).toContain('adult average');
  });

  it('singular wording when only one decision', () => {
    const single = {
      ...SCENARIO,
      decision_tree: [SCENARIO.decision_tree[0], SCENARIO.decision_tree[0], SCENARIO.decision_tree[0]],
    };
    single.decision_tree.pop();
    single.decision_tree.pop();
    render(<ScenarioCard scenario={single} />);
    expect(screen.getByTestId('scenario-decision-count').textContent).toBe('1 decision');
  });
});

describe('ScenarioCard empty state (Step 5 dynamic-case invariant)', () => {
  it('renders the placeholder when no scenario loaded', () => {
    render(<ScenarioCard scenario={null} />);
    expect(screen.getByTestId('scenario-card-empty')).toBeInTheDocument();
    expect(screen.getByTestId('scenario-card-empty').textContent).toContain('Awaiting scenario');
  });
});
