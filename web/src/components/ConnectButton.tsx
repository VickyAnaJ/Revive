'use client';

export type ConnectButtonProps = {
  isSupported: boolean;
  isConnected: boolean;
  onConnect: () => void;
  onDisconnect?: () => void;
};

export function ConnectButton({
  isSupported,
  isConnected,
  onConnect,
  onDisconnect,
}: ConnectButtonProps) {
  if (!isSupported) {
    return (
      <button
        type="button"
        disabled
        data-testid="connect-button"
        className="btn btn-mono"
        title="Web Serial not available. Press Option+Shift+Space for keyboard mode."
      >
        Web Serial unsupported
      </button>
    );
  }

  if (isConnected) {
    return (
      <button
        type="button"
        onClick={onDisconnect}
        data-testid="connect-button"
        className="btn btn-mono"
        style={{ borderColor: 'var(--good)', color: 'var(--good)' }}
      >
        ● Connected — disconnect
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onConnect}
      data-testid="connect-button"
      className="btn btn-mono"
    >
      Connect Arduino
    </button>
  );
}
