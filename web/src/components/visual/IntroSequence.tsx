'use client';

import { useEffect, useRef, useState } from 'react';
import { ECGLine } from './ECGLine';

// Cinematic intro adapted from Claude Design Revive bundle
// (intro.jsx L46-101). REVIVE wordmark with staggered character
// reveal, ECG band, light sweep transition into the UI.
//
// Skips the heart/veins zoom per user direction in chat1.md.
export function IntroSequence({
  onComplete,
  accent,
}: {
  onComplete: () => void;
  accent: string;
}) {
  const [exiting, setExiting] = useState(false);
  const skipRef = useRef(false);

  useEffect(() => {
    if (skipRef.current) return;
    const exitT = setTimeout(() => setExiting(true), 3400);
    const doneT = setTimeout(() => onComplete(), 4100);
    return () => {
      clearTimeout(exitT);
      clearTimeout(doneT);
    };
  }, [onComplete]);

  const skip = () => {
    skipRef.current = true;
    setExiting(true);
    setTimeout(() => onComplete(), 500);
  };

  const word = 'REVIVE';
  return (
    <div className={`intro${exiting ? ' exiting' : ''}`}>
      <div className="intro-grid" />
      <div className="intro-corner tl">REVIVE / SYS-04</div>
      <div className="intro-corner tr">SCENARIO · CARDIAC</div>
      <div className="intro-corner bl">EMERGENCY MEDICAL TRAINING SYSTEM</div>
      <div className="intro-corner br">
        <span
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: accent,
            boxShadow: `0 0 8px ${accent}`,
          }}
        />
        TELEMETRY ONLINE
      </div>

      <div className="intro-center">
        <div className="intro-tag">EMERGENCY MEDICAL TRAINING SYSTEM</div>
        <h1 className="intro-rev">
          {word.split('').map((c, i) => (
            <span
              key={i}
              className={'char' + (i === 1 ? ' accent' : '')}
              style={{ animationDelay: `${0.15 + i * 0.08}s` }}
            >
              {c}
            </span>
          ))}
        </h1>
        <div className="intro-rule" />
        <div className="intro-tag">v2.4.1 · CARDIAC PROTOCOL · CLEARED FOR LIVE TRAINING</div>
      </div>

      <div className="intro-ecg-band">
        <ECGLine accent={accent} amp={0.9} speed={1.1} />
      </div>

      <div className="intro-sweep" />

      <button className="intro-skip" onClick={skip}>
        SKIP →
      </button>
    </div>
  );
}
