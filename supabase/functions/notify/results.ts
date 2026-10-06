// Сбор итога вечера из БД доменными функциями и публикация постов с защитой от дублей.
// Общий код notify (банкир завершил вечер) и cron-tick (добивка неотправленных итогов).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  computeAchievements,
  computeMoney,
  diffAchievements,
  replay,
  scorePrediction,
  seasonKey,
  summarize,
  voteResults,
  type Achievement,
  type EveningEvent,
  type EveningSummary,
  type EventPayload,
  type EventType,
  type PlayerId,
  type ScoredPrediction,
  type ScoringConfig,
  type StarAward,
  type TournamentFormat,
  type Vote,
  type VoteCategory,
} from '../_shared/domain/index.ts';
import { resultsPost, type Post } from '../_shared/messages.ts';
import { sendMessage } from '../_shared/telegram.ts';
import { describeError } from '../_shared/admin.ts';

// ---------------------------------------------------------------------------
// Строки БД (только нужные колонки)
// ---------------------------------------------------------------------------

export interface SettingsRow {
  group_chat_id: number | string | null;
  bot_username: string | null;
  game_weekday: number;
  game_time: string; // 'HH:MM:SS', время Москвы
  announce_hours_before: number;
  default_location: string | null;
  default_format_id: string | null;
  season_best_n: number;
  ko_points: number | string;
  win_bonus: number | string;
}

export interface EveningRow {
  id: string;
  scheduled_at: string;
  location: string | null;
  note: string | null;
  status: 'announced' | 'live' | 'finished' | 'settled' | 'cancelled';
  banker_id: string | null;
  format: TournamentFormat;
  finished_at: string | null;
  voting_closes_at: string | null;
  announce_posted_at: string | null;
  results_posted_at: string | null;
  voting_posted_at: string | null;
}

// Одной строкой-литералом: из конкатенации supabase-js не выводит тип строк select.
export const EVENING_COLUMNS =
  'id, scheduled_at, location, note, status, banker_id, format, finished_at, voting_closes_at, announce_posted_at, results_posted_at, voting_posted_at';

interface PlayerRow {
  id: string;
  display_name: string;
  is_guest: boolean;
}

interface EventRow {
  id: number | string; // bigserial: PostgREST отдаёт числом, но не полагаемся
  evening_id: string;
  type: EventType;
  payload: EventPayload;
  at: string;
  voided_at: string | null;
}

interface PredictionRow {
  evening_id: string;
  player_id: string;
  winner_id: string | null;
  first_out_id: string | null;
}

export interface VoteRow {
  evening_id: string;
  voter_id: string;
  category: VoteCategory;
  nominee_id: string;
}

type Db = SupabaseClient;

/** PostgREST отдаёт не больше max_rows (1000) строк за запрос — читаем страницами. */
async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(describeError(error));
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < pageSize) return rows;
  }
}

export async function loadSettings(db: Db): Promise<SettingsRow> {
  const { data, error } = await db.from('settings').select('*').eq('id', 1).single();
  if (error) throw new Error(`settings: ${describeError(error)}`);
  return data as SettingsRow;
}

export function scoringConfig(s: SettingsRow): ScoringConfig {
  return { koPoints: Number(s.ko_points), winBonus: Number(s.win_bonus) };
}

export async function loadPlayerNames(db: Db): Promise<{
  names: Record<PlayerId, string>;
  guests: Set<PlayerId>;
}> {
  const rows = await fetchAll<PlayerRow>((from, to) =>
    db.from('players').select('id, display_name, is_guest').order('id').range(from, to),
  );
  const names: Record<PlayerId, string> = {};
  const guests = new Set<PlayerId>();
  for (const p of rows) {
    names[p.id] = p.display_name;
    if (p.is_guest) guests.add(p.id);
  }
  return { names, guests };
}

function toDomainEvent(row: EventRow): EveningEvent {
  return {
    id: Number(row.id),
    type: row.type,
    payload: row.payload,
    at: row.at,
    voided: row.voided_at !== null,
  };
}

// ---------------------------------------------------------------------------
// История клуба
// ---------------------------------------------------------------------------

export interface ClubHistory {
  evenings: Map<string, EveningRow>; // завершённые (finished/settled)
  events: Map<string, EveningEvent[]>;
  summaries: EveningSummary[];
  predictions: PredictionRow[];
  votes: VoteRow[];
}

