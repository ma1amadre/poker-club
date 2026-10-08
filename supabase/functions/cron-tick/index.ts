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
//   4) подстраховка notify evening_changed: о переносе, месте, отмене или возврате вечера, чей
//      анонс уже в группе, если админский вызов после сохранения не дошёл (миграция 008,
//      notify/changes.ts);
//   5) пост в день игры за gameday_hours_before до начала объявленного вечера: кто идёт, кто ещё
//      не ответил (без болельщиков, миграция 024), «На кону» (кто в шаге от ачивки или рекорда, расклад сезона — stakesOf) и сколько
//      сделано прогнозов (миграция 014, _shared/gameday.ts);
//   6) напоминание о голосовании за 3 ч до его закрытия: сколько игроков вечера уже проголосовали
//      (миграция 021, _shared/votingReminder.ts);
//   7) пост «Итоги сезона» в первый день нового квартала после 12:00 МСК — один раз на сезон
//      (отметка season_posts, миграция 025; notify/season.ts). Анонс и пост дня игры последнего
//      вечера квартала несут строку «Финал сезона» (_shared/seasonPost.ts).
// Каждый шаг идемпотентен по *_posted_at (см. publishOnce), поэтому лишний вызов безопасен.
// Тренировочные вечера (миграция 023) не выбирает ни один шаг: о них бот в группу не пишет, день клуба
// они не занимают (claimPost их тоже не застолбит — страховка).
// Без settings.group_chat_id ничего не постит, но вечер создаёт.
// Сбой шага или всего вызова — сообщение админу в личку (_shared/alerts.ts, не чаще раза в 6 ч на
// один и тот же сбой); ответ функции и строки errors от этого не меняются.
// В конце каждого тика, прошедшего проверку секрета, — отметка в базе (mark_cron_tick, миграция 021):
// когда тик отработал и когда отработал без ошибок. По ней keepalive в poker-club-ops замечает, что
// будильник встал (сторож будильника).
import { adminClient, describeError, errorResponse, json } from '../_shared/admin.ts';
import { alertAdmin, type AlertKind } from '../_shared/alerts.ts';
import {
  DEFAULT_FORMAT,
  seasonKey,
  seasonStartMs,
  seatedIds,
  validateFormat,
  voteResults,
  type EventPayload,
  type TournamentFormat,
} from '../_shared/domain/index.ts';
import { announceSnapshot } from '../_shared/announce.ts';
import {
  decideGamedayPost,
  gamedayHours,
  gamedayRoster,
  predictionsMade,
  type GamedayPlayerRow,
  type GamedayPredictionRow,
  type GamedayRsvpRow,
} from '../_shared/gameday.ts';
import {
  announcePost,
  formatClubDate,
  gamedayPost,
  votingPost,
  votingReminderPost,
} from '../_shared/messages.ts';
import { postAnnounceChange } from '../notify/changes.ts';
import { postSeasonResults, type SeasonPostOutcome } from '../notify/season.ts';
import {
  clubSchedule,
  finaleSeasonOf,
  seasonPostDue,
  type CalendarRow,
} from '../_shared/seasonPost.ts';
import {
  EVENING_COLUMNS,
  fetchAll,
  loadHistory,
  loadPlayerNames,
  loadSettings,
  postEveningResults,
  publishOnce,
  claimPost,
  eveningStarLevels,
  scoringConfig,
  stakesOf,
  votesOf,
  type ClubHistory,
  type EveningRow,
  type PostOutcome,
  type SettingsRow,
  type VoteRow,
} from '../notify/results.ts';
import {
  VOTING_REMINDER_HOURS,
  decideVotingReminder,
  turnoutDecision,
  votingTurnout,
  type TurnoutPlayerRow,
} from '../_shared/votingReminder.ts';
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
/** Окно выборки напоминаний о голосовании: закрытие не дальше, чем через столько. */
const VOTING_REMINDER_WINDOW_MS = VOTING_REMINDER_HOURS * HOUR_MS;

type Db = ReturnType<typeof adminClient>;

