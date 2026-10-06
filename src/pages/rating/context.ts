// Общий вход вкладок рейтинга: история клуба, игроки по id и действующие чемпионы.
import type { PlayerId } from '@domain/types.ts';
import type { ClubHistory, Player } from '../../shared/api';

export interface RatingContext {
  history: ClubHistory;
  playersById: ReadonlyMap<PlayerId, Player>;
  /** Чемпионы прошлого сезона — носят значок до конца текущего. */
  champions: ReadonlySet<PlayerId>;
  championSeason: string | null;
}

/** Имя игрока по id; удалённый или скрытый RLS игрок — понятной заглушкой, а не пустотой. */
export function playerName(ctx: Pick<RatingContext, 'playersById'>, id: PlayerId): string {
  return ctx.playersById.get(id)?.display_name ?? 'Игрок не найден';
}