/** Все завершённые вечера с журналами и итогами. Вечер, чей журнал не завершён, пропускаем. */
export async function loadHistory(db: Db, cfg: ScoringConfig): Promise<ClubHistory> {
  const eveningRows = await fetchAll<EveningRow>((from, to) =>
    db
      .from('evenings')
      .select(EVENING_COLUMNS)
      .in('status', ['finished', 'settled'])
      .order('scheduled_at')
      .order('id')
      .range(from, to),
  );
  const evenings = new Map(eveningRows.map((e) => [e.id, e]));

  // Все журналы разом: вечеров в клубе десятки, событий — тысячи; фильтр по списку id
  // упёрся бы в длину URL раньше, чем объём станет проблемой.
  const eventRows = await fetchAll<EventRow>((from, to) =>
    db
      .from('evening_events')
      .select('id, evening_id, type, payload, at, voided_at')
      .order('id')
      .range(from, to),
  );
  const events = new Map<string, EveningEvent[]>();
  for (const row of eventRows) {
    if (!evenings.has(row.evening_id)) continue;
    const list = events.get(row.evening_id) ?? [];
    list.push(toDomainEvent(row));
    events.set(row.evening_id, list);
  }

  const summaries: EveningSummary[] = [];
  for (const e of eveningRows) {
    try {
      summaries.push(summarize(e.id, e.scheduled_at, e.format, events.get(e.id) ?? [], cfg));
    } catch (error) {
      // Статус finished при незавершённом журнале — рассинхрон, его чинит админ; статистика
      // остальных вечеров от этого страдать не должна.
      console.warn(`Вечер ${e.id} пропущен в истории: ${describeError(error)}`);
    }
  }

  const ids = new Set(evenings.keys());
  const predictions = (
    await fetchAll<PredictionRow>((from, to) =>
      db
        .from('predictions')
        .select('evening_id, player_id, winner_id, first_out_id')
        .order('evening_id')
        .order('player_id')
        .range(from, to),
    )
  ).filter((p) => ids.has(p.evening_id));

  const votes = (
    await fetchAll<VoteRow>((from, to) =>
      db
        .from('votes')
        .select('evening_id, voter_id, category, nominee_id')
        .order('evening_id')
        .order('voter_id')
        .order('category')
        .range(from, to),
    )
  ).filter((v) => ids.has(v.evening_id));

  return { evenings, events, summaries, predictions, votes };
}

function scoredPredictions(
  history: ClubHistory,
  include: (eveningId: string) => boolean,
): ScoredPrediction[] {
  const byId = new Map(history.summaries.map((s) => [s.eveningId, s]));
  const out: ScoredPrediction[] = [];
  for (const p of history.predictions) {
    const s = byId.get(p.evening_id);
    if (!s || !include(p.evening_id)) continue;
    const score = scorePrediction({ winnerId: p.winner_id, firstOutId: p.first_out_id }, s);
    out.push({ eveningId: p.evening_id, playerId: p.player_id, ...score });
  }
  return out;
}

export function votesOf(rows: readonly VoteRow[]): Vote[] {
  return rows.map((v) => ({ voterId: v.voter_id, category: v.category, nomineeId: v.nominee_id }));
}

/** «Звёзды» — только по закрытым голосованиям: пока голосование идёт, лидер может смениться. */
function starAwards(
  history: ClubHistory,
  nowMs: number,
  include: (eveningId: string) => boolean,
): StarAward[] {
  const awards: StarAward[] = [];
  for (const [id, e] of history.evenings) {
    if (!include(id) || !e.voting_closes_at || Date.parse(e.voting_closes_at) > nowMs) continue;
    const results = voteResults(votesOf(history.votes.filter((v) => v.evening_id === id)));
    for (const [category, r] of Object.entries(results) as [
      VoteCategory,
      { winners: PlayerId[] },
    ][]) {
      if (r.winners.length > 0) awards.push({ eveningId: id, category, winners: r.winners });
    }
  }
  return awards;
}

/**
 * Новые ачивки, которые принёс вечер: разница между историей без него и с ним.
 * «Текущий сезон» до вечера — сезон последнего из остальных вечеров, после — сезон «сейчас»:
 * так сезонные ачивки (чемпион, ребай-король, железный стул) прошедшего квартала попадают
 * в пост первого вечера нового квартала, а не теряются (по времени их никто не объявляет).
 */
export function newAchievementsFor(
  history: ClubHistory,
  eveningId: string,
  guests: ReadonlySet<PlayerId>,
  bestN: number,
  nowMs: number,
): Achievement[] {
  const nowSeason = seasonKey(new Date(nowMs).toISOString());
  const others = history.summaries.filter((s) => s.eveningId !== eveningId);
  const lastOther = others.reduce<EveningSummary | null>(
    (last, s) => (!last || Date.parse(s.date) >= Date.parse(last.date) ? s : last),
    null,
  );
  const notThis = (id: string): boolean => id !== eveningId;
  const all = (): boolean => true;

  const before = computeAchievements({
    summaries: others,
    excluded: guests,
    predictions: scoredPredictions(history, notThis),
    stars: starAwards(history, nowMs, notThis),
    bestN,
    currentSeasonKey:
      lastOther && lastOther.seasonKey < nowSeason ? lastOther.seasonKey : nowSeason,
  });
  const after = computeAchievements({
    summaries: history.summaries,
    excluded: guests,
    predictions: scoredPredictions(history, all),
    // Звёзды самого вечера не берём ни «до», ни «после»: их объявляет пост итогов голосования.
    stars: starAwards(history, nowMs, notThis),
    bestN,
    currentSeasonKey: nowSeason,
  });
  return diffAchievements(before, after);
}

