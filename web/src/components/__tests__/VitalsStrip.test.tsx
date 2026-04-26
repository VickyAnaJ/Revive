import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VitalsStrip } from '../VitalsStrip';
import type { PatientState } from '@/types/contracts';

const baseVitals: PatientState = {
  hr: 72,
  bp: '110/70',
  o2: 88,
  rhythm: 'weak_pulse',
  complication: null,
  patient_speech: null,
  body_type_feedback: null,
};

describe('VitalsStrip render (Step 5 unit test a)', () => {
  it('renders HR, BP, O2, and rhythm from props', () => {
    render(<VitalsStrip vitals={baseVitals} />);
    expect(screen.getByTestId('vitals-hr').textContent).toBe('72');
    expect(screen.getByTestId('vitals-bp').textContent).toBe('110/70');
    expect(screen.getByTestId('vitals-o2').textContent).toBe('88');
    expect(screen.getByTestId('vitals-rhythm').textContent).toBe('Weak pulse');
  });

  it('uses an emerald rhythm tone for sinus rhythm', () => {
    render(<VitalsStrip vitals={{ ...baseVitals, rhythm: 'sinus' }} />);
    const rhythm = screen.getByTestId('vitals-rhythm');
    expect(rhythm.className).toContain('text-emerald-400');
    expect(rhythm.textContent).toBe('Sinus');
  });

  it('labels rosc rhythm distinctly', () => {
    render(<VitalsStrip vitals={{ ...baseVitals, rhythm: 'rosc' }} />);
    expect(screen.getByTestId('vitals-rhythm').textContent).toBe('ROSC');
  });

  it('uses a red rhythm tone for v_fib and flatline', () => {
    const { rerender } = render(<VitalsStrip vitals={{ ...baseVitals, rhythm: 'v_fib' }} />);
    expect(screen.getByTestId('vitals-rhythm').className).toContain('text-red-400');
    rerender(<VitalsStrip vitals={{ ...baseVitals, rhythm: 'flatline' }} />);
    expect(screen.getByTestId('vitals-rhythm').className).toContain('text-red-500');
  });
});

describe('VitalsStrip trend arrow (Step 5 unit test b)', () => {
  it('shows up when current HR is meaningfully higher than previous', () => {
    render(<VitalsStrip vitals={baseVitals} prevVitals={{ ...baseVitals, hr: 60 }} />);
    expect(screen.getByLabelText('trend up')).toBeInTheDocument();
  });

  it('shows down when current O2 is meaningfully lower than previous', () => {
    render(<VitalsStrip vitals={baseVitals} prevVitals={{ ...baseVitals, o2: 95 }} />);
    expect(screen.getByLabelText('trend down')).toBeInTheDocument();
  });

  it('shows flat when within ±1 unit of previous', () => {
    render(<VitalsStrip vitals={baseVitals} prevVitals={{ ...baseVitals, hr: 73, o2: 87 }} />);
    const flats = screen.getAllByLabelText('trend flat');
    expect(flats.length).toBeGreaterThanOrEqual(2);
  });

  it('shows flat when no previous vitals provided', () => {
    render(<VitalsStrip vitals={baseVitals} />);
    expect(screen.getAllByLabelText('trend flat').length).toBeGreaterThan(0);
  });
});

describe('VitalsStrip dynamic-case invariants', () => {
  it('renders cleanly with hr=0 (cardiac arrest baseline)', () => {
    render(<VitalsStrip vitals={{ ...baseVitals, hr: 0, o2: 0, rhythm: 'flatline' }} />);
    expect(screen.getByTestId('vitals-hr').textContent).toBe('0');
    expect(screen.getByTestId('vitals-rhythm').textContent).toBe('Flatline');
  });

  it('handles a long bp string without breaking layout', () => {
    render(<VitalsStrip vitals={{ ...baseVitals, bp: '120/80' }} />);
    expect(screen.getByTestId('vitals-bp').textContent).toBe('120/80');
  });
});
