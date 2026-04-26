import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DepthBar } from '../DepthBar';

describe('DepthBar (Step 5 unit test a)', () => {
  it('renders the fill at 0% when depth is 0', () => {
    render(<DepthBar depth={0} />);
    const fill = screen.getByTestId('depth-bar-fill');
    expect(fill.style.height).toBe('0%');
  });

  it('renders the fill at 50% when depth is 0.5', () => {
    render(<DepthBar depth={0.5} />);
    const fill = screen.getByTestId('depth-bar-fill');
    expect(fill.style.height).toBe('50%');
  });

  it('renders the fill at 100% when depth is 1.0', () => {
    render(<DepthBar depth={1.0} />);
    const fill = screen.getByTestId('depth-bar-fill');
    expect(fill.style.height).toBe('100%');
  });

  it('clamps depths above 1 to 100%', () => {
    render(<DepthBar depth={1.2} />);
    const fill = screen.getByTestId('depth-bar-fill');
    expect(fill.style.height).toBe('100%');
  });

  it('clamps negative depths to 0%', () => {
    render(<DepthBar depth={-0.3} />);
    const fill = screen.getByTestId('depth-bar-fill');
    expect(fill.style.height).toBe('0%');
  });

  it('switches to the force-ceiling color class when forceCeiling is true', () => {
    render(<DepthBar depth={0.5} forceCeiling />);
    const fill = screen.getByTestId('depth-bar-fill');
    expect(fill.className).toContain('bg-red-500');
  });

  it('uses the normal color class when forceCeiling is false', () => {
    render(<DepthBar depth={0.5} />);
    const fill = screen.getByTestId('depth-bar-fill');
    expect(fill.className).toContain('bg-emerald-500');
  });
});
