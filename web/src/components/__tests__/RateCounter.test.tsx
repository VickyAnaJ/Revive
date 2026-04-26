import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RateCounter } from '../RateCounter';

describe('RateCounter (Step 5 unit test b)', () => {
  it('renders zero when rate is 0', () => {
    render(<RateCounter rate={0} />);
    expect(screen.getByTestId('rate-counter-value').textContent).toBe('0');
  });

  it('renders the rounded BPM value', () => {
    render(<RateCounter rate={110.6} />);
    expect(screen.getByTestId('rate-counter-value').textContent).toBe('111');
  });

  it('clamps rate to 220', () => {
    render(<RateCounter rate={500} />);
    expect(screen.getByTestId('rate-counter-value').textContent).toBe('220');
  });

  it('uses the in-target color class when rate is between 100 and 120', () => {
    render(<RateCounter rate={110} />);
    const value = screen.getByTestId('rate-counter-value');
    expect(value.className).toContain('text-emerald-400');
  });

  it('uses the neutral color class when rate is below 100', () => {
    render(<RateCounter rate={80} />);
    const value = screen.getByTestId('rate-counter-value');
    expect(value.className).not.toContain('text-emerald-400');
  });
});
