// «Олл-ины вечера»: раздачи из журнала (версии, правки, отмены, отклонённые), итог на ривере и
// «победа с N %»: правила swingFromShares и совпадение быстрого allInSwing с полным счётом.
import { describe, expect, it } from 'vitest';
import {
  ALLIN_SWING_MAX_PCT,
  allInShares,
  allInStreets,
  allInSwing,
  allInSwings,
  bestSwing,
  eveningAllIns,
  riverWinners,
  swingFromShares,
  type AllIn,
} from './allins.ts';
import { DEFAULT_FORMAT } from './format.ts';
import { CARD_RANKS, CARD_SUITS } from './showdown.ts';
import { journal, prng } from './test-utils.ts';
import type { CardCode, PlayerId } from './types.ts';

const SD1 = '11111111-1111-4111-8111-111111111111';
const SD2 = '22222222-2222-4222-8222-222222222222';
const SD3 = '33333333-3333-4333-8333-333333333333';

/** Вечер трёх игроков: A, B, C за столом, таймер идёт. */
function table() {
  const j = journal();
  j.join('A', 'B', 'C');
  j.start();
  return j;
}

function allIn(over: Partial<AllIn> & Pick<AllIn, 'hands' | 'board' | 'boardSizes'>): AllIn {
  return {
    showdownId: SD1,
    openedEventId: 1,
    openedAt: '2026-10-08T16:00:00.000Z',
    updatedAt: '2026-10-08T16:00:00.000Z',
    winners: riverWinners(over.hands, over.board),
    ...over,
  };
}

const hand = (playerId: PlayerId, a: CardCode, b: CardCode) => ({
  playerId,
  cards: [a, b] as [CardCode, CardCode],
});

describe('олл-ины вечера из журнала', () => {
  it('раздача по улицам: итоговые руки и стол, улицы по возрастанию, итог на ривере', () => {
    const j = table();
    j.wait(5).showdown(SD1, [
      ['A', 'As', 'Ad'],
      ['B', '7c', '2h'],
    ]);
    j.wait(1).showdown(
      SD1,
      [
        ['A', 'As', 'Ad'],
        ['B', '7c', '2h'],
      ],
      ['7d', '2s', 'Kc'],
    );
    j.wait(1).showdown(
      SD1,
      [
        ['A', 'As', 'Ad'],
        ['B', '7c', '2h'],
      ],
      ['7d', '2s', 'Kc', '9h', '3d'],
    );
    const [a, ...rest] = eveningAllIns(DEFAULT_FORMAT, j.events);
    expect(rest).toEqual([]);
    expect(a).toMatchObject({
      showdownId: SD1,
      openedEventId: 5,
      hands: [hand('A', 'As', 'Ad'), hand('B', '7c', '2h')],
      board: ['7d', '2s', 'Kc', '9h', '3d'],
      boardSizes: [0, 3, 5],
      winners: ['B'],
    });
    expect(a && allInStreets(a).map((s) => [s.street, s.board.length])).toEqual([
      ['preflop', 0],
      ['flop', 3],
      ['river', 5],
    ]);
  });

  it('правка карты — в истории исправленная раздача; отменённый ривер — раздача без итога', () => {
    const j = table();
    j.showdown(
      SD1,
      [
        ['A', 'Ks', 'Kd'],
        ['B', 'Qs', 'Qd'],
      ],
      ['2c', '3c', '4c'],
    );
    // Опечатка в руке B: на самом деле дамы червей и треф.
    j.showdown(
      SD1,
      [
        ['A', 'Ks', 'Kd'],
        ['B', 'Qh', 'Qc'],
      ],
      ['2c', '3c', '4c'],
    );
    j.showdown(
      SD1,
      [
        ['A', 'Ks', 'Kd'],
        ['B', 'Qh', 'Qc'],
      ],
      ['2c', '3c', '4c', '9d'],
    );
    const river = j.showdown(
      SD1,
      [
        ['A', 'Ks', 'Kd'],
        ['B', 'Qh', 'Qc'],
      ],
      ['2c', '3c', '4c', '9d', 'Qs'],
    );
    j.voidEvent(river);
    const [a] = eveningAllIns(DEFAULT_FORMAT, j.events);
    expect(a?.hands).toEqual([hand('A', 'Ks', 'Kd'), hand('B', 'Qh', 'Qc')]);
    expect(a?.boardSizes).toEqual([3, 4]);
    expect(a?.winners).toBeNull();
  });

  it('ривер, снятый правкой (стол снова 4 карты), — не улица этой раздачи', () => {
    const j = table();
    const hs: [PlayerId, CardCode, CardCode][] = [
      ['A', 'Ks', 'Kd'],
      ['B', 'Qh', 'Qc'],
    ];
    j.showdown(SD1, hs, ['2c', '3c', '4c', '9d', 'Qs']);
    j.showdown(SD1, hs, ['2c', '3c', '4c', '9d']);
    const [a] = eveningAllIns(DEFAULT_FORMAT, j.events);
    expect(a?.boardSizes).toEqual([4]);
    expect(a?.winners).toBeNull();
  });

  it('отклонённая версия не в счёт; раздачи — в порядке открытия; закрытие не мешает', () => {
    const j = table();
    j.bust('C', ['A']);
    // C уже вне игры — новую раздачу с ним журнал не примет.
    j.showdown(SD2, [
      ['A', 'As', 'Ks'],
      ['C', 'Qs', 'Qd'],
    ]);
    j.showdown(SD1, [
      ['A', 'As', 'Ks'],
      ['B', 'Qs', 'Qd'],
    ]);
    j.closeShowdown(SD1);
    j.showdown(
      SD3,
      [
        ['A', '9s', '9d'],
        ['B', '8s', '8d'],
      ],
      ['2c', '3h', '4d', '5s', 'Kc'],
    );
    const list = eveningAllIns(DEFAULT_FORMAT, j.events);
    expect(list.map((a) => [a.showdownId, a.boardSizes, a.winners])).toEqual([
      [SD1, [0], null],
      [SD3, [5], ['A']],
    ]);
  });

  it('после «Игра окончена» олл-ин не принимается — и в историю не попадает', () => {
    const j = journal();
    j.join('A', 'B');
    j.start();
    j.bust('B', ['A']);
    j.finish();
    j.showdown(SD1, [
      ['A', 'As', 'Ks'],
      ['B', 'Qs', 'Qd'],
    ]);
    expect(eveningAllIns(DEFAULT_FORMAT, j.events)).toEqual([]);
  });

  it('итог на ривере: делёж банка, сломанные карты и неполный стол — без победителя', () => {
    expect(
      riverWinners(
        [hand('A', 'As', '2d'), hand('B', 'Ah', '3c'), hand('C', 'Kd', 'Qd')],
        ['Ts', 'Js', 'Qs', 'Kh', '9c'],
      ),
    ).toEqual(['A', 'B']);
    expect(riverWinners([hand('A', 'As', '2d'), hand('B', 'Ah', '3c')], ['Ts', 'Js'])).toBeNull();
    expect(
      riverWinners([hand('A', 'Xx', '2d'), hand('B', 'Ah', '3c')], ['Ts', 'Js', 'Qs', 'Kh', '9c']),
    ).toBeNull();
  });
});

