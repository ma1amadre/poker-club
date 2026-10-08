// Сбор итога вечера из БД доменными функциями и публикация постов с защитой от дублей.
// Общий код notify (банкир завершил вечер) и cron-tick (добивка неотправленных итогов).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2'; // версия — как в _shared/admin.ts
import {
  computeAchievements,
  computeMoney,
  diffAchievements,
  eveningAllIns,
  eveningClubNews,
  eveningStakes,
  eveningStory,
  hasClubNews,
  replay,
  scorePrediction,
  seasonKey,
  spectatesEvening,
  starAchievements,
  starAwards as eveningStarAwards,
  summarize,
  voteResults,
  type Achievement,
  type EveningClubNews,
  type EveningEvent,
  type EveningStakes,
  type EveningSummary,
  type EventPayload,
  type EventType,
  type PlayerId,
  type ScoredPrediction,
  type ScoringConfig,
  type SeasonBestN,
  type StarAward,
  type StoryItem,
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
  /** За сколько часов до начала пост в день игры (миграция 014, 1–48). */
  gameday_hours_before: number;
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
  /** Пост в день игры ушёл или не понадобился (миграция 014). */
  gameday_posted_at: string | null;
  results_posted_at: string | null;
  voting_posted_at: string | null;
  /** Напоминание о голосовании ушло или не понадобилось (миграция 021). */
  voting_reminder_posted_at: string | null;
  /** > 0 — итог уже публиковался и устарел (отмена finish или правка): пост «Исправленные итоги». */
  results_revision: number;
  /** Что группа знает о вечере из постов бота (миграция 008, _shared/announce.ts). */
  announce_snapshot: unknown;
  /** Причина отмены для поста в группу (миграция 010); заметка вечера ей больше не служит. */
  cancel_reason: string | null;
  /** Снимок правил очков {koPoints, winBonus} — есть у finished/settled (миграция 013). */
  scoring: unknown;
  /**
   * Тренировочный вечер (миграция 023): не попадает в историю и ни в один пост бота — его не выбирают
   * шаги cron-tick, не застолбит claimPost, notify отвечает 'training'.
   */
  is_training: boolean;
}

// Одной строкой-литералом: из конкатенации supabase-js не выводит тип строк select.
export const EVENING_COLUMNS =
  'id, scheduled_at, location, note, status, banker_id, format, finished_at, voting_closes_at, announce_posted_at, gameday_posted_at, results_posted_at, voting_posted_at, voting_reminder_posted_at, results_revision, announce_snapshot, cancel_reason, scoring, is_training';

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
export async function fetchAll<T>(
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

/** Текущие правила очков клуба — для вечеров без снимка evenings.scoring (до миграции 013). */
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
  /** Замороженные «лучшие N» закрытых сезонов (season_rules, миграция 013). */
  bestNBySeason: SeasonBestN;
}

/**
 * Все завершённые вечера с журналами и итогами. Вечер, чей журнал не завершён, пропускаем.
 * Очки вечера — по его снимку правил (evenings.scoring), cfg — только для вечеров без снимка.
 * Тренировки (миграция 023) в историю не входят: ни в итоги, ни в ачивки, ни в «Жизнь клуба».
 */
