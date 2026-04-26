'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { SerialBridge } from '@/lib/SerialBridge';
import { KeyboardFallback } from '@/lib/keyboardFallback';
import { readCalibration } from '@/lib/Calibrator';
import { DepthBar } from '@/components/DepthBar';
import { RateCounter } from '@/components/RateCounter';
import { ConnectButton } from '@/components/ConnectButton';
import { AudioUnlockOverlay } from '@/components/AudioUnlockOverlay';
import type { SerialFrame } from '@/types/contracts';

export default function Home() {
  const bridgeRef = useRef<SerialBridge | null>(null);
  const fallbackRef = useRef<KeyboardFallback | null>(null);
  const ceilingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const decayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rateResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isSupported, setIsSupported] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [keyboardActive, setKeyboardActive] = useState(false);
  const [depth, setDepth] = useState(0);
  const [rate, setRate] = useState(0);
  const [forceCeiling, setForceCeiling] = useState(false);
  const [calibrated, setCalibrated] = useState(false);
  const maxSeenRef = useRef(0.3);

  useEffect(() => {
    setIsSupported(SerialBridge.isSupported());
    setCalibrated(readCalibration() !== null);

    const bridge = new SerialBridge();
    const fallback = new KeyboardFallback();
    bridgeRef.current = bridge;
    fallbackRef.current = fallback;

    const onPeak = (event: Event) => {
      const frame = (event as CustomEvent<SerialFrame>).detail;
      if (frame.depth === 0) return;
      if (frame.depth > maxSeenRef.current) {
        maxSeenRef.current = frame.depth;
      }
      const scaled = Math.min(1, frame.depth / maxSeenRef.current);
      setDepth(scaled);
      if (frame.rate > 0) setRate(frame.rate);
      if (decayTimeoutRef.current) clearTimeout(decayTimeoutRef.current);
      decayTimeoutRef.current = setTimeout(() => setDepth((d) => d * 0.4), 350);
      if (rateResetTimeoutRef.current) clearTimeout(rateResetTimeoutRef.current);
      rateResetTimeoutRef.current = setTimeout(() => setRate(0), 3000);
    };

    const onCeiling = () => {
      setForceCeiling(true);
      if (ceilingTimeoutRef.current) clearTimeout(ceilingTimeoutRef.current);
      ceilingTimeoutRef.current = setTimeout(() => setForceCeiling(false), 600);
    };

    const onDisconnect = () => {
      setIsConnected(false);
      console.info('[C9] disconnect detected; keyboard fallback remains armed');
    };

    const onMode = (event: Event) => {
      const detail = (event as CustomEvent<{ active: boolean }>).detail;
      setKeyboardActive(detail.active);
    };

    bridge.addEventListener('peak', onPeak);
    bridge.addEventListener('ceiling', onCeiling);
    bridge.addEventListener('disconnect', onDisconnect);
    fallback.addEventListener('peak', onPeak);
    fallback.addEventListener('mode', onMode);

    fallback.start();

    return () => {
      bridge.removeEventListener('peak', onPeak);
      bridge.removeEventListener('ceiling', onCeiling);
      bridge.removeEventListener('disconnect', onDisconnect);
      fallback.removeEventListener('peak', onPeak);
      fallback.removeEventListener('mode', onMode);
      fallback.stop();
      void bridge.disconnect();
      if (ceilingTimeoutRef.current) clearTimeout(ceilingTimeoutRef.current);
      if (decayTimeoutRef.current) clearTimeout(decayTimeoutRef.current);
      if (rateResetTimeoutRef.current) clearTimeout(rateResetTimeoutRef.current);
    };
  }, []);

  const handleConnect = useCallback(async () => {
    if (!bridgeRef.current) return;
    try {
      await bridgeRef.current.connect();
      setIsConnected(true);
    } catch (err) {
      console.warn('[C9] connect failed', err);
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    if (!bridgeRef.current) return;
    await bridgeRef.current.disconnect();
    setIsConnected(false);
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-zinc-950 p-8 text-zinc-100">
      <AudioUnlockOverlay />

      <header className="flex w-full max-w-3xl items-center justify-between">
        <h1 className="text-xl font-semibold">Revive — S1 hardware loop</h1>
        <span className="text-xs text-zinc-500">
          {keyboardActive ? 'Keyboard mode' : isConnected ? 'Serial connected' : 'Idle'}
          {calibrated ? ' · calibrated' : ' · default thresholds'}
        </span>
      </header>

      <section className="flex w-full max-w-3xl items-center justify-center gap-12">
        <DepthBar depth={depth} forceCeiling={forceCeiling} />
        <RateCounter rate={rate} depthOk={depth >= 0.75} />
      </section>

      <footer className="flex items-center gap-4">
        <ConnectButton
          isSupported={isSupported}
          isConnected={isConnected}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
        />
        <span className="text-xs text-zinc-500">
          Option+Shift+Space toggles keyboard fallback
        </span>
      </footer>
    </main>
  );
}
