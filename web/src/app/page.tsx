'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { SerialBridge } from '@/lib/SerialBridge';
import { KeyboardFallback } from '@/lib/keyboardFallback';
import { readCalibration } from '@/lib/Calibrator';
import { CompressionScorer } from '@/controllers/CompressionScorer';
import { SessionController, type SessionState } from '@/controllers/SessionController';
import { AgentBus } from '@/lib/AgentBus';
import { createGeminiCaller } from '@/lib/geminiClient';
import { loadFixtures } from '@/lib/OfflineCache';
import { audioContextManager } from '@/lib/AudioContextManager';
import { AudioQueue } from '@/lib/AudioQueue';
import { VoiceCached } from '@/lib/VoiceCached';
import { VoiceFallback } from '@/lib/VoiceFallback';
import { VoiceLive } from '@/lib/VoiceLive';
import { VoiceIntegration } from '@/lib/voiceIntegration';
import type { VoiceKey } from '@/lib/AudioQueue';
import { DepthBar } from '@/components/DepthBar';
import { RateCounter } from '@/components/RateCounter';
import { ConnectButton } from '@/components/ConnectButton';
import { AudioUnlockOverlay } from '@/components/AudioUnlockOverlay';
import { VitalsStrip } from '@/components/VitalsStrip';
import { ScenarioCard } from '@/components/ScenarioCard';
import { CoachText } from '@/components/CoachText';
import { DecisionCard } from '@/components/DecisionCard';
import { ResultsScreen } from '@/components/ResultsScreen';
import { CompressionFeedback } from '@/components/CompressionFeedback';
import { CompressionGoal } from '@/components/CompressionGoal';
import type {
  CompressionStats,
  DecisionRecord,
  SessionOutcome,
} from '@/controllers/SessionController';
import { FALLBACK_PATIENT_STATE, getAdequateDepthThreshold } from '@/agents/PatientAgent';
import type {
  CoachPhrase,
  CompressionBatch,
  PatientState,
  Scenario,
  SerialFrame,
} from '@/types/contracts';

const EMPTY_STATS: CompressionStats = {
  totalBatches: 0,
  adequateBatches: 0,
  tooShallowBatches: 0,
  tooFastBatches: 0,
  tooSlowBatches: 0,
  forceCeilingBatches: 0,
};

