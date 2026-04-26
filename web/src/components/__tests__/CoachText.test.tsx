import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CoachText } from '../CoachText';
import type { CoachPhrase } from '@/types/contracts';

describe('CoachText priority colors (Step 5 unit test d)', () => {
  it('renders an emerald tone for low priority', () => {
    const phrase: CoachPhrase = { feedback: 'Stay here. Both green.', priority: 'low' };
    render(<CoachText phrase={phrase} />);
    expect(screen.getByTestId('coach-text-phrase').className).toContain('text-emerald-400');
    expect(screen.getByTestId('coach-text-active').dataset.priority).toBe('low');
  });

  it('renders an amber tone for medium priority', () => {
    const phrase: CoachPhrase = { feedback: 'Slow down. Get the number green.', priority: 'medium' };
    render(<CoachText phrase={phrase} />);
    expect(screen.getByTestId('coach-text-phrase').className).toContain('text-amber-400');
  });

  it('renders an orange tone for high priority', () => {
    const phrase: CoachPhrase = { feedback: 'Push past the upper line.', priority: 'high' };
    render(<CoachText phrase={phrase} />);
    expect(screen.getByTestId('coach-text-phrase').className).toContain('text-orange-400');
  });

  it('renders a red tone for critical priority', () => {
    const phrase: CoachPhrase = { feedback: 'Ease up. Bar is red.', priority: 'critical' };
    render(<CoachText phrase={phrase} />);
    expect(screen.getByTestId('coach-text-phrase').className).toContain('text-red-400');
  });

  it('shows the phrase text verbatim', () => {
    const phrase: CoachPhrase = { feedback: 'Stay here. Both green.', priority: 'low' };
    render(<CoachText phrase={phrase} />);
    expect(screen.getByTestId('coach-text-phrase').textContent).toBe('Stay here. Both green.');
  });
});

describe('CoachText empty state (Step 5 dynamic-case invariant)', () => {
  it('renders the empty placeholder when no phrase is set', () => {
    render(<CoachText phrase={null} />);
    expect(screen.getByTestId('coach-text-empty')).toBeInTheDocument();
    expect(screen.getByTestId('coach-text-empty').textContent).toContain('Coach silent.');
  });

  it('does not crash on a 200-char phrase', () => {
    const phrase: CoachPhrase = { feedback: 'x'.repeat(200), priority: 'high' };
    render(<CoachText phrase={phrase} />);
    expect(screen.getByTestId('coach-text-phrase').textContent?.length).toBe(200);
  });
});
