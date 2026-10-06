// cron-tick — будильник клуба, его раз в 15 минут дёргает pg_cron (миграция 005).
// verify_jwt = false (config.toml): pg_net шлёт не JWT, а заголовок x-cron-secret. Секрет живёт
// только в Vault (его создаёт миграция 011), функция сверяет заголовок RPC verify_cron_secret —
// в окружении функций копии секрета нет.
// За один вызов:
//   1) до ближайшей игры по расписанию ≤ announce_hours_before и слот свободен (нет вечера ни
//      на эту дату, ни перенесённого с неё — evenings.slot_date) —
//      создаёт вечер (формат по умолчанию, банкир не назначен); постит неотправленные анонсы;
//   2) добивает неотправленные итоги вечеров (если notify банкира не дошёл);
//   3) постит итоги голосования, когда оно закрылось;
//   4) подстраховка notify evening_changed: о переносе, отмене или возврате вечера, чей анонс уже
//      в группе, если админский вызов после сохранения не дошёл (миграция 008, notify/changes.ts).
// Каждый шаг идемпотентен по *_posted_at (см. publishOnce), поэтому лишний вызов безопасен.
// Без settings.group_chat_id ничего не постит, но вечер создаёт.
import { adminClient, describeError, errorResponse, json } from '../_shared/admin.ts';
import {
  DEFAULT_FORMAT,
  validateFormat,
  voteResults,
  type TournamentFormat,
} from '../_shared/domain/index.ts';
import { announceSnapshot } from '../_shared/announce.ts';
import { announcePost, votingPost } from '../_shared/messages.ts';
import { postAnnounceChange } from '../notify/changes.ts';
import {
  EVENING_COLUMNS,
  loadPlayerNames,
  loadSettings,
  postEveningResults,
  publishOnce,
  claimPost,
  votesOf,
  type EveningRow,
  type PostOutcome,
  type SettingsRow,
  type VoteRow,
} from '../notify/results.ts';
import { holdsSlot, nextGameAt, slotFilter, type SlotEvening } from './schedule.ts';

const HOUR_MS = 60 * 60 * 1000;
/** Итоги старше — уже не новость: при подключении группы не вываливаем в неё всю историю. */
const BACKFILL_WINDOW_MS = 3 * 24 * HOUR_MS;
/**
 * Итоги добиваем не сразу после finish: свой notify банкир шлёт сразу после завершения, и добивка
 * не должна столкнуться с ним. Отменить finish может только админ; если он вернул вечер в игру,
 * void_event снимает отметку поста, и после повторного завершения уйдут «Исправленные итоги».
 */
const RESULTS_GRACE_MS = 10 * 60 * 1000;

type Db = ReturnType<typeof adminClient>;

interface TickReport {
  now: string;
  group: boolean;
  nextGameAt: string | null;
  createdEvening: string | null;
  announced: Record<string, PostOutcome>;
  results: Record<string, PostOutcome>;
  voting: Record<string, PostOutcome | 'no_votes'>;
  changes: Record<string, string>;
  errors: string[];
}

/**
 * Заголовок x-cron-secret совпадает с секретом cron_secret из Vault. Сравнение — в базе
 * (public.verify_cron_secret, миграция 011: HMAC на случайном ключе, без утечки по времени).
 * Пустой заголовок отсекаем без запроса в базу.
 */
async function secretMatches(db: Db, given: string): Promise<boolean> {
  if (given === '') return false;
  const { data, error } = await db.rpc('verify_cron_secret', { p_secret: given });
  if (error) throw new Error(`verify_cron_secret: ${describeError(error)}`);
  return data === true;
}

const hasGroup = (s: SettingsRow): s is SettingsRow & { group_chat_id: number | string } =>
  s.group_chat_id !== null && s.group_chat_id !== '';

/** Формат по умолчанию из settings; битый или отсутствующий — клубный из домена. */
async function defaultFormat(db: Db, s: SettingsRow): Promise<TournamentFormat> {
  if (!s.default_format_id) return DEFAULT_FORMAT;
  const { data, error } = await db
    .from('formats')
    .select('config')
    .eq('id', s.default_format_id)
    .maybeSingle();
  if (error) throw new Error(`formats: ${describeError(error)}`);
  const config: unknown = (data as { config?: unknown } | null)?.config;
  const problems = validateFormat(config);
  if (problems.length > 0) {
    console.warn(
      `Формат по умолчанию ${s.default_format_id} не годен (${problems.join('; ')}) — беру клубный`,
    );
    return DEFAULT_FORMAT;
  }
  return config as TournamentFormat;
}

