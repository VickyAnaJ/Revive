import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { KeyboardFallback } from '../keyboardFallback';
import type { SerialFrame } from '@/types/contracts';

function dispatchKey(opts: KeyboardEventInit & { code: string }): void {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...opts });
  window.dispatchEvent(event);
}

describe('KeyboardFallback hotkey behavior (Step 5 unit tests b and c)', () => {
  let fb: KeyboardFallback;

  beforeEach(() => {
    fb = new KeyboardFallback();
    fb.start();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    fb.stop();
  });

  it('alt+shift+space toggles keyboard mode on and off', () => {
    expect(fb.isActive()).toBe(false);
    dispatchKey({ code: 'Space', altKey: true, shiftKey: true });
    expect(fb.isActive()).toBe(true);
    dispatchKey({ code: 'Space', altKey: true, shiftKey: true });
    expect(fb.isActive()).toBe(false);
  });

  it('emits a mode event with the new active state on toggle', () => {
    const mode = vi.fn();
    fb.addEventListener('mode', mode as EventListener);
    dispatchKey({ code: 'Space', altKey: true, shiftKey: true });
    expect(mode).toHaveBeenCalledOnce();
    const detail = (mode.mock.calls[0][0] as CustomEvent<{ active: boolean }>).detail;
    expect(detail.active).toBe(true);
  });

  it.each([
    { code: 'Space', altKey: true, shiftKey: false, label: 'alt+space' },
    { code: 'Space', altKey: false, shiftKey: true, label: 'shift+space' },
    { code: 'Space', altKey: false, shiftKey: false, ctrlKey: true, label: 'ctrl+space' },
    { code: 'Space', altKey: false, shiftKey: false, metaKey: true, label: 'cmd+space' },
    { code: 'Space', altKey: false, shiftKey: false, label: 'space alone' },
    { code: 'KeyA', altKey: true, shiftKey: true, label: 'alt+shift+a' },
  ])('does not toggle on $label', ({ label: _label, ...opts }) => {
    dispatchKey(opts);
    expect(fb.isActive()).toBe(false);
  });
});

describe('KeyboardFallback peak synthesis (Step 5 unit test b: synthesized event shape)', () => {
  let fb: KeyboardFallback;

  beforeEach(() => {
    fb = new KeyboardFallback();
    fb.start();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    fb.stop();
  });

  it('does not emit peak events when inactive', () => {
    const peak = vi.fn();
    fb.addEventListener('peak', peak as EventListener);
    dispatchKey({ code: 'Space' });
    expect(peak).not.toHaveBeenCalled();
  });

  it('emits a peak event when active and spacebar is pressed', () => {
    fb.setActive(true);
    const peak = vi.fn();
    fb.addEventListener('peak', peak as EventListener);
    dispatchKey({ code: 'Space' });
    expect(peak).toHaveBeenCalledOnce();
    const detail = (peak.mock.calls[0][0] as CustomEvent<SerialFrame>).detail;
    expect(detail.depth).toBeGreaterThan(0);
    expect(detail.depth).toBeLessThanOrEqual(1);
    expect(detail.rate).toBe(0);
    expect(detail.ts).toBeGreaterThan(0);
  });

  it('computes rate from the interval between consecutive presses', () => {
    fb.setActive(true);
    const peak = vi.fn();
    fb.addEventListener('peak', peak as EventListener);

    const t0 = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(t0);
    dispatchKey({ code: 'Space' });
    vi.spyOn(Date, 'now').mockReturnValue(t0 + 600);
    dispatchKey({ code: 'Space' });

    const second = (peak.mock.calls[1][0] as CustomEvent<SerialFrame>).detail;
    expect(second.rate).toBe(100);
  });

  it('clamps synthesized rate to 220 BPM', () => {
    fb.setActive(true);
    const peak = vi.fn();
    fb.addEventListener('peak', peak as EventListener);

    const t0 = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(t0);
    dispatchKey({ code: 'Space' });
    vi.spyOn(Date, 'now').mockReturnValue(t0 + 100);
    dispatchKey({ code: 'Space' });

    const second = (peak.mock.calls[1][0] as CustomEvent<SerialFrame>).detail;
    expect(second.rate).toBeLessThanOrEqual(220);
  });
});
