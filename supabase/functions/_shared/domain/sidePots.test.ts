// Калькулятор банков олл-ина: вклады, слои банков, мёртвые деньги, делёж и нечётные фишки (TDA 21),
// возврат, итоговые стеки, вылеты и кто выбил. Каждый случай проверяет сохранение фишек (settle), а
// сотни случайных раздач сверяются с прямым пересчётом и с правилом riverBusts.ts без стеков.
import { describe, expect, it } from 'vitest';
import { riverRanking } from './allins.ts';
import { DEFAULT_FORMAT } from './format.ts';
import { parseCards } from './poker/cards.ts';
import { evaluate } from './poker/evaluator.ts';
import { replay, replayLog } from './replay.ts';
import { riverBustDrafts, riverKillerGroups } from './riverBusts.ts';
import { handSeating } from './seats.ts';
import { CARD_RANKS, CARD_SUITS } from './showdown.ts';
import {
  oddChipOrder,
  sidePotBustDrafts,
  sidePots,
  splitPot,
  type SidePotInput,
  type SidePots,
} from './sidePots.ts';
import { journal, prng } from './test-utils.ts';
import {
  TABLE_SEATS,
  type CardCode,
  type HandSeating,
  type PlayerId,
  type ShowdownHand,
} from './types.ts';

const hand = (playerId: string, a: string, b: string): ShowdownHand => ({
  playerId,
  cards: [a, b],
});
/** Стол без стрита и флеша: решают пары и старшие карты. */
const BOARD = ['2c', '7h', '9s', 'Jc', '3d'];
/** Стол играет у всех: стрит до туза разномастный, сильнее руки с двумя картами не собрать. */
const BOARD_PLAYS = ['As', 'Kd', 'Qh', 'Jc', 'Ts'];
// Руки по силе на BOARD: тузы > короли (две равные пары) > дамы > десятки > восьмёрки.
const AA = (id: string) => hand(id, 'As', 'Ah');
const KK = (id: string) => hand(id, 'Kd', 'Ks');
const KK2 = (id: string) => hand(id, 'Kc', 'Kh');
const QQ = (id: string) => hand(id, 'Qs', 'Qh');
const TT = (id: string) => hand(id, 'Td', 'Th');
const EE = (id: string) => hand(id, '8c', '8d');

const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);

/** Ввод калькулятора: [рука, стек на начало раздачи] по порядку рук; номинал по умолчанию — 1. */
function input(players: [ShowdownHand, number][], extra: Partial<SidePotInput> = {}): SidePotInput {
  return {
    hands: players.map(([h]) => h),
    board: BOARD,
    stacks: Object.fromEntries(players.map(([h, s]) => [h.playerId, s])),
    chipUnit: 1,
    ...extra,
  };
}

/**
 * Банки с проверкой сохранения фишек: банки = вклады + мёртвые деньги, доли банка = банк,
 * выплаты = вклады + мёртвые деньги, стеки после = стеки до + мёртвые деньги, никто не уходит в минус.
 */
function settle(inp: SidePotInput): SidePots {
  const read = sidePots(inp);
  if (!read.ok) throw new Error(read.error);
  const v = read.value;
  const ids = inp.hands.map((h) => h.playerId);
  const dead = sum(inp.dead ?? []);
  const contributed = sum(ids.map((id) => v.contributions[id] as number)) + dead;
  expect(v.dead).toBe(dead);
  expect(v.total).toBe(contributed);
  expect(sum(v.pots.map((p) => p.amount))).toBe(contributed);
  expect(sum(v.pots.map((p) => p.dead))).toBe(dead);
  for (const p of v.pots) if (p.shares) expect(sum(Object.values(p.shares))).toBe(p.amount);
  for (const id of ids) {
    expect(v.contributions[id]).toBeGreaterThanOrEqual(1);
    expect(v.contributions[id]).toBeLessThanOrEqual(inp.stacks[id] as number);
  }
  const r = v.result;
  if (r) {
    expect(sum(ids.map((id) => r.payouts[id] as number))).toBe(contributed);
    expect(sum(ids.map((id) => r.finalStacks[id] as number))).toBe(
      sum(ids.map((id) => inp.stacks[id] as number)) + dead,
    );
    for (const id of ids) {
      expect(r.finalStacks[id]).toBeGreaterThanOrEqual(0);
      expect(r.finalStacks[id]).toBe(
        (inp.stacks[id] as number) - (v.contributions[id] as number) + (r.payouts[id] as number),
      );
    }
    expect([...r.busted].sort()).toEqual(ids.filter((id) => r.finalStacks[id] === 0).sort());
    expect(Object.keys(r.knockouts).sort()).toEqual([...r.busted].sort());
  }
  return v;
}

/** Банки коротко: [сумма, участники, победители]. */
const brief = (v: SidePots) => v.pots.map((p) => [p.amount, p.eligible, p.winners]);

