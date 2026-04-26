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
import { ConnectButton } from '@/components/ConnectButton';
import { AudioUnlockOverlay } from '@/components/AudioUnlockOverlay';
import { TopBar, Stepper, Ambient, CountdownRing } from '@/components/visual/Chrome';
import { ECGLine } from '@/components/visual/ECGLine';
import { RhythmWave } from '@/components/visual/RhythmWave';
import { Silhouette } from '@/components/visual/Silhouette';
import { IntroSequence } from '@/components/visual/IntroSequence';
import { PerformanceGraph } from '@/components/visual/PerformanceGraph';
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
  const audioQueueRef = useRef<AudioQueue | null>(null);
  const welcomeFiredRef = useRef(false);

  const [phase, setPhase] = useState<'intro' | 'app'>('intro');
  const [audioUnlocked, setAudioUnlocked] = useState(false);
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
      // ElevenLabs voice IDs are 20 chars. Anything else (truncated, empty,
      // or paste error) will 404 voice_not_found. Validate length before
      // committing the ID so we fall back to a known-good voice rather
      // than burning every flash_v2 call on a malformed voice ID.
      const validVoice = (id: string | undefined): id is string => !!id && id.length === 20;
      const validInstructor = validVoice(instructorVoice) ? instructorVoice : undefined;
      const validDispatcher = validVoice(dispatcherVoice) ? dispatcherVoice : undefined;
      const validBystander = validVoice(bystanderVoice) ? bystanderVoice : undefined;
      // Rachel — ElevenLabs stock voice, always available on every account.
      // Calm female timbre that fits "calm soothing nurse" framing for the
      // welcome line. Used as the absolute fallback when the user hasn't
      // configured a valid instructor voice ID.
      const RACHEL = '21m00Tcm4TlvDq8ikWAM';
      if (elevenApiKey) {
        const voiceIds: Record<VoiceKey, string> = {
          instructor: validInstructor ?? RACHEL,
          dispatcher: validDispatcher ?? validInstructor ?? RACHEL,
          bystander: validBystander ?? validDispatcher ?? RACHEL,
        };
        live = new VoiceLive({ apiKey: elevenApiKey, voiceIds });
        console.warn(
          `[C9] VoiceLive enabled. instructor=${voiceIds.instructor.slice(0, 6)}… (${validInstructor ? 'configured' : 'Rachel fallback'}) ` +
            `dispatcher=${voiceIds.dispatcher.slice(0, 6)}… bystander=${voiceIds.bystander.slice(0, 6)}…`,
        );
      } else {
        console.warn('[C9] voice enabled but ElevenLabs key/valid 20-char voice IDs missing — Tier 2 streaming disabled');
      }
      const queue = new AudioQueue({ cached, fallback: fallbackVoice, live });
      audioQueueRef.current = queue;
      const integration = new VoiceIntegration({
        controller: controllerRef.current,
        audioQueue: queue,
        scorer: scorerRef.current ?? undefined,
      });
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
      // Scenario-customized Bystander reaction on decision commit.
      // Fires through the BYSTANDER voice via streaming flash_v2 so the
      // panic continues to feel specific to this run. Uses scenario state
      // so the line varies (sex/age/location) per session.
      if (audioQueueRef.current && scenario) {
        const { age, sex } = scenario.patient_profile;
        const pronoun = (sex || '').toLowerCase().startsWith('f') ? 'her' : 'him';
        const subject = (sex || '').toLowerCase().startsWith('f') ? 'she' : 'he';
        const location = scenario.location || 'right here';
        audioQueueRef.current.enqueue({
          channel: 'bystander',
          source: 'streaming',
          priority: 'high',
          text: `Please, do something — ${subject}'s still not breathing! ${age} years old, in the ${location}, save ${pronoun}!`,
          cooldownBucket: `bystander_decision_${nodeId}`,
        });
      }
    } catch (err) {
      console.warn('[C9] selectDecision failed', err);
    }
  }, [recordedDecisionIds, scenario]);

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

  // Track AudioContext unlock so we know when voice can play. Browser
  // autoplay policy blocks any audio before the first user gesture; we can't
  // queue the welcome line until after AudioUnlockOverlay has been clicked.
  useEffect(() => {
    setAudioUnlocked(audioContextManager.unlocked);
    const off = audioContextManager.subscribe(() => setAudioUnlocked(true));
    return off;
  }, []);

  // Welcome voice — uses the same INSTRUCTOR voice + default settings as
  // the coach corrections during compression, so the user hears one
  // consistent character throughout the session. No overrides → falls
  // through to the channel's configured voice ID (coach → instructor) and
  // the pinned flash_v2 / stability 0.5 / similarity 0.8 defaults.
  useEffect(() => {
    if (welcomeFiredRef.current) return;
    if (!audioUnlocked) return;
    if (!audioQueueRef.current) return;
    welcomeFiredRef.current = true;
    audioQueueRef.current.enqueue({
      channel: 'coach',
      source: 'streaming',
      priority: 'high',
      text: 'Welcome to Revive. Take a slow, deep breath. When you are ready, begin compressions.',
      cooldownBucket: 'welcome',
    });
  }, [audioUnlocked]);

  // Phase routing for the design's stepper + screen selection.
  const stepNum =
    sessionState === 'debrief' ? 4
    : sessionState === 'decision' ? 1
    : (sessionState === 'compression' || sessionState === 'complication' || sessionState === 'rosc') ? 2
    : 0;
  const screenLabel = ['SCENARIO 04 / INTRO', 'DECISION POINT 01', 'COMPRESSION CYCLE', 'TELEMETRY', 'SESSION DEBRIEF'][stepNum];

  // Patient HR drives the ambient pulse + silhouette ring. Fallback to 72
  // before any vitals arrive so the UI doesn't freeze.
  const beatMs = 60000 / Math.max(50, vitals.hr || 72);
  const accent = '#0a84ff';

  // Body-type-aware target / floor for the depth bar (preserved from prior
  // implementation — same math, different rendering).
  const adequateThreshold = getAdequateDepthThreshold(scenario?.patient_profile.body_type ?? 'adult_average');
  const targetPct = Math.min(95, Math.max(10, (adequateThreshold / Math.max(0.05, maxSeen)) * 100));
  const floorPct = Math.min(92, Math.max(5, ((adequateThreshold - 0.03) / Math.max(0.05, maxSeen)) * 100));

  // Live coaching feedback string from the latest scorer batch.
  const feedback = lastBatch
    ? lastBatch.classification === 'too_shallow' ? { text: 'PUSH HARDER', tone: 'warn' as const }
    : lastBatch.classification === 'too_fast'    ? { text: 'SLOW SLIGHTLY', tone: 'warn' as const }
    : lastBatch.classification === 'too_slow'    ? { text: 'INCREASE RATE', tone: 'warn' as const }
    : lastBatch.classification === 'force_ceiling' ? { text: 'EASE OFF · TOO DEEP', tone: 'warn' as const }
    : { text: 'GOOD RHYTHM', tone: 'good' as const }
    : { text: 'BEGIN COMPRESSIONS', tone: 'good' as const };
  const fbColor = feedback.tone === 'good' ? 'var(--good)' : 'var(--warn)';

  // Decision node derivation — find the next un-answered node in the tree.
  const currentDecisionNode = scenario?.decision_tree.find((n) => !recordedDecisionIds.includes(n.id)) ?? null;

  // Decision icons (cycled by option index).
  const decIcons = ['P', '☏', '♥', '⚡'];

  // Local 15s countdown for the decision phase. Resets when the node
  // changes. Cosmetic only — the real penalty path is driven by
  // SessionController.applyDecisionDecay regardless of this value.
  const [decisionTimeLeft, setDecisionTimeLeft] = useState(15);
  useEffect(() => {
    if (sessionState !== 'decision') {
      setDecisionTimeLeft(15);
      return;
    }
    if (decisionTimeLeft <= 0) return;
    const id = setTimeout(() => setDecisionTimeLeft((v) => v - 1), 1000);
    return () => clearTimeout(id);
  }, [sessionState, decisionTimeLeft, currentDecisionNode?.id]);

  // Compression count from stats.
  const compressionCount = stats.totalBatches * 12; // approximate display number

  // BPM display value (real or zero).
  const displayBpm = Math.max(0, Math.min(220, Math.round(rate || vitals.hr || 0)));
  const targetBpm = displayBpm >= 100 && displayBpm <= 120;

  // Intro is the unlock surface — first click anywhere on it creates and
  // resumes the AudioContext, which kicks off the welcome voice via the
  // unlock effect above. Browsers block audio until a user gesture, so
  // this is the earliest moment voice can fire on app open.
  const handleIntroUnlock = useCallback(() => {
    if (audioContextManager.unlocked) return;
    try {
      const Ctor =
        typeof window !== 'undefined'
          ? (window.AudioContext ??
              (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
          : undefined;
      if (Ctor) {
        const ctx = new Ctor();
        void ctx.resume();
        audioContextManager.bindContext(ctx);
      }
    } catch (err) {
      console.warn('[C9] intro unlock failed', err);
    }
  }, []);

  return (
    <div className="stage">
      {/* Render the unlock overlay only once we're past intro — during the
          intro the cinematic itself doubles as the unlock surface. */}
      {phase === 'app' ? (
        <AudioUnlockOverlay onUnlock={(ctx) => audioContextManager.bindContext(ctx)} />
      ) : null}

      {/* Cinematic intro — REVIVE wordmark reveal + ECG band + light sweep
          transition. Plays IMMEDIATELY on app open (no black overlay first).
          First click anywhere unlocks audio + fires Calm Instructor welcome
          voice. Auto-completes after ~4s; user can SKIP. Only renders during
          cold_start/reset to avoid redrawing mid-session. */}
      {phase === 'intro' && (sessionState === 'cold_start' || sessionState === 'reset') ? (
        <IntroSequence
          accent={accent}
          onComplete={() => setPhase('app')}
          onUnlock={handleIntroUnlock}
          needsUnlock={!audioUnlocked}
        />
      ) : null}

      {sessionState !== 'cold_start' && sessionState !== 'reset' ? <Ambient beatMs={beatMs} /> : null}

      <TopBar
        screen={screenLabel}
        onExit={
          sessionState === 'compression' || sessionState === 'rosc' || sessionState === 'complication'
            ? handleEndSession
            : undefined
        }
      />

      {/* SCENARIO SCREEN — cold_start / reset / scenario_intro */}
      {(sessionState === 'cold_start' || sessionState === 'reset' || sessionState === 'scenario_intro') ? (
        <div className="scn">
          <div className="scn-hero">
            <div className="scn-eyebrow-row">
              <span className="chip chip-priority">PRIORITY 1</span>
              <span className="eyebrow">SCENARIO · LIVE TRAINING</span>
              <span className="eyebrow">{calibrated ? 'CALIBRATED' : 'DEFAULT THRESHOLDS'}</span>
            </div>
            <h1 className="scn-title">Cardiac Arrest</h1>
            <div className="scn-sub">
              {scenario ? `${scenario.location} · ${scenario.patient_profile.sex}, ${scenario.patient_profile.age}` : 'Ready to begin'}
            </div>
            <p className="scn-desc">
              Press the foam pad to deliver compressions. The AI coach will give real-time corrections,
              the patient simulator updates vitals every 2 seconds, and a 911 dispatcher reads the
              scenario aloud through ElevenLabs.
            </p>
            {scenario ? (
              <div className="scn-chips">
                <span className="chip"><span className="chip-k">AGE</span><span className="chip-v">{scenario.patient_profile.age}</span></span>
                <span className="chip"><span className="chip-k">SEX</span><span className="chip-v">{String(scenario.patient_profile.sex).toUpperCase()}</span></span>
                <span className="chip"><span className="chip-k">BUILD</span><span className="chip-v">{String(scenario.patient_profile.body_type).toUpperCase().replace(/_/g, ' ')}</span></span>
                <span className="chip"><span className="chip-k">SCENARIO</span><span className="chip-v">{String(scenario.scenario_type).toUpperCase()}</span></span>
              </div>
            ) : (
              <div className="scn-chips">
                <span className="chip"><span className="chip-k">INPUT</span><span className="chip-v">{keyboardActive ? 'KEYBOARD' : isConnected ? 'PAD' : 'NONE'}</span></span>
                <span className="chip"><span className="chip-k">VOICE</span><span className="chip-v">{process.env.NEXT_PUBLIC_VOICE_ENABLED === 'true' ? 'ON' : 'OFF'}</span></span>
                <span className="chip"><span className="chip-k">AGENTS</span><span className="chip-v">{agentsReady ? 'READY' : 'LOADING'}</span></span>
              </div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12, marginTop: 8 }}>
              <ConnectButton
                isSupported={isSupported}
                isConnected={isConnected}
                onConnect={handleConnect}
                onDisconnect={handleDisconnect}
              />
              {mounted ? (
                <button
                  type="button"
                  className="btn btn-primary btn-hero"
                  onClick={handleStartScenario}
                  disabled={!canStart}
                  data-testid="start-scenario-button"
                >
                  {isStarting ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                      <span
                        aria-hidden="true"
                        style={{
                          display: 'inline-block',
                          width: 14, height: 14, borderRadius: '50%',
                          border: '2px solid rgba(255,255,255,.4)', borderTopColor: 'white',
                          animation: 'spin 0.7s linear infinite',
                        }}
                      />
                      GENERATING SCENARIO…
                    </span>
                  ) : (
                    <>BEGIN CPR PROTOCOL <span className="kbd">START</span></>
                  )}
                </button>
              ) : null}
            </div>
            <div className="scn-foot">ALL ACTIONS WILL BE EVALUATED IN REAL TIME · OPTION+SHIFT+SPACE TOGGLES KEYBOARD</div>
          </div>
          <div className="scn-ecg"><ECGLine accent={accent} amp={0.6} speed={1} /></div>
        </div>
      ) : null}

      {/* COMPRESSION SCREEN */}
      {(sessionState === 'compression' || sessionState === 'complication' || sessionState === 'rosc') ? (
        <div className="cmp">
          {/* Left: depth bar */}
          <div className="cmp-col cmp-col-left">
            <div className="eyebrow" style={{ marginBottom: 14 }}>COMPRESSION DEPTH</div>
            <div className="cmp-bar-wrap">
              <div className="cmp-bar-scale">
                <span>3.0&quot;</span><span className="ok">2.4&quot;</span><span className="ok">2.0&quot;</span>
                <span>1.5&quot;</span><span>0.5&quot;</span><span>0&quot;</span>
              </div>
              <div className="cmp-bar">
                <div
                  className="cmp-bar-target"
                  style={{ top: `${Math.max(0, 100 - targetPct - 10)}%`, height: `${Math.min(40, targetPct - floorPct + 10)}%` }}
                />
                <div
                  className="cmp-bar-fill"
                  style={{
                    height: `${Math.min(100, depth * 100)}%`,
                    background: forceCeiling ? 'var(--crit)' : depth * 100 >= floorPct && depth * 100 <= targetPct + 5 ? 'var(--good)' : accent,
                    boxShadow: `0 0 16px ${forceCeiling ? 'var(--crit)' : 'var(--accent)'}`,
                  }}
                />
                <div className="cmp-marker" style={{ top: `${100 - Math.min(100, depth * 100)}%` }}>
                  {(depth * 3).toFixed(1)}&quot;
                </div>
              </div>
            </div>
            <div
              className="cmp-bar-status"
              style={{ color: depth * 100 >= floorPct && depth * 100 <= targetPct + 5 ? 'var(--good)' : 'var(--ink-3)' }}
            >
              {depth * 100 >= floorPct && depth * 100 <= targetPct + 5 ? '● IN TARGET' : '○ ADJUSTING'}
            </div>
          </div>

          {/* Center: BPM, wave, feedback */}
          <div className="cmp-col cmp-col-center cmp-center">
            <div className="eyebrow" style={{ marginBottom: 6 }}>COMPRESSION RATE</div>
            <div>
              <span
                className="cmp-bpm-num"
                style={{ color: targetBpm ? 'var(--good)' : 'var(--warn)' }}
                data-testid="rate-counter"
              >
                {displayBpm > 0 ? displayBpm : '—'}
              </span>
              <span className="cmp-bpm-unit">BPM</span>
            </div>
            <div className="eyebrow" style={{ marginTop: 4 }}>TARGET · 100–120 BPM</div>
            <div style={{ width: '100%', maxWidth: 560, height: 96, marginTop: 18, marginBottom: 8 }}>
              <RhythmWave accent={accent} bpm={displayBpm > 0 ? displayBpm : 110} />
            </div>
            <div
              className="cmp-feedback"
              style={{
                borderColor: fbColor,
                color: fbColor,
                background: `color-mix(in srgb, ${fbColor} 8%, transparent)`,
              }}
            >
              <div className="cmp-feedback-eyebrow">FEEDBACK · LIVE</div>
              <div className="cmp-feedback-text">{feedback.text}</div>
            </div>

            {/* Mini vitals row below feedback */}
            <div className="panel vit-strip" style={{ marginTop: 16, width: '100%', maxWidth: 720 }}>
              <div className="panel-head">
                <div className="eyebrow">PATIENT VITALS</div>
                <div className="eyebrow eyebrow--accent">● LIVE</div>
              </div>
              <div className="vit-grid">
                <div className="vit-cell">
                  <div className="k">HR</div>
                  <div className={`v ${vitals.hr === 0 ? 'tone-crit' : vitals.hr > 110 ? 'tone-warn' : 'tone-good'}`}>{vitals.hr || '—'}</div>
                  <div className="u">bpm</div>
                </div>
                <div className="vit-cell">
                  <div className="k">BP</div>
                  <div className="v compact">{vitals.bp || '—'}</div>
                  <div className="u">mmHg</div>
                </div>
                <div className="vit-cell">
                  <div className="k">SpO₂</div>
                  <div className={`v ${vitals.o2 < 80 ? 'tone-crit' : vitals.o2 < 92 ? 'tone-warn' : 'tone-good'}`}>{vitals.o2 || '—'}</div>
                  <div className="u">%</div>
                </div>
                <div className="vit-cell">
                  <div className="k">RHYTHM</div>
                  <div
                    className={`v compact ${vitals.rhythm === 'rosc' || vitals.rhythm === 'sinus' ? 'tone-good' : vitals.rhythm === 'flatline' ? 'tone-crit' : 'tone-warn'}`}
                  >
                    {String(vitals.rhythm).toUpperCase().replace('_', '-')}
                  </div>
                  <div className="u">{vitals.rhythm === 'v_fib' || vitals.rhythm === 'v_tach' ? 'shockable' : ''}</div>
                </div>
                <div className="vit-cell">
                  <div className="k">ADEQUATE</div>
                  <div className="v compact tone-good">{stats.adequateBatches}</div>
                  <div className="u">/ {stats.totalBatches} batches</div>
                </div>
                <div className="vit-cell">
                  <div className="k">INPUT</div>
                  <div className="v compact">{keyboardActive ? 'KEY' : isConnected ? 'PAD' : '—'}</div>
                  <div className="u">{calibrated ? 'cal' : 'def'}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Right: counters */}
          <div className="cmp-col cmp-col-right">
            <div className="cmp-counter">
              <div className="eyebrow">COMPRESSIONS</div>
              <div className="cmp-counter-num" data-testid="compression-counter">
                {String(compressionCount).padStart(3, '0')}
              </div>
              <div className="cmp-counter-tag">CYCLE 30:2</div>
            </div>
            <div className="cmp-counter" style={{ marginTop: 28 }}>
              <div className="eyebrow">CYCLE TIME</div>
              <div className="cmp-cycle-num">
                {Math.floor(durationMs / 60000).toString().padStart(2, '0')}:
                {Math.floor((durationMs / 1000) % 60).toString().padStart(2, '0')}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-mono"
              style={{ marginTop: 28 }}
              onClick={handleEndSession}
              data-testid="end-session-button"
            >
              END SESSION →
            </button>
          </div>

          {/* Far right: silhouette */}
          <div className="cmp-col cmp-col-silo">
            <Silhouette accent={accent} beatMs={beatMs} depth={depth} />
          </div>
        </div>
      ) : null}

      {/* DECISION SCREEN */}
      {sessionState === 'decision' && currentDecisionNode ? (
        <div className="dec">
          <div className="dec-q">
            <div className="eyebrow eyebrow--accent" style={{ marginBottom: 10 }}>
              DECISION POINT 0{recordedDecisionIds.length + 1} · {decisionTimeLeft}s WINDOW
            </div>
            <h1>{currentDecisionNode.prompt}</h1>
            <h2>Pick your next action.</h2>
          </div>
          <CountdownRing seconds={Math.max(0, decisionTimeLeft)} total={15} accent={accent} />
          <div className="dec-grid">
            {currentDecisionNode.options.map((opt, i) => (
              <button
                key={opt.id}
                type="button"
                className="dec-card"
                disabled={recordedDecisionIds.includes(currentDecisionNode.id)}
                onClick={() => handleSelectDecision(currentDecisionNode.id, opt.id)}
                data-testid={`decision-option-${opt.id}`}
              >
                <div className="dec-icon">{decIcons[i % decIcons.length]}</div>
                <div className="dec-body">
                  <div className="dec-key">OPTION 0{i + 1}</div>
                  <div className="dec-label">{opt.label}</div>
                  <div className="dec-sub">CHOOSE TO COMMIT</div>
                  <div className="dec-detail">Tap to select. Voice input is also accepted.</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* RESULTS SCREEN — Claude Design layout (large headline + score on
          left, performance graph + 6 stat cards on right, action buttons
          bottom-right). Real session data drives every value. */}
      {sessionState === 'debrief' ? (() => {
        const survived = outcome === 'survived';
        const totalDecisions = decisionHistory.length;
        const correctDecisions = decisionHistory.filter((d) => d.correct).length;
        const decisionAccuracyPct = totalDecisions === 0 ? 0 : Math.round((correctDecisions / totalDecisions) * 100);
        const avgDecisionMs = totalDecisions === 0
          ? 0
          : Math.round(decisionHistory.reduce((s, d) => s + d.timeToDecideMs, 0) / totalDecisions);
        const compAdequatePct = stats.totalBatches === 0
          ? 0
          : Math.round((stats.adequateBatches / stats.totalBatches) * 100);
        const ratePct = stats.totalBatches === 0
          ? 0
          : Math.round(((stats.totalBatches - stats.tooFastBatches - stats.tooSlowBatches) / stats.totalBatches) * 100);
        const recoilPct = stats.totalBatches === 0
          ? 0
          : Math.max(0, Math.round(100 - (stats.forceCeilingBatches / stats.totalBatches) * 100));
        const interruptionsSec = (stats.tooSlowBatches + (stats.totalBatches === 0 ? 0 : 0)) * 2;
        const aedDecision = decisionHistory.find((d) => d.choiceId.toLowerCase().includes('aed'));
        const aedLabel = aedDecision ? (aedDecision.correct ? 'CORRECT' : 'INCORRECT') : 'N/A';
        const aedTone: 'good' | 'warn' | 'crit' = !aedDecision ? 'warn' : aedDecision.correct ? 'good' : 'crit';
        const score = Math.round((compAdequatePct * 0.5 + ratePct * 0.3 + decisionAccuracyPct * 0.2));
        const tier = score >= 90 ? 'TIER S' : score >= 80 ? 'TIER A' : score >= 70 ? 'TIER B' : score >= 60 ? 'TIER C' : 'TIER D';
        const tierLabel = score >= 80 ? 'EXCEEDS STANDARD' : score >= 60 ? 'MEETS STANDARD' : 'BELOW STANDARD';
        const fmtTime = (ms: number) => {
          const total = Math.floor(ms / 1000);
          return `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
        };
        const blurb = survived
          ? 'Strong protocol adherence with consistent depth and minimal pause time. Continue practicing recoil quality between compressions.'
          : 'Patient could not be revived. Review compression depth, rate consistency, and decision timing — small improvements compound into ROSC.';

        const cards: Array<{ k: string; v: string | number; u?: string; tone: 'good' | 'warn' | 'crit'; pct: number }> = [
          { k: 'COMPRESSION DEPTH', v: compAdequatePct, u: '%', tone: compAdequatePct >= 80 ? 'good' : compAdequatePct >= 60 ? 'warn' : 'crit', pct: compAdequatePct },
          { k: 'RATE ACCURACY', v: ratePct, u: '%', tone: ratePct >= 80 ? 'good' : ratePct >= 60 ? 'warn' : 'crit', pct: ratePct },
          { k: 'RECOIL', v: recoilPct, u: '%', tone: recoilPct >= 80 ? 'good' : recoilPct >= 60 ? 'warn' : 'crit', pct: recoilPct },
          { k: 'INTERRUPTIONS', v: interruptionsSec, u: 'sec', tone: interruptionsSec <= 8 ? 'good' : interruptionsSec <= 16 ? 'warn' : 'crit', pct: Math.min(100, interruptionsSec * 5) },
          { k: 'DECISION TIME', v: (avgDecisionMs / 1000).toFixed(1), u: 'sec', tone: avgDecisionMs <= 5000 ? 'good' : avgDecisionMs <= 10000 ? 'warn' : 'crit', pct: Math.min(100, avgDecisionMs / 100) },
          { k: 'AED USE', v: aedLabel, tone: aedTone, pct: aedLabel === 'CORRECT' ? 100 : aedLabel === 'INCORRECT' ? 30 : 0 },
        ];

        return (
          <div className="res">
            <div className="res-grid">
              <div className="res-left">
                <div className="eyebrow">SESSION DEBRIEF · 04</div>
                <div className={`res-status${survived ? '' : ' is-lost'}`}>
                  {survived ? `ROSC ACHIEVED · ${fmtTime(durationMs)}` : `PATIENT LOST · ${fmtTime(durationMs)}`}
                </div>
                <h1 className="res-headline">
                  {survived ? <>Pulse <em>recovered.</em></> : <>Patient <em>lost.</em></>}
                </h1>
                <p className="res-blurb">{blurb}</p>
                <div className="res-score">
                  <div className="num" data-testid="results-score">{score}</div>
                  <div className="lbl">
                    <div className="a">PERFORMANCE INDEX</div>
                    <div className="b" style={{ color: score >= 80 ? 'var(--good)' : score >= 60 ? 'var(--warn)' : 'var(--crit)' }}>
                      {tierLabel} · {tier}
                    </div>
                  </div>
                </div>
              </div>
              <div className="res-right">
                <div className="panel res-graph-card">
                  <div className="panel-head">
                    <div className="eyebrow">COMPRESSION QUALITY · OVER TIME</div>
                    <div style={{ display: 'flex', gap: 14 }}>
                      <span className="eyebrow">
                        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--good)', marginRight: 6 }} />
                        TARGET
                      </span>
                      <span className="eyebrow">
                        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: accent, marginRight: 6 }} />
                        YOU
                      </span>
                    </div>
                  </div>
                  <div className="res-graph"><PerformanceGraph accent={accent} /></div>
                </div>
                <div className="res-cards">
                  {cards.map((c) => (
                    <div className="panel res-card" key={c.k}>
                      <div className="k">{c.k}</div>
                      <div className={`v tone-${c.tone}`}>
                        {c.v}
                        {c.u ? <span style={{ fontSize: 11, color: 'var(--ink-3)', marginLeft: 6 }}>{c.u}</span> : null}
                      </div>
                      <div className="meter">
                        <i style={{ width: c.pct + '%', background: `var(--${c.tone})` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="res-actions">
              <button type="button" className="btn btn-mono" onClick={handleResetSession} data-testid="end-session-button">
                END SESSION
              </button>
              <button type="button" className="btn btn-primary btn-mono" onClick={handleResetSession} data-testid="retry-scenario-button">
                ↻ RETRY SCENARIO
              </button>
            </div>
          </div>
        );
      })() : null}

      <Stepper step={stepNum} />

      {/* Keep CSS keyframes for the inline spinner */}
      <style jsx global>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
