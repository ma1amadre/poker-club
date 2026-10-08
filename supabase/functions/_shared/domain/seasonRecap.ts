// «Итоги сезона»: подиум, денежный зачёт, «Оракул сезона», лучший охотник, рекорды, установленные
// в сезоне, ачивки сезона и «Твой сезон» игрока. Ничего нового не считает и правил не меняет: таблица —
// seasonStandings с «лучшими N» сезона (замороженными у закрытого), деньги — moneyStandings, прогнозы —
// oracleStandings, ачивки — computeAchievements, рекорды — recordsTable. Гости (excluded) — нигде.
import {
  ACHIEVEMENT_CODES,
  computeAchievements,
  type Achievement,
  type AchievementInput,
} from './achievements.ts';
import { recordsTable, type RecordHolder, type RecordKind } from './records.ts';
import { standingPlace } from './recap.ts';
import {
  bestNForSeason,
  compareSeasonKeys,
  moneyStandings,
  oracleStandings,
  seasonChampions,
  seasonStandings,
  type OracleRow,
  type StandingRow,
} from './season.ts';
import type { PlayerId } from './types.ts';

export interface SeasonRecapInput extends AchievementInput {
  /**
   * Готовые ачивки клуба (computeAchievements того же input) — если уже посчитаны: зал славы строит
   * итоги всех сезонов и не должен считать ачивки на каждый.
   */
  achievements?: readonly Achievement[];
}

/** Ступень подиума: место 1–3 и все, кто его делит (по очкам, победам и нокаутам — sameRank). */
export interface PodiumStep {
  place: number;
  playerIds: PlayerId[];
  total: number;
}

/** Лидер номинации сезона: ничья — все; value — значение лидера. */
export interface SeasonTop {
  playerIds: PlayerId[];
  value: number;
}

/** Рекорд клуба, установленный в сезоне: к концу сезона выше, чем был к его началу. */
export interface SeasonRecord {
  kind: RecordKind;
  value: number;
  /** Рекорд к началу сезона; null — его ещё не было. */
  previous: number | null;
  /** Держатели на конец сезона — все из этого сезона (у рекордов вечера playerId = null). */
  holders: RecordHolder[];
}

export interface SeasonRecap {
  seasonKey: string;
  /** Сезон завершён (ключ меньше текущего): сезонные ачивки выданы, таблица финальная. */
  closed: boolean;
  /** Вечера сезона (id в хронологии). */
  eveningIds: string[];
  /** «Лучшие N» сезона: замороженное значение закрытого, иначе текущее. */
  bestN: number;
  /** Таблица сезона (seasonStandings) и места с дележом (1, 2, 2, 4) — в том же порядке. */
  standings: StandingRow[];
  places: number[];
  /** Чемпионы — как в зале славы (seasonChampions): все на первой строке, если очки есть. */
  champions: PlayerId[];
  /** Подиум: места 1–3 с очками больше нуля, ступень на место (делёж — несколько игроков). */
  podium: PodiumStep[];
  /** Денежный зачёт сезона (moneyStandings) и лидер — наибольшее нетто больше нуля. */
  money: StandingRow[];
  moneyLeader: SeasonTop | null;
  /** «Оракул сезона» (oracleStandings прогнозов сезона) и лидер — по очкам и угаданным победителям. */
  oracle: OracleRow[];
  oracleLeader: SeasonTop | null;
  /** Лучший охотник сезона — больше всех нокаутов за сезон (без денег). */
  hunters: SeasonTop | null;
  /** Рекорды клуба, установленные в сезоне, в порядке RECORD_KINDS (сначала рекорды игрока). */
  records: SeasonRecord[];
  /**
   * Ачивки сезона: вечерние строки вечеров сезона и сезонные (seasonKey) — в порядке каталога, у
   * одного кода — сначала старший уровень.
   */
  achievements: Achievement[];
}

const byRankThenId = (rank: (a: Achievement) => number) => (a: Achievement, b: Achievement) =>
  rank(a) - rank(b) || b.level - a.level || (a.playerId < b.playerId ? -1 : 1);

/**
 * Лидер таблицы, уже отсортированной по value (у равных — по правилу таблицы): все, кто равен первой
 * строке по same, если value первой больше нуля; иначе null.
 */
function leaderOf<T extends { playerId: PlayerId }>(
  sorted: readonly T[],
  value: (row: T) => number,
  same: (a: T, b: T) => boolean = (a, b) => value(a) === value(b),
): SeasonTop | null {
  const top = sorted[0];
  if (!top || value(top) <= 0) return null;
  return {
    playerIds: sorted.filter((r) => same(r, top)).map((r) => r.playerId),
    value: value(top),
  };
}

/** Рекорды, установленные в сезоне key: таблица рекордов до сезона и на его конец. */
function seasonRecords(input: SeasonRecapInput, key: string): SeasonRecord[] {
  const opts = { excluded: input.excluded };
  const before = recordsTable(
    input.summaries.filter((s) => compareSeasonKeys(s.seasonKey, key) < 0),
    opts,
  );
  const after = recordsTable(
    input.summaries.filter((s) => compareSeasonKeys(s.seasonKey, key) <= 0),
    opts,
  );
  const out: SeasonRecord[] = [];
  for (const record of after) {
    const previous = before.find((r) => r.kind === record.kind)?.value ?? null;
    if (record.value === null || (previous !== null && record.value <= previous)) continue;
    out.push({ kind: record.kind, value: record.value, previous, holders: record.holders });
  }
  return out;
}

