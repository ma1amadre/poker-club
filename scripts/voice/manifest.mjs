#!/usr/bin/env node
// Манифест фраз голоса табло: какие клипы должны лежать в public.voice_clips (миграция 016).
// Его строит workflow voice.yml в poker-club-ops, дальше generate.py озвучивает только хеши, которых
// в таблице нет. Тексты, хеши и правила отбора — домен (supabase/functions/_shared/domain/voice.ts,
// voiceManifest); генератор и его запуск — ARCHITECTURE.md, «Голос табло».
//
// Использование (Node 23.6+ — домен импортируется как .ts, зависимостей нет, npm ci не нужен):
//   psql "$SUPABASE_DB_URL" -At -c 'select private.voice_manifest_input()' > input.json
//   node scripts/voice/manifest.mjs input.json > manifest.json      # или вход через stdin
// Флаги: --pair-players N (целые фразы пар нокаутов для N недавних игроков, по умолчанию 16),
//        --max N (предел фраз, по умолчанию 1000).
// Выход (stdout): JSON-массив [{voice, hash, text}] — text ровно то, что озвучить и записать в
// voice_clips.text, hash — voice_clips.text_hash. Пометки об урезанном — в stderr («note: …»).

import { readFileSync } from 'node:fs';
import {
  MANIFEST_MAX_TEXTS,
  MANIFEST_PAIR_PLAYERS,
  voiceManifest,
} from '../../supabase/functions/_shared/domain/voice.ts';

function fail(message) {
  process.stderr.write(`voice-manifest: ${message}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
function intFlag(name, fallback) {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const value = Number(args[i + 1]);
  if (!Number.isSafeInteger(value) || value < 0) fail(`${name}: нужно целое число ≥ 0`);
  args.splice(i, 2);
  return value;
}
const pairPlayers = intFlag('--pair-players', MANIFEST_PAIR_PLAYERS);
const maxTexts = intFlag('--max', MANIFEST_MAX_TEXTS);
const file = args[0];

let raw;
try {
  raw = file ? readFileSync(file, 'utf8') : readFileSync(0, 'utf8');
} catch (error) {
  fail(`не прочитать вход ${file ?? '(stdin)'}: ${error.message}`);
}

let input;
try {
  input = JSON.parse(raw);
} catch (error) {
  fail(`вход — не JSON: ${error.message}`);
}
if (
  !input ||
  typeof input !== 'object' ||
  !Array.isArray(input.players) ||
  !Array.isArray(input.formats)
)
  fail(
    'вход должен быть объектом {players: [...], formats: [...]} — результат private.voice_manifest_input()',
  );

const { clips, notes } = await voiceManifest(input, { pairPlayers, maxTexts });
for (const note of notes) process.stderr.write(`note: ${note}\n`);
process.stderr.write(`voice-manifest: ${clips.length} фраз\n`);
process.stdout.write(`${JSON.stringify(clips, null, 2)}\n`);
