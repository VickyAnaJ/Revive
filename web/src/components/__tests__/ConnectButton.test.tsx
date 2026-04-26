import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConnectButton } from '../ConnectButton';

describe('ConnectButton (Step 5 unit test c)', () => {
  it('is disabled when Web Serial is unsupported', () => {
    render(
      <ConnectButton isSupported={false} isConnected={false} onConnect={() => undefined} />,
    );
    const btn = screen.getByTestId('connect-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain('Web Serial unsupported');
  });

  it('is enabled and triggers onConnect when supported and disconnected', () => {
    const onConnect = vi.fn();
    render(<ConnectButton isSupported isConnected={false} onConnect={onConnect} />);
    const btn = screen.getByTestId('connect-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onConnect).toHaveBeenCalledOnce();
  });

  it('shows the connected state and triggers onDisconnect', () => {
    const onDisconnect = vi.fn();
    render(
      <ConnectButton
        isSupported
        isConnected
        onConnect={() => undefined}
        onDisconnect={onDisconnect}
      />,
    );
    const btn = screen.getByTestId('connect-button') as HTMLButtonElement;
    expect(btn.textContent).toContain('disconnect');
    fireEvent.click(btn);
    expect(onDisconnect).toHaveBeenCalledOnce();
  });
});
