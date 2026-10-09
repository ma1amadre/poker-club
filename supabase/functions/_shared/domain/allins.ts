// «Олл-ины вечера»: все раздачи, которые банкир отметил в пульте, — карты, улицы и итог на ривере —
// и «победа с 18 %»: раздача, которую выиграл тот, у кого на одной из улиц шансов было меньше всех.
// Всё выводится из журнала (события 'showdown', принятые replay); шансы — движок домена (poker/),
// тот же, что считает табло, поэтому цифры в истории, сюжете вечера и посте совпадают с табло.
//
// Правила:
// - Раздача — все принятые версии с одним showdownId. Руки и стол — последней версии: опечатку в
//   карте банкир правит новой версией, и в истории остаётся исправленная раздача.
// - Улицы — размеры стола, с которыми раздачу показывали (0, 3, 4, 5), но не больше итогового стола:
//   ривер, который потом сняли правкой, не в счёт. Олл-ин на флопе — без улицы «до флопа»: до флопа
//   его ещё не было. Шансы на улице считаются по итоговым рукам и картам итогового стола.
// - Итог есть только у раздачи, дошедшей до ривера: лучшая рука (несколько — делёж банка).
// - «Победа с N %» (swing): победитель один, и на какой-то улице до ривера его доля банка (целые %,
//   как на табло — roundShares) была меньше, чем у кого-то из соперников, и не больше
//   ALLIN_SWING_MAX_PCT. N — наименьшая такая доля, фаворит — у кого на той улице доля больше всех.
//
// Стоимость: флоп и тёрн — точный перебор (меньше тысячи досок), до флопа — Монте-Карло движка
// (~0,1 с на руку). allInSwing считает полный Монте-Карло только там, где быстрая прикидка
// (ALLIN_QUICK_SAMPLES раздач) не исключает «победу с N %»: функции итогов укладываются в лимит CPU,
// а ответ тот же, что у полного счёта (swingFromShares по всем улицам — тест allins.test.ts).
import { parseCards } from './poker/cards.ts';
import {
  computeEquity,
  monteCarloEquity,
  planEquity,
  seedFor,
  showdownKey,
  type EquityResult,
} from './poker/equity.ts';
import { evaluate } from './poker/evaluator.ts';
import { roundShares } from './poker/shares.ts';
import { replayLog } from './replay.ts';
import { readShowdown, streetOf, type Street } from './showdown.ts';
import type { CardCode, EveningEvent, PlayerId, ShowdownHand, TournamentFormat } from './types.ts';

/** До скольких % доли банка победа считается «победой с N %». */
export const ALLIN_SWING_MAX_PCT = 35;
/** Быстрая прикидка до флопа: столько раздач Монте-Карло (погрешность доли — около 1 п. п.). */
export const ALLIN_QUICK_SAMPLES = 3000;
/** Запас прикидки: выше ALLIN_SWING_MAX_PCT + запас полный счёт не нужен (запас — 8 погрешностей). */
export const ALLIN_QUICK_MARGIN_PCT = 8;

export interface AllIn {
  showdownId: string;
  /** Первая принятая версия раздачи. */
  openedEventId: number;
  openedAt: string;
  /** Последняя принятая версия. */
  updatedAt: string;
  /** Руки и стол последней версии — какими раздачу в итоге внёс банкир. */
  hands: ShowdownHand[];
  board: CardCode[];
  /** Размеры стола, с которыми раздачу показывали (0/3/4/5), не больше итогового, по возрастанию. */
  boardSizes: number[];
  /** На ривере — лучшая рука (несколько — делёж банка), в порядке рук; до ривера — null. */
  winners: PlayerId[] | null;
}

/** Улица раздачи: стол — первые boardSize карт итогового стола. */
export interface AllInStreet {
  boardSize: number;
  street: Street;
  board: CardCode[];
  /** Ключ раздачи движка (showdownKey) — по нему кешируются шансы на клиенте. */
  key: string;
}

