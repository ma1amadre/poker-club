// История клуба: все завершённые вечера, сведённые доменом в EveningSummary, плюс всё, что нужно
// рейтингу, «Оракулу», залу славы и ачивкам. Считается на клиенте тем же кодом, что и на сервере
// (supabase/functions/_shared/domain) — поэтому числа в приложении и в постах бота совпадают.
import type { AchievementInput, StarAward } from '@domain/achievements.ts';
import { scorePrediction, type ScoredPrediction } from '@domain/predictions.ts';
import { seasonKey, type SeasonBestN } from '@domain/season.ts';
import { summarize, type EveningSummary } from '@domain/summary.ts';
import type { PlayerId } from '@domain/types.ts';
import { VOTE_CATEGORIES, voteResults } from '@domain/votes.ts';
import { useQuery } from '@tanstack/react-query';
import { serverNow } from '../lib/serverClock';
import { supabase } from '../supabase';
import { errorMessage, toError } from './errors';
import { chunk, fetchAll, type RangeQuery } from './fetchAll';
import { nextVotingCloseMs } from './historyFeed';
import { queryKeys } from './keys';
import { fetchEvenings, fetchPlayers, fetchSettings } from './queries';
import {
  scoringFromSettings,
  toDomainVote,
  toEventRecord,
  toVote,
  type Evening,
  type EveningEventRecord,
  type Player,
  type PredictionRow,
  type Settings,
  type VoteRow,
} from './types';

export interface ClubHistory {
  /** Завершённые и рассчитанные вечера, новые сверху. */
  evenings: Evening[];
  /** Итоги вечеров в том же порядке (вечера, которые не удалось свести, пропущены). */
  summaries: EveningSummary[];
  summaryById: Map<string, EveningSummary>;
  /** Журналы событий по вечерам (с отменёнными) — для карточки вечера в истории. */
  eventsByEvening: Map<string, EveningEventRecord[]>;
  predictionsByEvening: Map<string, PredictionRow[]>;
  votesByEvening: Map<string, VoteRow[]>;
  /** Оценённые прогнозы по всем завершённым вечерам — вход oracleStandings и ачивки «Оракул». */
  predictionScores: ScoredPrediction[];
  /** Победители номинаций по вечерам с закрытым голосованием. */
  stars: StarAward[];
  players: Player[];
  settings: Settings | null;
  /** Гости: в рейтинг, ачивки и звания не попадают. */
  excluded: Set<PlayerId>;
  /** «Лучшие N» текущего сезона (и закрытых, если их значение не заморожено) — settings.season_best_n. */
  bestN: number;
  /**
   * Замороженные «лучшие N» закрытых сезонов (season_rules, миграция 013): передавать в
   * seasonStandings / hallOfFame вместе с bestN, чтобы смена настройки не переписывала прошлое.
   */
  bestNBySeason: SeasonBestN;
  currentSeasonKey: string;
  /** Готовый вход для computeAchievements / titles. */
  achievementInput: AchievementInput;
  /** Вечера, журнал которых домен не смог свести (например, finish отменён, а статус остался). */
  failed: { eveningId: string; message: string }[];
  /**
   * Момент загрузки по часам сервера (до запросов). Голоса в истории — какими их отдал RLS на этот
   * момент: по голосованию, закрытому позже, у игрока только свои. Поэтому моменты и звёзды
   * считаются не позже fetchedAtMs (`momentsNowMs`), а закрывшееся голосование подтягивает
   * перезапрос (useClubHistory).
   */
  fetchedAtMs: number;
}

const IDS_PER_REQUEST = 40;

/** Строки по списку вечеров: куски по IDS_PER_REQUEST id, каждый — постранично. */
async function fetchByEvenings<T>(
  eveningIds: readonly string[],
  build: (ids: string[]) => RangeQuery<T>,
): Promise<T[]> {
  const parts = await Promise.all(
    chunk(eveningIds, IDS_PER_REQUEST).map((ids) => fetchAll(() => build(ids))),
  );
  return parts.flat();
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}

/**
 * «Лучшие N» закрытых сезонов. Таблицы нет (фронт уже выложен, а миграция 013 ещё катится — деплой
 * параллельный) — замороженных значений тоже нет: все сезоны по текущей настройке, как до 013.
 * Остальные ошибки (права, сеть) — как у прочих запросов истории.
 */
async function fetchSeasonBestN(): Promise<SeasonBestN> {
  const { data, error } = await supabase.from('season_rules').select('season_key, best_n');
  if (error) {
    if (error.code === 'PGRST205') return {};
    throw toError(error);
  }
  return Object.fromEntries((data ?? []).map((r) => [r.season_key, r.best_n]));
}