interface TickReport {
  now: string;
  group: boolean;
  nextGameAt: string | null;
  createdEvening: string | null;
  announced: Record<string, PostOutcome>;
  /**
   * Пост в день игры: posted / already_posted, fresh_announce — отмечен без поста (анонс ушёл уже
   * внутри окна), wait_announce — окно открыто, а анонс ещё не уходил.
   */
  gameday: Record<string, PostOutcome | 'fresh_announce' | 'wait_announce'>;
  results: Record<string, PostOutcome>;
  voting: Record<string, PostOutcome | 'no_votes'>;
  /**
   * Напоминание о голосовании: posted / already_posted; wait_results — итогов в группе ещё нет;
   * отмечено без поста: fresh_results (итоги ушли уже за 3 ч до закрытия), too_late, all_voted,
   * no_voters (_shared/votingReminder.ts).
   */
  votingReminder: Record<string, PostOutcome | 'wait_results' | ReminderMark>;
  /** Пост «Итоги сезона» по ключу сезона (миграция 025): posted / already_posted / wait_live / no_evenings. */
  season: Record<string, SeasonPostOutcome>;
  changes: Record<string, string>;
  errors: string[];
}

/** Напоминание о голосовании отмечено без поста — почему. */
type ReminderMark = 'fresh_results' | 'too_late' | 'all_voted' | 'no_voters';

/** Сбой для алерта админу: в ответ функции (его хранит pg_net) не попадает. */
interface Failure {
  kind: AlertKind;
  /** Для человека: какой вечер (без uuid). Пусто — сбой шага целиком. */
  detail: string;
  err: unknown;
}

interface TickState extends TickReport {
  failures: Failure[];
}

/** Записать сбой: строка в errors (как раньше, с id для логов) и запись для алерта. */
function fail(t: TickState, kind: AlertKind, label: string, err: unknown, detail = ''): void {
  t.errors.push(`${label}: ${describeError(err)}`);
  t.failures.push({ kind, detail, err });
}

const eveningDetail = (e: EveningRow): string => `вечер ${formatClubDate(e.scheduled_at)}`;

/**
 * Алерты по итогам тика: один вызов alertAdmin на вид сбоя (первая ошибка + сколько ещё было в том
 * же шаге). Троттлинг и дедупликация — внутри alertAdmin; он не бросает.
 */
async function alertFailures(db: Db | null, failures: readonly Failure[]): Promise<void> {
  const byKind = new Map<AlertKind, Failure[]>();
  for (const f of failures) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f]);
  for (const [kind, list] of byKind) {
    const first = list[0];
    if (!first) continue;
    const more = list.length > 1 ? `ещё ${list.length - 1} в этом же шаге` : '';
    const detail = [first.detail, more].filter(Boolean).join('; ');
    await alertAdmin(db, kind, detail, first.err);
  }
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

/**
 * Отметка тика для сторожа будильника (mark_cron_tick, миграция 021): тик отработал, и — если без
 * единой ошибки — отработал успешно. Время ставит база (now()), а не функция. Не бросает: отметка не
 * должна ронять тик, а не записанная отметка сама станет сигналом — keepalive увидит, что она старая.
 */