describe('sidePots: основной и побочные банки', () => {
  it('классика: короткий олл-ин выигрывает основной, побочный — между двумя большими', () => {
    const v = settle(
      input([
        [AA('a'), 100],
        [KK('b'), 500],
        [QQ('c'), 800],
      ]),
    );
    expect(v.contributions).toEqual({ a: 100, b: 500, c: 500 });
    expect(brief(v)).toEqual([
      [300, ['a', 'b', 'c'], ['a']],
      [800, ['b', 'c'], ['b']],
    ]);
    expect(v.pots.map((p) => p.level)).toEqual([100, 500]);
    expect(v.result).toEqual({
      payouts: { a: 300, b: 800, c: 0 },
      // У c лишние 300 никто не уравнял — остаются у него, он в игре.
      finalStacks: { a: 300, b: 800, c: 300 },
      busted: [],
      knockouts: {},
    });
  });

  it('классика: большой стек забирает оба банка — короткий вылетает, выбил он', () => {
    const v = settle(
      input([
        [QQ('a'), 100],
        [AA('b'), 500],
        [KK('c'), 800],
      ]),
    );
    expect(brief(v)).toEqual([
      [300, ['a', 'b', 'c'], ['b']],
      [800, ['b', 'c'], ['b']],
    ]);
    expect(v.result?.finalStacks).toEqual({ a: 0, b: 1100, c: 300 });
    expect(v.result?.busted).toEqual(['a']);
    expect(v.result?.knockouts).toEqual({ a: ['b'] });
  });

  it('три разных стека: основной у короткого, побочный выбивает среднего', () => {
    const v = settle(
      input([
        [AA('a'), 100],
        [QQ('b'), 200],
        [KK('c'), 300],
      ]),
    );
    expect(v.contributions).toEqual({ a: 100, b: 200, c: 200 });
    expect(brief(v)).toEqual([
      [300, ['a', 'b', 'c'], ['a']],
      [200, ['b', 'c'], ['c']],
    ]);
    expect(v.result?.finalStacks).toEqual({ a: 300, b: 0, c: 300 });
    // Последние фишки b — в побочном банке, его забрал c (основной — a, но a b не покрывал).
    expect(v.result?.knockouts).toEqual({ b: ['c'] });
  });

  it('равные стеки: один банк, оба проигравших вылетают от одной руки', () => {
    const v = settle(
      input([
        [KK('a'), 200],
        [AA('b'), 200],
        [QQ('c'), 200],
      ]),
    );
    expect(brief(v)).toEqual([[600, ['a', 'b', 'c'], ['b']]]);
    expect(v.result?.finalStacks).toEqual({ a: 0, b: 600, c: 0 });
    // Равные стеки — в порядке рук.
    expect(v.result?.busted).toEqual(['a', 'c']);
    expect(v.result?.knockouts).toEqual({ a: ['b'], c: ['b'] });
  });

  it('делёж основного и выигрыш побочного: нокаут — только тому, кто забрал побочный', () => {
    const v = settle(
      input([
        [KK('a'), 100],
        [KK2('b'), 300],
        [QQ('c'), 300],
      ]),
    );
    expect(brief(v)).toEqual([
      [300, ['a', 'b', 'c'], ['a', 'b']],
      [400, ['b', 'c'], ['b']],
    ]);
    expect(v.pots[0]?.shares).toEqual({ a: 150, b: 150 });
    expect(v.pots[0]?.oddChipTo).toEqual([]);
    expect(v.result?.finalStacks).toEqual({ a: 150, b: 550, c: 0 });
    expect(v.result?.knockouts).toEqual({ c: ['b'] });
    // Без стеков riverBusts даёт группу равных рук целиком — калькулятор её уточняет: a короче c.
    expect(
      riverKillerGroups({ hands: [KK('a'), KK2('b'), QQ('c')], board: BOARD }, ['c'])?.get('c'),
    ).toEqual([['a', 'b']]);
  });

  it('хедз-ап: короткий проигрывает — вылет, лишнее у большого не в банке', () => {
    const v = settle(
      input([
        [KK('a'), 300],
        [AA('b'), 1000],
      ]),
    );
    expect(v.contributions).toEqual({ a: 300, b: 300 });
    expect(brief(v)).toEqual([[600, ['a', 'b'], ['b']]]);
    expect(v.result?.finalStacks).toEqual({ a: 0, b: 1300 });
    expect(v.result?.knockouts).toEqual({ a: ['b'] });
  });

  it('хедз-ап: короткий выигрывает — удваивается; равные стеки и делёж — никто не вылетел', () => {
    const won = settle(
      input([
        [AA('a'), 300],
        [KK('b'), 1000],
      ]),
    );
    expect(won.result?.finalStacks).toEqual({ a: 600, b: 700 });
    expect(won.result?.busted).toEqual([]);
    const split = settle(
      input(
        [
          [hand('a', '2c', '3d'), 500],
          [hand('b', '2h', '3h'), 500],
        ],
        { board: BOARD_PLAYS },
      ),
    );
    expect(split.pots[0]?.shares).toEqual({ a: 500, b: 500 });
    expect(split.result?.finalStacks).toEqual({ a: 500, b: 500 });
    expect(split.result?.busted).toEqual([]);
  });

  it('9 рук, стеки против силы рук: восемь банков, каждый — своей руке, никто не вылетел', () => {
    const players: [ShowdownHand, number][] = [
      [AA('aa'), 100],
      [KK('kk'), 200],
      [QQ('qq'), 300],
      [TT('tt'), 400],
      [EE('ee'), 500],
      [hand('66', '6s', '6h'), 600],
      [hand('55', '5d', '5c'), 700],
      [hand('44', '4h', '4s'), 800],
      [hand('ak', 'Ac', 'Kc'), 900],
    ];
    const v = settle(input(players));
    expect(v.pots.map((p) => p.amount)).toEqual([900, 800, 700, 600, 500, 400, 300, 200]);
    expect(v.pots.map((p) => p.winners)).toEqual([
      ['aa'],
      ['kk'],
      ['qq'],
      ['tt'],
      ['ee'],
      ['66'],
      ['55'],
      ['44'],
    ]);
    expect(v.pots.map((p) => p.eligible.length)).toEqual([9, 8, 7, 6, 5, 4, 3, 2]);
    expect(v.result?.finalStacks).toEqual({
      aa: 900,
      kk: 800,
      qq: 700,
      tt: 600,
      ee: 500,
      '66': 400,
      '55': 300,
      '44': 200,
      ak: 100,
    });
    expect(v.result?.busted).toEqual([]);
  });

  it('6 рук, у лучшей руки самый большой стек: вылетают пятеро, от большего стека к меньшему', () => {
    const v = settle(
      input([
        [EE('ee'), 200],
        [AA('aa'), 600],
        [TT('tt'), 300],
        [KK('kk'), 500],
        [hand('66', '6s', '6h'), 100],
        [QQ('qq'), 400],
      ]),
    );
    expect(v.contributions.aa).toBe(500);
    expect(v.pots.every((p) => p.winners?.[0] === 'aa' && p.winners.length === 1)).toBe(true);
    expect(v.result?.finalStacks.aa).toBe(2100);
    expect(v.result?.busted).toEqual(['kk', 'qq', 'tt', 'ee', '66']);
    expect(Object.values(v.result?.knockouts ?? {})).toEqual(Array(5).fill(['aa']));
    // Готово для записи одним действием: вылеты от меньшего стека к большему, у каждого свой by.
    expect(riverBustDrafts(v.result!.busted, v.result!.knockouts).map((d) => d.payload)).toEqual([
      { playerId: '66', by: ['aa'] },
      { playerId: 'ee', by: ['aa'] },
      { playerId: 'tt', by: ['aa'] },
      { playerId: 'qq', by: ['aa'] },
      { playerId: 'kk', by: ['aa'] },
    ]);
  });
});