export default function Home() {
  const bridgeRef = useRef<SerialBridge | null>(null);
  const fallbackRef = useRef<KeyboardFallback | null>(null);
  const scorerRef = useRef<CompressionScorer | null>(null);
  const controllerRef = useRef<SessionController | null>(null);
  const ceilingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const decayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rateResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceIntegrationRef = useRef<VoiceIntegration | null>(null);

  const [mounted, setMounted] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [keyboardActive, setKeyboardActive] = useState(false);
  const [depth, setDepth] = useState(0);
  const [rate, setRate] = useState(0);
  const [forceCeiling, setForceCeiling] = useState(false);
  const [calibrated, setCalibrated] = useState(false);
  const [sessionState, setSessionState] = useState<SessionState>('cold_start');
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [vitals, setVitals] = useState<PatientState>(FALLBACK_PATIENT_STATE);
  const [prevVitals, setPrevVitals] = useState<PatientState | null>(null);
  const [phrase, setPhrase] = useState<CoachPhrase | null>(null);
  const [agentsReady, setAgentsReady] = useState(false);
  const [recordedDecisionIds, setRecordedDecisionIds] = useState<string[]>([]);
  const [decisionHistory, setDecisionHistory] = useState<DecisionRecord[]>([]);
  const [lastBatch, setLastBatch] = useState<CompressionBatch | null>(null);
  const [stats, setStats] = useState<CompressionStats>(EMPTY_STATS);
  const [outcome, setOutcome] = useState<SessionOutcome>('in_progress');
  const [durationMs, setDurationMs] = useState(0);
  const [isStarting, setIsStarting] = useState(false);
  const [maxSeen, setMaxSeen] = useState(0.3);
  const maxSeenRef = useRef(0.3);

  useEffect(() => {
    setMounted(true);
    setIsSupported(SerialBridge.isSupported());
    setCalibrated(readCalibration() !== null);

    const bridge = new SerialBridge();
    const fallback = new KeyboardFallback();
    const scorer = new CompressionScorer();
    bridgeRef.current = bridge;
    fallbackRef.current = fallback;
    scorerRef.current = scorer;

    const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY ?? '';
    if (apiKey) {
      const bus = new AgentBus();
      const callGemini = createGeminiCaller({ apiKey });
      const controller = new SessionController({ bus, callGemini });
      controllerRef.current = controller;

      controller.addEventListener('state', (e) => {
        const detail = (e as CustomEvent<{ to: SessionState }>).detail;
        setSessionState(detail.to);
        // Clear stale coach phrase whenever we enter or leave a live state.
        // Phrases are tied to a specific batch context; once the state shifts
        // (or the session ends) they no longer reflect what the player sees.
        setPhrase(null);
        if (detail.to === 'reset' || detail.to === 'cold_start') {
          setRecordedDecisionIds([]);
          // Re-arm the scorer for the next session.
          scorerRef.current?.start();
        }
        if (detail.to === 'compression') {
          // Open the scorer's emission gate. Without this, empty batches
          // never emit before the first pad press and the patient is stuck
          // at the post-decision penalty state — the do-nothing → flatline
          // path silently fails.
          scorerRef.current?.activate();
        }
        if (detail.to === 'debrief') {
          // Snapshot the outcome and duration at the moment of transition.
          // The controller sets `_outcome` and `_sessionEndedAt` synchronously
          // before transitioning so these reads are safe.
          if (controllerRef.current) {
            setOutcome(controllerRef.current.outcome);
            setDurationMs(controllerRef.current.durationMs);
          }
          // Freeze live compression UI: stop the 2-second batch timer and
          // clear the latest batch so the feedback line / depth bar don't
          // show stale "TOO SLOW" telemetry from an idle pad.
          scorerRef.current?.stop();
          setLastBatch(null);
        }
      });
      controller.addEventListener('stats', (e) => {
        setStats((e as CustomEvent<CompressionStats>).detail);
      });
      controller.addEventListener('scenario', (e) => {
        const next = (e as CustomEvent<Scenario>).detail;
        setScenario(next);
        setRecordedDecisionIds([]);
        // Body-type-aware target. The depth threshold for "adequate"
        // shifts per scenario so the simulator's visible scoring aligns
        // with the patient body the user is meant to be coaching.
        scorer.setBodyType(next.patient_profile.body_type);
      });
      controller.addEventListener('vitals', (e) => {
        const next = (e as CustomEvent<PatientState>).detail;
        setVitals((current) => {
          setPrevVitals(current);
          return next;
        });
      });
      controller.addEventListener('phrase', (e) => {
        setPhrase((e as CustomEvent<CoachPhrase>).detail);
      });

      void loadFixtures()
        .then(() => setAgentsReady(true))
        .catch((err) => {
          console.warn('[C9] OfflineCache load failed', err);
          setAgentsReady(false);
        });
    } else {
      console.info('[C9] NEXT_PUBLIC_GEMINI_API_KEY not set — agent path disabled');
    }

    const onPeak = (event: Event) => {
      const frame = (event as CustomEvent<SerialFrame>).detail;
      console.info(`[C9] peak depth=${frame.depth.toFixed(3)} rate=${frame.rate}`);
      if (frame.depth === 0) return;
      if (frame.depth > maxSeenRef.current) {
        maxSeenRef.current = frame.depth;
        setMaxSeen(frame.depth);
      }
      const scaled = Math.min(1, frame.depth / maxSeenRef.current);
      setDepth(scaled);
      if (decayTimeoutRef.current) clearTimeout(decayTimeoutRef.current);
      decayTimeoutRef.current = setTimeout(() => setDepth((d) => d * 0.4), 350);

      // Per-peak rate display for sub-2s latency. The 2s batch window is
      // authoritative but feels laggy on the demo floor. Show the per-peak
      // value immediately, bounded to the plausible CPR range so a single
      // double-tap (rate 200+) or Arduino's bogus first-peak rate=0 don't
      // pollute the display.
      if (frame.rate >= 60 && frame.rate <= 200) {
        setRate(frame.rate);

        // Synthesize a live CompressionBatch so CompressionFeedback /
        // DepthBar tone update in the same ~50ms as the rate counter.
        // Without this, the user sees rate=110 immediately but the text
        // says "TOO SLOW" for up to 2s until the next batch tick. The
        // real scorer batch overrides every 2s as authoritative.
        const target = scenario
          ? Math.max(0.05, scenario.patient_profile.body_type === 'adult_large' ? 0.22
            : scenario.patient_profile.body_type === 'elderly' ? 0.12
            : scenario.patient_profile.body_type === 'child' ? 0.09
            : 0.16)
          : 0.16;
        const stickyFloor = Math.max(0, target - 0.03);
        const liveClass: CompressionBatch['classification'] =
          frame.depth >= stickyFloor
            ? frame.rate < 95
              ? 'too_slow'
              : frame.rate > 120
                ? 'too_fast'
                : 'adequate'
            : 'too_shallow';
        setLastBatch({
          avg_depth: frame.depth,
          avg_rate: frame.rate,
          consistency: 1,
          classification: liveClass,
        });

        // Reset to idle if no peak in 1.5s — gives "stops the moment you
        // stop pressing" feel for both rate counter and feedback text.
        if (rateResetTimeoutRef.current) clearTimeout(rateResetTimeoutRef.current);
        rateResetTimeoutRef.current = setTimeout(() => {
          setRate(0);
          setLastBatch({
            avg_depth: 0,
            avg_rate: 0,
            consistency: 0,
            classification: 'too_slow',
          });
        }, 1500);
      }

      // Re-stamp with browser wall-clock time. Arduino's `frame.ts` is
      // `millis()` since boot (e.g., 9_876_830) but the scorer's emit timer
      // uses Date.now() (e.g., 1_745_000_000_000). Using Arduino time would
      // make every peak instantly older than `Date.now() - 2000` so trim()
      // would purge the entire buffer and emitBatch would always report
      // avg_depth=0 / avg_rate=0 / class=too_slow.
      scorer.addPeak({ depth: frame.depth, rate: frame.rate, ts: Date.now() });
    };

    const onBatch = (event: Event) => {
      const batch = (event as CustomEvent<CompressionBatch>).detail;
      console.info(`[C9] batch arrived class=${batch.classification} controller=${controllerRef.current ? 'present' : 'null'}`);
      setLastBatch(batch);
      // Drive the rate counter and depth bar from the authoritative 2-second
      // window. Per-peak rate is misleading — a single fast double-tap sets
      // it to 127 even when the sustained cadence is 0. Using batch.avg_rate
      // means the counter reads 0 the moment compressions stop, agreeing
      // with the scorer's TOO SLOW classification instead of contradicting it.
      setRate(batch.avg_rate);
      if (batch.avg_rate === 0 && batch.avg_depth === 0) {
        setDepth(0);
      }
      void controllerRef.current?.ingestCompressionBatch(batch);
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
    scorer.addEventListener('batch', onBatch);

    scorer.start();
    fallback.start();

    // Voice pipeline (S3). Behind a feature flag so demo can roll back to
    // silent S2.5 behaviour in one config flip. When the flag is off this
    // entire branch is dormant — no extra subscribers, no audio context, no
    // ElevenLabs API calls.
    const voiceEnabled = process.env.NEXT_PUBLIC_VOICE_ENABLED === 'true';
    const elevenApiKey = process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY ?? '';
    const instructorVoice = process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_ID_INSTRUCTOR ?? '';
    const dispatcherVoice = process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_ID_DISPATCHER ?? '';
    const bystanderVoice = process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_ID_BYSTANDER ?? '';
    if (voiceEnabled && controllerRef.current) {
      const cached = new VoiceCached();
      const fallbackVoice = new VoiceFallback();
      let live: VoiceLive | undefined;
      if (elevenApiKey && (instructorVoice || dispatcherVoice || bystanderVoice)) {
        const voiceIds: Record<VoiceKey, string> = {
          instructor: instructorVoice || dispatcherVoice,
          dispatcher: dispatcherVoice || instructorVoice,
          bystander: bystanderVoice || dispatcherVoice,
        };
        live = new VoiceLive({ apiKey: elevenApiKey, voiceIds });
      } else {
        console.warn('[C9] voice enabled but ElevenLabs key/voices missing — Tier 2 streaming disabled');
      }
      const queue = new AudioQueue({ cached, fallback: fallbackVoice, live });
      const integration = new VoiceIntegration({ controller: controllerRef.current, audioQueue: queue });
      voiceIntegrationRef.current = integration;
      console.info('[C9] voice pipeline enabled');
    }

    return () => {
      bridge.removeEventListener('peak', onPeak);
      bridge.removeEventListener('ceiling', onCeiling);
      bridge.removeEventListener('disconnect', onDisconnect);
      fallback.removeEventListener('peak', onPeak);
      fallback.removeEventListener('mode', onMode);
      scorer.removeEventListener('batch', onBatch);
      fallback.stop();
      scorer.stop();
      void bridge.disconnect();
      voiceIntegrationRef.current?.destroy();
      voiceIntegrationRef.current = null;
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

  const handleStartScenario = useCallback(async () => {
    if (!controllerRef.current) return;
    setIsStarting(true);
    try {
      await controllerRef.current.start();
    } catch (err) {
      console.warn('[C9] start scenario failed', err);
    } finally {
      setIsStarting(false);
    }
  }, []);

  const handleSelectDecision = useCallback((nodeId: string, choiceId: string) => {
    if (!controllerRef.current) return;
    if (recordedDecisionIds.includes(nodeId)) return;
    try {
      controllerRef.current.selectDecision(nodeId, choiceId);
      setRecordedDecisionIds((prev) => [...prev, nodeId]);
      setDecisionHistory([...controllerRef.current.decisionHistory]);
    } catch (err) {
      console.warn('[C9] selectDecision failed', err);
    }
  }, [recordedDecisionIds]);

  const handleEndSession = useCallback(() => {
    if (!controllerRef.current) return;
    try {
      controllerRef.current.endSession();
    } catch (err) {
      console.warn('[C9] endSession failed', err);
    }
  }, []);

  const handleResetSession = useCallback(() => {
    if (!controllerRef.current) return;
    controllerRef.current.reset();
    setScenario(null);
    setRecordedDecisionIds([]);
    setDecisionHistory([]);
    setVitals(FALLBACK_PATIENT_STATE);
    setPrevVitals(null);
    setPhrase(null);
    setLastBatch(null);
    setStats(EMPTY_STATS);
    setOutcome('in_progress');
    setDurationMs(0);
  }, []);

  const canStart =
    agentsReady &&
    !isStarting &&
    (sessionState === 'cold_start' || sessionState === 'reset');

  // Decision-phase O₂ decay. Real cardiac arrest doesn't pause for reading
  // speed; every 1.5s of indecision costs 1 point of saturation. After
  // ~90s of total indecision the patient flatlines and the session ends
  // automatically. Only runs while in decision state.
  useEffect(() => {
    if (sessionState !== 'decision') return;
    const id = setInterval(() => {
      controllerRef.current?.applyDecisionDecay();
    }, 1500);
    return () => clearInterval(id);
  }, [sessionState]);

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 bg-zinc-950 p-8 text-zinc-100">
      <AudioUnlockOverlay onUnlock={(ctx) => audioContextManager.bindContext(ctx)} />

      <header className="flex w-full max-w-3xl items-center justify-between">
        <h1 className="text-xl font-semibold">Revive</h1>
        <span className="text-xs text-zinc-500">
          {keyboardActive ? 'Keyboard mode' : isConnected ? 'Serial connected' : 'Idle'}
          {calibrated ? ' · calibrated' : ' · default thresholds'}
          {' · session: '}
          {sessionState}
        </span>
      </header>

      <section className="flex w-full max-w-3xl flex-col gap-4">
        <VitalsStrip
          vitals={vitals}
          prevVitals={prevVitals}
          active={sessionState !== 'cold_start' && sessionState !== 'reset'}
        />
        {sessionState === 'compression' || sessionState === 'complication' || sessionState === 'rosc' ? (
          <CompressionGoal vitals={vitals} stats={stats} />
        ) : null}
        {sessionState !== 'debrief' ? (
          <>
            <div className="flex items-center justify-center gap-12">
              <DepthBar
                depth={depth}
                forceCeiling={forceCeiling}
                classification={lastBatch?.classification ?? null}
                targetPct={Math.min(
                  95,
                  Math.max(
                    10,
                    (getAdequateDepthThreshold(scenario?.patient_profile.body_type ?? 'adult_average') /
                      Math.max(0.05, maxSeen)) *
                      100,
                  ),
                )}
                floorPct={Math.min(
                  92,
                  Math.max(
                    5,
                    ((getAdequateDepthThreshold(scenario?.patient_profile.body_type ?? 'adult_average') -
                      0.03) /
                      Math.max(0.05, maxSeen)) *
                      100,
                  ),
                )}
              />
              <RateCounter rate={rate} />
            </div>
            <CompressionFeedback
              batch={lastBatch}
              bodyType={scenario?.patient_profile.body_type}
            />
          </>
        ) : null}
      </section>

      <section className="flex w-full max-w-3xl flex-col gap-3">
        {sessionState === 'debrief' ? (
          <ResultsScreen
            scenario={scenario}
            decisions={decisionHistory}
            finalVitals={vitals}
            stats={stats}
            outcome={outcome}
            durationMs={durationMs}
            onReset={handleResetSession}
          />
        ) : (
          <>
            <ScenarioCard scenario={scenario} />
            <DecisionCard
              scenario={scenario}
              visible={sessionState === 'decision'}
              recordedNodeIds={recordedDecisionIds}
              onSelect={handleSelectDecision}
            />
            {sessionState === 'compression' ||
            sessionState === 'complication' ||
            sessionState === 'rosc' ? (
              // Suppress the agent coach text during any live-telemetry
              // state. CoachText is the S3 ElevenLabs voice script — once
              // S3 is wired, the agent talks instead of duplicating the
              // CompressionFeedback line. Until then, we keep it silent
              // during compression so the live UI is the single source
              // of truth. Coach speaks in scenario_intro and decision
              // states where there's no live feedback to compete with.
              null
            ) : (
              <CoachText phrase={phrase} />
            )}
          </>
        )}
      </section>

      <footer className="flex w-full max-w-3xl flex-wrap items-center justify-center gap-4">
        <ConnectButton
          isSupported={isSupported}
          isConnected={isConnected}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
        />
        {mounted ? (
          <button
            type="button"
            onClick={handleStartScenario}
            disabled={!canStart}
            data-testid="start-scenario-button"
            className={
              canStart
                ? 'rounded bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400'
                : 'cursor-not-allowed rounded border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm text-zinc-600'
            }
          >
            {isStarting ? (
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300"
                />
                Generating scenario…
              </span>
            ) : (
              'Start scenario'
            )}
          </button>
        ) : null}
        {mounted && (sessionState === 'compression' || sessionState === 'rosc' || sessionState === 'complication') ? (
          <button
            type="button"
            onClick={handleEndSession}
            data-testid="end-session-button"
            className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
          >
            End session
          </button>
        ) : null}
        <span className="text-xs text-zinc-500">
          Option+Shift+Space toggles keyboard fallback
        </span>
      </footer>
    </main>
  );
}