async function markTick(db: Db | null, ok: boolean): Promise<void> {
  if (!db) return;
  try {
    const { error } = await db.rpc('mark_cron_tick', { p_ok: ok });
    if (error) throw new Error(describeError(error));
  } catch (err) {
    console.error(`cron-tick: отметка тика не записана: ${describeError(err)}`);
  }
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

/** Сезон, финал которого вечер (строка «Финал сезона»), или null. */
type FinaleOf = (e: EveningRow) => Promise<string | null>;

/**
 * Пометка «Финал сезона» для анонса и поста дня игры (последний вечер квартала — isSeasonFinale
 * домена): вечера клуба с начала текущего сезона в любом статусе (отменённый держит свой слот
 * расписания), один запрос на тик и только если есть что постить. Не загрузились или подсчёт упал —
 * пост уходит без строки (ошибка в лог): это пометка, из-за неё пост не застревает.
 */
function finaleResolver(db: Db, s: SettingsRow, nowMs: number): FinaleOf {
  const schedule = clubSchedule(s);
  let rows: Promise<CalendarRow[] | null> | null = null;
  const load = async (): Promise<CalendarRow[] | null> => {
    try {
      const from = seasonStartMs(seasonKey(new Date(nowMs).toISOString()));
      const { data, error } = await db
        .from('evenings')
        .select('id, scheduled_at, slot_date, status')
        .eq('is_training', false)
        .gte('scheduled_at', new Date(from).toISOString())
        .order('scheduled_at');
      if (error) throw new Error(describeError(error));
      return (data ?? []) as CalendarRow[];
    } catch (err) {
      console.error(`«Финал сезона»: вечера не загрузились — ${describeError(err)}`);
      return null;
    }
  };
  return async (e) => {
    rows ??= load();
    const list = await rows;
    if (!list) return null;
    try {
      const self = list.find((r) => r.id === e.id) ?? {
        id: e.id,
        scheduled_at: e.scheduled_at,
        slot_date: null,
        status: e.status,
      };
      return finaleSeasonOf(self, list, schedule);
    } catch (err) {
      console.error(`«Финал сезона» вечера ${e.id} не посчитан: ${describeError(err)}`);
      return null;
    }
  };
}

/** Шаг 1а: вечер на ближайшую игру, если до неё не больше announce_hours_before. */
async function ensureUpcomingEvening(
  db: Db,
  s: SettingsRow,
  nowMs: number,
  report: TickState,
): Promise<void> {
  const gameMs = nextGameAt(nowMs, s.game_weekday, s.game_time);
  report.nextGameAt = new Date(gameMs).toISOString();
  if (gameMs - nowMs > s.announce_hours_before * HOUR_MS) return;

  // «Слот свободен» — в любом статусе нет вечера ни в этот московский день, ни закреплённого за
  // ним (slot_date, миграция 010): отменённый админом вечер не воскрешаем, перенесённый на другое
  // время того же дня или на другой день не дублируем (см. holdsSlot).
  // Тренировка (миграция 023) день клуба не держит: в день игры с тренировкой вечер всё равно нужен.
  const { data: existing, error } = await db
    .from('evenings')
    .select('scheduled_at, slot_date')
    .eq('is_training', false)
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
  report: TickState,
  finaleOf: FinaleOf,
): Promise<void> {
  const { data, error } = await db
    .from('evenings')
    .select(EVENING_COLUMNS)
    .eq('is_training', false)
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
        finaleSeasonKey: await finaleOf(e),
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
      fail(report, 'cron_announce', `анонс ${e.id}`, err, eveningDetail(e));
    }
  }
}

/**
 * Шаг 1в: пост в день игры — у объявленных вечеров, до начала которых осталось не больше
 * gameday_hours_before. Один раз на вечер (gameday_posted_at, publishOnce); перенос на другой
 * московский день снимает отметку (триггер миграции 014), и в новый день пост уходит снова.
 * Идёт после анонсов: анонс, ушедший в этот же тик, уже виден как свежий, и пост дня игры
 * отмечается без отправки — группа не получает два поста подряд (decideGamedayPost).
 */