export interface AllInSwing {
  showdownId: string;
  winnerId: PlayerId;
  /** Доля банка победителя (целые %, как на табло) там, где шансов было меньше всего. */
  pct: number;
  boardSize: number;
  street: Street;
  /** Фаворит той улицы: больше всех шансов (ничья — все); и его доля. */
  favoriteIds: PlayerId[];
  favoritePct: number;
}

/**
 * Руки на полном столе (5 карт) от лучшей к худшей: группы равных рук (делёж), внутри — в порядке
 * рук раздачи. До ривера, меньше двух рук или при сломанных картах — null.
 */
export function riverRanking(
  hands: readonly ShowdownHand[],
  board: readonly CardCode[],
): PlayerId[][] | null {
  if (board.length !== 5 || hands.length < 2) return null;
  let scores: number[];
  try {
    const parsedBoard = parseCards(board);
    scores = hands.map((h) => evaluate([...parseCards(h.cards), ...parsedBoard]));
  } catch {
    return null;
  }
  return [...new Set(scores)]
    .sort((a, b) => b - a)
    .map((score) => hands.filter((_, i) => scores[i] === score).map((h) => h.playerId));
}

/** Лучшая рука на полном столе (5 карт): игроки с лучшим счётом; иначе или при сломанных картах — null. */
export function riverWinners(
  hands: readonly ShowdownHand[],
  board: readonly CardCode[],
): PlayerId[] | null {
  return riverRanking(hands, board)?.[0] ?? null;
}

/**
 * Раздачи вечера из принятых событий (ReplayLog.applied) в порядке первой версии. Форма payload уже
 * проверена replay; readShowdown — на случай чужого списка.
 */
export function allInsFromApplied(applied: readonly EveningEvent[]): AllIn[] {
  const byId = new Map<string, AllIn & { sizes: Set<number> }>();
  for (const ev of applied) {
    if (ev.type !== 'showdown') continue;
    const read = readShowdown(ev.payload);
    if (!read.ok) continue;
    const { showdownId, hands, board } = read.value;
    const prev = byId.get(showdownId);
    const next = prev ?? {
      showdownId,
      openedEventId: ev.id,
      openedAt: ev.at,
      updatedAt: ev.at,
      hands: [],
      board: [],
      boardSizes: [],
      winners: null,
      sizes: new Set<number>(),
    };
    next.updatedAt = ev.at;
    next.hands = hands.map((h) => ({ playerId: h.playerId, cards: [h.cards[0], h.cards[1]] }));
    next.board = [...board];
    next.sizes.add(board.length);
    byId.set(showdownId, next);
  }
  return [...byId.values()]
    .sort((a, b) => a.openedEventId - b.openedEventId)
    .map(({ sizes, ...a }) => ({
      ...a,
      boardSizes: [...sizes].filter((n) => n <= a.board.length).sort((x, y) => x - y),
      winners: riverWinners(a.hands, a.board),
    }));
}

/** Олл-ины вечера по журналу: принятые replay версии раздач (отменённые и отклонённые — нет). */
export function eveningAllIns(
  format: TournamentFormat,
  events: readonly EveningEvent[],
  nowMs?: number,
): AllIn[] {
  const lastMs = events.reduce((m, e) => Math.max(m, Date.parse(e.at) || 0), 0);
  return allInsFromApplied(replayLog(format, events, nowMs ?? lastMs).applied);
}

/** Улицы раздачи по порядку (с ривером, если он был), стол каждой — префикс итогового стола. */
export function allInStreets(allIn: AllIn): AllInStreet[] {
  const cards = allIn.hands.map((h) => h.cards);
  return allIn.boardSizes.map((boardSize) => {
    const board = allIn.board.slice(0, boardSize);
    return { boardSize, street: streetOf(boardSize), board, key: showdownKey(cards, board) };
  });
}

/** Шансы движка по ключу — подменяется на клиенте кешем шансов табло (тот же счёт). */
export type AllInEquity = (
  hands: readonly (readonly CardCode[])[],
  board: readonly CardCode[],
) => EquityResult;