/** Шаг 1а: вечер на ближайшую игру, если до неё не больше announce_hours_before. */
async function ensureUpcomingEvening(
  db: Db,
  s: SettingsRow,
  nowMs: number,
  report: TickReport,
): Promise<void> {
  const gameMs = nextGameAt(nowMs, s.game_weekday, s.game_time);
  report.nextGameAt = new Date(gameMs).toISOString();
  if (gameMs - nowMs > s.announce_hours_before * HOUR_MS) return;

  // «Слот свободен» — в любом статусе нет вечера ни в этот московский день, ни закреплённого за
  // ним (slot_date, миграция 010): отменённый админом вечер не воскрешаем, перенесённый на другое
  // время того же дня или на другой день не дублируем (см. holdsSlot).
  const { data: existing, error } = await db
    .from('evenings')
    .select('scheduled_at, slot_date')
    .or(slotFilter(gameMs));
  if (error) throw new Error(`evenings: ${describeError(error)}`);
  if (((existing ?? []) as SlotEvening[]).some((e) => holdsSlot(e, gameMs))) return;

  const { data: created, error: insError } = await db
    .from('evenings')
    .insert({
      scheduled_at: new Date(gameMs).toISOString(),
      location: s.default_location,
      status: 'announced',
      format: await defaultFormat(db, s),
    })
    .select('id')
    .single();
  if (insError) throw new Error(`evenings insert: ${describeError(insError)}`);
  report.createdEvening = (created as { id: string }).id;
}

/** Шаг 1б: анонсы будущих вечеров, попавших в окно анонса и ещё не объявленных. */
async function postAnnouncements(
  db: Db,
  s: SettingsRow & { group_chat_id: number | string },
  nowMs: number,
  report: TickReport,
): Promise<void> {
  const { data, error } = await db
    .from('evenings')
    .select(EVENING_COLUMNS)
    .eq('status', 'announced')
    .is('announce_posted_at', null)
    .gt('scheduled_at', new Date(nowMs).toISOString())
    .lte('scheduled_at', new Date(nowMs + s.announce_hours_before * HOUR_MS).toISOString())
    .order('scheduled_at');
  if (error) throw new Error(`evenings: ${describeError(error)}`);
  for (const e of (data ?? []) as unknown as EveningRow[]) {
    try {
      const post = announcePost({
        eveningId: e.id,
        scheduledAt: e.scheduled_at,
        location: e.location,
        note: e.note,
        format: e.format,
        botUsername: s.bot_username,
      });
      // Вместе с отметкой — снимок того, что ушло в пост: с ним сравнивает notify evening_changed.
      report.announced[e.id] = await publishOnce(
        db,
        e.id,
        'announce_posted_at',
        s.group_chat_id,
        post,
        nowMs,
        ['announced'],
        { announce_snapshot: announceSnapshot(e) },
      );
    } catch (err) {
      report.errors.push(`анонс ${e.id}: ${describeError(err)}`);
    }
  }
}

/** Шаг 2: итоги вечеров, которые не ушли через notify. */
async function backfillResults(db: Db, nowMs: number, report: TickReport): Promise<void> {
  const { data, error } = await db
    .from('evenings')
    .select(EVENING_COLUMNS)
    .in('status', ['finished', 'settled'])
    .is('results_posted_at', null)
    .not('finished_at', 'is', null)
    .lte('finished_at', new Date(nowMs - RESULTS_GRACE_MS).toISOString())
    .gte('finished_at', new Date(nowMs - BACKFILL_WINDOW_MS).toISOString())
    .order('finished_at');
  if (error) throw new Error(`evenings: ${describeError(error)}`);
  for (const e of (data ?? []) as unknown as EveningRow[]) {
    try {
      report.results[e.id] = await postEveningResults(db, e, nowMs);
    } catch (err) {
      report.errors.push(`итоги ${e.id}: ${describeError(err)}`);
    }
  }
}

