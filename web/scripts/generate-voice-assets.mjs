#!/usr/bin/env node
// S3-T01 — generate static voice assets for C7b VoiceCached.
// Usage: node scripts/generate-voice-assets.mjs [--force]
//
// Reads ELEVENLABS_API_KEY + voice IDs from .env.local. Generates 5 coach
// clips (Calm Instructor voice) + Bystander emotional variants (Panicked
// Bystander voice). Writes to web/public/audio/{coach,bystander}/.
//
// Idempotent: skips files that already exist unless --force is passed.

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(__dirname, '..');
const ENV_PATH = join(WEB_ROOT, '.env.local');
const OUTPUT_ROOT = join(WEB_ROOT, 'public', 'audio');

const FORCE = process.argv.includes('--force');

const COACH_CLIPS = [
  { name: 'push_harder', text: 'Push harder.' },
  { name: 'faster', text: 'Faster.' },
  { name: 'slower', text: 'Slow down.' },
  { name: 'allow_recoil', text: 'Allow recoil.' },
  { name: 'good_keep_going', text: 'Good. Keep going.' },
];

const BYSTANDER_CLIPS = [
  // Scared tier — patient O₂ > 80
  { name: 'scared_1', text: 'Please help him, he just collapsed in the kitchen.' },
  { name: 'scared_2', text: 'He fell down, I think his heart stopped.' },
  { name: 'scared_3', text: 'Oh god, please do something.' },
  // Panicked tier — patient O₂ 50–80
  { name: 'panicked_1', text: 'Oh no, he is not breathing — do something!' },
  { name: 'panicked_2', text: 'He is turning blue, hurry, hurry!' },
  { name: 'panicked_3', text: 'Please, you have to save him!' },
  // Hysterical tier — patient O₂ < 50
  { name: 'hysterical_1', text: 'He is dying! He is dying!' },
  { name: 'hysterical_2', text: 'No no no — please, please!' },
  { name: 'hysterical_3', text: 'Why is it not working, why?!' },
  // Relieved tier — rhythm became ROSC
  { name: 'relieved_1', text: 'Oh thank god, he is breathing again.' },
  { name: 'relieved_2', text: 'He is alive, you saved him.' },
];

async function loadEnv() {
  const text = await readFile(ENV_PATH, 'utf-8');
  const env = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function generateClip({ apiKey, voiceId, text, outputPath }) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_22050_32`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_flash_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.8,
      },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`ElevenLabs ${response.status}: ${detail.slice(0, 300)}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(outputPath, buffer);
  return buffer.length;
}

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

async function main() {
  const env = await loadEnv();
  const apiKey = env.ELEVENLABS_API_KEY;
  const instructorVoice = env.ELEVENLABS_VOICE_ID_INSTRUCTOR;
  const bystanderVoice = env.ELEVENLABS_VOICE_ID_BYSTANDER;

  if (!apiKey) throw new Error('ELEVENLABS_API_KEY missing from .env.local');
  if (!instructorVoice) throw new Error('ELEVENLABS_VOICE_ID_INSTRUCTOR missing from .env.local');
  if (!bystanderVoice) throw new Error('ELEVENLABS_VOICE_ID_BYSTANDER missing from .env.local');

  // Coach Tier 1 cached clips use the DISPATCHER voice. INSTRUCTOR (calm
  // nurse) is reserved for the intro welcome line only — keeping it out
  // of the compression loop makes the demo's three voices cleanly
  // distinct: nurse welcomes, dispatcher coaches + reads scenario,
  // bystander reacts.
  const dispatcherVoice = env.ELEVENLABS_VOICE_ID_DISPATCHER;
  if (!dispatcherVoice || dispatcherVoice.length !== 20) {
    throw new Error('ELEVENLABS_VOICE_ID_DISPATCHER missing or invalid (expected 20 chars)');
  }
  const coachVoice = dispatcherVoice;

  const coachDir = join(OUTPUT_ROOT, 'coach');
  const bystanderDir = join(OUTPUT_ROOT, 'bystander');
  await ensureDir(coachDir);
  await ensureDir(bystanderDir);

  let generated = 0;
  let skipped = 0;
  let totalBytes = 0;

  for (const clip of COACH_CLIPS) {
    const outputPath = join(coachDir, `${clip.name}.mp3`);
    if (!FORCE && (await exists(outputPath))) {
      console.log(`[skip] coach/${clip.name}.mp3 (already exists)`);
      skipped++;
      continue;
    }
    try {
      const bytes = await generateClip({
        apiKey,
        voiceId: coachVoice,
        text: clip.text,
        outputPath,
      });
      totalBytes += bytes;
      generated++;
      console.log(`[ok] coach/${clip.name}.mp3 (${(bytes / 1024).toFixed(1)} KB) — "${clip.text}"`);
    } catch (err) {
      console.error(`[fail] coach/${clip.name}.mp3:`, err.message);
    }
  }

  for (const clip of BYSTANDER_CLIPS) {
    const outputPath = join(bystanderDir, `${clip.name}.mp3`);
    if (!FORCE && (await exists(outputPath))) {
      console.log(`[skip] bystander/${clip.name}.mp3 (already exists)`);
      skipped++;
      continue;
    }
    try {
      const bytes = await generateClip({
        apiKey,
        voiceId: bystanderVoice,
        text: clip.text,
        outputPath,
      });
      totalBytes += bytes;
      generated++;
      console.log(`[ok] bystander/${clip.name}.mp3 (${(bytes / 1024).toFixed(1)} KB) — "${clip.text}"`);
    } catch (err) {
      console.error(`[fail] bystander/${clip.name}.mp3:`, err.message);
    }
  }

  console.log('');
  console.log(`Generated: ${generated} | Skipped (exists): ${skipped} | Total: ${(totalBytes / 1024).toFixed(1)} KB`);
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
