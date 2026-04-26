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
        className="cursor-not-allowed rounded border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm text-zinc-500"
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
        className="rounded border border-emerald-700 bg-emerald-950 px-4 py-2 text-sm text-emerald-300 hover:bg-emerald-900"
      >
        Connected — disconnect
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onConnect}
      data-testid="connect-button"
      className="rounded bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400"
    >
      Connect Arduino
    </button>
  );
}
