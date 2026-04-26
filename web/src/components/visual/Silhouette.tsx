'use client';

import { useEffect, useRef } from 'react';

// Anatomical silhouette adapted from Claude Design Revive bundle
// (silhouette.jsx L1-153). Pulses with the compression rhythm —
// chest sinks on each beat, target ring expands, glowing pulse fires
// synced to BPM via the --beat CSS variable.
export function Silhouette({
  accent,
  beatMs = 545,
  depth = 0,
}: {
  accent: string;
  beatMs?: number;
  depth?: number;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (stageRef.current) {
      stageRef.current.style.setProperty('--beat', `${beatMs}ms`);
    }
  }, [beatMs]);

  const sink = depth * 6;
  const glow = 0.25 + depth * 0.65;

  return (
    <div className="silo-stage" ref={stageRef}>
      <svg viewBox="0 0 320 540" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="siloBody" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(8,24,48,0.10)" />
            <stop offset="100%" stopColor="rgba(8,24,48,0.04)" />
          </linearGradient>
          <linearGradient id="siloStroke" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(8,24,48,0.55)" />
            <stop offset="100%" stopColor="rgba(8,24,48,0.25)" />
          </linearGradient>
          <radialGradient id="chestGlow" cx="50%" cy="44%" r="22%">
            <stop offset="0%" stopColor={accent} stopOpacity={glow} />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </radialGradient>
        </defs>

        <ellipse cx="160" cy="520" rx="92" ry="8" fill="rgba(8,24,48,0.08)" />

        <g fill="url(#siloBody)" stroke="url(#siloStroke)" strokeWidth="1.4" strokeLinejoin="round">
          {/* Head */}
          <path d="M160,30 C 134,30 118,50 118,76 C 118,96 124,112 134,124 L 134,138 C 134,148 142,154 160,154 C 178,154 186,148 186,138 L 186,124 C 196,112 202,96 202,76 C 202,50 186,30 160,30 Z" />
          <path d="M138,140 Q160,150 182,140" fill="none" stroke="rgba(8,24,48,0.28)" strokeWidth="1" />
          {/* Torso */}
          <path d="M118,168 Q 100,166 86,178 Q 70,196 60,224 L 56,260 L 64,300 L 76,332 L 82,360 L 86,400 L 92,460 L 100,500 L 130,508 L 130,470 L 144,440 Q 160,432 176,440 L 190,470 L 190,508 L 220,500 L 228,460 L 234,400 L 238,360 L 244,332 L 256,300 L 264,260 L 260,224 Q 250,196 234,178 Q 220,166 202,168 Q 192,176 178,178 L 142,178 Q 128,176 118,168 Z" />
        </g>

        <g fill="none" stroke="rgba(8,24,48,0.32)" strokeWidth="0.9" strokeLinecap="round">
          <path d="M104,178 Q132,188 158,184 Q184,188 216,178" />
          <line x1="160" y1="186" x2="160" y2="252" />
          <path d="M108,200 Q132,232 158,236" />
          <path d="M212,200 Q188,232 162,236" />
          <path d="M138,250 Q160,246 182,250" opacity="0.5" />
          <path d="M134,272 Q160,266 186,272" opacity="0.5" />
          <path d="M132,294 Q160,288 188,294" opacity="0.5" />
          <line x1="160" y1="254" x2="160" y2="356" strokeDasharray="2 4" opacity="0.7" />
          <path d="M138,284 L182,284" opacity="0.45" />
          <path d="M136,308 L184,308" opacity="0.45" />
          <path d="M134,332 L186,332" opacity="0.45" />
          <path d="M104,388 Q160,400 216,388" opacity="0.55" />
          <path d="M124,420 Q160,432 196,420" opacity="0.55" />
          <path d="M84,260 Q92,300 100,340" opacity="0.4" />
          <path d="M236,260 Q228,300 220,340" opacity="0.4" />
        </g>

        <g style={{ transform: `translate(0, ${sink}px)`, transition: 'transform 60ms linear' }}>
          <rect x="0" y="0" width="320" height="540" fill="url(#chestGlow)" />
          <circle
            cx="160"
            cy="252"
            r={32 + depth * 8}
            fill="none"
            stroke={accent}
            strokeWidth="1.5"
            opacity={0.5 + depth * 0.5}
            style={{ filter: `drop-shadow(0 0 ${4 + depth * 8}px ${accent})` }}
          />
          <circle cx="160" cy="252" r={14 + depth * 4} fill={accent} opacity={0.18 + depth * 0.55} />
          <line x1="160" y1="232" x2="160" y2="272" stroke={accent} strokeWidth="1" opacity="0.55" />
          <line x1="140" y1="252" x2="180" y2="252" stroke={accent} strokeWidth="1" opacity="0.55" />
        </g>

        <g fill="none" stroke={accent} strokeWidth="1" opacity="0.4" strokeDasharray="2 3">
          <rect x="138" y="234" width="44" height="36" rx="3" />
        </g>

        <circle cx="160" cy="252" r="2" fill="rgba(8,24,48,0.7)" stroke="none" />
      </svg>

      <div className="silo-pulse" style={{ borderColor: accent, top: 'calc(50% - 70px)' }} />
      <div className="silo-label">PATIENT · ANTERIOR VIEW</div>
    </div>
  );
}
