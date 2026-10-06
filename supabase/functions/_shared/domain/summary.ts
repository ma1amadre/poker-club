// Компактный итог завершённого вечера — единица статистики. Рейтинг, сезоны и ачивки
// работают со списком итогов, а не с сырыми журналами: так их можно хранить или кешировать.
import { computeMoney } from './money.ts';
import { replayLog } from './replay.ts';
import { eveningPoints, eveningScoring, type ScoringConfig } from './scoring.ts';
import { seasonKey } from './season.ts';
import type { EveningEvent, PlayerId, TournamentFormat } from './types.ts';

export interface EveningSummary {
  eveningId: string;
  date: string; // ISO, дата вечера (scheduled_at)
  seasonKey: string;
  entrants: PlayerId[]; // в порядке входа
  places: PlayerId[]; // index 0 = 1-е место
  points: Record<PlayerId, number>;
  /**
   * Правила, по которым посчитаны points: снимок вечера (evenings.scoring) или, без снимка, текущие
   * настройки. Необязательное только ради итогов, собранных вручную в тестах; summarize ставит всегда.
   */
  scoring?: ScoringConfig;
  netRub: Record<PlayerId, number>;
  kos: Record<PlayerId, number>;
  koPairs: [PlayerId, PlayerId][]; // [кто выбил, кого]; при дележе — пара на каждого выбившего
  rebuys: Record<PlayerId, number>;
  bustLevel: Record<PlayerId, number | null>;
  // Расширения контракта: нужны прогнозам (первый вылет) и ачивке first_blood (дележ первого нокаута).
  firstBustPlayerId: PlayerId | null;
  busts: { victim: PlayerId; by: PlayerId[] }[]; // все принятые bust в порядке журнала
}

// Payload принятых bust уже проверен replay, поэтому приведение типа здесь безопасно.
function bustOf(ev: EveningEvent): { victim: PlayerId; by: PlayerId[] } {
  const p = ev.payload as { playerId: PlayerId; by: PlayerId[] };
  return { victim: p.playerId, by: [...p.by] };
}

/**
 * Итог завершённого вечера. Бросает ошибку, если по журналу вечер не завершён: незавершённый
 * вечер в статистике дал бы нулевые очки всем — лучше громко, чем тихо неверно.
 *
 * Очки — по снимку правил вечера `snapshot` (evenings.scoring, фиксируется при finish), если он
 * есть и корректен, иначе по `cfg` (текущие настройки клуба). Так смена ko_points / win_bonus
 * не переписывает уже сыгранные вечера.
 */
export function summarize(
  eveningId: string,
  dateIso: string,
  format: TournamentFormat,
  events: readonly EveningEvent[],
  cfg: ScoringConfig,
  snapshot?: unknown,
): EveningSummary {
  // Время для статистики не важно: после finish таймер стоит. Берём последний момент журнала.
  const lastMs = events.reduce((m, e) => Math.max(m, Date.parse(e.at) || 0), 0);
  const { state, applied } = replayLog(format, events, lastMs);
  if (!state.finished) {
    throw new Error(`Вечер ${eveningId} не завершён по журналу событий`);
  }
  const money = computeMoney(format, state);
  const scoring = eveningScoring(snapshot, cfg);
  const busts = applied.filter((e) => e.type === 'bust').map(bustOf);

  const kos: Record<PlayerId, number> = {};
  const netRub: Record<PlayerId, number> = {};
  const rebuys: Record<PlayerId, number> = {};
  const bustLevel: Record<PlayerId, number | null> = {};
  for (const id of state.joinOrder) {
    const p = state.players[id];
    if (!p) continue;
    kos[id] = p.kos;
    rebuys[id] = p.rebuys;
    bustLevel[id] = p.bustLevel;
    netRub[id] = money[id]?.netRub ?? 0;
  }

  return {
    eveningId,
    date: dateIso,
    seasonKey: seasonKey(dateIso),
    entrants: [...state.joinOrder],
    places: [...state.places],
    points: eveningPoints(state, scoring),
    scoring,
    netRub,
    kos,
    koPairs: busts.flatMap((b) => b.by.map((k): [PlayerId, PlayerId] => [k, b.victim])),
    rebuys,
    bustLevel,
    firstBustPlayerId: state.firstBustPlayerId,
    busts,
  };
}