async function postGamedayPosts(
  db: Db,
  s: SettingsRow & { group_chat_id: number | string },
  nowMs: number,
  report: TickState,
  finaleOf: FinaleOf,
): Promise<void> {
  const hours = gamedayHours(s.gameday_hours_before);
  const { data, error } = await db
    .from('evenings')
    .select(EVENING_COLUMNS)
    .eq('is_training', false)
    .eq('status', 'announced')
    .is('gameday_posted_at', null)
    .gt('scheduled_at', new Date(nowMs).toISOString())
    .lte('scheduled_at', new Date(nowMs + hours * HOUR_MS).toISOString())
    .order('scheduled_at');
  if (error) throw new Error(`evenings: ${describeError(error)}`);
  const evenings = (data ?? []) as unknown as EveningRow[];
  if (evenings.length === 0) return;

  // Игроки — один раз на шаг и только если есть что постить.
  let players: GamedayPlayerRow[] | null = null;
  const loadPlayers = async (): Promise<GamedayPlayerRow[]> => {
    players ??= await fetchAll<GamedayPlayerRow>((from, to) =>
      db
        .from('players')
        .select('id, display_name, username, tg_id, is_active, is_guest, is_spectator')
        .order('id')
        .range(from, to),
    );
    return players;
  };

  // null — ещё не загружали; false — не загрузилась (в этом тике больше не пробуем).
  let history: ClubHistory | false | null = null;
  for (const e of evenings) {
    try {
      const decision = decideGamedayPost(e, hours, nowMs);
      if (decision === 'none') continue;
      if (decision === 'wait_announce') {
        report.gameday[e.id] = 'wait_announce';
        continue;
      }
      // Застолбить, только если вечер не перенесли, пока мы его читали.
      const sameTime = { scheduled_at: e.scheduled_at };
      if (decision === 'fresh_announce') {
        const claimed = await claimPost(
          db,
          e.id,
          'gameday_posted_at',
          new Date(nowMs).toISOString(),
          ['announced'],
          {},
          sameTime,
        );
        report.gameday[e.id] = claimed ? 'fresh_announce' : 'already_posted';
        continue;
      }

      const all = await loadPlayers();
      const { data: rsvps, error: rError } = await db
        .from('rsvps')
        .select('player_id, status, updated_at')
        .eq('evening_id', e.id);
      if (rError) throw new Error(`rsvps: ${describeError(rError)}`);
      // Только число: содержимое чужих прогнозов до старта скрыто от игроков (RLS predictions).
      const { data: predictions, error: pError } = await db
        .from('predictions')
        .select('winner_id, first_out_id')
        .eq('evening_id', e.id);
      if (pError) throw new Error(`predictions: ${describeError(pError)}`);
      // Кто уже за столом (действующий вход): посаженный болельщик на этот вечер игрок (миграция 024).
      const { data: joins, error: jError } = await db
        .from('evening_events')
        .select('type, payload, voided_at')
        .eq('evening_id', e.id)
        .eq('type', 'join')
        .is('voided_at', null);
      if (jError) throw new Error(`evening_events: ${describeError(jError)}`);
      const seated = seatedIds(
        (joins ?? []).map((j) => ({
          type: 'join' as const,
          payload: j.payload as EventPayload,
          voided: j.voided_at !== null,
        })),
      );
      const banker = e.banker_id ? all.find((p) => p.id === e.banker_id) : undefined;
      // «На кону» — по истории клуба (одна загрузка на шаг). Это дополнение: история не загрузилась
      // или подсчёт упал — пост уходит без этих строк (ошибка в лог), а не застревает.
      if (history === null) {
        try {
          history = await loadHistory(db, scoringConfig(s));
        } catch (err) {
          console.error(`«На кону»: история клуба не загрузилась — ${describeError(err)}`);
          history = false;
        }
      }
      const stakes = history
        ? stakesOf(
            history,
            e,
            all,
            (rsvps ?? []) as GamedayRsvpRow[],
            s.season_best_n,
            seated,
            nowMs,
          )
        : null;
      const post = gamedayPost({
        eveningId: e.id,
        scheduledAt: e.scheduled_at,
        location: e.location,
        bankerName: banker?.display_name ?? null,
        roster: gamedayRoster(all, (rsvps ?? []) as GamedayRsvpRow[], seated),
        botUsername: s.bot_username,
        nowMs,
        predictionsMade: predictionsMade((predictions ?? []) as GamedayPredictionRow[]),
        stakes,
        names: Object.fromEntries(all.map((p) => [p.id, p.display_name])),
        finaleSeasonKey: await finaleOf(e),
      });
      report.gameday[e.id] = await publishOnce(
        db,
        e.id,
        'gameday_posted_at',
        s.group_chat_id,
        post,
        nowMs,
        ['announced'],
        {},
        sameTime,
      );
    } catch (err) {
      fail(report, 'cron_gameday', `день игры ${e.id}`, err, eveningDetail(e));
    }
  }
}

