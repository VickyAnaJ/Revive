'use client';

import { useEffect, useState } from 'react';

// Top bar with REVIVE branding + session/operator/time + END button.
// Adapted from Claude Design Revive screens.jsx TopBar (L7-29).
export function TopBar({
  screen,
  onExit,
}: {
  screen: string;
  onExit?: () => void;
}) {
  const [time, setTime] = useState('');
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString([], { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="topbar">
      <div className="topbar-left">
        <div className="topbar-mark">
          <span className="dot" />
          REVIVE
        </div>
        <div className="topbar-meta topbar-meta--ter">{screen}</div>
      </div>
      <div className="topbar-right">
        <div className="topbar-meta topbar-meta--sec">
          SESSION <strong>0042</strong>
        </div>
        <div className="topbar-meta topbar-meta--sec">
          OPERATOR <strong>J.MORENO</strong>
        </div>
        <div className="topbar-meta">{time}</div>
        {onExit ? (
          <button type="button" className="topbar-end" onClick={onExit}>
            ⏻ END
          </button>
        ) : null}
      </div>
    </div>
  );
}

// Stepper at bottom showing progress through screens. Read-only —
// jumping is disabled (the real state machine drives navigation, not
// stepper clicks).
export function Stepper({ step }: { step: number }) {
  const labels = ['SCENARIO', 'DECISION', 'COMPRESSION', 'VITALS', 'RESULTS'];
  return (
    <div className="stepper">
      {labels.map((l, i) => {
        const cls =
          i === step ? 'stepper-item is-active' : i < step ? 'stepper-item is-done' : 'stepper-item';
        return (
          <div key={l} className={cls}>
            <span className="pip" />
            <span>
              0{i + 1} {l}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Ambient pulse background that pulses with the active rate.
export function Ambient({ beatMs }: { beatMs: number }) {
  return <div className="ambient" style={{ ['--beat' as string]: beatMs + 'ms' } as React.CSSProperties} />;
}

// Countdown ring used on the decision screen.
export function CountdownRing({
  seconds,
  total,
  accent,
}: {
  seconds: number;
  total: number;
  accent: string;
}) {
  const r = 36;
  const c = 2 * Math.PI * r;
  const p = seconds / total;
  return (
    <div className="ring-wrap timer-ring">
      <svg viewBox="0 0 88 88">
        <circle cx="44" cy="44" r={r} fill="none" stroke="rgba(8,24,48,.1)" strokeWidth="3" />
        <circle
          cx="44"
          cy="44"
          r={r}
          fill="none"
          stroke={accent}
          strokeWidth="3"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - p)}
          strokeLinecap="round"
          transform="rotate(-90 44 44)"
          style={{
            filter: `drop-shadow(0 0 6px ${accent})`,
            transition: 'stroke-dashoffset .95s linear',
          }}
        />
      </svg>
      <div className="num">{seconds}</div>
    </div>
  );
}