export async function fetchClubHistory(nowMs: number = serverNow()): Promise<ClubHistory> {
  const [evenings, players, settings, bestNBySeason] = await Promise.all([
    fetchEvenings({ status: ['finished', 'settled'] }),
    fetchPlayers(),
    fetchSettings(),
    fetchSeasonBestN(),
  ]);
  const ids = evenings.map((e) => e.id);

  const [eventRows, predictionRows, voteRows] = await Promise.all([
    fetchByEvenings(ids, (chunkIds) =>
      supabase
        .from('evening_events')
        .select('*')
        .in('evening_id', chunkIds)
        .order('evening_id')
        .order('id'),
    ),
    fetchByEvenings(ids, (chunkIds) =>
      supabase
        .from('predictions')
        .select('*')
        .in('evening_id', chunkIds)
        .order('evening_id')
        .order('player_id'),
    ),
    fetchByEvenings(ids, (chunkIds) =>
      supabase
        .from('votes')
        .select('*')
        .in('evening_id', chunkIds)
        .order('evening_id')
        .order('voter_id')
        .order('category'),
    ),
  ]);

  const eventsByEvening = groupBy(eventRows.map(toEventRecord), (e) => e.eveningId);
  for (const list of eventsByEvening.values()) list.sort((a, b) => a.id - b.id);
  const predictionsByEvening = groupBy(predictionRows, (p) => p.evening_id);
  const votesByEvening = groupBy(voteRows.map(toVote), (v) => v.evening_id);

  // Текущие правила очков — только для вечеров без снимка (до миграции 013); у остальных свой.
  const scoring = scoringFromSettings(settings);
  const summaries: EveningSummary[] = [];
  const summaryById = new Map<string, EveningSummary>();
  const failed: ClubHistory['failed'] = [];
  for (const evening of evenings) {
    try {
      const summary = summarize(
        evening.id,
        evening.scheduled_at,
        evening.format,
        eventsByEvening.get(evening.id) ?? [],
        scoring,
        evening.scoring,
      );
      summaries.push(summary);
      summaryById.set(evening.id, summary);
    } catch (error) {
      // Один «сломанный» вечер не должен ронять рейтинг всего клуба — показываем его отдельно.
      failed.push({ eveningId: evening.id, message: errorMessage(error) });
    }
  }

  const predictionScores: ScoredPrediction[] = [];
  for (const [eveningId, list] of predictionsByEvening) {
    const outcome = summaryById.get(eveningId);
    if (!outcome) continue;
    for (const p of list) {
      if (p.winner_id === null && p.first_out_id === null) continue;
      const score = scorePrediction({ winnerId: p.winner_id, firstOutId: p.first_out_id }, outcome);
      predictionScores.push({ ...score, eveningId, playerId: p.player_id });
    }
  }

  // Звёзды — только по закрытым голосованиям: до закрытия RLS отдаёт лишь свои голоса,
  // и «победитель» по ним был бы случайным.
  const stars: StarAward[] = [];
  for (const evening of evenings) {
    if (!evening.voting_closes_at || Date.parse(evening.voting_closes_at) > nowMs) continue;
    if (!summaryById.has(evening.id)) continue;
    const results = voteResults((votesByEvening.get(evening.id) ?? []).map(toDomainVote));
    for (const category of VOTE_CATEGORIES) {
      const winners = results[category].winners;
      if (winners.length > 0) stars.push({ eveningId: evening.id, category, winners });
    }
  }

  const excluded = new Set(players.filter((p) => p.is_guest).map((p) => p.id));
  const bestN = settings?.season_best_n ?? 10;
  const currentSeasonKey = seasonKey(new Date(nowMs).toISOString());

  return {
    evenings,
    summaries,
    summaryById,
    eventsByEvening,
    predictionsByEvening,
    votesByEvening,
    predictionScores,
    stars,
    players,
    settings,
    excluded,
    bestN,
    bestNBySeason,
    currentSeasonKey,
    achievementInput: {
      summaries,
      excluded,
      predictions: predictionScores,
      stars,
      bestN,
      bestNBySeason,
      currentSeasonKey,
    },
    failed,
    fetchedAtMs: nowMs,
  };
}

/** Самый долгий таймер перезапроса: setTimeout с задержкой больше 2^31 − 1 мс срабатывает сразу. */
const MAX_REFETCH_DELAY_MS = 6 * 3_600_000;
/** Запас после закрытия: RLS должен уже отдавать все голоса. */
const CLOSE_MARGIN_MS = 2_000;

/**
 * Вся история клуба одним запросом-агрегатом: рейтинг, игрок, история и ачивки читают одно и то же.
 * Инвалидируется мутациями, которые меняют завершённые вечера, прогнозы, голоса и настройки.
 */
export function useClubHistory() {
  return useQuery({
    queryKey: queryKeys.clubHistory,
    queryFn: () => fetchClubHistory(),
    staleTime: 60_000,
    // Закрылось голосование — перезапросить: до закрытия RLS отдавал только свои голоса, а моменты
    // и звёзды нужны по всем. Без этого закрывшееся голосование появилось бы только после фокуса.
    refetchInterval: (query) => {
      const data = query.state.data;
      const next = data ? nextVotingCloseMs(data) : null;
      if (next === null) return false;
      return Math.min(Math.max(next - serverNow() + CLOSE_MARGIN_MS, 1_000), MAX_REFETCH_DELAY_MS);
    },
  });
}