/**
 * Итоги сезона key по истории клуба. Сезон без вечеров — пустые таблицы и eveningIds = [].
 * Подиум и чемпион — по той же таблице, что вкладка «Сезон» и зал славы.
 */
export function seasonRecap(input: SeasonRecapInput, key: string): SeasonRecap {
  const inSeason = input.summaries.filter((s) => s.seasonKey === key);
  const eveningIds = [...inSeason]
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || (a.eveningId < b.eveningId ? -1 : 1))
    .map((s) => s.eveningId);
  const standings = seasonStandings(inSeason, {
    bestN: input.bestN,
    excluded: input.excluded,
    seasonKey: key,
    bestNBySeason: input.bestNBySeason,
  });
  const places = standings.map((r) => standingPlace(standings, r.playerId) ?? 0);

  const podium: PodiumStep[] = [];
  standings.forEach((row, i) => {
    const place = places[i] ?? 0;
    if (place < 1 || place > 3 || row.total <= 0) return;
    const step = podium.find((p) => p.place === place);
    if (step) step.playerIds.push(row.playerId);
    else podium.push({ place, playerIds: [row.playerId], total: row.total });
  });

  const money = moneyStandings(inSeason, { excluded: input.excluded, seasonKey: key });
  const ids = new Set(eveningIds);
  const oracle = oracleStandings(
    input.predictions.filter((p) => ids.has(p.eveningId) && !input.excluded.has(p.playerId)),
  );
  const all = input.achievements ?? computeAchievements(input);
  const rank = (a: Achievement): number => ACHIEVEMENT_CODES.indexOf(a.code);
  const achievements = all
    .filter((a) => (a.eveningId !== null && ids.has(a.eveningId)) || a.seasonKey === key)
    .sort(byRankThenId(rank));

  return {
    seasonKey: key,
    closed: compareSeasonKeys(key, input.currentSeasonKey) < 0,
    eveningIds,
    bestN: bestNForSeason(key, input.bestN, input.bestNBySeason),
    standings,
    places,
    champions: seasonChampions(standings),
    podium,
    money,
    moneyLeader: leaderOf(money, (r) => r.netRub),
    oracle,
    oracleLeader: leaderOf(
      oracle,
      (r) => r.total,
      (a, b) => a.total === b.total && a.winnerHits === b.winnerHits,
    ),
    hunters: leaderOf(
      [...standings].sort((a, b) => b.kos - a.kos),
      (r) => r.kos,
    ),
    records: inSeason.length > 0 ? seasonRecords(input, key) : [],
    achievements,
  };
}

/**
 * Итоги всех завершённых сезонов с вечерами — для зала славы, новые сверху. Ачивки считаются один раз
 * на всю историю.
 */
export function closedSeasonRecaps(input: SeasonRecapInput): SeasonRecap[] {
  const achievements = input.achievements ?? computeAchievements(input);
  return [...new Set(input.summaries.map((s) => s.seasonKey))]
    .filter((k) => compareSeasonKeys(k, input.currentSeasonKey) < 0)
    .sort((a, b) => compareSeasonKeys(b, a))
    .map((key) => seasonRecap({ ...input, achievements }, key));
}

/** «Твой сезон»: что сезон значил для игрока. */
export interface PlayerSeason {
  playerId: PlayerId;
  /** Место в таблице сезона (с дележом) и сколько в ней игроков; null — не играл в сезоне. */
  place: number | null;
  of: number;
  /** Очки сезона (сумма лучших N), вечеров в зачёте и сыграно. */
  total: number;
  counted: number;
  played: number;
  bestN: number;
  wins: number;
  kos: number;
  netRub: number;
  /** Ступень подиума (1–3), если игрок на нём. */
  podiumPlace: number | null;
  champion: boolean;
  /** «Оракул сезона»: место (с дележом по очкам и угаданным победителям) и строка; null — без прогнозов. */
  oracle: (OracleRow & { place: number }) | null;
  /** Ачивки игрока за сезон (строки recap.achievements). */
  achievements: Achievement[];
}

/**
 * «Твой сезон» из итогов сезона. null — игрок в сезоне не играл, прогнозов и ачивок у него нет
 * (гостю — всегда null: его нет ни в таблицах, ни в ачивках).
 */
export function playerSeason(recap: SeasonRecap, playerId: PlayerId): PlayerSeason | null {
  const index = recap.standings.findIndex((r) => r.playerId === playerId);
  const row = index >= 0 ? recap.standings[index] : undefined;
  const oracleIndex = recap.oracle.findIndex((r) => r.playerId === playerId);
  const oracleRow = oracleIndex >= 0 ? recap.oracle[oracleIndex] : undefined;
  const achievements = recap.achievements.filter((a) => a.playerId === playerId);
  if (!row && !oracleRow && achievements.length === 0) return null;

  let oracle: PlayerSeason['oracle'] = null;
  if (oracleRow) {
    const first = recap.oracle.findIndex(
      (r) => r.total === oracleRow.total && r.winnerHits === oracleRow.winnerHits,
    );
    oracle = { ...oracleRow, place: first + 1 };
  }
  const podium = recap.podium.find((p) => p.playerIds.includes(playerId));
  return {
    playerId,
    place: row ? (recap.places[index] ?? null) : null,
    of: recap.standings.length,
    total: row?.total ?? 0,
    counted: row?.counted.length ?? 0,
    played: row?.played ?? 0,
    bestN: recap.bestN,
    wins: row?.wins ?? 0,
    kos: row?.kos ?? 0,
    netRub: row?.netRub ?? 0,
    podiumPlace: podium?.place ?? null,
    champion: recap.champions.includes(playerId),
    oracle,
    achievements,
  };
}