describe('sidePots: мёртвые деньги и возврат', () => {
  it('мёртвые деньги ложатся по слоям, а не все в основной', () => {
    // Сбросили двое: один вложил 50, другой 250. Основной (до 100) получает 50 + 100,
    // побочный (100–300) — оставшиеся 150 второго.
    const v = settle(
      input(
        [
          [AA('a'), 100],
          [KK('b'), 300],
          [QQ('c'), 300],
        ],
        { dead: [50, 250] },
      ),
    );
    expect(v.dead).toBe(300);
    expect(v.pots.map((p) => [p.amount, p.dead])).toEqual([
      [450, 150],
      [550, 150],
    ]);
    expect(v.result?.finalStacks).toEqual({ a: 450, b: 550, c: 0 });
    expect(v.result?.knockouts).toEqual({ c: ['b'] });
  });

  it('нулевые вклады сбросивших ничего не меняют', () => {
    const base = input([
      [AA('a'), 100],
      [KK('b'), 300],
    ]);
    expect(settle({ ...base, dead: [0, 0] }).pots).toEqual(settle(base).pots);
  });

  it('единственный участник верхнего слоя: возврат ему — не выигрыш и не нокаут', () => {
    // b поставил 300, сбросивший уравнял их и сбросил на ре-рейз; короткий a — в олл-ине на 100.
    // Слой 100–300 разыгрывать некому: фишки b и сбросившего возвращаются b.
    const inp = input(
      [
        [AA('a'), 100],
        [KK('b'), 1000],
      ],
      { dead: [300] },
    );
    const v = settle(inp);
    expect(v.contributions).toEqual({ a: 100, b: 300 });
    expect(v.pots).toEqual([
      {
        level: 100,
        amount: 300,
        dead: 100,
        eligible: ['a', 'b'],
        returned: false,
        winners: ['a'],
        shares: { a: 300 },
        oddChipTo: [],
      },
      {
        level: 300,
        amount: 400,
        dead: 200,
        eligible: ['b'],
        returned: true,
        winners: [],
        shares: { b: 400 },
        oddChipTo: [],
      },
    ]);
    expect(v.result?.finalStacks).toEqual({ a: 300, b: 1100 });
    expect(v.result?.busted).toEqual([]);
    // До ривера возврат уже известен, основной банк — ещё нет.
    const flop = settle({ ...inp, board: BOARD.slice(0, 3) });
    expect(flop.pots.map((p) => [p.winners, p.shares])).toEqual([
      [null, null],
      [[], { b: 400 }],
    ]);
    expect(flop.result).toBeNull();
  });

  it('без мёртвых денег верхний слой всегда на двоих: излишек большого стека не банк', () => {
    const v = settle(
      input([
        [AA('a'), 100],
        [KK('b'), 1000],
      ]),
    );
    expect(v.pots.map((p) => p.returned)).toEqual([false]);
    expect(v.result?.finalStacks).toEqual({ a: 200, b: 900 });
  });
});