/** Шаг 2: итоги вечеров, которые не ушли через notify. */
async function backfillResults(db: Db, nowMs: number, report: TickState): Promise<void> {
  const { data, error } = await db
    .from('evenings')
    .select(EVENING_COLUMNS)
    .eq('is_training', false)
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
      fail(report, 'cron_results', `итоги ${e.id}`, err, eveningDetail(e));
    }
  }
}

/** Уровни «Звезды вечера» для поста итогов голосования; подсчёт упал — без уровней (в лог). */
function starLevelsOf(
  history: ClubHistory | null,
  eveningId: string,
  guests: ReadonlySet<string>,
  nowMs: number,
): ReturnType<typeof eveningStarLevels> | undefined {
  if (!history) return undefined;
  try {
    return eveningStarLevels(history, eveningId, guests, nowMs);
  } catch (err) {
    console.error(`Уровни «Звезды вечера» ${eveningId} не посчитаны: ${describeError(err)}`);
    return undefined;
  }
}

/** Шаг 3: итоги голосования по вечерам, где оно закрылось. Без голосов — только отметка. */
async function postVotingResults(
  db: Db,
  s: SettingsRow & { group_chat_id: number | string },
  nowMs: number,
  report: TickState,
): Promise<void> {
  const { data, error } = await db
    .from('evenings')
    .select(EVENING_COLUMNS)
    .eq('is_training', false)
    .in('status', ['finished', 'settled'])
    .is('voting_posted_at', null)
    .lte('voting_closes_at', new Date(nowMs).toISOString())
    .gte('voting_closes_at', new Date(nowMs - BACKFILL_WINDOW_MS).toISOString())
    .order('voting_closes_at');
  if (error) throw new Error(`evenings: ${describeError(error)}`);
  const evenings = (data ?? []) as unknown as EveningRow[];
  if (evenings.length === 0) return;

  const { names, guests } = await loadPlayerNames(db);
  // Уровни «Звезды вечера» — по истории клуба (одна загрузка на шаг). Дополнение: история не
  // загрузилась — пост уходит со звёздами, но без «нового уровня» (ошибка в лог).
  let history: ClubHistory | null = null;
  try {
    history = await loadHistory(db, scoringConfig(s));
  } catch (err) {
    console.error(`Итоги голосования: история клуба не загрузилась — ${describeError(err)}`);
  }
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
        guests,
        starLevels: starLevelsOf(history, e.id, guests, nowMs),
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
      fail(report, 'cron_voting', `голосование ${e.id}`, err, eveningDetail(e));
    }
  }
}

/**
 * Шаг 3б: напоминание о голосовании за VOTING_REMINDER_HOURS часа до закрытия — один раз на закрытие
 * (voting_reminder_posted_at). Отметка без поста, если итоги ушли уже внутри окна, до закрытия
 * осталось мало, проголосовали все или голосовать некому (decideVotingReminder, turnoutDecision).
 * Застолбить — только если закрытие голосования то же, что прочитали (отмена finish и новое
 * завершение между чтением и отметкой сдвигают его, и отметку снимает триггер миграции 021).
 */
