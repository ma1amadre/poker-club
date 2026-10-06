// Очки рейтинга за вечер: +1 за каждого, кто вылетел раньше, + koPoints за нокаут, + winBonus за победу.
import type { EveningState, PlayerId } from './types.ts';

export interface ScoringConfig {
  koPoints: number; // settings.ko_points, по умолчанию 0.5
  winBonus: number; // settings.win_bonus, по умолчанию 1
}

export const DEFAULT_SCORING: ScoringConfig = { koPoints: 0.5, winBonus: 1 };

/** Убирает хвосты двоичной арифметики (0.1 + 0.2), чтобы в таблицах не было 7.000000001. */
export function roundPoints(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** Очки одного игрока. n — число участников вечера (гости тоже считаются). */
export function placePoints(place: number, n: number, kos: number, cfg: ScoringConfig): number {
  return roundPoints(n - place + cfg.koPoints * kos + (place === 1 ? cfg.winBonus : 0));
}

/** Очки всех участников завершённого вечера; до finish — пустой объект (места не окончательны). */
export function eveningPoints(state: EveningState, cfg: ScoringConfig): Record<PlayerId, number> {
  const points: Record<PlayerId, number> = {};
  if (!state.finished) return points;
  const n = state.joinOrder.length;
  for (const id of state.joinOrder) {
    const p = state.players[id];
    if (!p || p.place === null) continue;
    points[id] = placePoints(p.place, n, p.kos, cfg);
  }
  return points;
}
