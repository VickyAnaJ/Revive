# Revive

**CPR practice anywhere.** A pressure-sensitive pad, a real-time AI patient simulator, and a voice that corrects you within 50 milliseconds.

Built for HackaBull VII (Apr 26, 2026).

---

## Why

Out-of-hospital cardiac arrest survival without bystander CPR is around 10%. With proper compressions, it doubles. The bottleneck is training — not motivation. **Revive trains anyone, anywhere, with $50 of hardware and a browser.**

## How it works

You compress a force-sensitive pad. The pad streams pressure peaks over Web Serial. The web app:

1. Generates a fresh emergency scenario via **Gemini 2.5 Flash** (patient demographics, location, decision tree).
2. Simulates patient physiology in real time — heart rate, BP, rhythm, oxygenation — based on your compression depth and rate.
3. Coaches you out loud through **three ElevenLabs voices** — a calm instructor for the welcome, a 911 dispatcher reading scenario decisions, a panicked bystander with scenario-customized text.
4. Scores you against AHA protocol (depth 2.0–2.4", rate 100–120 BPM, recoil quality, decision timing).

Voice replaces the screen, so your eyes stay on the patient.

## Demo flow

1. Cinematic intro → click anywhere → **calm instructor voice** welcomes
2. Click **BEGIN CPR PROTOCOL** → Gemini generates scenario → **bystander panics** with scenario-specific lines
3. **Decision screen**: 20-second window, pick first action (CPR / pulse check / call 911 / AED)
4. **Compression screen**: depth bar, BPM counter, rhythm wave, anatomical silhouette pulsing with rate, dispatcher voice barking corrections per batch ("Push harder", "Slow down", "Allow recoil")
5. Patient reaches ROSC or flatlines → debrief with performance index, breakdown, retry option

## Run locally

```bash
git clone https://github.com/VickyAnaJ/Revive.git
cd Revive/web
npm install
cp .env.local.example .env.local   # add ElevenLabs + Gemini keys
npm run dev
# open http://localhost:3000 in Chrome
```

For the hardware: open `firmware/revive_firmware.ino` in Arduino IDE, flash to UNO R4 Minima, plug into USB. The web app auto-detects via Web Serial. No Arduino? Press `Option+Shift+Space` for keyboard fallback.

Required env vars:

```
NEXT_PUBLIC_GEMINI_API_KEY=...
NEXT_PUBLIC_ELEVENLABS_API_KEY=...
NEXT_PUBLIC_ELEVENLABS_VOICE_ID_INSTRUCTOR=...
NEXT_PUBLIC_ELEVENLABS_VOICE_ID_DISPATCHER=...
NEXT_PUBLIC_ELEVENLABS_VOICE_ID_BYSTANDER=...
```

## Stack

- **Hardware**: Arduino UNO R4 Minima + FSR pressure pad → JSON-over-Web-Serial
- **Web**: Next.js 16 + React 19 + TypeScript + Tailwind 4
- **AI**: Gemini 2.5 Flash (3 agents — patient simulation, coach phrases, scenario generation)
- **Voice**: ElevenLabs `eleven_flash_v2` streaming TTS + pre-rendered MP3s + browser SpeechSynthesis fallback
- **Tests**: Vitest, 222 tests, full TypeScript

## What's in the repo

```
revive/
├── firmware/    Arduino sketch (force sensor → JSON peaks at 100Hz)
├── web/         Next.js app — UI, state machine, AI agents, voice pipeline
├── api/         FastAPI scaffolding (currently unused; agents run client-side)
├── contracts/   Shared JSON schemas
└── docs/        Internal design + audit docs (gitignored, kept private)
```

## AI usage

- **Gemini 2.5 Flash** generates scenarios, simulates patient physiology, and produces coach phrases. Three independent agents with structured JSON output, schema validation, and a 3-tier fallback (retry → cached scenarios → rule-based vitals).
- **ElevenLabs flash_v2** drives all spoken voice. Three distinct character voices for instructor / dispatcher / bystander. Pre-rendered MP3s for instant coach corrections; streaming for scenario-specific lines.
- **Claude Code** assisted architecture planning, implementation, and bug fixes during the build.
- **Claude Design** generated the UI mockup that was hand-converted to React components.

Core scoring, hardware integration, state machine, and patient physiology rule-based fallback are human-written.

## Fallbacks

When something fails on stage, the demo keeps working:

- **Pad disconnected** → keyboard fallback (`Option+Shift+Space`)
- **Gemini times out** → cached scenarios + rule-based vitals
- **ElevenLabs 429 / network down** → browser SpeechSynthesis
- **Audio blocked** → text overlays preserve every coach correction

## Team

Built at HackaBull VII at the University of South Florida.