/** Доли банка на улице — целые %, как на табло. */
export function allInShares(
  allIn: AllIn,
  street: Pick<AllInStreet, 'board'>,
  equity: AllInEquity = computeEquity,
): number[] {
  return roundShares(
    equity(
      allIn.hands.map((h) => h.cards),
      street.board,
    ).equity,
  );
}

/**
 * «Победа с N %» по готовым долям улиц (размер стола → доли в порядке рук; улицы без долей
 * пропускаются). null — раздача не дошла до ривера, делёж банка или победитель ни на одной улице
 * не уступал сопернику с долей не больше ALLIN_SWING_MAX_PCT. Равные минимумы — ранняя улица.
 */
export function swingFromShares(
  allIn: AllIn,
  sharesBySize: ReadonlyMap<number, readonly number[]>,
): AllInSwing | null {
  const winnerId = allIn.winners?.length === 1 ? allIn.winners[0] : undefined;
  if (winnerId === undefined) return null;
  const w = allIn.hands.findIndex((h) => h.playerId === winnerId);
  let best: AllInSwing | null = null;
  for (const size of allIn.boardSizes) {
    if (size >= 5) continue;
    const shares = sharesBySize.get(size);
    const pct = shares?.[w];
    if (!shares || pct === undefined || pct > ALLIN_SWING_MAX_PCT) continue;
    const others = shares.filter((_, i) => i !== w);
    const top = Math.max(...others);
    if (!(top > pct) || (best && pct >= best.pct)) continue;
    best = {
      showdownId: allIn.showdownId,
      winnerId,
      pct,
      boardSize: size,
      street: streetOf(size),
      favoriteIds: allIn.hands
        .filter((_, i) => i !== w && shares[i] === top)
        .map((h) => h.playerId),
      favoritePct: top,
    };
  }
  return best;
}

/**
 * «Победа с N %» раздачи, шансы — движком. До флопа полный Монте-Карло — только если быстрая
 * прикидка оставляет победителю не больше ALLIN_SWING_MAX_PCT + ALLIN_QUICK_MARGIN_PCT: выше этого
 * такая улица «победой с N %» стать не может, а ответ совпадает со swingFromShares по всем улицам.
 */
export function allInSwing(allIn: AllIn, equity: AllInEquity = computeEquity): AllInSwing | null {
  const winnerId = allIn.winners?.length === 1 ? allIn.winners[0] : undefined;
  if (winnerId === undefined) return null;
  const w = allIn.hands.findIndex((h) => h.playerId === winnerId);
  const cards = allIn.hands.map((h) => h.cards);
  const shares = new Map<number, number[]>();
  for (const street of allInStreets(allIn)) {
    if (street.boardSize >= 5) continue;
    const plan = planEquity(cards.length, street.boardSize, street.key);
    if (plan.kind === 'mc') {
      const quick = monteCarloEquity(
        cards.map((c) => parseCards(c)),
        parseCards(street.board),
        ALLIN_QUICK_SAMPLES,
        seedFor(`quick|${street.key}`),
      );
      if ((quick.equity[w] ?? 0) > ALLIN_SWING_MAX_PCT + ALLIN_QUICK_MARGIN_PCT) continue;
    }
    shares.set(street.boardSize, allInShares(allIn, street, equity));
  }
  return swingFromShares(allIn, shares);
}

/** «Победы с N %» всех раздач вечера: showdownId → swing (раздачи без неё — нет в карте). */
export function allInSwings(
  allIns: readonly AllIn[],
  equity: AllInEquity = computeEquity,
): Map<string, AllInSwing> {
  const out = new Map<string, AllInSwing>();
  for (const a of allIns) {
    const swing = allInSwing(a, equity);
    if (swing) out.set(a.showdownId, swing);
  }
  return out;
}

/** Самая невероятная победа вечера: наименьшая доля; равные — раньше открытая раздача. */
export function bestSwing(
  allIns: readonly AllIn[],
  swings: ReadonlyMap<string, AllInSwing>,
): AllInSwing | null {
  let best: AllInSwing | null = null;
  for (const a of allIns) {
    const s = swings.get(a.showdownId);
    if (s && (!best || s.pct < best.pct)) best = s;
  }
  return best;
}
