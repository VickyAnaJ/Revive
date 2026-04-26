'use client';

import { useMemo } from 'react';

// Compression-quality-over-time graph for the results screen. Adapted
// from Claude Design Revive screens.jsx PerformanceGraph (L368-401).
// Smooth curve with gradient fill, target band, and time tick labels.
export function PerformanceGraph({
  accent,
  series,
}: {
  accent: string;
  series?: number[]; // optional real series in 0..1 — falls back to a smooth synthetic curve
}) {
  const W = 800;
  const H = 200;
  const pts = useMemo(() => {
    if (series && series.length > 1) {
      const arr: Array<[number, number]> = [];
      for (let i = 0; i < series.length; i++) {
        const x = (i / (series.length - 1)) * W;
        const y = H - 20 - Math.max(0, Math.min(1, series[i])) * (H - 40);
        arr.push([x, y]);
      }
      return arr;
    }
    const arr: Array<[number, number]> = [];
    for (let x = 0; x <= W; x += 8) {
      const t = x / W;
      const y = H * 0.55 - (Math.sin(t * 6) * 30 + Math.sin(t * 14) * 12 + (t - 0.4) * -40);
      arr.push([x, Math.max(20, Math.min(H - 20, y))]);
    }
    return arr;
  }, [series]);

  const path = 'M' + pts.map((p) => p.join(',')).join(' L');
  const area = `${path} L${W},${H} L0,${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id="perfFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.28" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="0" y={H * 0.25} width={W} height={H * 0.3} fill="rgba(10,138,82,0.06)" />
      <line x1="0" y1={H * 0.25} x2={W} y2={H * 0.25} stroke="rgba(10,138,82,0.4)" strokeDasharray="4 6" />
      <line x1="0" y1={H * 0.55} x2={W} y2={H * 0.55} stroke="rgba(10,138,82,0.4)" strokeDasharray="4 6" />
      <path d={area} fill="url(#perfFill)" />
      <path
        d={path}
        fill="none"
        stroke={accent}
        strokeWidth="2"
        style={{ filter: `drop-shadow(0 0 4px ${accent})` }}
      />
      <g fontFamily="'JetBrains Mono', monospace" fill="rgba(8,24,48,0.4)" fontSize="9">
        <text x="6" y={H - 8}>0:00</text>
        <text x={W / 2 - 12} y={H - 8}>2:30</text>
        <text x={W - 36} y={H - 8}>5:00</text>
      </g>
    </svg>
  );
}