/** Шаг 3: итоги голосования по вечерам, где оно закрылось. Без голосов — только отметка. */
async function postVotingResults(
  db: Db,
  s: SettingsRow & { group_chat_id: number | string },
  nowMs: number,
  report: TickReport,
): Promise<void> {
  const { data, error } = await db
    .from('evenings')
    .select(EVENING_COLUMNS)
    .in('status', ['finished', 'settled'])
    .is('voting_posted_at', null)
    .lte('voting_closes_at', new Date(nowMs).toISOString())
    .gte('voting_closes_at', new Date(nowMs - BACKFILL_WINDOW_MS).toISOString())
    .order('voting_closes_at');
  if (error) throw new Error(`evenings: ${describeError(error)}`);
  const evenings = (data ?? []) as unknown as EveningRow[];
  if (evenings.length === 0) return;

  const { names } = await loadPlayerNames(db);
  for (const e of evenings) {
    try {
      const { data: votes, error: vError } = await db
        .from('votes')
        .select('evening_id, voter_id, category, nominee_id')
        .eq('evening_id', e.id);
      if (vError) throw new Error(`votes: ${describeError(vError)}`);
      const post = votingPost({
        eveningId: e.id,
        scheduledAt: e.scheduled_at,
        names,
        results: voteResults(votesOf((votes ?? []) as VoteRow[])),
        botUsername: s.bot_username,
      });
      if (post) {
        report.voting[e.id] = await publishOnce(
          db,
          e.id,
          'voting_posted_at',
          s.group_chat_id,
          post,
          nowMs,
        );
      } else {
        // Пустое голосование не постим, но отмечаем — чтобы не проверять его каждые 15 минут.
        await claimPost(db, e.id, 'voting_posted_at', new Date(nowMs).toISOString());
        report.voting[e.id] = 'no_votes';
      }
    } catch (err) {
      report.errors.push(`голосование ${e.id}: ${describeError(err)}`);
    }
  }
}

/**
 * Шаг 4: правки объявленных вечеров, о которых группа ещё не знает. Окно — неделя назад: о вечерах,
 * которые давно прошли, писать нечего (decideAnnounceChange их и так пропустит).
 */
async function postAnnounceChanges(
  db: Db,
  s: SettingsRow & { group_chat_id: number | string },
  nowMs: number,
  report: TickReport,
): Promise<void> {
  const { data, error } = await db
    .from('evenings')
    .select(EVENING_COLUMNS)
    .in('status', ['announced', 'cancelled'])
    .not('announce_posted_at', 'is', null)
    .gte('scheduled_at', new Date(nowMs - 7 * 24 * HOUR_MS).toISOString())
    .order('scheduled_at');
  if (error) throw new Error(`evenings: ${describeError(error)}`);
  for (const e of (data ?? []) as unknown as EveningRow[]) {
    try {
      const result = await postAnnounceChange(db, e, nowMs, s);
      if (result.outcome !== 'no_changes') {
        report.changes[e.id] = result.change
          ? `${result.outcome}:${result.change}`
          : result.outcome;
      }
    } catch (err) {
      report.errors.push(`правка вечера ${e.id}: ${describeError(err)}`);
    }
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Только POST');
  let authorized: boolean;
  try {
    authorized = await secretMatches(adminClient(), req.headers.get('x-cron-secret') ?? '');
  } catch (err) {
    console.error(`cron-tick: ${describeError(err)}`);
    return errorResponse(500, 'not_configured', 'Не удалось проверить x-cron-secret');
  }
  if (!authorized) return errorResponse(401, 'bad_secret', 'Неверный x-cron-secret');

  const nowMs = Date.now();
  const report: TickReport = {
    now: new Date(nowMs).toISOString(),
    group: false,
    nextGameAt: null,
    createdEvening: null,
    announced: {},
    results: {},
    voting: {},
    changes: {},
    errors: [],
  };

  try {
    const db = adminClient();
    const s = await loadSettings(db);
    report.group = hasGroup(s);

    // Шаги независимы: сбой одного (например, Telegram недоступен) не отменяет остальные.
    const step = async (name: string, fn: () => Promise<void>): Promise<void> => {
      try {
        await fn();
      } catch (err) {
        report.errors.push(`${name}: ${describeError(err)}`);
      }
    };
    await step('вечер по расписанию', () => ensureUpcomingEvening(db, s, nowMs, report));
    if (hasGroup(s)) {
      // Сначала правки уже объявленных вечеров, потом новые анонсы: свежий анонс и так несёт
      // актуальные данные, а его снимок пишется вместе с отметкой.
      await step('правки вечеров', () => postAnnounceChanges(db, s, nowMs, report));
      await step('анонсы', () => postAnnouncements(db, s, nowMs, report));
      await step('итоги вечеров', () => backfillResults(db, nowMs, report));
      await step('итоги голосования', () => postVotingResults(db, s, nowMs, report));
    }
  } catch (err) {
    report.errors.push(describeError(err));
  }

  if (report.errors.length > 0) console.error(`cron-tick: ${report.errors.join(' | ')}`);
  return json(report);
});
