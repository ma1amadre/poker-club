#!/usr/bin/env node
// Проверка merge_players (миграция 008) на локальной БД с seed.sql: replay каждого вечера после
// слияния должен давать тот же результат, что до него, с подменой id гостя на id профиля.
// Слияние идёт в транзакции psql и откатывается — данные seed не меняются.
//
// Сравнивается по каждому вечеру: итог summarize (места, очки, деньги, нокауты, пары, ребаи,
// уровни вылета, первый вылет), расчёт settlement по платежам журнала, итоги голосования,
// очки прогнозов.
//
// Использование (стек поднят, Node 23.6+ — домен импортируется как .ts):
//   node scripts/check-merge-replay.mjs [guest_id] [--container supabase_db_poker-club]
// По умолчанию гость — «Вова (гость)» из seed, профиль — новый Telegram-игрок «Вова» (tg 1007),
// которого скрипт создаёт внутри той же транзакции.

import { execFileSync } from 'node:child_process';
import {
  computeMoney,
  paymentsFromEvents,
  settlement,
} from '../supabase/functions/_shared/domain/money.ts';
import { scorePrediction } from '../supabase/functions/_shared/domain/predictions.ts';
import { replay } from '../supabase/functions/_shared/domain/replay.ts';
import { summarize } from '../supabase/functions/_shared/domain/summary.ts';
import { voteResults } from '../supabase/functions/_shared/domain/votes.ts';

const args = process.argv.slice(2);
const containerFlag = args.indexOf('--container');
const container = containerFlag >= 0 ? args[containerFlag + 1] : 'supabase_db_poker-club';
const GUEST = args.find((a) => /^[0-9a-f-]{36}$/.test(a)) ?? 'a0000000-0000-4000-8000-000000009001';
const TARGET = 'a0000000-0000-4000-8000-000000001007';
const ADMIN_AUTH = '00000000-0000-4000-8000-00000000a001';

// Снимок всего, что нужно домену, одной строкой JSON.
const DUMP = `
select json_build_object(
  'settings', (select row_to_json(s) from public.settings s),
  'evenings', (select json_agg(json_build_object('id', e.id, 'scheduled_at', e.scheduled_at,
                 'status', e.status, 'format', e.format) order by e.scheduled_at) from public.evenings e),
  'events', (select json_agg(json_build_object('id', ee.id, 'evening_id', ee.evening_id, 'type', ee.type,
                 'payload', ee.payload, 'at', ee.at, 'voided', ee.voided_at is not null) order by ee.id)
             from public.evening_events ee),
  'votes', (select json_agg(json_build_object('evening_id', v.evening_id, 'voterId', v.voter_id,
                 'category', v.category, 'nomineeId', v.nominee_id) order by v.evening_id, v.voter_id, v.category)
            from public.votes v),
  'predictions', (select json_agg(json_build_object('evening_id', p.evening_id, 'player_id', p.player_id,
                 'winnerId', p.winner_id, 'firstOutId', p.first_out_id) order by p.evening_id, p.player_id)
                  from public.predictions p))::text;`;

const sql = `
\\set ON_ERROR_STOP on
\\set QUIET on
begin;
insert into auth.users (id, aud, role, email)
  values ('${ADMIN_AUTH}', 'authenticated', 'authenticated', 'merge-check@test.invalid');
update public.players set auth_user_id = '${ADMIN_AUTH}' where id = 'a0000000-0000-4000-8000-000000001001';
insert into public.players (id, tg_id, display_name) values ('${TARGET}', 1007, 'Вова');
\\echo BEFORE
${DUMP}
select set_config('request.jwt.claims', json_build_object('sub', '${ADMIN_AUTH}', 'role', 'authenticated')::text, true);
set local role authenticated;
\\echo REPORT
select public.merge_players('${GUEST}', '${TARGET}')::text;
reset role;
\\echo AFTER
${DUMP}
rollback;
`;

const out = execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-At'], {
  input: sql,
  encoding: 'utf8',
});
const section = (name) => {
  const lines = out.split(/\r?\n/);
  const i = lines.indexOf(name);
  if (i < 0) throw new Error(`Нет секции ${name} в выводе psql:\n${out}`);
  return lines.slice(i + 1).find((l) => l.startsWith('{'));
};
const before = JSON.parse(section('BEFORE'));
const report = JSON.parse(section('REPORT'));
const after = JSON.parse(section('AFTER'));

/** Каноничный JSON: ключи объектов по алфавиту — порядок вставки не влияет на сравнение. */
function canon(value) {
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canon(value[k])]),
    );
  }
  return value;
}
const swap = (value) => JSON.parse(JSON.stringify(value).replaceAll(GUEST, TARGET));

function eveningResult(db, evening) {
  const cfg = { koPoints: Number(db.settings.ko_points), winBonus: Number(db.settings.win_bonus) };
  const events = (db.events ?? []).filter((e) => e.evening_id === evening.id);
  const lastMs = events.reduce((m, e) => Math.max(m, Date.parse(e.at) || 0), 0);
  const state = replay(evening.format, events, lastMs);
  const money = computeMoney(evening.format, state);
  let summary = null;
  try {
    summary = summarize(evening.id, evening.scheduled_at, evening.format, events, cfg);
  } catch {
    summary = 'не завершён';
  }
  const votes = (db.votes ?? []).filter((v) => v.evening_id === evening.id);
  const predictions = (db.predictions ?? [])
    .filter((p) => p.evening_id === evening.id)
    .map((p) => ({ player: p.player_id, ...scorePrediction(p, state) }));
  return {
    summary,
    errors: state.errors,
    settlement: settlement(money, paymentsFromEvents(events)),
    votes: voteResults(votes),
    predictions,
  };
}

const mentions = (db, id) =>
  new Set(
    (db.events ?? [])
      .filter((e) => JSON.stringify(e.payload).includes(id))
      .map((e) => e.evening_id),
  );
const touched = mentions(before, GUEST);

let failures = 0;
for (const evening of before.evenings) {
  const afterEvening = after.evenings.find((e) => e.id === evening.id);
  const expected = JSON.stringify(canon(swap(eveningResult(before, evening))));
  const actual = JSON.stringify(canon(eveningResult(after, afterEvening)));
  const same = expected === actual && evening.status === afterEvening.status;
  const mark = touched.has(evening.id) ? 'вечер гостя' : 'не затронут';
  console.log(
    `${same ? 'ok  ' : 'FAIL'} ${evening.scheduled_at.slice(0, 10)} ${evening.status} (${mark})`,
  );
  if (!same) {
    failures += 1;
    console.log(`  ожидалось: ${expected}\n  получилось: ${actual}`);
  }
}

if (mentions(after, GUEST).size > 0) {
  failures += 1;
  console.log('FAIL в журнале остались ссылки на гостя');
}
console.log(`Отчёт merge_players: ${JSON.stringify(report)}`);
console.log(`Вечеров гостя: ${touched.size}, всего вечеров: ${before.evenings.length}`);
if (failures > 0) {
  console.error(`Расхождений: ${failures}`);
  process.exit(1);
}
console.log('Replay после слияния совпадает с исходным с подменой id.');