async function postVotingReminders(
  db: Db,
  s: SettingsRow & { group_chat_id: number | string },
  nowMs: number,
  report: TickState,
): Promise<void> {
  const nowIso = new Date(nowMs).toISOString();
  const { data, error } = await db
    .from('evenings')
    .select(EVENING_COLUMNS)
    .eq('is_training', false)
    .in('status', ['finished', 'settled'])
    .is('voting_reminder_posted_at', null)
    .gt('voting_closes_at', nowIso)
    .lte('voting_closes_at', new Date(nowMs + VOTING_REMINDER_WINDOW_MS).toISOString())
    .order('voting_closes_at');
  if (error) throw new Error(`evenings: ${describeError(error)}`);
  const statuses: EveningRow['status'][] = ['finished', 'settled'];
  for (const e of (data ?? []) as unknown as EveningRow[]) {
    try {
      const decision = decideVotingReminder(e, nowMs);
      if (decision === 'none' || !e.voting_closes_at) continue;
      if (decision === 'wait_results') {
        report.votingReminder[e.id] = 'wait_results';
        continue;
      }
      const sameClose = { voting_closes_at: e.voting_closes_at };
      const markOnly = async (why: ReminderMark): Promise<void> => {
        const claimed = await claimPost(
          db,
          e.id,
          'voting_reminder_posted_at',
          nowIso,
          statuses,
          {},
          sameClose,
        );
        report.votingReminder[e.id] = claimed ? why : 'already_posted';
      };
      if (decision !== 'post') {
        await markOnly(decision);
        continue;
      }

      const [joins, players, votes] = await Promise.all([
        fetchAll<{ payload: { playerId?: unknown } }>((from, to) =>
          db
            .from('evening_events')
            .select('payload')
            .eq('evening_id', e.id)
            .eq('type', 'join')
            .is('voided_at', null)
            .order('id')
            .range(from, to),
        ),
        fetchAll<TurnoutPlayerRow>((from, to) =>
          db.from('players').select('id, tg_id, is_active').order('id').range(from, to),
        ),
        fetchAll<{ voter_id: string }>((from, to) =>
          db
            .from('votes')
            .select('voter_id')
            .eq('evening_id', e.id)
            .order('voter_id')
            .order('category')
            .range(from, to),
        ),
      ]);
      const participants = joins
        .map((j) => j.payload.playerId)
        .filter((id): id is string => typeof id === 'string');
      const turnout = votingTurnout(
        participants,
        players,
        votes.map((v) => v.voter_id),
      );
      const outcome = turnoutDecision(turnout);
      if (outcome !== 'post') {
        await markOnly(outcome);
        continue;
      }
      report.votingReminder[e.id] = await publishOnce(
        db,
        e.id,
        'voting_reminder_posted_at',
        s.group_chat_id,
        votingReminderPost({
          eveningId: e.id,
          scheduledAt: e.scheduled_at,
          votingClosesAt: e.voting_closes_at,
          voted: turnout.voted,
          eligible: turnout.eligible,
          botUsername: s.bot_username,
        }),
        nowMs,
        statuses,
        {},
        sameClose,
      );
    } catch (err) {
      fail(report, 'cron_voting_reminder', `напоминание ${e.id}`, err, eveningDetail(e));
    }
  }
}

/**
 * Шаг 7: пост «Итоги сезона» — прошлый квартал, с 12:00 МСК первого дня нового квартала и ещё две
 * недели (seasonPostDue), один раз на сезон (season_posts). Сбой Telegram снимает отметку — пост уйдёт
 * следующим тиком; вечер сезона ещё идёт — ждём (wait_live).
 */
