// VoiceIntegration (S3-T07). Realises pulsehero-design.md §10.11.
//
// Bridges SessionController events to the AudioQueue. Voice subscribes,
// never replaces — every existing setCoachPhrase / setScenario /
// transitionTo call is unchanged in C3. This module only adds parallel
// audio output by listening to the events C3 already emits.
//
// Lifecycle: instantiate with (controller, queue). Listeners attach in the
// constructor. Call destroy() to detach (used on page unmount or feature
// flag toggle off mid-session).

import type { Scenario, PatientState, CoachPhrase } from '@/types/contracts';
import type { SessionController } from '@/controllers/SessionController';
import type { AudioQueue } from './AudioQueue';
import { pickBystanderTier, pickBystanderClip, type BystanderTier } from './voiceSelectors';

export interface VoiceIntegrationDeps {
  controller: SessionController;
  audioQueue: AudioQueue;
}

export class VoiceIntegration {
  private cleanups: Array<() => void> = [];
  private bystanderCounter = 0;
  private currentBystanderTier: BystanderTier | null = null;
  private hasFiredScenarioIntro = false;
  private hasFiredCompressionEntry = false;

  constructor(private readonly deps: VoiceIntegrationDeps) {
    this.attach();
  }

  private attach(): void {
    const { controller, audioQueue } = this.deps;

    const onState = (e: Event) => {
      const { from, to } = (e as CustomEvent<{ from: string; to: string }>).detail;

      // First entry into compression — fire scared Bystander to mask the
      // scenario-gen latency window. Skipped on returns from decision phase
      // (no need to re-set the scene mid-session).
      if (to === 'compression' && from !== 'decision' && !this.hasFiredCompressionEntry) {
        this.hasFiredCompressionEntry = true;
        const tier: BystanderTier = 'scared';
        const clip = pickBystanderClip(tier, this.bystanderCounter++);
        audioQueue.enqueue({
          channel: 'bystander',
          source: 'cached',
          priority: 'high',
          clipName: `bystander/${clip}`,
          cooldownBucket: 'bystander_intro',
        });
        this.currentBystanderTier = tier;
      }

      // Reset / debrief / cold_start — flush all queued audio so a stale
      // phrase doesn't play after the session has reset.
      if (to === 'debrief' || to === 'reset' || to === 'cold_start') {
        audioQueue.cancelAll();
        this.hasFiredScenarioIntro = false;
        this.hasFiredCompressionEntry = false;
      }
    };
    controller.addEventListener('state', onState);
    this.cleanups.push(() => controller.removeEventListener('state', onState));

    // CoachAgent emitted a phrase. Stream via flash_v2 (Tier 2) — the
    // natural-language phrasing is what makes the demo feel alive. Tier 1
    // cached barks are a follow-up enhancement layered on classification
    // labels (separate event source); we wire the rich phrase channel here.
    const onPhrase = (e: Event) => {
      const phrase = (e as CustomEvent<CoachPhrase>).detail;
      if (!phrase.feedback) return;
      const priority =
        phrase.priority === 'critical' ? 'high' : phrase.priority === 'high' ? 'med' : 'low';
      audioQueue.enqueue({
        channel: 'coach',
        source: 'streaming',
        priority,
        text: phrase.feedback,
        cooldownBucket: 'coach_phrase',
      });
    };
    controller.addEventListener('phrase', onPhrase);
    this.cleanups.push(() => controller.removeEventListener('phrase', onPhrase));

    // Scenario load — Dispatcher reads the scene. Plays alongside the
    // Bystander mp3 (Bystander is high-priority and fires first; Dispatcher
    // queues at med and starts when Bystander finishes). Once-per-session
    // via hasFiredScenarioIntro.
    const onScenario = (e: Event) => {
      if (this.hasFiredScenarioIntro) return;
      this.hasFiredScenarioIntro = true;
      const scenario = (e as CustomEvent<Scenario>).detail;
      const text = this.scenarioToDispatcherText(scenario);
      if (!text) return;
      audioQueue.enqueue({
        channel: 'dispatcher',
        source: 'streaming',
        priority: 'med',
        text,
        cooldownBucket: 'scenario_intro',
      });
    };
    controller.addEventListener('scenario', onScenario);
    this.cleanups.push(() => controller.removeEventListener('scenario', onScenario));

    // Vitals updates → swap Bystander tier when emotional state crosses a
    // boundary. Doesn't fire on every vitals tick (would spam audio); only
    // when the *tier* changes.
    const onVitals = (e: Event) => {
      const state = (e as CustomEvent<PatientState>).detail;
      const tier = pickBystanderTier(state.o2, state.rhythm === 'rosc');
      if (tier !== this.currentBystanderTier && this.currentBystanderTier !== null) {
        // Tier crossing — fire one variant from the new tier
        const clip = pickBystanderClip(tier, this.bystanderCounter++);
        audioQueue.enqueue({
          channel: 'bystander',
          source: 'cached',
          priority: 'med',
          clipName: `bystander/${clip}`,
          cooldownBucket: `bystander_tier_${tier}`,
        });
        this.currentBystanderTier = tier;
      }
    };
    controller.addEventListener('vitals', onVitals);
    this.cleanups.push(() => controller.removeEventListener('vitals', onVitals));
  }

  private scenarioToDispatcherText(scenario: Scenario): string {
    const profile = scenario.patient_profile;
    const ageBracket =
      profile.age >= 65 ? 'elderly' : profile.age >= 40 ? 'middle-aged' : profile.age >= 18 ? 'adult' : 'young';
    const sex = profile.sex || 'patient';
    return `${ageBracket} ${sex}, ${scenario.scenario_type}, ${scenario.location}.`;
  }

  destroy(): void {
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
  }
}
