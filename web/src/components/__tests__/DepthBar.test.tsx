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

  it('uses the idle color class when no classification has arrived yet', () => {
    render(<DepthBar depth={0.5} />);
    const fill = screen.getByTestId('depth-bar-fill');
    expect(fill.className).toContain('bg-zinc-700');
  });

  it('uses emerald for adequate compressions', () => {
    render(<DepthBar depth={0.5} classification="adequate" />);
    const fill = screen.getByTestId('depth-bar-fill');
    expect(fill.className).toContain('bg-emerald-500');
  });

  it('uses amber for off-target classifications', () => {
    render(<DepthBar depth={0.5} classification="too_shallow" />);
    const fill = screen.getByTestId('depth-bar-fill');
    expect(fill.className).toContain('bg-amber-400');
  });

  it('uses red for force_ceiling classification', () => {
    render(<DepthBar depth={0.5} classification="force_ceiling" />);
    const fill = screen.getByTestId('depth-bar-fill');
    expect(fill.className).toContain('bg-red-500');
  });
});