describe('sidePots: вклад по факту (committed) — у больших стеков остались фишки', () => {
  it('короткий в олл-ине, двое больших прочекали до ривера: вылетает только короткий', () => {
    const players: [ShowdownHand, number][] = [
      [EE('A'), 100],
      [TT('B'), 500],
      [AA('C'), 1000],
    ];
    // По правилу по умолчанию B «в олл-ине» на 500 — ложный вылет B и нокаут C.
    expect(settle(input(players)).result?.busted).toEqual(['B', 'A']);
    const v = settle(input(players, { committed: { A: 100, B: 100, C: 100 } }));
    expect(v.contributions).toEqual({ A: 100, B: 100, C: 100 });
    expect(brief(v)).toEqual([[300, ['A', 'B', 'C'], ['C']]]);
    expect(v.result).toEqual({
      payouts: { A: 0, B: 0, C: 300 },
      finalStacks: { A: 0, B: 400, C: 1200 },
      busted: ['A'],
      knockouts: { A: ['C'] },
    });
  });

  it('проигравший большой стек с фишками за спиной не вылетает', () => {
    const v = settle(
      input(
        [
          [AA('a'), 100],
          [KK('b'), 1000],
          [QQ('c'), 1000],
        ],
        { committed: { a: 100, b: 100, c: 100 } },
      ),
    );
    expect(v.result?.finalStacks).toEqual({ a: 300, b: 900, c: 900 });
    expect(v.result?.busted).toEqual([]);
    expect(v.result?.knockouts).toEqual({});
  });

  it('ставки в побочном банке меньше второго стека: банки по фактическим вкладам', () => {
    // a в олл-ине на 100; b и c доставили по 250 и вскрылись; сбросивший оставил 40 (основной).
    const v = settle(
      input(
        [
          [AA('a'), 100],
          [KK('b'), 1000],
          [QQ('c'), 800],
        ],
        { committed: { a: 100, b: 350, c: 350 }, dead: [40] },
      ),
    );
    expect(v.pots.map((p) => [p.level, p.amount, p.dead, p.eligible, p.winners])).toEqual([
      [100, 340, 40, ['a', 'b', 'c'], ['a']],
      [350, 500, 0, ['b', 'c'], ['b']],
    ]);
    expect(v.result?.finalStacks).toEqual({ a: 340, b: 1150, c: 450 });
    expect(v.result?.busted).toEqual([]);
  });

  it('неуравненный излишек в вкладе — банк-возврат; стеки — как по правилу по умолчанию', () => {
    const players: [ShowdownHand, number][] = [
      [AA('a'), 100],
      [KK('b'), 1000],
    ];
    // b пошёл в олл-ин на 1000, a уравнял 100: камера видит в банке все 1100.
    const v = settle(input(players, { committed: { a: 100, b: 1000 } }));
    expect(v.pots.map((p) => [p.amount, p.eligible, p.returned, p.shares])).toEqual([
      [200, ['a', 'b'], false, { a: 200 }],
      [900, ['b'], true, { b: 900 }],
    ]);
    expect(v.result?.finalStacks).toEqual(settle(input(players)).result?.finalStacks);
    expect(v.result?.finalStacks).toEqual({ a: 200, b: 900 });
  });

  it('до ривера: банки по фактическим вкладам, итога нет', () => {
    const v = settle(
      input(
        [
          [AA('a'), 100],
          [KK('b'), 1000],
          [QQ('c'), 800],
        ],
        { committed: { a: 100, b: 350, c: 350 }, board: BOARD.slice(0, 4) },
      ),
    );
    expect(brief(v)).toEqual([
      [300, ['a', 'b', 'c'], null],
      [500, ['b', 'c'], null],
    ]);
    expect(v.result).toBeNull();
  });

  it('отказы: вклад не для всех, вне 1..стек, меньше наибольшего не в олл-ине, мёртвые выше вкладов', () => {
    const three: [ShowdownHand, number][] = [
      [AA('a'), 100],
      [KK('b'), 500],
      [QQ('c'), 1000],
    ];
    const error = (extra: Partial<SidePotInput>) => {
      const r = sidePots(input(three, extra));
      return r.ok ? null : { error: r.error, playerId: r.playerId };
    };
    const range = 'Банки: вклад — целое число фишек от 1 до стека';
    expect(error({ committed: { a: 100, b: 100 } })).toEqual({ error: range, playerId: 'c' });
    expect(error({ committed: { a: 100, b: 0, c: 100 } })).toEqual({ error: range, playerId: 'b' });
    expect(error({ committed: { a: 101, b: 101, c: 101 } })).toEqual({
      error: range,
      playerId: 'a',
    });
    expect(error({ committed: { a: 100, b: 100.5, c: 100 } })).toEqual({
      error: range,
      playerId: 'b',
    });
    // b не в олл-ине (фишки остались), а вложил меньше c: так b должен был сбросить.
    expect(error({ committed: { a: 100, b: 200, c: 300 } })).toEqual({
      error: 'Банки: вклад меньше наибольшего бывает только в олл-ине (весь стек) — проверь суммы',
      playerId: 'b',
    });
    // b в олл-ине на весь стек — меньше наибольшего можно.
    expect(error({ committed: { a: 100, b: 500, c: 700 } })).toBeNull();
    expect(error({ committed: { a: 100, b: 100, c: 100 }, dead: [150] })).toEqual({
      error: 'Банки: у сбросившего фишек больше, чем вклад любого участника — проверь суммы',
      playerId: undefined,
    });
    expect(error({ committed: { a: 100, b: 150, c: 150 }, dead: [150] })).toBeNull();
  });
});

describe('sidePotBustDrafts: вылеты в журнал — без повторов и выбывших', () => {
  const SD = '00000000-0000-4000-8000-000000000002';
  const HANDS: [PlayerId, CardCode, CardCode][] = [
    ['a', 'As', 'Ah'],
    ['b', 'Kd', 'Ks'],
    ['c', 'Qs', 'Qh'],
  ];
  const STACKS = { a: 100, b: 300, c: 200 };

  /** Вечер с олл-ином: before — что случилось между флопом и ривером. */
  function evening(before: (j: ReturnType<typeof journal>) => void) {
    const j = journal();
    j.join('a', 'b', 'c');
    j.start();
    j.showdown(SD, HANDS, BOARD.slice(0, 3));
    before(j);
    j.showdown(SD, HANDS, BOARD);
    const log = replayLog(DEFAULT_FORMAT, j.events, j.now());
    const r = settle({ ...log.state.showdown!, stacks: STACKS, chipUnit: 1 }).result!;
    // a забрал основной, b — побочный у c: c вылетел, выбил b.
    expect([r.busted, r.knockouts]).toEqual([['c'], { c: ['b'] }]);
    const drafts = sidePotBustDrafts(
      r,
      log.state.showdown!,
      (id) => log.state.players[id]?.alive ?? false,
      log.applied,
    );
    return { j, r, drafts };
  }

  it('обычный ривер: записи — как riverBustDrafts, журнал их принимает', () => {
    const { j, r, drafts } = evening(() => {});
    expect(drafts).toEqual(riverBustDrafts(r.busted, r.knockouts));
    for (const d of drafts) j.add(d.type, d.payload);
    const s = replay(DEFAULT_FORMAT, j.events, j.now());
    expect(s.errors).toEqual([]);
    expect(s.players.c?.alive).toBe(false);
  });

  it('вылет записан до ривера, потом ребай: второго вылета в той же раздаче нет', () => {
    const { j, r, drafts } = evening((j) => {
      j.bust('c', ['b']);
      j.rebuy('c');
    });
    expect(drafts).toEqual([]);
    // Сырой busted калькулятора записал бы c второй раз — второй нокаут b.
    for (const d of riverBustDrafts(r.busted, r.knockouts)) j.add(d.type, d.payload);
    const busts = replayLog(DEFAULT_FORMAT, j.events, j.now()).applied.filter(
      (e) => e.type === 'bust',
    );
    expect(busts).toHaveLength(2);
  });

  it('вылет записан до ривера, ребая нет: игрок уже вне игры — записей нет', () => {
    const { j, r, drafts } = evening((j) => j.bust('c', ['b']));
    expect(drafts).toEqual([]);
    // Сырой busted replay отклонил бы.
    for (const d of riverBustDrafts(r.busted, r.knockouts)) j.add(d.type, d.payload);
    expect(replay(DEFAULT_FORMAT, j.events, j.now()).errors.map((e) => e.message)).toEqual([
      'Игрок уже выбыл',
    ]);
  });

  it('выбившие — только кто в игре; порядок записей — от меньшего стека к большему', () => {
    const drafts = sidePotBustDrafts(
      { busted: ['c', 'd'], knockouts: { c: ['b'], d: ['a', 'b'] } },
      { openedEventId: 0 },
      (id) => id !== 'a',
      [],
    );
    expect(drafts.map((d) => d.payload)).toEqual([
      { playerId: 'd', by: ['b'] },
      { playerId: 'c', by: ['b'] },
    ]);
  });
});

