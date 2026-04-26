// Shared voice-pipeline types (S3-T05). Realises pulsehero-design.md §10.7.
//
// AudioRequest is the contract between any voice-emitting site (CoachAgent
// result handler, SessionController state transitions, page.tsx Bystander
// trigger) and C8 AudioQueue. The queue routes by `source` field through
// the cascade chain, applies cooldown by `cooldownBucket`, and respects
// `priority` for barge-in semantics.

export type VoiceChannel = 'coach' | 'bystander' | 'dispatcher' | 'fallback';

// `cached` = pre-rendered mp3 via C7b. `streaming` = ElevenLabs flash_v2
// via C7a (live). `conversational` = ElevenLabs CAI via C5e (DispatcherAgent).
export type VoiceSource = 'cached' | 'streaming' | 'conversational';

// `low` = drop if active is med/high. `med` = queue. `high` = preempt active
// low/med via abort.
export type VoicePriority = 'low' | 'med' | 'high';

export interface AudioRequest {
  channel: VoiceChannel;
  source: VoiceSource;
  priority: VoicePriority;

  // For `cached` source.
  clipName?: string;

  // For `streaming` and `fallback` cascade tiers.
  text?: string;

  // De-duplication bucket. Identical buckets within `cooldownMs` window are
  // dropped silently. Different buckets play independently. Pass `undefined`
  // to skip cooldown entirely (e.g., scenario intro plays once per session).
  cooldownBucket?: string;
}