// ---------------------------------------------------------------------------
// Пост итогов
// ---------------------------------------------------------------------------

export class NotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotReadyError';
  }
}

/** Текст итогов вечера. Бросает NotReadyError, если вечер не завершён по журналу. */
export async function buildResultsPost(
  db: Db,
  evening: EveningRow,
  settings: SettingsRow,
  nowMs: number,
): Promise<Post> {
  const cfg = scoringConfig(settings);
  const [history, { names, guests }] = await Promise.all([
    loadHistory(db, cfg),
    loadPlayerNames(db),
  ]);

  const summary = history.summaries.find((s) => s.eveningId === evening.id);
  const events = history.events.get(evening.id) ?? [];
  if (!summary) throw new NotReadyError('Вечер не завершён по журналу событий');

  // Деньги по местам считаем на момент последнего события: после finish таймер стоит.
  const lastMs = events.reduce((m, e) => Math.max(m, Date.parse(e.at) || 0), 0);
  const state = replay(evening.format, events, lastMs);
  const money = computeMoney(evening.format, state);

  return resultsPost({
    eveningId: evening.id,
    scheduledAt: evening.scheduled_at,
    location: evening.location,
    names,
    places: summary.places,
    money,
    kos: summary.kos,
    totalEntries: state.totalEntries,
    rebuysTotal: Object.values(summary.rebuys).reduce((a, b) => a + b, 0),
    prizePoolRub: state.prizePoolRub,
    newAchievements: newAchievementsFor(history, evening.id, guests, settings.season_best_n, nowMs),
    votingClosesAt: evening.voting_closes_at,
    nowMs,
    botUsername: settings.bot_username,
  });
}

// ---------------------------------------------------------------------------
// Защита от дублей
// ---------------------------------------------------------------------------
// Сначала «застолбить» пост (проставить *_posted_at, только если там null), потом отправить,
// при ошибке отправки — снять отметку. Так notify банкира и cron-tick, пришедшие одновременно,
// не напишут в группу дважды: второй увидит, что строка уже занята. Цена — при падении функции
// между отметкой и отправкой пост потеряется; дубль в группе хуже.

export type PostColumn = 'announce_posted_at' | 'results_posted_at' | 'voting_posted_at';

/** statuses — дополнительно требовать статус вечера (итоги — только у завершённого). */
export async function claimPost(
  db: Db,
  eveningId: string,
  column: PostColumn,
  atIso: string,
  statuses?: readonly EveningRow['status'][],
): Promise<boolean> {
  let query = db
    .from('evenings')
    .update({ [column]: atIso })
    .eq('id', eveningId)
    .is(column, null);
  if (statuses) query = query.in('status', [...statuses]);
  const { data, error } = await query.select('id');
  if (error) throw new Error(`claim ${column}: ${describeError(error)}`);
  return (data ?? []).length > 0;
}

export async function releasePost(
  db: Db,
  eveningId: string,
  column: PostColumn,
  atIso: string,
): Promise<void> {
  const { error } = await db
    .from('evenings')
    .update({ [column]: null })
    .eq('id', eveningId)
    .eq(column, atIso);
  if (error) console.error(`release ${column} ${eveningId}: ${describeError(error)}`);
}

export type PostOutcome = 'posted' | 'already_posted' | 'no_group';

/** Застолбить → отправить → при ошибке снять отметку и пробросить ошибку. */
export async function publishOnce(
  db: Db,
  eveningId: string,
  column: PostColumn,
  chatId: number | string,
  post: Post,
  nowMs: number,
  statuses?: readonly EveningRow['status'][],
): Promise<PostOutcome> {
  const atIso = new Date(nowMs).toISOString();
  if (!(await claimPost(db, eveningId, column, atIso, statuses))) return 'already_posted';
  try {
    await sendMessage(chatId, post.text, { buttons: post.buttons });
    return 'posted';
  } catch (error) {
    await releasePost(db, eveningId, column, atIso);
    throw error;
  }
}

/** Итоги вечера в группу. Без group_chat_id ничего не делаем и не отмечаем — добьёт cron-tick. */
export async function postEveningResults(
  db: Db,
  evening: EveningRow,
  nowMs: number,
): Promise<PostOutcome> {
  if (evening.results_posted_at) return 'already_posted';
  const settings = await loadSettings(db);
  if (settings.group_chat_id === null || settings.group_chat_id === '') return 'no_group';
  const post = await buildResultsPost(db, evening, settings, nowMs);
  return publishOnce(db, evening.id, 'results_posted_at', settings.group_chat_id, post, nowMs, [
    'finished',
    'settled',
  ]);
}