describe('«победа с N %» по долям улиц', () => {
  const base = allIn({
    hands: [hand('A', 'As', 'Ad'), hand('B', '7c', '2h'), hand('C', 'Kc', 'Qc')],
    board: ['7d', '2s', 'Kh', '9h', '3d'], // у B две пары — победа B
    boardSizes: [0, 3, 4, 5],
  });

  it('наименьшая доля победителя там, где он уступал; фаворит — у кого доля больше всех', () => {
    expect(base.winners).toEqual(['B']);
    const shares = new Map([
      [0, [70, 12, 18]],
      [3, [20, 75, 5]],
      [4, [25, 74, 1]],
    ]);
    expect(swingFromShares(base, shares)).toEqual({
      showdownId: SD1,
      winnerId: 'B',
      pct: 12,
      boardSize: 0,
      street: 'preflop',
      favoriteIds: ['A'],
      favoritePct: 70,
    });
  });

  it('выше порога, впереди или вровень с лучшим — не «победа с N %»', () => {
    const at = (preflop: number[]) => swingFromShares(base, new Map([[0, preflop]]));
    expect(at([40, ALLIN_SWING_MAX_PCT + 1, 24])).toBeNull();
    expect(at([40, ALLIN_SWING_MAX_PCT, 25])?.pct).toBe(ALLIN_SWING_MAX_PCT);
    // У B 34 % — больше всех: он фаворит, а не отыгравшийся.
    expect(at([33, 34, 33])).toBeNull();
    // Вровень с лучшим — тоже не уступал.
    expect(at([34, 34, 32])).toBeNull();
    // Фаворитов двое — оба.
    expect(at([40, 20, 40])?.favoriteIds).toEqual(['A', 'C']);
  });

  it('равные минимумы — ранняя улица; ривер и улицы без долей не считаются', () => {
    const shares = new Map([
      [0, [60, 30, 10]],
      [3, [65, 30, 5]],
    ]);
    expect(swingFromShares(base, shares)?.street).toBe('preflop');
    expect(swingFromShares(base, new Map([[5, [0, 100, 0]]]))).toBeNull();
    expect(swingFromShares(base, new Map())).toBeNull();
  });

  it('без ривера и при дележе банка — нет', () => {
    const noRiver = {
      ...base,
      board: base.board.slice(0, 4),
      boardSizes: [0, 3, 4],
      winners: null,
    };
    expect(swingFromShares(noRiver, new Map([[0, [70, 12, 18]]]))).toBeNull();
    const split = { ...base, winners: ['A', 'B'] };
    expect(swingFromShares(split, new Map([[0, [70, 12, 18]]]))).toBeNull();
  });

  it('движок: тузы против 7-2 до флопа — 87 на 13, у 7-2 победа с 13 %', () => {
    const a = allIn({
      hands: [hand('A', 'As', 'Ad'), hand('B', '7c', '2h')],
      board: ['7d', '2s', 'Kc', '9h', '3d'],
      boardSizes: [0, 5],
    });
    expect(allInShares(a, { board: [] })).toEqual([87, 13]);
    expect(allInSwing(a)).toEqual({
      showdownId: SD1,
      winnerId: 'B',
      pct: 13,
      boardSize: 0,
      street: 'preflop',
      favoriteIds: ['A'],
      favoritePct: 87,
    });
    // Тузы выиграли — фаворит победил, «победы с N %» нет.
    const aces = allIn({
      hands: a.hands,
      board: ['Ac', '5s', 'Kc', '9h', '3d'],
      boardSizes: [0, 5],
    });
    expect(aces.winners).toEqual(['A']);
    expect(allInSwing(aces)).toBeNull();
  });

  it('несколько раздач: карта побед и самая невероятная — наименьшая доля', () => {
    const preflop = allIn({
      showdownId: SD1,
      openedEventId: 1,
      hands: [hand('A', 'As', 'Ad'), hand('B', '7c', '2h')],
      board: ['7d', '2s', 'Kc', '9h', '3d'],
      boardSizes: [0, 5],
    });
    // Тёрн: у B флеш-дро и стрит-дро против сета — около 30 %, ривер приносит флеш.
    const turn = allIn({
      showdownId: SD2,
      openedEventId: 5,
      hands: [hand('A', 'Kd', 'Kc'), hand('B', 'Jh', 'Th')],
      board: ['Kh', '9h', '2c', '3s', '5h'],
      boardSizes: [4, 5],
    });
    const swings = allInSwings([preflop, turn]);
    expect([...swings.keys()]).toEqual([SD1, SD2]);
    expect(swings.get(SD2)?.street).toBe('turn');
    const best = bestSwing([preflop, turn], swings);
    expect(best?.pct).toBe(Math.min(swings.get(SD1)?.pct ?? 99, swings.get(SD2)?.pct ?? 99));
  });
});

