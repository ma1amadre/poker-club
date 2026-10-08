// Разбор раздачи олл-ина для табло: кто впереди сейчас, чем, и ауты отстающих.
//
// Ауты (определение — ARCHITECTURE.md, «Олл-ин»): для каждого игрока, который на текущем столе НЕ
// впереди (его рука слабее лучшей), — карты из невидимой колоды (52 без всех открытых рук и стола),
// после которых на следующей улице он впереди один (`outs`) или делит лучшую руку (`splitOuts`).
// Флоп — ауты к тёрну (одна карта; общие шансы до ривера — в эквити), тёрн — к риверу, до флопа и
// на ривере аутов нет: до флопа только проценты, на ривере всё решено.
import { streetOf, type Street } from '@domain/showdown.ts';
import { cardCode, deckWithout, parseCards, type Card } from './cards';
import { describeHand, evaluate } from './evaluator';
import type { EquityResult } from './equity';
import { outsEquity } from './pokermath';

export { roundShares } from '@domain/poker/shares.ts';

export interface PlayerOuts {
  /** Карты, после которых игрок впереди один. */
  outs: string[];
  /** Карты, после которых он делит лучшую руку. */
  splitOuts: string[];
  /** Вероятность, что следующая карта — один из аутов (с дележом), %. */
  hitPct: number;
}

export interface PlayerShowdown {
  /** Доля банка, %. */
  equity: number;
  /** Частота чистой победы, %. */
  win: number;
  /** Частота дележа, %. */
  tie: number;
  /** Рука на текущем столе словами («Пара тузов»); null до флопа. */
  hand: string | null;
  /** Впереди на текущем столе (лучшая рука, в том числе поровну с кем-то); до флопа — false. */
  ahead: boolean;
  /** Ауты на флопе и тёрне у тех, кто не впереди; иначе null. */
  outs: PlayerOuts | null;
}

export interface ShowdownAnalysis {
  street: Street;
  players: PlayerShowdown[];
  /** Сколько карт не видно (колода без рук и стола). */
  unseen: number;
  /** Точный перебор или Монте-Карло. */
  exact: boolean;
  /** Сколько досок перебрано или разыграно. */
  samples: number;
  /** На ривере — индексы тех, у кого лучшая рука (больше одного — делёж); иначе null. */
  winners: number[] | null;
}

function scoresOn(hands: readonly (readonly Card[])[], board: readonly Card[]): number[] {
  return hands.map((h) => evaluate([h[0]!, h[1]!, ...board]));
}

/**
 * Ауты к следующей карте для каждого игрока, который сейчас не впереди; у тех, кто впереди, — null.
 * Стол — 3 или 4 карты (на других улицах аутов нет — null целиком).
 */
export function computeOuts(
  hands: readonly (readonly Card[])[],
  board: readonly Card[],
): (Omit<PlayerOuts, 'hitPct'> | null)[] | null {
  if (board.length !== 3 && board.length !== 4) return null;
  const now = scoresOn(hands, board);
  const best = Math.max(...now);
  const deck = deckWithout([...board, ...hands.flat()]);
  const res = hands.map((_, i) =>
    (now[i] ?? 0) < best ? { outs: [] as string[], splitOuts: [] as string[] } : null,
  );
  if (res.every((r) => r === null)) return res;
  const next = [...board, 0];
  for (const card of deck) {
    next[board.length] = card;
    const after = scoresOn(hands, next);
    const top = Math.max(...after);
    const leaders = after.filter((s) => s === top).length;
    res.forEach((r, i) => {
      if (!r || after[i] !== top) return;
      (leaders === 1 ? r.outs : r.splitOuts).push(cardCode(card));
    });
  }
  return res;
}

/**
 * Полный разбор раздачи по уже посчитанным шансам (computeEquity / useShowdownEquity): рука
 * каждого словами, кто впереди, ауты, победители на ривере.
 */
export function analyzeShowdown(
  handCodes: readonly (readonly string[])[],
  boardCodes: readonly string[],
  equity: EquityResult,
): ShowdownAnalysis {
  const hands = handCodes.map((h) => parseCards(h));
  const board = parseCards(boardCodes);
  const street = streetOf(board.length);
  const unseen = 52 - board.length - 2 * hands.length;
  const scores = board.length >= 3 ? scoresOn(hands, board) : null;
  const best = scores ? Math.max(...scores) : null;
  const outs = computeOuts(hands, board);
  const cardsToCome = 1 as const;

  const players = hands.map((_, i): PlayerShowdown => {
    const o = outs?.[i] ?? null;
    return {
      equity: equity.equity[i] ?? 0,
      win: equity.win[i] ?? 0,
      tie: equity.tie[i] ?? 0,
      hand: scores ? describeHand(scores[i] ?? 0) : null,
      ahead: scores !== null && scores[i] === best,
      outs: o
        ? { ...o, hitPct: outsEquity(o.outs.length + o.splitOuts.length, cardsToCome, unseen) }
        : null,
    };
  });

  const winners =
    street === 'river' && scores ? scores.flatMap((s, i) => (s === best ? [i] : [])) : null;

  return { street, players, unseen, exact: equity.exact, samples: equity.samples, winners };
}
