# Revive

CPR practice, anywhere. A force sensing pad, a web app with three Gemini agents, and an ElevenLabs coach that corrects your hands inside two seconds. HackaBull VII (Apr 25 to 26, 2026) entry.

## What this repo is

This repo is the build for the system designed in `../docs/pulsehero-design.md`. Layers 0 through 2 (physics, infrastructure, logical design) live in that doc. Layers 3 through 7 (strategy, implementation, code, verification, operations) live here, executed against `../Cascade/build-workflow.md`.

## Governing documents

| Doc | Layer | Where |
|---|---|---|
| Architecture pipeline (the rules) | L0 to L7 universal | `../Cascade/architecture-pipeline.md` |
| System design (the answers) | L0 to L2 specific | `../docs/pulsehero-design.md` |
| Build workflow (the process) | L3 to L7 process | `../Cascade/build-workflow.md` |
| Winner code patterns (verbatim references) | L4 to L5 implementation | `../docs/winner-code-patterns.md` |
| Hardware BOM | L1 to L2 hardware | `../docs/hardware-bom.md` |
| Hackathon rules and tracks | external constraints | `../docs/hackathon-ref.md` |

## Repo layout

```
revive/
├── firmware/         C1 ArduinoFirmware (Arduino sketch)
├── web/              C2 SerialBridge, C3 SessionController, C4 CompressionScorer,
│                     C6 ScoringRules, C7a/b/c Voice, C8 AudioQueue, C9 GameUI,
│                     C10 Calibrator, C12 Dashboard, C13 OfflineCache (Next.js)
├── api/              C5a PatientAgent, C5b CoachAgent, C5c ScenarioAgent,
│                     C5d AgentBus, C11 LocalSessionLog (FastAPI)
├── contracts/        Shared JSON schemas (TS + Python) per design §6f
├── scripts/          Local dev scripts
└── docs/
    ├── STATUS.md             traceability matrix and bootstrap audit
    ├── status/
    │   ├── slices/           one file per slice
    │   ├── foundation/       one file per foundation task
    │   ├── incidents/        post mortem logs
    │   ├── workflow-changes/ workflow evolution logs
    │   └── _templates/       SLICE_TEMPLATE.md, FOUNDATION_TEMPLATE.md
    ├── adr/                  architecture decision records
    └── external_apis/        one reference doc per external dependency
```

Component to directory mapping is `pulsehero-design.md §6d` plus the table above. If a component appears with no directory, the design or the layout is wrong; fix the lower layer first per build workflow governing rules.

## Setup (zero tribal knowledge per build-workflow 0.V29)

Prerequisites: Node 20 plus, Python 3.11 plus, Arduino IDE 2.x, Chrome or Edge browser (Web Serial API required).

```bash
# 1. Web app
cd web
npm install
cp .env.local.example .env.local   # then fill in keys
npm run dev                         # http://localhost:3000

# 2. Backend agents
cd ../api
python -m venv .venv
source .venv/bin/activate           # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                # then fill in keys
uvicorn main:app --reload --port 8000

# 3. Firmware
# Open firmware/revive_firmware.ino in Arduino IDE.
# Tools, Board, Arduino UNO R4 Minima.
# Tools, Port, /dev/cu.usbmodem* (Mac) or COMx (Windows).
# Upload.
# Tools, Serial Monitor at 115200 baud to see JSON.
```

Required env vars (drop into `.env.local` and `.env`, never commit):

```
GEMINI_API_KEY=...
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID_INSTRUCTOR=...
```

## AI usage disclosure (hackathon-ref.md L407)

This project uses AI as a load bearing component, not as a code generator helper.

- **Google Gemini 2.5 Flash** generates emergency scenarios, simulates patient physiology, and produces coach phrases. Three role pipeline (PatientAgent, CoachAgent, ScenarioAgent) with structured JSON output, JSON repair chain, and a three layer fallback per design §6g.
- **ElevenLabs (eleven_flash_v2)** streams the Calm Instructor coach voice and pre renders the Panicked Bystander scenario intro. Browser SpeechSynthesis covers 911 Dispatcher and Patient ROSC lines for free tier preservation.
- **Claude Code** assisted with architecture planning during the design phase (Layers 0 to 2 in `../docs/pulsehero-design.md`) and with implementation guidance against the build workflow.
- **Claude Design** (Anthropic Labs, research preview Apr 2026) generated initial UI for C9 GameUI components (VitalsStrip, RhythmBar, DecisionCard, ScenarioIntro, ResultsScreen). Output was Tailwind JSX, dropped into `web/src/components/` verbatim, then wired to the SessionController via typed props. See `docs/external_apis/claude-design.md` for the integration mechanism.

Core game logic, hardware integration, scoring algorithms, and the patient physiology rule based fallback are human written.

## Contributor onboarding (build-workflow 0.V34)

Read in order:
1. `../Cascade/architecture-pipeline.md` (the rules, all 21 L0 invariants).
2. `../docs/pulsehero-design.md` (what we are building, why, with what).
3. `../Cascade/build-workflow.md` (the process you are inside of right now).
4. `docs/STATUS.md` (where we are; pick a slice, follow the workflow).

Slice and foundation files copy from `docs/status/_templates/`. Deviation from format is invalid until corrected.

## Execution mode

Solo or collaborative declared in `docs/STATUS.md` Bootstrap section.

## Fallback paths

See `RUNBOOK.md` for the full failure mode chain. Short version:
- FSR dies → spacebar fallback (FR8).
- Gemini timeout → cached scenario, then hardcoded.
- ElevenLabs 429 → browser SpeechSynthesis takes over.
- Local session JSON write fails → console log of full record so the operator can copy it manually.
- All cloud fails → `offline_fallback` state (design §3 State Machine).
