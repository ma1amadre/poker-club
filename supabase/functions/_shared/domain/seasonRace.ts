// «Гонка сезона» на главной: где игрок в таблице сезона и сколько очков до соседей выше и ниже, до
// лидера, сколько вечеров уже в зачёте из «лучших N». Таблица — seasonStandings (порядок: очки, победы,
// нокауты), места с дележом — sameRank, как в рейтинге; правила очков здесь не меняются.
import { roundPoints } from './scoring.ts';
import { sameRank, type StandingRow } from './season.ts';
import type { PlayerId } from './types.ts';

/** Чем решается порядок при равных очках: победами, а при равных победах — нокаутами. */
export type RaceTiebreak = 'wins' | 'kos';

export interface RaceRival {
  /** Все, кто на этом месте (делёж — несколько). */
  playerIds: PlayerId[];
  place: number;
  total: number;
  /** Разница в очках с игроком, ≥ 0: выше — сколько не хватает, ниже — отрыв. */
  gap: number;
  /** Очки равны — чем место отделено от игрока; очки разные — null. */
  tiebreak: RaceTiebreak | null;
}

export interface SeasonRace {
  place: number;
  /** Строк в таблице сезона. */
  of: number;
  total: number;
  /** Делят место с игроком (без него самого). */
  tiedWith: PlayerId[];
  /** Ближайшее место выше; null — игрок первый. */
  above: RaceRival | null;
  /** Первое место, если оно выше соседа сверху; иначе null (лидер — это above или сам игрок). */
  leader: RaceRival | null;
  /** Ближайшее место ниже; null — ниже никого. */
  below: RaceRival | null;
  /** Вечеров в зачёте (лучшие N из сыгранных). */
  counted: number;
  played: number;
  /** «Лучшие N» этого сезона. */
  bestN: number;
  /**
   * Все N мест зачёта заняты: очки нового вечера пойдут в сумму, только если их больше худшего
   * засчитанного — это его значение. Пока места есть — null.
   */
  weakestCounted: number | null;
}

/** Порядок между соседними группами при равных очках: что из двух критериев их различает. */
function tiebreakOf(upper: StandingRow, lower: StandingRow): RaceTiebreak | null {
  if (upper.total !== lower.total) return null;
  return upper.wins !== lower.wins ? 'wins' : 'kos';
}

/**
 * Гонка сезона игрока playerId по таблице rows (seasonStandings этого сезона) и его «лучшим N».
 * null — игрока в таблице нет (в сезоне без игр, гость).
 */
export function seasonRace(
  rows: readonly StandingRow[],
  playerId: PlayerId,
  bestN: number,
): SeasonRace | null {
  const index = rows.findIndex((r) => r.playerId === playerId);
  const me = rows[index];
  if (!me) return null;

  // Группы мест: соседние строки с тем же рангом делят место.
  const groups: { place: number; rows: StandingRow[] }[] = [];
  rows.forEach((row, i) => {
    const last = groups.at(-1);
    const head = last?.rows[0];
    if (last && head && sameRank(head, row)) last.rows.push(row);
    else groups.push({ place: i + 1, rows: [row] });
  });
  const g = groups.findIndex((group) => group.rows.includes(me));
  const mine = groups[g];
  if (!mine) return null;

  const rival = (group: (typeof groups)[number] | undefined, upper: boolean): RaceRival | null => {
    const head = group?.rows[0];
    if (!group || !head) return null;
    return {
      playerIds: group.rows.map((r) => r.playerId),
      place: group.place,
      total: head.total,
      gap: roundPoints(Math.abs(head.total - me.total)),
      tiebreak: upper ? tiebreakOf(head, me) : tiebreakOf(me, head),
    };
  };

  const full = me.counted.length >= bestN && bestN > 0;
  return {
    place: mine.place,
    of: rows.length,
    total: me.total,
    tiedWith: mine.rows.filter((r) => r.playerId !== playerId).map((r) => r.playerId),
    above: rival(groups[g - 1], true),
    leader: g >= 2 ? rival(groups[0], true) : null,
    below: rival(groups[g + 1], false),
    counted: me.counted.length,
    played: me.played,
    bestN,
    weakestCounted: full ? (me.counted.at(-1) ?? null) : null,
  };
}
