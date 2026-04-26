'use client';

import { useEffect, useState } from 'react';

// Animated rhythm wave for the compression screen. Adapts the Claude
// Design Revive screens.jsx RhythmWave (L155-192). Animates against a
// real BPM value passed in from page.tsx. Pure visual.
export function RhythmWave({ accent, bpm }: { accent: string; bpm: number }) {
  const [path, setPath] = useState('');
  useEffect(() => {
    let raf = 0;
    let t = 0;
    const safeBpm = Math.max(40, bpm || 60);
    const tick = () => {
      t += 1;
      const W = 1000;
      const H = 120;
      const pts: string[] = [];
      for (let x = 0; x <= W; x += 3) {
        const phase = ((x + t * 6) / 60) * (110 / safeBpm);
        const env = Math.sin(phase * 0.4) * 0.6 + 0.4;
        const wig = Math.sin(phase * 4) * 7 * env + Math.sin(phase * 9) * 3 * env;
        let y = H / 2 + wig;
        const beat = (x + t * 6) % (W / 4);
        if (beat < 6) y -= 28 * env;
        else if (beat < 12) y += 24 * env;
        pts.push(`${x},${y.toFixed(1)}`);
      }
      setPath('M' + pts.join(' L'));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [bpm]);

  return (
    <svg viewBox="0 0 1000 120" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id="rhFade" x1="0" x2="100%">
          <stop offset="0%" stopColor={accent} stopOpacity="0" />
          <stop offset="20%" stopColor={accent} stopOpacity="0.4" />
          <stop offset="100%" stopColor={accent} stopOpacity="1" />
        </linearGradient>
      </defs>
      <path
        d={path}
        fill="none"
        stroke="url(#rhFade)"
        strokeWidth="2"
        style={{ filter: `drop-shadow(0 0 6px ${accent})` }}
      />
    </svg>
  );
}