describe('sidePots: нечётные фишки (TDA 2026, правило 21)', () => {
  // a и b делят банк 235 (75·3 + 10 мёртвых): одна нечётная фишка.
  const odd = (seating?: HandSeating) =>
    settle(
      input(
        [
          [KK('a'), 75],
          [KK2('b'), 75],
          [QQ('c'), 75],
        ],
        { dead: [10], seating },
      ),
    ).pots[0];

  it('первому из делящих по часовой от баттона', () => {
    // Баттон 5: по часовой 6, 7 (b), …, 3 (a) — фишка b.
    expect(odd({ seats: { a: 3, b: 7, c: 9 }, buttonSeat: 5 })).toMatchObject({
      amount: 235,
      shares: { a: 117, b: 118 },
      oddChipTo: ['b'],
    });
    // Баттон 2: первым идёт место 3 (a).
    expect(odd({ seats: { a: 3, b: 7, c: 9 }, buttonSeat: 2 })?.oddChipTo).toEqual(['a']);
    // Баттон на месте b: b — последний по часовой, фишка a.
    expect(odd({ seats: { a: 3, b: 7, c: 9 }, buttonSeat: 7 })?.oddChipTo).toEqual(['a']);
    // Баттон на пустом месте 10: по часовой 1, 2, 3 (a).
    expect(odd({ seats: { a: 3, b: 7, c: 9 }, buttonSeat: 10 })?.oddChipTo).toEqual(['a']);
  });

  it('мест или баттона нет, кто-то из делящих без места — первому в порядке рук', () => {
    expect(odd()?.shares).toEqual({ a: 118, b: 117 });
    expect(odd({ seats: { a: 3, b: 7 }, buttonSeat: null })?.oddChipTo).toEqual(['a']);
    expect(odd({ seats: { b: 7, c: 9 }, buttonSeat: 5 })?.oddChipTo).toEqual(['a']);
    expect(odd({ seats: { a: null, b: 7 }, buttonSeat: 5 })?.oddChipTo).toEqual(['a']);
  });

  it('две нечётные фишки на троих — по одной первым двум по часовой', () => {
    const v = settle(
      input(
        [
          [hand('a', '2c', '3d'), 100],
          [hand('b', '2h', '3h'), 100],
          [hand('c', '4c', '5d'), 100],
        ],
        { board: BOARD_PLAYS, dead: [2], seating: { seats: { a: 1, b: 4, c: 8 }, buttonSeat: 4 } },
      ),
    );
    // Баттон у b (4): по часовой 8 (c), 1 (a), 4 (b).
    expect(v.pots[0]?.shares).toEqual({ a: 101, b: 100, c: 101 });
    expect(v.pots[0]?.oddChipTo).toEqual(['c', 'a']);
    expect(v.result?.busted).toEqual([]);
  });

  it('номинал — обязательный вход: без него отказ, а не молчаливая 1 (TDA 21: размен до номинала)', () => {
    // Банк 100 на троих: по фишке 1 — 34/33/33, а при наименьшей фишке 5 так не выплатить — 35/35/30.
    const three: [ShowdownHand, number][] = [
      [hand('a', '2c', '3d'), 30],
      [hand('b', '2h', '3h'), 30],
      [hand('c', '4c', '5d'), 30],
    ];
    const pot = (unit: number) =>
      settle(input(three, { board: BOARD_PLAYS, dead: [10], chipUnit: unit })).pots[0]?.shares;
    expect(pot(1)).toEqual({ a: 34, b: 33, c: 33 });
    expect(pot(5)).toEqual({ a: 35, b: 35, c: 30 });
    const noUnit = {
      hands: three.map(([h]) => h),
      board: BOARD_PLAYS,
      stacks: { a: 30, b: 30, c: 30 },
    };
    // @ts-expect-error chipUnit обязателен
    const read = sidePots(noUnit);
    expect(read).toEqual({
      ok: false,
      error: 'Банки: наименьший номинал — целое число фишек от 1',
    });
  });

  it('размен до наименьшего номинала: нечётная — целой фишкой номинала', () => {
    const players: [ShowdownHand, number][] = [
      [KK('a'), 50],
      [KK2('b'), 50],
      [QQ('c'), 50],
    ];
    expect(settle(input(players, { dead: [25] })).pots[0]?.shares).toEqual({ a: 88, b: 87 });
    expect(settle(input(players, { dead: [25], chipUnit: 25 })).pots[0]?.shares).toEqual({
      a: 100,
      b: 75,
    });
  });

  it('суммы не кратны номиналу: доля в дележе бывает нулевой — нокаут только забравшим фишки', () => {
    // Банк 3 при номинале 5: размен невозможен, остаток целиком первому из делящих (a).
    const v = settle(
      input(
        [
          [KK('a'), 1],
          [KK2('b'), 1],
          [QQ('c'), 1],
        ],
        { chipUnit: 5 },
      ),
    );
    expect(v.pots[0]?.shares).toEqual({ a: 3, b: 0 });
    expect(v.result?.busted).toEqual(['b', 'c']);
    expect(v.result?.knockouts).toEqual({ b: ['a'], c: ['a'] });
  });

  it('splitPot и oddChipOrder', () => {
    expect(splitPot(10, ['x', 'y', 'z'])).toEqual({
      shares: { x: 4, y: 3, z: 3 },
      oddChipTo: ['x'],
    });
    expect(splitPot(12, ['x', 'y', 'z'])).toEqual({
      shares: { x: 4, y: 4, z: 4 },
      oddChipTo: [],
    });
    // Сумма не кратна номиналу: остаток меньше номинала — первому.
    expect(splitPot(103, ['x', 'y'], 25)).toEqual({ shares: { x: 53, y: 50 }, oddChipTo: ['x'] });
    expect(oddChipOrder(['a', 'b', 'c'], { seats: { a: 10, b: 1, c: 2 }, buttonSeat: 1 })).toEqual([
      'c',
      'a',
      'b',
    ]);
    expect(oddChipOrder(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('места и баттон — той раздачи (state.showdown.seating): «Следующая раздача» их не меняет', () => {
    const j = journal();
    j.join('a', 'b', 'c');
    j.seat('a', 3);
    j.seat('b', 7);
    j.seat('c', 9);
    j.start();
    j.button(3);
    j.wait(5).showdown(
      '00000000-0000-4000-8000-000000000001',
      [
        ['a', 'Kd', 'Ks'],
        ['b', 'Kc', 'Kh'],
        ['c', 'Qs', 'Qh'],
      ],
      BOARD,
    );
    // Пульт: стеки и мёртвые деньги — ввод, остальное (руки, стол, места и баттон) — из раздачи.
    const calc = () => {
      const state = replay(DEFAULT_FORMAT, j.events, j.now());
      const v = settle({
        ...state.showdown!,
        stacks: { a: 75, b: 75, c: 75 },
        dead: [10],
        chipUnit: 1,
      });
      return { button: state.buttonSeat, shares: v.pots[0]?.shares, odd: v.pots[0]?.oddChipTo };
    };
    // Баттон у a (3): по часовой первым b (7).
    const during = calc();
    expect(during).toEqual({ button: 3, shares: { a: 117, b: 118 }, odd: ['b'] });
    // Банкир нажал «Следующая раздача»: баттон ушёл к b (7), олл-ин ещё на экране. По текущему
    // баттону фишка ушла бы к a — пересчёт той же раздачи поменял бы выплаты на фишку.
    j.hand();
    const after = calc();
    expect(after.button).toBe(7);
    expect(after.shares).toEqual(during.shares);
    expect(after.odd).toEqual(['b']);
    const now = replay(DEFAULT_FORMAT, j.events, j.now());
    expect(
      settle({
        ...now.showdown!,
        stacks: { a: 75, b: 75, c: 75 },
        dead: [10],
        chipUnit: 1,
        seating: handSeating(now),
      }).pots[0]?.oddChipTo,
    ).toEqual(['a']);
  });
});

describe('sidePots: до ривера и неверный ввод', () => {
  it('до ривера: банки и участники есть, победителей и итога нет', () => {
    const v = settle(
      input(
        [
          [AA('a'), 100],
          [KK('b'), 500],
          [QQ('c'), 800],
        ],
        { board: [] },
      ),
    );
    expect(brief(v)).toEqual([
      [300, ['a', 'b', 'c'], null],
      [800, ['b', 'c'], null],
    ]);
    expect(v.pots.map((p) => p.shares)).toEqual([null, null]);
    expect(v.result).toBeNull();
  });

  it('отказы: состав, стол, стеки, мёртвые деньги, номинал, карты', () => {
    const two: [ShowdownHand, number][] = [
      [AA('a'), 100],
      [KK('b'), 300],
    ];
    const error = (inp: SidePotInput) => {
      const r = sidePots(inp);
      return r.ok ? null : { error: r.error, playerId: r.playerId };
    };
    expect(error(input([[AA('a'), 100]]))?.error).toBe('Банки: участников вскрытия — от 2 до 9');
    expect(
      error(
        input([
          [AA('a'), 100],
          [KK('a'), 100],
        ]),
      )?.error,
    ).toBe('Банки: игрок указан дважды');
    expect(error(input(two, { board: ['2c', '7h'] }))?.error).toBe(
      'Банки: на столе 0, 3, 4 или 5 карт',
    );
    for (const bad of [0, -5, 1.5, Number.NaN]) {
      expect(error(input(two, { stacks: { a: 100, b: bad } }))).toEqual({
        error: 'Банки: стек — целое число фишек от 1',
        playerId: 'b',
      });
    }
    expect(error(input(two, { stacks: { a: 100 } }))?.playerId).toBe('b');
    expect(error(input(two, { dead: [10, -1] }))?.error).toBe(
      'Банки: фишки сбросивших — целые числа от 0',
    );
    expect(error(input(two, { chipUnit: 0 }))?.error).toBe(
      'Банки: наименьший номинал — целое число фишек от 1',
    );
    expect(error(input(two, { dead: [301] }))?.error).toBe(
      'Банки: у сбросившего фишек больше, чем стек самого большого участника — проверь суммы',
    );
    // Ставка сбросившего, равная самому большому стеку, — ещё возможна.
    expect(error(input(two, { dead: [300] }))).toBeNull();
    expect(error(input(two, { board: ['2c', '7h', '9s', 'Jc', 'zz'] }))?.error).toBe(
      'Банки: карты раздачи не читаются',
    );
  });
});

// ── Сверка перебором ────────────────────────────────────────────────────────────────────────────

const DECK = [...CARD_RANKS].flatMap((r) => [...CARD_SUITS].map((s) => r + s));

function shuffle<T>(items: readonly T[], rnd: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const k = Math.floor(rnd() * (i + 1));
    [out[i], out[k]] = [out[k] as T, out[i] as T];
  }
  return out;
}

/**
 * Случайная раздача: 2–6 рук, стеки (часто равные), мёртвые деньги, рассадка, номинал; в трети
 * раздач — вклад по факту (committed): торговля кончилась на уровне m не выше второго стека, у кого
 * стек больше m — фишки остались; иногда единственный такой — в олл-ине с неуравненным излишком.
 */
function randomDeal(rnd: () => number): SidePotInput {
  const n = 2 + Math.floor(rnd() * 5);
  const playsBoard = rnd() < 0.2; // стол у всех — много дележа
  const deck = shuffle(
    DECK.filter((c) => !playsBoard || !BOARD_PLAYS.includes(c)),
    rnd,
  );
  const hands = Array.from({ length: n }, (_, i) =>
    hand(`p${i}`, deck[2 * i] as CardCode, deck[2 * i + 1] as CardCode),
  );
  const board = playsBoard ? BOARD_PLAYS : (deck.slice(2 * n, 2 * n + 5) as CardCode[]);
  const unit = rnd() < 0.2 ? (rnd() < 0.5 ? 5 : 25) : 1;
  const coarse = rnd() < 0.5; // стеки из короткого списка — чаще равные
  const stacks: Record<PlayerId, number> = {};
  for (const h of hands)
    stacks[h.playerId] = coarse
      ? unit * 20 * (1 + Math.floor(rnd() * 6))
      : unit * (1 + Math.floor(rnd() * 400));
  const biggest = Math.max(...Object.values(stacks));
  const dead = Array.from(
    { length: Math.floor(rnd() * 4) },
    () => unit * Math.floor((rnd() * (biggest + 1)) / unit),
  );
  let seating: HandSeating | undefined;
  const s = rnd();
  if (s < 0.7) {
    const places = shuffle(
      Array.from({ length: TABLE_SEATS }, (_, i) => i + 1),
      rnd,
    );
    const seats: Record<PlayerId, number | null> = {};
    hands.forEach((h, i) => (seats[h.playerId] = places[i] as number));
    if (s < 0.1) seats.p0 = null; // кто-то без места — порядок рук
    seating = { seats, buttonSeat: 1 + Math.floor(rnd() * TABLE_SEATS) };
  }
  if (rnd() < 2 / 3) return { hands, board, stacks, dead, seating, chipUnit: unit };
  const second = Object.values(stacks).sort((a, b) => b - a)[1] as number;
  const m = unit * (1 + Math.floor((rnd() * second) / unit));
  const committed: Record<PlayerId, number> = {};
  for (const h of hands) committed[h.playerId] = Math.min(stacks[h.playerId] as number, m);
  const behind = hands.filter((h) => (stacks[h.playerId] as number) > m);
  if (behind.length === 1 && rnd() < 0.5) {
    const id = (behind[0] as ShowdownHand).playerId;
    committed[id] = stacks[id] as number;
  }
  const capped = dead.map((d) => Math.min(d, m));
  return { hands, board, stacks, committed, dead: capped, seating, chipUnit: unit };
}

/**
 * Прямой пересчёт, независимо от модуля: вклад — committed или сколько может забрать у игрока самый
 * большой из остальных стеков (или ставка сбросившего); банки — снятием наименьшего остатка; победитель —
 * оценщиком напрямую; нечётные фишки — обходом мест по часовой от баттона, номиналы — по кругу.
 */
function direct(inp: SidePotInput) {
  const ids = inp.hands.map((h) => h.playerId);
  const stack = (id: PlayerId) => inp.stacks[id] as number;
  const dead = [...(inp.dead ?? [])];
  const unit = inp.chipUnit;
  const maxDead = Math.max(0, ...dead);
  const committed = inp.committed;
  const contrib = ids.map((id) =>
    committed
      ? (committed[id] as number)
      : Math.min(stack(id), Math.max(maxDead, ...ids.filter((o) => o !== id).map(stack))),
  );
  const score = new Map(
    inp.hands.map((h) => [h.playerId, evaluate(parseCards([...h.cards, ...inp.board]))]),
  );
  const seating = inp.seating;
  const clockwise = (winners: PlayerId[]): PlayerId[] => {
    const button = seating?.buttonSeat ?? null;
    if (!seating || button === null || winners.some((w) => typeof seating.seats[w] !== 'number'))
      return winners;
    const out: PlayerId[] = [];
    for (let k = 1; k <= TABLE_SEATS; k += 1) {
      const seat = ((button - 1 + k) % TABLE_SEATS) + 1;
      out.push(...winners.filter((w) => seating.seats[w] === seat));
    }
    return out;
  };
  const rem = [...contrib];
  const pots: { amount: number; eligible: PlayerId[]; shares: Record<PlayerId, number> }[] = [];
  while (rem.some((x) => x > 0)) {
    const m = Math.min(...rem.filter((x) => x > 0));
    const eligible = ids.filter((_, i) => (rem[i] as number) > 0);
    let amount = 0;
    rem.forEach((x, i) => {
      const t = Math.min(x, m);
      amount += t;
      rem[i] = x - t;
    });
    dead.forEach((x, j) => {
      const t = Math.min(x, m);
      amount += t;
      dead[j] = x - t;
    });
    const best = Math.max(...eligible.map((id) => score.get(id) as number));
    const winners = clockwise(eligible.filter((id) => score.get(id) === best));
    const shares: Record<PlayerId, number> = Object.fromEntries(winners.map((w) => [w, 0]));
    let left = amount;
    for (let k = 0; left >= unit; k += 1) {
      const w = winners[k % winners.length] as PlayerId;
      shares[w] = (shares[w] as number) + unit;
      left -= unit;
    }
    shares[winners[0] as PlayerId] = (shares[winners[0] as PlayerId] as number) + left;
    pots.push({ amount, eligible, shares });
  }
  expect(dead.every((x) => x === 0)).toBe(true);
  const payouts = Object.fromEntries(
    ids.map((id) => [id, sum(pots.map((p) => p.shares[id] ?? 0))]),
  );
  const finals = Object.fromEntries(
    ids.map((id, i) => [id, stack(id) - (contrib[i] as number) + (payouts[id] as number)]),
  );
  const busted = ids.filter((id) => finals[id] === 0);
  const knockouts = Object.fromEntries(
    busted.map((v) => {
      const top = pots.filter((p) => p.eligible.includes(v)).at(-1)!;
      return [v, Object.keys(top.shares).filter((w) => w !== v)];
    }),
  );
  // Доля каждого по одной фишке слоя: слой x — по фишке от каждого, кто внёс не меньше x (и от
  // сбросивших), забирают лучшие руки из внёсших не меньше x поровну, дробно.
  const exact = Object.fromEntries(ids.map((id) => [id, 0]));
  const top = Math.max(...contrib);
  for (let x = 1; x <= top; x += 1) {
    const inLayer = ids.filter((_, i) => (contrib[i] as number) >= x);
    const chips = inLayer.length + (inp.dead ?? []).filter((d) => d >= x).length;
    const best = Math.max(...inLayer.map((id) => score.get(id) as number));
    const winners = inLayer.length === 1 ? inLayer : inLayer.filter((id) => score.get(id) === best);
    for (const w of winners) exact[w] = (exact[w] as number) + chips / winners.length;
  }
  return { contrib, pots, payouts, finals, busted, knockouts, exact };
}

describe('sidePots: сверка перебором', () => {
  it('500 случайных раздач (2–6 рук): совпадает с прямым пересчётом', () => {
    const rnd = prng(20261023);
    let splits = 0;
    let withDead = 0;
    let returns = 0;
    let withCommitted = 0;
    let behindLosers = 0;
    for (let t = 0; t < 500; t += 1) {
      const inp = randomDeal(rnd);
      const v = settle(inp);
      const d = direct(inp);
      const ids = inp.hands.map((h) => h.playerId);
      const r = v.result!;
      expect(ids.map((id) => v.contributions[id])).toEqual(d.contrib);
      expect(v.pots.map((p) => [p.amount, p.eligible, p.shares])).toEqual(
        d.pots.map((p) => [p.amount, p.eligible, p.shares]),
      );
      expect(r.payouts).toEqual(d.payouts);
      expect(r.finalStacks).toEqual(d.finals);
      expect([...r.busted].sort()).toEqual([...d.busted].sort());
      for (const victim of r.busted)
        expect([...(r.knockouts[victim] ?? [])].sort()).toEqual(
          [...(d.knockouts[victim] ?? [])].sort(),
        );
      // От большего стека к меньшему.
      const stacks = r.busted.map((id) => inp.stacks[id] as number);
      expect(stacks).toEqual([...stacks].sort((a, b) => b - a));
      // По одной фишке: без дележа — ровно так же; с дележом — расхождение только нечётными фишками.
      const split = v.pots.some((p) => (p.winners?.length ?? 0) > 1);
      for (const id of ids) {
        const gap = Math.abs((r.payouts[id] as number) - (d.exact[id] as number));
        if (split) expect(gap).toBeLessThan(2 * inp.chipUnit * v.pots.length);
        else expect(gap).toBe(0);
      }
      if (inp.committed) {
        withCommitted += 1;
        // У кого фишки остались, тот не вылетает, даже проиграв всё внесённое.
        for (const id of ids) {
          if ((inp.committed[id] as number) >= (inp.stacks[id] as number)) continue;
          expect(r.busted).not.toContain(id);
          if (r.payouts[id] === 0) behindLosers += 1;
        }
      } else {
        // Те же вклады явно — тот же расчёт.
        expect(settle({ ...inp, committed: v.contributions })).toEqual(v);
      }
      if (split) splits += 1;
      if ((inp.dead ?? []).some((x) => x > 0)) withDead += 1;
      if (v.pots.some((p) => p.returned)) returns += 1;
    }
    // Перебор действительно задел делёж, мёртвые деньги, возвраты и вклады по факту с проигравшими,
    // у которых остались фишки.
    expect(splits).toBeGreaterThan(100);
    expect(withDead).toBeGreaterThan(300);
    expect(returns).toBeGreaterThan(100);
    expect(withCommitted).toBeGreaterThan(130);
    expect(behindLosers).toBeGreaterThan(100);
  });

  it('согласуется с riverBusts.ts: кто вылетел и кто выбил — среди вариантов без стеков', () => {
    const rnd = prng(20261009);
    let unambiguous = 0;
    let ambiguous = 0;
    for (let t = 0; t < 400; t += 1) {
      const inp = randomDeal(rnd);
      const r = settle(inp).result!;
      const ranking = riverRanking(inp.hands, inp.board)!;
      const groupOf = new Map<PlayerId, number>();
      ranking.forEach((g, i) => g.forEach((id) => groupOf.set(id, i)));
      // Лучшая рука раздачи не вылетает: её банки она забирает целиком или делит.
      for (const victim of r.busted) expect(groupOf.get(victim)).toBeGreaterThan(0);
      const options = riverKillerGroups(inp, r.busted)!;
      for (const victim of r.busted) {
        const killers = r.knockouts[victim] ?? [];
        expect(killers.length).toBeGreaterThan(0);
        // Выбившие — одна группа равных рук, сильнее вылетевшего.
        const g = groupOf.get(killers[0] as PlayerId) as number;
        expect(killers.every((k) => groupOf.get(k) === g)).toBe(true);
        expect(g).toBeLessThan(groupOf.get(victim) as number);
        // Эта группа — один из вариантов riverBusts; единственный вариант — ровно она.
        const variants = options.get(victim) ?? [];
        expect(variants).toContainEqual(ranking[g]);
        expect(killers.every((k) => (ranking[g] as PlayerId[]).includes(k))).toBe(true);
        if (variants.length === 1) unambiguous += 1;
        else ambiguous += 1;
      }
    }
    expect(unambiguous).toBeGreaterThan(300);
    expect(ambiguous).toBeGreaterThan(200);
  });
});
