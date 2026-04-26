import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DecisionCard } from '../DecisionCard';
import type { Scenario } from '@/types/contracts';

const SCENARIO: Scenario = {
  scenario_id: '00000000-0000-4000-8000-000000000001',
  scenario_type: 'cardiac_arrest',
  location: 'Test',
  patient_profile: { age: 45, sex: 'male', body_type: 'adult_average' },
  decision_tree: [
    {
      id: 'd1',
      prompt: 'First decision',
      options: [
        { id: 'a', label: 'Right' },
        { id: 'b', label: 'Wrong' },
      ],
      correct_choice_id: 'a',
      penalty_delta: { hr: 0, o2: 0 },
    },
    {
      id: 'd2',
      prompt: 'Second decision',
      options: [
        { id: 'a', label: 'Right' },
        { id: 'b', label: 'Wrong' },
        { id: 'c', label: 'Maybe' },
        { id: 'd', label: 'No clue' },
      ],
      correct_choice_id: 'a',
      penalty_delta: { hr: 0, o2: 0 },
    },
  ],
};

describe('DecisionCard visibility (Step 5 unit test a)', () => {
  it('renders nothing when visible=false', () => {
    render(
      <DecisionCard scenario={SCENARIO} visible={false} recordedNodeIds={[]} onSelect={vi.fn()} />,
    );
    expect(screen.queryByTestId('decision-card')).toBeNull();
  });

  it('renders nothing when scenario is null', () => {
    render(<DecisionCard scenario={null} visible recordedNodeIds={[]} onSelect={vi.fn()} />);
    expect(screen.queryByTestId('decision-card')).toBeNull();
  });

  it('renders nothing when all decisions already recorded', () => {
    render(
      <DecisionCard
        scenario={SCENARIO}
        visible
        recordedNodeIds={['d1', 'd2']}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('decision-card')).toBeNull();
  });
});

describe('DecisionCard render (Step 5 unit test b)', () => {
  it('renders prompt + 2 option buttons for the first node', () => {
    render(
      <DecisionCard scenario={SCENARIO} visible recordedNodeIds={[]} onSelect={vi.fn()} />,
    );
    expect(screen.getByTestId('decision-prompt').textContent).toBe('First decision');
    expect(screen.getByTestId('decision-option-a')).toBeInTheDocument();
    expect(screen.getByTestId('decision-option-b')).toBeInTheDocument();
  });

  it('renders 4 option buttons when the node has 4 options', () => {
    render(
      <DecisionCard
        scenario={SCENARIO}
        visible
        recordedNodeIds={['d1']}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByTestId('decision-prompt').textContent).toBe('Second decision');
    for (const id of ['a', 'b', 'c', 'd']) {
      expect(screen.getByTestId(`decision-option-${id}`)).toBeInTheDocument();
    }
  });

  it('renders the step counter', () => {
    render(
      <DecisionCard scenario={SCENARIO} visible recordedNodeIds={[]} onSelect={vi.fn()} />,
    );
    expect(screen.getByTestId('decision-step').textContent).toBe('Decision 1 of 2');
  });

  it('updates the step counter as decisions are recorded', () => {
    render(
      <DecisionCard
        scenario={SCENARIO}
        visible
        recordedNodeIds={['d1']}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByTestId('decision-step').textContent).toBe('Decision 2 of 2');
  });
});

describe('DecisionCard onSelect (Step 5 unit test c)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires onSelect with (nodeId, choiceId) after the feedback hold expires', () => {
    const onSelect = vi.fn();
    render(
      <DecisionCard scenario={SCENARIO} visible recordedNodeIds={[]} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByTestId('decision-option-a'));
    // Feedback shows immediately; onSelect is delayed.
    expect(screen.getByTestId('decision-feedback')).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith('d1', 'a');
  });

  it('fires onSelect for the second node after the first is recorded', () => {
    const onSelect = vi.fn();
    render(
      <DecisionCard
        scenario={SCENARIO}
        visible
        recordedNodeIds={['d1']}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByTestId('decision-option-c'));
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onSelect).toHaveBeenCalledWith('d2', 'c');
  });

  it('shows correct=true feedback when the right option is picked', () => {
    const onSelect = vi.fn();
    render(
      <DecisionCard scenario={SCENARIO} visible recordedNodeIds={[]} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByTestId('decision-option-a'));
    expect(screen.getByTestId('decision-feedback').dataset.correct).toBe('true');
  });

  it('shows correct=false feedback when the wrong option is picked', () => {
    const onSelect = vi.fn();
    render(
      <DecisionCard scenario={SCENARIO} visible recordedNodeIds={[]} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByTestId('decision-option-b'));
    const feedback = screen.getByTestId('decision-feedback');
    expect(feedback.dataset.correct).toBe('false');
    expect(feedback.textContent).toContain('Right');
  });
});
