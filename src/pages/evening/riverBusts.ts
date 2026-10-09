// Олл-ин после ривера на пульте: подписи, вопрос, тост и записи действия «вылеты (и ребаи) одной
// раздачи». Кто проиграл и кто кого выбил (с побочными банками) решает домен — riverBusts.ts домена;
// здесь только раскладка (тесты — riverBusts.test.ts). Места считает домен: вылеты одной раздачи
// пишутся одним действием (add_events) от меньшего стека к большему — позже записанный вылет даёт
// место выше; ребаи — после всех вылетов (каждый — как «Вылет и ребай» на пульте).
// Здесь же — сколько предложение держится на пульте (riverSuggestionLive) и где помнится ответ
// «Не записывать» (sessionStorage: переживает переход на другой экран и перезагрузку WebView).
import {
  riverBustDrafts,
  riverBustSuggestion,
  type RiverBustSuggestion,
} from '@domain/riverBusts.ts';
import type { EventDraft } from '@domain/replay.ts';
import type {
  EveningEvent,
  EventType,
  PlayerId,
  ShowdownState,
  TournamentFormat,
} from '@domain/types.ts';
import { pluralWithNumber } from '../../shared/lib/format';
import { capitalize, joinNames } from '../../shared/lib/text';
import { rebuyDrafts } from './lib';

/**
 * Сколько предложение вылета держится на пульте после ривера (последней правки раздачи). Табло
 * прячет раздачу через 2 минуты — банкиру этого мало: он сверяет фишки, а кнопка пропадала. Но и
 * бессрочно нельзя: проигравший, которому фишек хватило, может вылететь через полчаса в другой
 * раздаче, и готовая кнопка «Записать вылет» отдала бы нокаут победителю старой.
 */
export const RIVER_BUST_HOLD_MS = 5 * 60_000;

/** Записи, после которых раздача точно позади: кто-то вылетел, сыграна раздача, сменили уровень. */
const MOVED_ON: ReadonlySet<EventType> = new Set<EventType>([
  'bust',
  'hand',
  'level_next',
  'level_prev',
]);

/**
 * Держится ли предложение вылета по раздаче на пульте: после ривера прошло меньше
 * RIVER_BUST_HOLD_MS и журнал после него не принял ни вылета (любого игрока — в том числе
 * записанного по этой раздаче: это и есть ответ банкира, а кого не отметили, тот остался в игре),
 * ни сыгранной раздачи, ни смены уровня вручную. applied — принятые события (replayLog).
 */
export function riverSuggestionLive(
  hand: Pick<ShowdownState, 'eventId' | 'updatedAt'>,
  applied: readonly Pick<EveningEvent, 'id' | 'type'>[],
  nowMs: number,
): boolean {
  const updatedMs = Date.parse(hand.updatedAt);
  if (!Number.isNaN(updatedMs) && nowMs - updatedMs >= RIVER_BUST_HOLD_MS) return false;
  return !applied.some((e) => e.id > hand.eventId && MOVED_ON.has(e.type));
}

/**
 * Предложение вылета на пульте (кнопки «Записать вылет: X», «Вылет и ребай»): раздача в состоянии
 * вечера — и спрятанная табло, но в срок (riverSuggestionLive); declined — версия раздачи, по которой
 * банкир ответил «Не записывать». Кто проиграл и кто выбил — домен (riverBustSuggestion).
 */
export function pultRiverSuggestion(
  hand: ShowdownState | null,
  isAlive: (id: PlayerId) => boolean,
  applied: readonly Pick<EveningEvent, 'id' | 'type' | 'payload'>[],
  nowMs: number,
  declined: number | null = null,
): RiverBustSuggestion | null {
  if (!hand || hand.eventId === declined || !riverSuggestionLive(hand, applied, nowMs)) return null;
  return riverBustSuggestion(hand, isAlive, applied);
}

type SessionLike = Pick<Storage, 'getItem' | 'setItem'>;

/** Ключ sessionStorage: версия раздачи, по которой банкир ответил «Не записывать» в этом вечере. */
export const riverDeclinedKey = (eveningId: string): string =>
  `poker-club:river-declined:${eveningId}`;

