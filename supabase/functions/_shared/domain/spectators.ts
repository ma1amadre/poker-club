// Болельщик (players.is_spectator, миграция 024) — «слежу, не играю». Флаг ставит сам человек
// (вопрос на главной, своя карточка) или админ. Болельщик видит всё и делает прогнозы, но не стоит в
// «Без ответа», не упоминается в посте дня игры, не входит в кандидаты прогноза и в «кто может
// прийти» у «На кону».
//
// На конкретный вечер флаг перекрывает поведение: ответил «иду» / «под вопросом» или сидит за
// столом (действующий вход в журнале) — в этот вечер он игрок. Сам флаг от этого не меняется:
// правило — чтение, а не запись, поэтому отмена ответа или входа возвращает всё как было, а в
// следующий вечер человек снова болельщик. Одно правило на главную, экран вечера, «На кону» и пост
// дня игры — сервер и клиент считают одинаково.
import type { EveningEvent, PlayerId } from './types.ts';

export interface SpectatorFacts {
  /** players.is_spectator: true — болельщик; false и null (ещё не выбирал) — игрок. */
  spectator: boolean | null | undefined;
  /** Ответ на анонс этого вечера: 'yes' | 'maybe' | 'no'; нет ответа — null или undefined. */
  rsvp?: string | null;
  /** Есть действующий вход в журнале этого вечера (seatedIds). */
  seated?: boolean;
}

/** Болельщик на этот вечер: флаг стоит, а ни «иду» / «под вопросом», ни места за столом нет. */
export function spectatesEvening({ spectator, rsvp, seated }: SpectatorFacts): boolean {
  return spectator === true && rsvp !== 'yes' && rsvp !== 'maybe' && seated !== true;
}

/**
 * Кто сидит за столом вечера: игроки с действующим (не отменённым) входом в журнале — то же правило,
 * что у is_participant в SQL. Принял ли вход replay, не важно: банкир посадил — человек за столом.
 */
export function seatedIds(
  events: readonly Pick<EveningEvent, 'type' | 'payload' | 'voided'>[],
): Set<PlayerId> {
  const seated = new Set<PlayerId>();
  for (const e of events) {
    if (e.type !== 'join' || e.voided) continue;
    const id = (e.payload as { playerId?: unknown }).playerId;
    if (typeof id === 'string' && id !== '') seated.add(id);
  }
  return seated;
}
