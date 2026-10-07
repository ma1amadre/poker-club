// Раскладка истории вечеров: идущие сверху, остальные — по сезонам, новые выше.
// Фонд и состав вечера считает replay домена, здесь только группировка и порядок.
import { replay } from '@domain/replay.ts';
import { compareSeasonKeys, seasonKey } from '@domain/season.ts';
import type { EveningEvent, TournamentFormat } from '@domain/types.ts';
import type { EveningStatus } from '../../shared/api';

/** Минимум полей вечера, нужный для раскладки (тесты не тащат всю строку БД). */
export interface HistoryEveningLike {
  id: string;
  scheduled_at: string;
  status: EveningStatus;
}

export interface HistorySeasonGroup<E extends HistoryEveningLike> {
  seasonKey: string;
  evenings: E[];
}

export interface HistoryLayout<E extends HistoryEveningLike> {
  /** Идущие вечера (обычно один) — показываются сверху с отметкой. */
  live: E[];
  /** Прошедшие (завершён / рассчитан / отменён) по сезонам, новые сверху. */
  seasons: HistorySeasonGroup<E>[];
}

/** Статусы, которые попадают в историю. Анонсы — будущие вечера, их показывает главная. */
const PAST: ReadonlySet<EveningStatus> = new Set(['finished', 'settled', 'cancelled']);

function newestFirst(a: HistoryEveningLike, b: HistoryEveningLike): number {
  return (
    Date.parse(b.scheduled_at) - Date.parse(a.scheduled_at) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export function groupHistory<E extends HistoryEveningLike>(
  evenings: readonly E[],
): HistoryLayout<E> {
  const live = evenings.filter((e) => e.status === 'live').sort(newestFirst);
  const bySeason = new Map<string, E[]>();
  for (const e of evenings) {
    if (!PAST.has(e.status)) continue;
    let key: string;
    try {
      key = seasonKey(e.scheduled_at);
    } catch {
      continue; // битая дата — вечер не показать в сезоне, но и экран не ронять
    }
    const list = bySeason.get(key);
    if (list) list.push(e);
    else bySeason.set(key, [e]);
  }
  const seasons = [...bySeason.entries()]
    .sort(([a], [b]) => compareSeasonKeys(b, a))
    .map(([key, list]) => ({ seasonKey: key, evenings: list.sort(newestFirst) }));
  return { live, seasons };
}

export interface EveningTotals {
  /** Сколько игроков входило в вечер. */
  players: number;
  /** Сколько сейчас в игре. */
  alive: number;
  /** Призовой фонд (replay домена: все взносы входов и ребаев). */
  prizePoolRub: number;
}

/** Состав и фонд вечера по журналу событий. Время на фонд не влияет — берём момент последнего события. */
export function eveningTotals(
  format: TournamentFormat,
  events: readonly EveningEvent[],
): EveningTotals {
  const lastMs = events.reduce((m, e) => Math.max(m, Date.parse(e.at) || 0), 0);
  const state = replay(format, events, lastMs);
  return {
    players: state.joinOrder.length,
    alive: state.aliveCount,
    prizePoolRub: state.prizePoolRub,
  };
}