/** Случайная раздача: 2–3 игрока, полный стол, улицы — случайное подмножество (ривер есть). */
function randomAllIn(rnd: () => number, withPreflop: boolean): AllIn {
  const deck: CardCode[] = [];
  for (const r of CARD_RANKS) for (const s of CARD_SUITS) deck.push(`${r}${s}`);
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const k = Math.floor(rnd() * (i + 1));
    [deck[i], deck[k]] = [deck[k] as CardCode, deck[i] as CardCode];
  }
  const n = rnd() < 0.7 ? 2 : 3;
  const ids = ['A', 'B', 'C'].slice(0, n);
  const hands = ids.map((id, i) => hand(id, deck[2 * i] as CardCode, deck[2 * i + 1] as CardCode));
  const board = deck.slice(2 * n, 2 * n + 5);
  const sizes = [3, 4].filter(() => rnd() < 0.6);
  const boardSizes = [...(withPreflop ? [0] : []), ...sizes, 5];
  return allIn({ hands, board, boardSizes: boardSizes.length > 1 ? boardSizes : [3, 5] });
}

describe('быстрый allInSwing ≡ полный счёт по всем улицам', () => {
  const full = (a: AllIn) =>
    swingFromShares(
      a,
      new Map(
        allInStreets(a)
          .filter((s) => s.boardSize < 5)
          .map((s) => [s.boardSize, allInShares(a, s)]),
      ),
    );

  it('300 случайных раздач с флопа и тёрна', () => {
    const rnd = prng(20261008);
    let swings = 0;
    for (let i = 0; i < 300; i += 1) {
      const a = randomAllIn(rnd, false);
      const expected = full(a);
      if (expected) swings += 1;
      expect(allInSwing(a)).toEqual(expected);
    }
    // Проверка не пустая: «победы с N %» среди случайных раздач есть.
    expect(swings).toBeGreaterThan(10);
  });

  it('24 случайные раздачи с улицей до флопа (Монте-Карло и прикидка)', () => {
    const rnd = prng(9102026);
    for (let i = 0; i < 24; i += 1) {
      const a = randomAllIn(rnd, true);
      expect(allInSwing(a)).toEqual(full(a));
    }
    // Монте-Карло до флопа — около 0,1 с на раздачу: под нагрузкой всего прогона дольше 5 с умолчания.
  }, 60_000);
});