export async function loadHistory(db: Db, cfg: ScoringConfig): Promise<ClubHistory> {
  const eveningRows = await fetchAll<EveningRow>((from, to) =>
    db
      .from('evenings')
      .select(EVENING_COLUMNS)
      .in('status', ['finished', 'settled'])
      .eq('is_training', false)
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
      summaries.push(
        summarize(e.id, e.scheduled_at, e.format, events.get(e.id) ?? [], cfg, e.scoring),
      );
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

  const { data: rules, error: rulesError } = await db
    .from('season_rules')
    .select('season_key, best_n');
  if (rulesError) throw new Error(`season_rules: ${describeError(rulesError)}`);
  const bestNBySeason: Record<string, number> = {};
  for (const r of (rules ?? []) as { season_key: string; best_n: number }[]) {
    bestNBySeason[r.season_key] = r.best_n;
  }

  return { evenings, events, summaries, predictions, votes, bestNBySeason };
}

export function scoredPredictions(
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

/**
 * «Звёзды вечера» — только по закрытым голосованиям: пока голосование идёт, лидер может смениться.
 * Кому звезда — правило домена (starAwards: единственный лидер номинации от 2 голосов).
 */
export function starAwards(
  history: ClubHistory,
  nowMs: number,
  include: (eveningId: string) => boolean = () => true,
): StarAward[] {
  const awards: StarAward[] = [];
  for (const [id, e] of history.evenings) {
    if (!include(id) || !e.voting_closes_at || Date.parse(e.voting_closes_at) > nowMs) continue;
    const results = voteResults(votesOf(history.votes.filter((v) => v.evening_id === id)));
    awards.push(...eveningStarAwards(id, results));
  }
  return awards;
}

/**
 * Уровень «Звезды вечера» у получивших звезду в вечере eveningId (после его голосования) — для поста
 * итогов голосования: «новый уровень». Голосование вечера должно быть уже закрыто к nowMs.
 */
export function eveningStarLevels(
  history: ClubHistory,
  eveningId: string,
  guests: ReadonlySet<PlayerId>,
  nowMs: number,
): Record<PlayerId, { level: number; first: boolean }> {
  const out: Record<PlayerId, { level: number; first: boolean }> = {};
  const rows = starAchievements({
    summaries: history.summaries,
    excluded: guests,
    stars: starAwards(history, nowMs),
  });
  for (const a of rows)
    if (a.eveningId === eveningId) out[a.playerId] = { level: a.level, first: a.first };
  return out;
}

/**
 * Новые ачивки, которые принёс вечер: разница между историей без него и с ним — строки самого вечера
 * (с уровнем и «впервые на уровне») и сезонные.
 * «Текущий сезон» до вечера — сезон последнего из остальных вечеров, после — сезон «сейчас»:
 * так сезонные ачивки (чемпион, ребай-король, железный стул) прошедшего квартала попадают
 * в пост первого вечера нового квартала, а не теряются (по времени их никто не объявляет).
 * Строки других вечеров отсеиваются: исправленный итог старого вечера сдвигает пороги в
 * последующих («Заклятый враг» берёт уровень вечером раньше или позже), но это не новости этого поста.
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
    bestNBySeason: history.bestNBySeason,
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
    bestNBySeason: history.bestNBySeason,
    currentSeasonKey: nowSeason,
  });
  return diffAchievements(before, after).filter(
    (a) => a.eveningId === eveningId || a.seasonKey !== null,
  );
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
  corrected = false,
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
  const clubNews = clubNewsOf(history, evening.id, guests, settings.season_best_n);
  const story = storyOf(history, evening, guests, settings.season_best_n);
  const newAchievements = newAchievementsFor(
    history,
    evening.id,
    guests,
    settings.season_best_n,
    nowMs,
  );
  const postedSeasons = await postedSeasonsOf(db, newAchievements);

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
    newAchievements,
    votingClosesAt: evening.voting_closes_at,
    nowMs,
    botUsername: settings.bot_username,
    corrected: corrected || evening.results_revision > 0,
    clubNews,
    story,
    postedSeasons,
  });
}

/**
 * Сезоны сезонных ачивок вечера (их приносит первый вечер нового квартала), чей пост «Итоги сезона»
 * уже в группе (season_posts, миграция 025): пост вечера их не повторяет. Не прочиталось — как будто
 * поста не было (ошибка в лог): лучше повтор чемпиона, чем застрявшие итоги вечера.
 */
async function postedSeasonsOf(db: Db, list: readonly Achievement[]): Promise<Set<string>> {
  const keys = [...new Set(list.map((a) => a.seasonKey).filter((k): k is string => k !== null))];
  if (keys.length === 0) return new Set();
  try {
    return await loadPostedSeasons(db, keys);
  } catch (error) {
    console.error(`Итоги вечера: ${describeError(error)}`);
    return new Set();
  }
}

/** Сезоны из keys, чей пост «Итоги сезона» уже в группе (строки season_posts, миграция 025). */
export async function loadPostedSeasons(db: Db, keys: readonly string[]): Promise<Set<string>> {
  const { data, error } = await db
    .from('season_posts')
    .select('season_key')
    .in('season_key', [...keys]);
  if (error) throw new Error(`season_posts: ${describeError(error)}`);
  return new Set(((data ?? []) as { season_key: string }[]).map((r) => r.season_key));
}

/**
 * «Сюжет вечера» для поста итогов (eveningStory с forPost: без рекордов и лидера сезона — они в
 * «Жизни клуба» — и без «Камбэка», который уже в «Новых ачивках»). Олл-ины — из журнала вечера,
 * шансы — движок домена: до флопа полный Монте-Карло только у раздач, где быстрая прикидка не
 * исключает «победу с N %» (allInSwing), — лимит CPU функции не под угрозой. Как и «Жизнь клуба» —
 * дополнение: подсчёт упал — пост уходит без блока (ошибка в лог).
 */
export function storyOf(
  history: ClubHistory,
  evening: Pick<EveningRow, 'id' | 'format'>,
  guests: ReadonlySet<PlayerId>,
  bestN: number,
): StoryItem[] {
  try {
    const summary = history.summaries.find((s) => s.eveningId === evening.id);
    if (!summary) return [];
    return eveningStory({
      summary,
      allIns: eveningAllIns(evening.format, history.events.get(evening.id) ?? []),
      excluded: guests,
      club: {
        summaries: history.summaries,
        excluded: guests,
        bestN,
        bestNBySeason: history.bestNBySeason,
      },
      forPost: true,
    });
  } catch (error) {
    console.error(`Сюжет вечера ${evening.id} не посчитан: ${describeError(error)}`);
    return [];
  }
}

/** Игрок для «На кону»: из справочника players. */
export interface StakesPlayerRow {
  id: string;
  is_active: boolean;
  is_guest: boolean;
  /** Болельщик (миграция 024). */
  is_spectator: boolean | null;
}

/**
 * «На кону» объявленного вечера для поста дня игры: кто может прийти (постоянные игроки, кроме
 * ответивших «не иду» и болельщиков на этот вечер; выключенный, но ответивший «иду» или «под
 * вопросом», — тоже), шаги к ачивкам и рекордам и расклад сезона (eveningStakes). `seated` — кто уже
 * за столом (seatedIds журнала): посаженный болельщик на этот вечер игрок. Дополнение: подсчёт упал —
 * пост без этих строк.
 */
export function stakesOf(
  history: ClubHistory,
  evening: Pick<EveningRow, 'id' | 'scheduled_at' | 'format'>,
  players: readonly StakesPlayerRow[],
  rsvps: readonly { player_id: string; status: string }[],
  bestN: number,
  seated: ReadonlySet<string> = new Set(),
  nowMs: number = Date.now(),
): EveningStakes | null {
  try {
    const guests = new Set(players.filter((p) => p.is_guest).map((p) => p.id));
    const rsvpOf = new Map(rsvps.map((r) => [r.player_id, r.status]));
    const answer = (id: string): 'yes' | 'maybe' | 'no' | null => {
      const status = rsvpOf.get(id);
      return status === 'yes' || status === 'maybe' || status === 'no' ? status : null;
    };
    return eveningStakes(
      {
        summaries: history.summaries,
        excluded: guests,
        predictions: scoredPredictions(history, () => true),
        // Звёзды — по закрытым к посту голосованиям: шаг к уровню «Звезды вечера».
        stars: starAwards(history, nowMs),
        bestN,
        bestNBySeason: history.bestNBySeason,
      },
      {
        eveningDate: evening.scheduled_at,
        players: players
          .filter((p) => {
            const a = answer(p.id);
            return !p.is_guest && (p.is_active || a === 'yes' || a === 'maybe');
          })
          .map((p) => ({
            playerId: p.id,
            rsvp: answer(p.id),
            spectator: spectatesEvening({
              spectator: p.is_spectator,
              rsvp: answer(p.id),
              seated: seated.has(p.id),
            }),
          })),
        buyInRub: evening.format.buyInRub,
      },
    );
  } catch (error) {
    console.error(`«На кону» вечера ${evening.id} не посчитано: ${describeError(error)}`);
    return null;
  }
}

/**
 * «Жизнь клуба» вечера для поста итогов: угаданные прогнозы, рекорды, звания, сдвиг в сезоне —
 * из уже загруженной истории (loadHistory). Блок — дополнение: если подсчёт упал, пост итогов
 * уходит без него (ошибка — в лог), а не застревает.
 */
export function clubNewsOf(
  history: ClubHistory,
  eveningId: string,
  guests: ReadonlySet<PlayerId>,
  bestN: number,
): EveningClubNews | null {
  try {
    const news = eveningClubNews(
      {
        summaries: history.summaries,
        excluded: guests,
        predictions: history.predictions.map((p) => ({
          eveningId: p.evening_id,
          playerId: p.player_id,
          winnerId: p.winner_id,
          firstOutId: p.first_out_id,
        })),
        bestN,
        bestNBySeason: history.bestNBySeason,
      },
      eveningId,
    );
    return hasClubNews(news) ? news : null;
  } catch (error) {
    console.error(`«Жизнь клуба» вечера ${eveningId} не посчитана: ${describeError(error)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Защита от дублей
// ---------------------------------------------------------------------------
// Сначала «застолбить» пост (проставить *_posted_at, только если там null), потом отправить,
// при ошибке отправки — снять отметку. Так notify банкира и cron-tick, пришедшие одновременно,
// не напишут в группу дважды: второй увидит, что строка уже занята. Цена — при падении функции
// между отметкой и отправкой пост потеряется; дубль в группе хуже.

export type PostColumn =
  | 'announce_posted_at'
  | 'gameday_posted_at'
  | 'results_posted_at'
  | 'voting_posted_at'
  | 'voting_reminder_posted_at';

/**
 * statuses — дополнительно требовать статус вечера (итоги — только у завершённого).
 * extra — поля, которые пишутся вместе с отметкой (анонс запоминает снимок announce_snapshot).
 * match — застолбить, только если поля вечера всё ещё равны прочитанным (пост дня игры сверяет
 * scheduled_at: перенос между чтением и отметкой не должен уйти в группу старым временем).
 */
export async function claimPost(
  db: Db,
  eveningId: string,
  column: PostColumn,
  atIso: string,
  statuses?: readonly EveningRow['status'][],
  extra: Record<string, unknown> = {},
  match: Record<string, string> = {},
): Promise<boolean> {
  // Тренировку не застолбит ни один пост (миграция 023) — страховка к фильтрам шагов cron-tick.
  let query = db
    .from('evenings')
    .update({ ...extra, [column]: atIso })
    .eq('id', eveningId)
    .eq('is_training', false)
    .is(column, null);
  if (statuses) query = query.in('status', [...statuses]);
  for (const [key, value] of Object.entries(match)) query = query.eq(key, value);
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

/**
 * not_announced — анонс вечера в группу ещё не уходил: о правке писать не нужно (миграция 008).
 * training — тренировочный вечер: в группу о нём ничего не пишем (миграция 023).
 */
export type PostOutcome =
  'posted' | 'already_posted' | 'no_group' | 'no_changes' | 'not_announced' | 'training';

/** Застолбить → отправить → при ошибке снять отметку и пробросить ошибку. */
export async function publishOnce(
  db: Db,
  eveningId: string,
  column: PostColumn,
  chatId: number | string,
  post: Post,
  nowMs: number,
  statuses?: readonly EveningRow['status'][],
  extra: Record<string, unknown> = {},
  match: Record<string, string> = {},
): Promise<PostOutcome> {
  const atIso = new Date(nowMs).toISOString();
  if (!(await claimPost(db, eveningId, column, atIso, statuses, extra, match))) {
    return 'already_posted';
  }
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
  if (evening.is_training) return 'training';
  if (evening.results_posted_at) return 'already_posted';
  const settings = await loadSettings(db);
  if (settings.group_chat_id === null || settings.group_chat_id === '') return 'no_group';
  const post = await buildResultsPost(db, evening, settings, nowMs);
  return publishOnce(db, evening.id, 'results_posted_at', settings.group_chat_id, post, nowMs, [
    'finished',
    'settled',
  ]);
}

/**
 * Исправленный итог закрытого вечера (админ поправил журнал, не возвращая вечер в игру).
 * Публикуем, только если после прошлого поста итогов журнал менялся (кроме платежей — на итог они
 * не влияют), иначе 'no_changes'. Защита от дублей — тот же приём «застолбить → отправить»:
 * results_posted_at переставляется на новое время, только если он ещё равен прочитанному.
 */
export async function postCorrectedResults(
  db: Db,
  evening: EveningRow,
  nowMs: number,
): Promise<PostOutcome> {
  if (evening.is_training) return 'training';
  const settings = await loadSettings(db);
  if (settings.group_chat_id === null || settings.group_chat_id === '') return 'no_group';
  // Итог ещё не публиковался — это обычный пост итогов, а не поправка.
  if (!evening.results_posted_at) return postEveningResults(db, evening, nowMs);

  const since = evening.results_posted_at;
  const { data: changed, error } = await db
    .from('evening_events')
    .select('id')
    .eq('evening_id', evening.id)
    // Платежи и показ олл-ина на итог не влияют.
    .not('type', 'in', '(payment,showdown,showdown_close)')
    .or(`at.gt."${since}",voided_at.gt."${since}"`)
    .limit(1);
  if (error) throw new Error(`evening_events: ${describeError(error)}`);
  if ((changed ?? []).length === 0) return 'no_changes';

  const post = await buildResultsPost(db, evening, settings, nowMs, true);
  const atIso = new Date(nowMs).toISOString();
  const { data: claimed, error: claimError } = await db
    .from('evenings')
    .update({ results_posted_at: atIso, results_revision: evening.results_revision + 1 })
    .eq('id', evening.id)
    .eq('is_training', false)
    .eq('results_posted_at', since)
    .in('status', ['finished', 'settled'])
    .select('id');
  if (claimError) throw new Error(`claim results_posted_at: ${describeError(claimError)}`);
  if ((claimed ?? []).length === 0) return 'already_posted';
  try {
    await sendMessage(settings.group_chat_id, post.text, { buttons: post.buttons });
    return 'posted';
  } catch (err) {
    const { error: undoError } = await db
      .from('evenings')
      .update({ results_posted_at: since, results_revision: evening.results_revision })
      .eq('id', evening.id)
      .eq('results_posted_at', atIso);
    if (undoError) console.error(`release corrected ${evening.id}: ${describeError(undoError)}`);
    throw err;
  }
}
