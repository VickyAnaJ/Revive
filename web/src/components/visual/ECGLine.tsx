'use client';

import { useEffect, useState } from 'react';

// Animated ECG line. Pure visual — no real patient data, just the
// cinematic waveform from the Claude Design Revive bundle (intro.jsx
// L4-42). Drives the scenario backdrop and the intro band.
export function ECGLine({
  accent = 'var(--accent)',
  amp = 1,
  speed = 1,
}: {
  accent?: string;
  amp?: number;
  speed?: number;
}) {
  const [path, setPath] = useState('');
  useEffect(() => {
    let raf = 0;
    let t = 0;
    const tick = () => {
      t += speed;
      const W = 1400;
      const H = 160;
      const pts: string[] = [];
      for (let x = 0; x <= W; x += 4) {
        let y = H / 2;
        const cycle = (x + t * 4) % 280;
        if (cycle === 60) y -= 4 * amp;
        else if (cycle >= 64 && cycle < 70) y += 36 * amp;
        else if (cycle >= 70 && cycle < 78) y -= 56 * amp;
        else if (cycle >= 78 && cycle < 86) y += 14 * amp;
        else if (cycle >= 130 && cycle < 145) y -= 8 * amp;
        pts.push(`${x},${y.toFixed(1)}`);
      }
      setPath('M' + pts.join(' L'));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [amp, speed]);

  return (
    <svg viewBox="0 0 1400 160" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id="ecgFade" x1="0%" x2="100%">
          <stop offset="0%" stopColor={accent} stopOpacity="0" />
          <stop offset="20%" stopColor={accent} stopOpacity="0.5" />
          <stop offset="100%" stopColor={accent} stopOpacity="1" />
        </linearGradient>
      </defs>
      <path
        d={path}
        fill="none"
        stroke="url(#ecgFade)"
        strokeWidth="2"
        style={{ filter: `drop-shadow(0 0 6px ${accent})` }}
      />
    </svg>
  );
}
