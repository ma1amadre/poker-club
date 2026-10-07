// Олл-ин на вскрытии: карты участников и стола, которые банкир отмечает в пульте, а табло и экран
// вечера показывают с шансами. Здесь — форма payload и правило «когда раздачу не показывать».
// Шансы и ауты считает клиент (src/shared/lib/poker): серверу они не нужны, на деньги, места и
// очки раздача не влияет.
//
// Почему так устроено:
// - Каждое событие 'showdown' несёт полное состояние раздачи (руки и стол), а не «добавь тёрн»:
//   правка карты — просто новая версия, отмена последней записи возвращает предыдущую, и replay
//   не нужно склеивать дельты.
// - Те же правила формы проверяет SQL (add_event, миграция 017); живые ли игроки — только replay,
//   как и остальные игровые правила.
import type { CardCode, EventType, ShowdownHand, ShowdownPayload, ShowdownState } from './types.ts';

/** Ранги по возрастанию: 2…9, T (десятка), J, Q, K, A. */
export const CARD_RANKS = '23456789TJQKA';
/** Масти в порядке показа: пики, червы, бубны, трефы. */
export const CARD_SUITS = 'shdc';

export const SHOWDOWN_MIN_HANDS = 2;
export const SHOWDOWN_MAX_HANDS = 9;
/** Сколько карт может лежать на столе: до флопа, флоп, тёрн, ривер. */
export const SHOWDOWN_BOARD_SIZES: readonly number[] = [0, 3, 4, 5];

/**
 * После ривера раздача висит на экране столько, если её не закрыли: время на вылет и разговоры
 * за столом, дальше табло возвращается к таймеру само.
 */
export const SHOWDOWN_RIVER_HOLD_MS = 2 * 60_000;
/**
 * Раздачу без правок дольше этого табло тоже прячет: живой олл-ин доходит до ривера за минуту,
 * забытая раздача не должна закрывать таймер весь уровень.
 */
export const SHOWDOWN_IDLE_HIDE_MS = 10 * 60_000;

const CARD_RE = /^[2-9TJQKA][shdc]$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Событие показа олл-ина: на игру, деньги и итоги не влияет. */
export function isShowdownEvent(type: EventType): boolean {
  return type === 'showdown' || type === 'showdown_close';
}

/** Карта в нотации 'As', 'Td', '9h' (ранг — заглавной, масть — строчной). */
export function isCardCode(value: unknown): value is CardCode {
  return typeof value === 'string' && CARD_RE.test(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** id раздачи из payload (uuid, в нижнем регистре — как его хранит SQL) или null. */
export function readShowdownId(payload: unknown): string | null {
  const id = asRecord(payload)?.showdownId;
  return typeof id === 'string' && UUID_RE.test(id) ? id.toLowerCase() : null;
}

export type ShowdownRead = { ok: true; value: ShowdownPayload } | { ok: false; error: string };

/**
 * payload 'showdown' → раздача или текст ошибки. Только форма: id, 2..9 рук по две карты, без
 * повторов игроков и карт, на столе 0/3/4/5 карт. Кто из игроков может быть в раздаче — решает
 * replay по состоянию вечера.
 */
export function readShowdown(payload: unknown): ShowdownRead {
  const record = asRecord(payload);
  const showdownId = readShowdownId(record);
  if (showdownId === null) return { ok: false, error: 'Олл-ин: нет id раздачи' };

  const rawHands = record?.hands;
  if (!Array.isArray(rawHands)) return { ok: false, error: 'Олл-ин: нет списка рук' };
  const handsList: unknown[] = rawHands;
  if (handsList.length < SHOWDOWN_MIN_HANDS || handsList.length > SHOWDOWN_MAX_HANDS)
    return {
      ok: false,
      error: `Олл-ин: игроков — от ${SHOWDOWN_MIN_HANDS} до ${SHOWDOWN_MAX_HANDS}`,
    };

  const hands: ShowdownHand[] = [];
  const players = new Set<string>();
  const seen = new Set<CardCode>();
  const takeCard = (card: unknown): string | null => {
    if (!isCardCode(card))
      return `Олл-ин: «${String(card)}» — не карта, нужна запись вида As, Td, 9h`;
    if (seen.has(card)) return `Олл-ин: карта ${card} указана дважды`;
    seen.add(card);
    return null;
  };

  for (const raw of handsList) {
    const hand = asRecord(raw);
    const playerId = hand?.playerId;
    if (typeof playerId !== 'string' || playerId === '')
      return { ok: false, error: 'Олл-ин: у руки не указан игрок' };
    if (players.has(playerId)) return { ok: false, error: 'Олл-ин: игрок указан дважды' };
    players.add(playerId);
    const cards = hand?.cards;
    if (!Array.isArray(cards) || cards.length !== 2)
      return { ok: false, error: 'Олл-ин: у каждого игрока — две карты' };
    const pair: unknown[] = cards;
    for (const card of pair) {
      const problem = takeCard(card);
      if (problem) return { ok: false, error: problem };
    }
    hands.push({ playerId, cards: [pair[0] as CardCode, pair[1] as CardCode] });
  }

  const rawBoard = record?.board;
  if (!Array.isArray(rawBoard)) return { ok: false, error: 'Олл-ин: нет карт стола' };
  const boardList: unknown[] = rawBoard;
  if (!SHOWDOWN_BOARD_SIZES.includes(boardList.length))
    return { ok: false, error: 'Олл-ин: на столе 0, 3, 4 или 5 карт' };
  for (const card of boardList) {
    const problem = takeCard(card);
    if (problem) return { ok: false, error: problem };
  }

  return { ok: true, value: { showdownId, hands, board: boardList as CardCode[] } };
}

/** Улица по числу карт на столе. */
export type Street = 'preflop' | 'flop' | 'turn' | 'river';

export function streetOf(boardSize: number): Street {
  if (boardSize >= 5) return 'river';
  if (boardSize === 4) return 'turn';
  if (boardSize === 3) return 'flop';
  return 'preflop';
}

/**
 * Раздача, которую сейчас показывают табло и экран вечера, или null. Открытую раздачу прячет время:
 * через SHOWDOWN_RIVER_HOLD_MS после последней правки, если на столе уже ривер, и через
 * SHOWDOWN_IDLE_HIDE_MS без правок на любой улице. Время — серверное (nowMs), поэтому все экраны
 * прячут раздачу в одну и ту же секунду.
 */
export function visibleShowdown(
  showdown: ShowdownState | null,
  nowMs: number,
): ShowdownState | null {
  if (!showdown) return null;
  const updatedMs = Date.parse(showdown.updatedAt);
  if (Number.isNaN(updatedMs)) return showdown;
  const idleMs = nowMs - updatedMs;
  if (showdown.board.length >= 5 && idleMs >= SHOWDOWN_RIVER_HOLD_MS) return null;
  if (idleMs >= SHOWDOWN_IDLE_HIDE_MS) return null;
  return showdown;
}
