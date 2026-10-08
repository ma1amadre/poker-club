// Стрелки движения в таблицах рейтинга: насколько сдвинулось место каждого игрока после последнего
// вечера таблицы. Таблицу строит тот же код, что и экран (build — seasonStandings, allTimeStandings,
// moneyStandings или «Оракул» по прогнозам), здесь только сравнение «без последнего вечера» и «с ним».
// Места — с дележом (равные соседние строки делят место: 1, 2, 2, 4), как во всех таблицах клуба.
import { chronological } from './achievements.ts';
import type { EveningSummary } from './summary.ts';
import type { PlayerId } from './types.ts';

/**
 * Места отсортированной таблицы с дележом: строка, равная предыдущей по same, делит её место,
 * следующее место пропускается (1, 2, 2, 4).
 */
export function tiedPlaces<R>(rows: readonly R[], same: (a: R, b: R) => boolean): number[] {
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

export interface PlaceMove {
  /** Место до последнего вечера; null — до него игрока в таблице не было. */
  from: number | null;
  /** Место сейчас. */
  to: number;
}

export interface TableMoves {
  /** Последний вечер таблицы (по хронологии итогов) — сдвиг считается после него. */
  eveningId: string;
  /** Сдвиг каждого игрока таблицы; у игравших в последнем вечере и у тех, кого обошли. */
  moves: Record<PlayerId, PlaceMove>;
}

/** На сколько мест вверх (> 0) или вниз (< 0) сдвинулся игрок; null — раньше его в таблице не было. */
export function placeDelta(move: PlaceMove): number | null {
  return move.from === null ? null : move.from - move.to;
}

/**
 * Сдвиг мест после последнего вечера: таблица по всем итогам против той же таблицы без последнего
 * вечера (хронология — chronological). summaries — итоги, из которых состоит таблица (сезон —
 * только его вечера). build строит таблицу так же, как экран, same — правило дележа места.
 * null — итогов нет или вечер единственный: до него таблицы не было, сдвигать нечего.
 */
export function lastEveningMoves<R extends { playerId: PlayerId }>(
  summaries: readonly EveningSummary[],
  build: (summaries: readonly EveningSummary[]) => readonly R[],
  same: (a: R, b: R) => boolean,
): TableMoves | null {
  const ordered = chronological(summaries);
  const last = ordered.at(-1);
  if (!last || ordered.length < 2) return null;

  const placesOf = (rows: readonly R[]): Map<PlayerId, number> => {
    const places = tiedPlaces(rows, same);
    return new Map(rows.map((r, i) => [r.playerId, places[i] ?? i + 1]));
  };
  const before = placesOf(build(ordered.slice(0, -1)));
  const after = placesOf(build(ordered));

  const moves: Record<PlayerId, PlaceMove> = {};
  for (const [playerId, to] of after) moves[playerId] = { from: before.get(playerId) ?? null, to };
  return { eveningId: last.eveningId, moves };
}
