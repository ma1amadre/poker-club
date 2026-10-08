// Олл-ин после ривера: кто проиграл раздачу и предложение «Записать вылет: X, выбивает Y».
// Чистый модуль (тесты — riverBusts.test.ts). Пульт не знает стеков: проигравший раздачу вылетает,
// только если фишек у него было не больше, чем у победителя, — поэтому это предложение, а решает
// банкир (подтверждение, снять отметку). Места считает домен: вылеты одной раздачи пишутся одним
// действием (add_events) от меньшего стека к большему — позже записанный вылет даёт место выше
// (места — в порядке, обратном окончательным вылетам).
import { riverWinners } from '@domain/allins.ts';
import type { EventDraft } from '@domain/replay.ts';
import type { EveningEvent, PlayerId, ShowdownHand } from '@domain/types.ts';
import { joinNames } from '../../shared/lib/text';

export interface RiverOutcome {
  /** Лучшая рука (несколько — делёж банка), в порядке рук раздачи. */
  winners: PlayerId[];
  /** Остальные участники раздачи, в порядке рук. */
  losers: PlayerId[];
}

/**
 * Итог раздачи на ривере (стол — 5 карт); до ривера или при сломанных картах — null. Лучшую руку
 * определяет домен (riverWinners — тот же итог, что у «Олл-инов вечера» и сюжета вечера).
 */
export function riverOutcome(showdown: {
  hands: readonly ShowdownHand[];
  board: readonly string[];
}): RiverOutcome | null {
  const winners = riverWinners(showdown.hands, showdown.board);
  if (!winners) return null;
  const losers = showdown.hands.map((h) => h.playerId).filter((id) => !winners.includes(id));
  return { winners, losers };
}

export interface RiverBustSuggestion {
  /** Проигравшие раздачу, которые сейчас в игре, — кандидаты на вылет (в порядке рук). */
  victims: PlayerId[];
  /** Кто выбивает: победители раздачи, которые в игре (делёж — нокаут каждому). */
  killers: PlayerId[];
}

/**
 * Кто уже вылетел в этой раздаче: принятые вылеты после её открытия (openedEventId — первая версия
 * раздачи). Вылет раздачу не закрывает, а ривер виден ещё 2 минуты — за это время игрок успевает
 * докупиться и снова оказаться «в игре», но второй раз в той же раздаче он не вылетает.
 */
export function bustedInHand(
  applied: readonly Pick<EveningEvent, 'id' | 'type' | 'payload'>[],
  openedEventId: number,
): Set<PlayerId> {
  const out = new Set<PlayerId>();
  for (const e of applied) {
    if (e.type !== 'bust' || e.id <= openedEventId) continue;
    const id = (e.payload as { playerId?: unknown }).playerId;
    if (typeof id === 'string') out.add(id);
  }
  return out;
}

/**
 * Что предложить банкиру после ривера: проигравшие в игре, у которых вылет в этой раздаче ещё не
 * записан (applied — принятые события журнала, replayLog; без него — только «в игре»). null — ривера
 * нет, делёж на всех или все проигравшие уже вне игры или уже вылетали в этой раздаче (вылет записали
 * руками или с пульта, а потом был ребай).
 */
export function riverBustSuggestion(
  showdown: { hands: readonly ShowdownHand[]; board: readonly string[]; openedEventId?: number },
  isAlive: (id: PlayerId) => boolean,
  applied: readonly Pick<EveningEvent, 'id' | 'type' | 'payload'>[] = [],
): RiverBustSuggestion | null {
  const outcome = riverOutcome(showdown);
  if (!outcome) return null;
  const busted =
    showdown.openedEventId === undefined
      ? new Set<PlayerId>()
      : bustedInHand(applied, showdown.openedEventId);
  const victims = outcome.losers.filter((id) => isAlive(id) && !busted.has(id));
  if (victims.length === 0) return null;
  return { victims, killers: outcome.winners.filter(isAlive) };
}

/**
 * Вылеты одной раздачи одним действием. byChips — вылетевшие от большего стека к меньшему (выше
 * в списке — место выше); записи идут от меньшего к большему: последний записанный вылет получает
 * место выше остальных.
 */
export function riverBustDrafts(
  byChips: readonly PlayerId[],
  killers: readonly PlayerId[],
): EventDraft[] {
  return [...byChips]
    .reverse()
    .map((playerId) => ({ type: 'bust' as const, payload: { playerId, by: [...killers] } }));
}

/** Порядок по фишкам после правки списка вылетевших: прежние — как были, новые — в конец. */
export function keepChipOrder(
  order: readonly PlayerId[],
  selected: readonly PlayerId[],
): PlayerId[] {
  const kept = order.filter((id) => selected.includes(id));
  return [...kept, ...selected.filter((id) => !kept.includes(id))];
}

/** Поднять игрока на строку выше в порядке по фишкам. */
export function moveUp(order: readonly PlayerId[], id: PlayerId): PlayerId[] {
  const i = order.indexOf(id);
  if (i <= 0) return [...order];
  const next = [...order];
  next[i - 1] = id;
  next[i] = order[i - 1] as PlayerId;
  return next;
}

/** «выбивает Женя», «выбивают Женя и Саша — нокаут каждому», «кто выбил — не указано». */
export function riverKillersText(killerNames: readonly string[]): string {
  if (killerNames.length === 0) return 'кто выбил — не указано';
  if (killerNames.length === 1) return `выбивает ${killerNames[0]}`;
  return `выбивают ${joinNames(killerNames)} — нокаут каждому`;
}

/** Главная кнопка предложения: «Записать вылет: Дима» / «Записать вылеты: 2» / что сделать. */
export function riverBustLabel(victimNames: readonly string[]): string {
  if (victimNames.length === 0) return 'Отметь, кто вылетел';
  if (victimNames.length === 1) return `Записать вылет: ${victimNames[0]}`;
  return `Записать вылеты: ${victimNames.length}`;
}

/**
 * Вопрос перед записью. byChipNames — вылетевшие от большего стека к меньшему. Без склонения имён
 * и без рода: «Дима — вылет, выбивает Женя».
 */
export function riverBustQuestion(
  byChipNames: readonly string[],
  killerNames: readonly string[],
): { title: string; message: string; confirmText: string } {
  const killers = riverKillersText(killerNames);
  if (byChipNames.length === 1) {
    return {
      title: `Записать вылет: ${byChipNames[0]}?`,
      message: `${byChipNames[0]} — вылет, ${killers}. Фишек хватило и игрок остаётся за столом — нажми «Не записывать».`,
      confirmText: 'Записать вылет',
    };
  }
  const order = byChipNames.map((name, i) => `${i + 1}. ${name}`).join(', ');
  return {
    title: `Записать вылеты: ${byChipNames.length}?`,
    message: `Вылет — ${joinNames(byChipNames)}, ${killers}. Места по фишкам перед раздачей, выше — у кого больше: ${order}.`,
    confirmText: 'Записать вылеты',
  };
}