/** Версия раздачи (eventId), по которой ответили «Не записывать», или null. */
export function readRiverDeclined(storage: SessionLike | null, eveningId: string): number | null {
  try {
    const raw = storage?.getItem(riverDeclinedKey(eveningId));
    const id = raw ? Number(raw) : NaN;
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export function writeRiverDeclined(
  storage: SessionLike | null,
  eveningId: string,
  eventId: number,
): void {
  try {
    storage?.setItem(riverDeclinedKey(eveningId), String(eventId));
  } catch {
    // Приватный режим или запрет хранилища — ответ живёт, пока открыт экран вечера.
  }
}

/** Что записать по раздаче после ривера: вылеты, кто выбил, ребаи сразу и закрыть раздачу. */
export interface RiverPlan {
  showdownId: string;
  /** Вылетевшие от большего стека к меньшему: выше в списке — место выше. */
  byChips: PlayerId[];
  /** Кто выбил каждого (делёж — нокаут каждому, пусто — никому). */
  killers: Record<PlayerId, PlayerId[]>;
  /** Кто из вылетевших сразу докупается (×1). */
  rebuys: PlayerId[];
  /** «Оплачено сразу» у этих ребаев. */
  paid: boolean;
}

/** Записи действия: вылеты в порядке мест, затем ребаи (и их платежи, если «Оплачено сразу»). */
export function riverPlanDrafts(format: TournamentFormat, plan: RiverPlan): EventDraft[] {
  return [
    ...riverBustDrafts(plan.byChips, plan.killers),
    ...plan.byChips
      .filter((id) => plan.rebuys.includes(id))
      .flatMap((id) => rebuyDrafts(format, id, 1, plan.paid)),
  ];
}

/** Ключ варианта «кто выбил» (группа равных рук) — значение переключателя. */
export function killerKey(group: readonly PlayerId[]): string {
  return group.join(',');
}

/**
 * Сколько знаков подписи «кто выбил» помещается в кнопку ряда из двух на 320 px (прописные Inter 14
 * с разрядкой, около 130 px на кнопку): длиннее — слово рвалось бы посреди.
 */
export const KILLER_ROW_MAX_CHARS = 12;

/** Варианты «кто выбил» — столбиком: больше двух или хоть одна подпись не помещается в ряд. */
export function killersInColumn(labels: readonly string[]): boolean {
  return labels.length > 2 || labels.some((l) => Array.from(l).length > KILLER_ROW_MAX_CHARS);
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

/**
 * Главная кнопка: «Записать вылет: Дима», «Вылет и ребай: Дима», «Записать вылеты: 2»,
 * «Записать вылеты: 2 и ребай» / «…: 3 и 2 ребая»; никого не отметили — что сделать.
 */
export function riverBustLabel(victimNames: readonly string[], rebuys = 0): string {
  if (victimNames.length === 0) return 'Отметь, кто вылетел';
  if (victimNames.length === 1)
    return rebuys > 0 ? `Вылет и ребай: ${victimNames[0]}` : `Записать вылет: ${victimNames[0]}`;
  const base = `Записать вылеты: ${victimNames.length}`;
  if (rebuys === 0) return base;
  return `${base} и ${rebuys === 1 ? 'ребай' : pluralWithNumber(rebuys, ['ребай', 'ребая', 'ребаев'])}`;
}

/** Вопрос перед записью одного вылета с пульта. Без склонения имён и без рода. */
export function riverBustQuestion(
  victimName: string,
  killerNames: readonly string[],
): { title: string; message: string; confirmText: string } {
  return {
    title: `Записать вылет: ${victimName}?`,
    message: `${victimName} — вылет, ${riverKillersText(killerNames)}. Раздача закроется. Фишек хватило и игрок остаётся за столом — нажми «Не записывать».`,
    confirmText: 'Записать вылет',
  };
}

/**
 * Тост после записи: «Вылет записан: Дима» / «Вылет и ребай: Дима» / «Вылеты записаны: Дима и
 * Лёша», в подробностях — кто кого выбил (у всех один — одной фразой) и ребаи.
 */
export function riverToast(
  plan: Pick<RiverPlan, 'byChips' | 'killers' | 'rebuys' | 'paid'>,
  nameOf: (id: PlayerId) => string,
): { success: string; detail: string } {
  const names = plan.byChips.map(nameOf);
  const rebuys = plan.byChips.filter((id) => plan.rebuys.includes(id));
  const single = names.length === 1;
  const success = single
    ? rebuys.length > 0
      ? `Вылет и ребай: ${names[0]}`
      : `Вылет записан: ${names[0]}`
    : `Вылеты записаны: ${joinNames(names)}`;
  const killerKeys = new Set(plan.byChips.map((id) => killerKey(plan.killers[id] ?? [])));
  const ko =
    killerKeys.size <= 1
      ? `${capitalize(riverKillersText((plan.killers[plan.byChips[0] ?? ''] ?? []).map(nameOf)))}.`
      : `${plan.byChips.map((id) => `${nameOf(id)}: ${riverKillersText((plan.killers[id] ?? []).map(nameOf))}`).join('; ')}.`;
  const rebuyText =
    rebuys.length === 0
      ? null
      : single
        ? plan.paid
          ? 'Ребай оплачен сразу.'
          : null
        : `Ребай: ${joinNames(rebuys.map(nameOf))}${plan.paid ? ', оплачено сразу' : ''}.`;
  return { success, detail: [ko, rebuyText].filter(Boolean).join(' ') };
}
