// Чистые хелперы экрана рейтинга: подписи сезонов, места с дележом, пометка вечеров «в зачёте»,
// прогнозы сезона, действующий чемпион. Сами очки, таблицы и чемпионов считает домен
// (seasonStandings, moneyStandings, oracleStandings, hallOfFame) — здесь только раскладка его
// результатов для показа.
import type { ScoredPrediction } from '@domain/predictions.ts';
import {
  compareSeasonKeys,
  previousSeasonKey,
  sameRank,
  type HallOfFameEntry,
  type OracleRow,
  type StandingRow,
} from '@domain/season.ts';
import type { EveningSummary } from '@domain/summary.ts';
import type { PlayerId } from '@domain/types.ts';

/** Сезоны для выбора: все, где были вечера, плюс текущий (даже пустой); новые сверху. */
export function seasonOptions(
  summaries: readonly Pick<EveningSummary, 'seasonKey'>[],
  currentSeasonKey: string,
): string[] {
  const keys = new Set(summaries.map((s) => s.seasonKey));
  keys.add(currentSeasonKey);
  return [...keys].sort((a, b) => compareSeasonKeys(b, a));
}

/**
 * Места в отсортированной таблице с дележом: равные соседние строки делят место,
 * следующее место пропускается (1, 2, 2, 4) — как в спортивных таблицах.
 */
export function rankPlaces<T>(rows: readonly T[], same: (a: T, b: T) => boolean): number[] {
  const places: number[] = [];
  rows.forEach((row, i) => {
    const prev = rows[i - 1];
    const prevPlace = places[i - 1];
    places.push(
      prev !== undefined && prevPlace !== undefined && same(prev, row) ? prevPlace : i + 1,
    );
  });
  return places;
}

/** Места таблицы сезона / всего времени: делят равные по очкам, победам и нокаутам (sameRank домена). */
export function standingPlaces(rows: readonly StandingRow[]): number[] {
  return rankPlaces(rows, sameRank);
}

/** Места денежной таблицы (moneyStandings уже отсортирован доменом): делят равные по нетто. */
export function moneyPlaces(rows: readonly StandingRow[]): number[] {
  return rankPlaces(rows, (a, b) => a.netRub === b.netRub);
}

/** Места «Оракула» (порядок oracleStandings): делят равные по очкам и угаданным победителям. */
export function oraclePlaces(rows: readonly OracleRow[]): number[] {
  return rankPlaces(rows, (a, b) => a.total === b.total && a.winnerHits === b.winnerHits);
}

export interface SeasonEveningMark {
  eveningId: string;
  date: string;
  points: number;
  /** Место в вечере (с 1); null — игрока нет в местах (по журналу так быть не должно). */
  place: number | null;
  /** Участников вечера (гости тоже). */
  entrants: number;
  /** Вечер входит в лучшие N, которые дали сумму сезона. */
  counted: boolean;
}

/**
 * Вечера игрока в хронологии с пометкой «в зачёте». Какие очки засчитаны, решает домен
 * (StandingRow.counted — мультимножество лучших N); здесь только сопоставляем их вечерам.
 * При равных очках в зачёт помечается более ранний вечер — на сумму это не влияет.
 */
export function markCountedEvenings(
  summaries: readonly EveningSummary[],
  playerId: PlayerId,
  counted: readonly number[],
): SeasonEveningMark[] {
  const played = summaries
    .filter((s) => s.entrants.includes(playerId))
    .map((s) => {
      const index = s.places.indexOf(playerId);
      return {
        eveningId: s.eveningId,
        date: s.date,
        points: s.points[playerId] ?? 0,
        place: index >= 0 ? index + 1 : null,
        entrants: s.entrants.length,
      };
    })
    .sort(
      (a, b) =>
        Date.parse(a.date) - Date.parse(b.date) ||
        (a.eveningId < b.eveningId ? -1 : a.eveningId > b.eveningId ? 1 : 0),
    );

  const left = new Map<number, number>();
  for (const p of counted) left.set(p, (left.get(p) ?? 0) + 1);

  const countedIds = new Set<string>();
  // Стабильная сортировка: при равных очках порядок хронологический.
  for (const e of [...played].sort((a, b) => b.points - a.points)) {
    const n = left.get(e.points) ?? 0;
    if (n > 0) {
      countedIds.add(e.eveningId);
      left.set(e.points, n - 1);
    }
  }
  return played.map((e) => ({ ...e, counted: countedIds.has(e.eveningId) }));
}

/**
 * Оценённые прогнозы одного сезона — вход oracleStandings для «Оракула сезона». Сезон вечера
 * берётся из его итога (seasonOf); прогнозы гостей и вечеров без итога отбрасываются.
 */
export function seasonPredictionScores(
  scores: readonly ScoredPrediction[],
  seasonOf: (eveningId: string) => string | undefined,
  seasonKey: string,
  excluded: ReadonlySet<PlayerId>,
): ScoredPrediction[] {
  return scores.filter((p) => !excluded.has(p.playerId) && seasonOf(p.eveningId) === seasonKey);
}

/**
 * Действующие чемпионы: победители прошлого сезона. Значок чемпиона живёт до конца следующего
 * сезона, поэтому в текущем сезоне его носят чемпионы предыдущего.
 */
export function reigningChampions(
  hall: readonly HallOfFameEntry[],
  currentSeasonKey: string,
): { seasonKey: string; champions: PlayerId[] } | null {
  let previous: string;
  try {
    previous = previousSeasonKey(currentSeasonKey);
  } catch {
    return null;
  }
  const entry = hall.find((h) => h.seasonKey === previous);
  return entry ? { seasonKey: entry.seasonKey, champions: [...entry.champions] } : null;
}
