// «На кону» объявленного вечера: доменный eveningStakes по истории клуба и ответам на анонс (кто
// может прийти — постоянные игроки, кроме ответивших «не иду» и болельщиков на этот вечер: болельщик
// с «иду» / «под вопросом» или уже посаженный за стол — игрок, миграция 024). Показ — StakesList
// (EveningStakes.tsx).
import { seatedIds, spectatesEvening } from '@domain/spectators.ts';
import { eveningStakes, type EveningStakes } from '@domain/stakes.ts';
import { useMemo } from 'react';
import {
  isTrainingEvening,
  useClubHistory,
  useEveningEvents,
  type Evening,
  type Player,
  type Rsvp,
} from '../../shared/api';
import { seasonStakeLines } from '../../shared/lib';

/** Больше шагов карточка не показывает: главное, а не таблица. */
export const STAKES_SHOWN = 4;

/**
 * «На кону» объявленного вечера; null — истории ещё нет (или она не загрузилась) или это
 * тренировка: она не входит в историю клуба, ачивок и рекордов на ней нет.
 */
export function useEveningStakes(
  evening: Evening,
  rsvps: readonly Rsvp[],
  players: readonly Player[],
): EveningStakes | null {
  const history = useClubHistory().data;
  // Журнал — тот же запрос и та же подписка, что у экрана (Realtime считает подписчиков).
  const events = useEveningEvents(evening.id).data;
  const training = isTrainingEvening(evening);
  return useMemo(() => {
    if (!history || training) return null;
    const rsvpOf = new Map(rsvps.map((r) => [r.player_id, r.status]));
    const seated = seatedIds(events ?? []);
    const list = players
      .filter((p) => {
        const answer = rsvpOf.get(p.id);
        // Выключенный игрок, который всё же ответил «иду» или «под вопросом», — тоже за столом.
        return !p.is_guest && (p.is_active || answer === 'yes' || answer === 'maybe');
      })
      .map((p) => {
        const rsvp = rsvpOf.get(p.id) ?? null;
        const spectator = spectatesEvening({
          spectator: p.is_spectator,
          rsvp,
          seated: seated.has(p.id),
        });
        return { playerId: p.id, rsvp, spectator };
      });
    return eveningStakes(
      {
        summaries: history.summaries,
        excluded: history.excluded,
        predictions: history.predictionScores,
        stars: history.stars,
        bestN: history.bestN,
        bestNBySeason: history.bestNBySeason,
      },
      { eveningDate: evening.scheduled_at, players: list, buyInRub: evening.format.buyInRub },
    );
  }, [history, training, rsvps, players, events, evening.scheduled_at, evening.format.buyInRub]);
}

/** Есть ли что показать. */
export function hasStakes(stakes: EveningStakes | null, meId?: string | null): boolean {
  if (!stakes) return false;
  return (
    stakes.items.length > 0 ||
    (stakes.season !== null && seasonStakeLines(stakes.season, () => '', meId).length > 0)
  );
}
