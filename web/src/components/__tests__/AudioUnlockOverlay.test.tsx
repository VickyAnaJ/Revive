import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AudioUnlockOverlay } from '../AudioUnlockOverlay';

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('AudioUnlockOverlay (Step 5 unit test d)', () => {
  it('renders the overlay on first mount', () => {
    render(<AudioUnlockOverlay />);
    expect(screen.getByTestId('audio-unlock-overlay')).toBeInTheDocument();
  });

  it('disappears after the first click', () => {
    render(<AudioUnlockOverlay />);
    fireEvent.click(screen.getByTestId('audio-unlock-overlay'));
    expect(screen.queryByTestId('audio-unlock-overlay')).toBeNull();
  });

  it('invokes onUnlock callback when AudioContext is available', () => {
    class FakeAudioContext {
      resume() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);

    const onUnlock = vi.fn();
    render(<AudioUnlockOverlay onUnlock={onUnlock} />);
    fireEvent.click(screen.getByTestId('audio-unlock-overlay'));

    expect(onUnlock).toHaveBeenCalledOnce();
    expect(onUnlock.mock.calls[0][0]).toBeInstanceOf(FakeAudioContext);
    vi.unstubAllGlobals();
  });

  it('still dismisses even when AudioContext is unavailable', () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', undefined);
    render(<AudioUnlockOverlay />);
    fireEvent.click(screen.getByTestId('audio-unlock-overlay'));
    expect(screen.queryByTestId('audio-unlock-overlay')).toBeNull();
    vi.unstubAllGlobals();
  });
});
