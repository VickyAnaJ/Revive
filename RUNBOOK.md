# Runbook

Failure modes from `../docs/pulsehero-design.md §6g` and the operator response for each. If something breaks during a judge demo, find it here, do the action, keep going.

## Hardware

### FSR stops reading or returns a stuck value
- **Symptom.** Depth bar frozen. Vitals stop responding to pressing.
- **Action.** Tell the judge "back to keyboard mode for this run." Press space repeatedly to drive compressions (FR8). Continue the demo.
- **Recover later.** Re-seat the FSR under the foam. Recalibrate via the Calibrator (C10).

### Arduino USB cable disconnects
- **Symptom.** Browser shows "Hardware lost." The C2 SerialBridge throws end-of-stream.
- **Action.** Web app auto switches to spacebar fallback within one second per NFR13.
- **Recover later.** Re-plug. Refresh the page. Calibration persists in localStorage (FM2).

### Foam pad shifts under the doll
- **Symptom.** Compressions read soft or hard inconsistently.
- **Action.** Re-seat the doll between scenarios. Three minutes between judge runs is enough.

## Cloud

### Gemini PatientAgent timeout (>3 s)
- **Symptom.** Vitals stop ticking for one cycle.
- **Action.** No operator action; C5d AgentBus retries up to 3 times, then coasts last valid vitals, then falls back to the rule based model after 3 fails (FM3, design §3 `offline_fallback`).

### Gemini CoachAgent timeout
- **Symptom.** No new coach phrase.
- **Action.** No operator action; C5d serves the most recent cached phrase (FM4).

### Gemini ScenarioAgent timeout
- **Symptom.** Scenario card delayed at intro.
- **Action.** No operator action; C13 OfflineCache serves one of five pre rendered scenarios (FM5).

### ElevenLabs returns 429 (quota exhausted)
- **Symptom.** No audio for the next coach phrase.
- **Action.** No operator action; C7a switches to C7c browser SpeechSynthesis for the rest of the session (FM6).
- **Hard recover.** Swap to backup ElevenLabs key in `.env.local` and reload.

### Local session JSON write fails
- **Symptom.** Console error on session end (disk full, permission denied, path missing). Demo continues.
- **Action.** No operator action; C11 LocalSessionLog keeps the buffer in memory and emits the full session record to the console so the operator can copy it manually if needed (FM7).
- **Hard recover.** `mkdir -p data/local/` from the api directory; check disk space; retry End Session.

### All cloud fails three times in 30 seconds
- **Symptom.** Banner switches to "Local mode." Coaching gets generic.
- **Action.** No operator action; the State Machine enters `offline_fallback` (FM14, design §3).
- **Recover later.** Click "Retry online" once the network is back.

## Audio

### Audio context locked at page load
- **Symptom.** "Click to enable audio" overlay shows.
- **Action.** Click anywhere on the page. Required by browser autoplay rules (FM12).

### Sustained ambient noise drowns coach voice
- **Symptom.** Judge says "I can't hear it." Coach line still on screen.
- **Action.** Raise system volume. Lean closer. Visual coach line still works (FM16).

## App

### Demo crashes mid run
- **Symptom.** Page error.
- **Action.** Click "Reset Scenario" first (FR7). If that fails, refresh the page; calibration persists (FM20).

### Judge clicks "Reset" mid coach phrase
- **Symptom.** Audio cut off.
- **Action.** Expected. Audio queue cancels cleanly (FM15).

## Pre demo checklist

Before each judge wave:
1. FSR connected, depth bar moves on press.
2. Audio plays (test the bystander intro mp3).
3. Gemini key responds (check the dev tools network tab on first compression).
4. `data/local/` directory exists and is writable (api creates it on startup if missing).
5. Calibration values inside ±50 of the morning's values.
6. Laptop on wall power, charge ≥ 50%.
7. Reset to scenario_intro state.