async function postSeasonPost(
  db: Db,
  s: SettingsRow & { group_chat_id: number | string },
  nowMs: number,
  report: TickState,
): Promise<void> {
  const key = seasonPostDue(nowMs);
  if (!key) return;
  try {
    report.season[key] = await postSeasonResults(db, s, key, nowMs);
  } catch (err) {
    fail(report, 'cron_season', `итоги сезона ${key}`, err, `сезон ${key}`);
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
  report: TickState,
): Promise<void> {
  const { data, error } = await db
    .from('evenings')
    .select(EVENING_COLUMNS)
    .eq('is_training', false)
    .in('status', ['announced', 'cancelled'])
    .not('announce_posted_at', 'is', null)
    .gte('scheduled_at', new Date(nowMs - 7 * 24 * HOUR_MS).toISOString())
    .order('scheduled_at');
  if (error) throw new Error(`evenings: ${describeError(error)}`);
  for (const e of (data ?? []) as unknown as EveningRow[]) {
    try {
      const result = await postAnnounceChange(db, e, nowMs, s);
      if (result.outcome !== 'no_changes') {
        // «posted:moved:place_set» — какой из постов о правке времени или места ушёл.
        report.changes[e.id] = result.change
          ? [result.outcome, result.change, result.move].filter(Boolean).join(':')
          : result.outcome;
      }
    } catch (err) {
      fail(report, 'cron_changes', `правка вечера ${e.id}`, err, eveningDetail(e));
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
    // Секрет не проверить — значит, база или окружение функции сломаны и тик не идёт вовсе.
    // Алерт уходит до проверки секрета: клиента или журнала может не быть (база лежит), и тогда
    // повторы сдерживает только запасной троттлинг в памяти (alerts.ts, FALLBACK_WINDOW_MS) —
    // посторонние запросы с любым x-cron-secret не превратятся в поток сообщений админу.
    let db: Db | null = null;
    try {
      db = adminClient();
    } catch {
      db = null;
    }
    await alertAdmin(db, 'cron_crash', 'не удалось проверить x-cron-secret', err);
    return errorResponse(500, 'not_configured', 'Не удалось проверить x-cron-secret');
  }
  if (!authorized) return errorResponse(401, 'bad_secret', 'Неверный x-cron-secret');

  const nowMs = Date.now();
  const report: TickState = {
    now: new Date(nowMs).toISOString(),
    group: false,
    nextGameAt: null,
    createdEvening: null,
    announced: {},
    gameday: {},
    results: {},
    voting: {},
    votingReminder: {},
    season: {},
    changes: {},
    errors: [],
    failures: [],
  };

  let db: Db | null = null;
  try {
    const client = adminClient();
    db = client;
    const s = await loadSettings(client);
    report.group = hasGroup(s);

    // Шаги независимы: сбой одного (например, Telegram недоступен) не отменяет остальные.
    const step = async (name: string, kind: AlertKind, fn: () => Promise<void>): Promise<void> => {
      try {
        await fn();
      } catch (err) {
        fail(report, kind, name, err);
      }
    };
    await step('вечер по расписанию', 'cron_schedule', () =>
      ensureUpcomingEvening(client, s, nowMs, report),
    );
    if (hasGroup(s)) {
      const finaleOf = finaleResolver(client, s, nowMs);
      // Сначала правки уже объявленных вечеров, потом новые анонсы: свежий анонс и так несёт
      // актуальные данные, а его снимок пишется вместе с отметкой.
      await step('правки вечеров', 'cron_changes', () =>
        postAnnounceChanges(client, s, nowMs, report),
      );
      await step('анонсы', 'cron_announce', () =>
        postAnnouncements(client, s, nowMs, report, finaleOf),
      );
      // После анонсов: анонс, ушедший в этот тик, гасит пост дня игры (decideGamedayPost).
      await step('пост в день игры', 'cron_gameday', () =>
        postGamedayPosts(client, s, nowMs, report, finaleOf),
      );
      await step('итоги вечеров', 'cron_results', () => backfillResults(client, nowMs, report));
      // После итогов вечеров: последний вечер сезона уходит в группу раньше итогов сезона.
      await step('итоги сезона', 'cron_season', () => postSeasonPost(client, s, nowMs, report));
      await step('итоги голосования', 'cron_voting', () =>
        postVotingResults(client, s, nowMs, report),
      );
      // После итогов вечеров: итоги, добитые в этот тик, уже видны как свежие (decideVotingReminder).
      await step('напоминание о голосовании', 'cron_voting_reminder', () =>
        postVotingReminders(client, s, nowMs, report),
      );
    }
  } catch (err) {
    report.errors.push(describeError(err));
    report.failures.push({ kind: 'cron_crash', detail: '', err });
  }

  const { failures, ...body } = report;
  if (body.errors.length > 0) console.error(`cron-tick: ${body.errors.join(' | ')}`);
  await alertFailures(db, failures);
  await markTick(db, body.errors.length === 0);
  const response: TickReport = body;
  return json(response);
});
