import { describe, expect, it } from 'vitest';
import {
  BOMB_POT_DRAFT,
  BOMB_POT_FEW_ERROR,
  BOMB_POT_IDLE_HIDE_MS,
  BOMB_POT_NEXT_OPEN_ERROR,
  BOMB_POT_OPEN_ERROR,
  BOMB_POT_RESULT_SHAPE_ERROR,
  BOMB_POT_SHAPE_ERROR,
  BOMB_REVEAL_MS,
  blindsInHand,
  bombPotCloseDrafts,
  bombPotLineup,
  bombPotNextRefusal,
  bombPotPreview,
  bombPotRevealAtMs,
  bombPotWinnerChoices,
  buttonAfterBombPot,
  isBombPotBbs,
  isBombPotEvent,
  isBombPotRevealed,
  lastBombPot,
  readBombPot,
  readBombPotResult,
  visibleBombPot,
} from './bombPot.ts';
import { DEFAULT_FORMAT } from './format.ts';
import { computeMoney } from './money.ts';
import { canApply, canApplySequence, replay, replayLog } from './replay.ts';
import { bombPotAllInWinners } from './riverBusts.ts';
import { DEFAULT_SCORING } from './scoring.ts';
import { seatHolder, tablePositions } from './seats.ts';
import { summarize } from './summary.ts';
import { journal, MIN, prng, type Journal } from './test-utils.ts';
import {
  BOMB_POT_EVENT_TYPES,
  BOMB_POT_MAX_BBS,
  BOMB_POT_MIN_BBS,
  EVENT_TYPES,
  TABLE_SEATS,
  type BombPotState,
  type EveningEvent,
  type EveningState,
  type TournamentFormat,
} from './types.ts';

const F = DEFAULT_FORMAT;
const SD0 = '5d000000-0000-4000-8000-0000000000b0';
const SD1 = '5d000000-0000-4000-8000-0000000000b1';
const state = (j: Journal, f: TournamentFormat = F) => replay(f, j.events, j.now());
const errorOf = (s: EveningState, id: number) =>
  s.errors.find((e) => e.eventId === id)?.message ?? null;
const open = (s: EveningState): BombPotState => {
  if (!s.bombPot) throw new Error('бомб-пот не открыт');
  return s.bombPot;
};

/** Четверо на местах 1, 3, 5, 8, баттон на 3 (B): SB — C (5), BB — D (8). Таймер идёт. */
function table(): Journal {
  const j = journal().join('A', 'B', 'C', 'D');
  j.seat('A', 1);
  j.seat('B', 3);
  j.seat('C', 5);
  j.seat('D', 8);
  j.button(3);
  j.start();
  return j;
}

describe('форма записей', () => {
  it('типы бомб-пота — в списке типов событий', () => {
    expect(BOMB_POT_EVENT_TYPES).toEqual(['bomb_pot', 'bomb_pot_result']);
    expect(BOMB_POT_EVENT_TYPES.every((t) => EVENT_TYPES.includes(t))).toBe(true);
    expect(isBombPotEvent('bomb_pot')).toBe(true);
    expect(isBombPotEvent('bomb_pot_result')).toBe(true);
    expect(isBombPotEvent('hand')).toBe(false);
  });

  it('взнос — целое число BB от 1 до 5', () => {
    expect([BOMB_POT_MIN_BBS, BOMB_POT_MAX_BBS]).toEqual([1, 5]);
    expect([1, 2, 3, 4, 5].every(isBombPotBbs)).toBe(true);
    expect([0, 6, -1, 2.5, '3', null, undefined, NaN].some(isBombPotBbs)).toBe(false);
  });

  it('бросок: запись сервера, переброс и черновик клиента', () => {
    expect(readBombPot({ bbs: 3 })).toEqual({ bbs: 3, previousBbs: [] });
    expect(readBombPot({ bbs: 4, previousBbs: [2, 5] })).toEqual({ bbs: 4, previousBbs: [2, 5] });
    // {} — черновик: кубик бросит сервер.
    expect(readBombPot({})).toEqual({ bbs: 0, previousBbs: [] });
    for (const bad of [
      { bbs: 0 },
      { bbs: 6 },
      { bbs: 2.5 },
      { bbs: '3' },
      { bbs: null },
      { previousBbs: [2] },
      { bbs: 3, previousBbs: [7] },
      { bbs: 3, previousBbs: 2 },
      { bbs: 3, previousBbs: ['2'] },
    ]) {
      expect(readBombPot(bad)).toBeNull();
    }
    expect(readBombPot(null)).toBeNull();
    expect(readBombPot([])).toBeNull();
  });

  it('результат: запись бомб-пота и непустой список забравших', () => {
    expect(readBombPotResult({ eventId: 7, winners: ['A'] })).toEqual({
      eventId: 7,
      winners: ['A'],
    });
    expect(readBombPotResult({ eventId: 7, winners: ['A', 'B'] })?.winners).toEqual(['A', 'B']);
    for (const bad of [
      { eventId: 0, winners: ['A'] },
      { eventId: -1, winners: ['A'] },
      { eventId: 1.5, winners: ['A'] },
      { eventId: '7', winners: ['A'] },
      { winners: ['A'] },
      { eventId: 7, winners: [] },
      { eventId: 7, winners: ['A', ''] },
      { eventId: 7, winners: 'A' },
      { eventId: 7 },
    ]) {
      expect(readBombPotResult(bad)).toBeNull();
    }
  });
});

describe('объявление: снимок раздачи', () => {
  it('взнос по BB уровня, участники по часовой от первого слова, номинальный банк', () => {
    const j = table();
    const id = j.wait(5).bombPot(3);
    const s = state(j);
    expect(s.errors).toEqual([]);
    const bp = open(s);
    expect(bp).toMatchObject({
      eventId: id,
      bbs: 3,
      previousBbs: [],
      reroll: false,
      levelIndex: 0,
      bb: 10,
      stake: 30,
      // Баттон — B (3): первое слово у SB — C (5), дальше по часовой D, A, B.
      players: ['C', 'D', 'A', 'B'],
      pot: 120,
      firstToAct: 'C',
      seating: { seats: { A: 1, B: 3, C: 5, D: 8 }, buttonSeat: 3 },
      result: null,
      closed: null,
    });
    expect(s.bombPots).toEqual([bp]);
    expect(s.bombPots[0]).toBe(bp);
    expect(lastBombPot(s)).toBe(bp);
  });

  it('взнос — по уровню в позиции записи: уровни по времени двигают BB', () => {
    const j = table();
    j.wait(41).bombPot(2); // уровень 2: 10/20
    const bp = open(state(j));
    expect(bp).toMatchObject({ levelIndex: 1, bb: 20, stake: 40, pot: 160 });
  });

  it('смена уровня, вылет, ребай и поздний вход после объявления снимок не меняют', () => {
    const j = table();
    j.wait(39).bombPot(5);
    j.wait(5).bust('A', ['C']);
    j.join('E');
    j.rebuy('A');
    const s = state(j);
    expect(s.errors).toEqual([]);
    expect(s.timer.levelIndex).toBe(1);
    expect(open(s)).toMatchObject({
      levelIndex: 0,
      bb: 10,
      stake: 50,
      players: ['C', 'D', 'A', 'B'],
      pot: 200,
    });
  });

  it('кто в игре без места — участник в конце, в порядке входа', () => {
    const j = table();
    j.join('F', 'E');
    j.bombPot(1);
    const bp = open(state(j));
    expect(bp.players).toEqual(['C', 'D', 'A', 'B', 'F', 'E']);
    expect(bp.pot).toBe(60);
  });

  it('без рассадки: участники в порядке входа, первого слова нет', () => {
    const j = journal().join('A', 'B', 'C');
    j.start();
    j.bombPot(4);
    const bp = open(state(j));
    expect(bp).toMatchObject({
      players: ['A', 'B', 'C'],
      firstToAct: null,
      seating: { buttonSeat: null },
      stake: 40,
      pot: 120,
    });
  });

  it('места без баттона: по номерам мест, первого слова нет', () => {
    const j = journal().join('A', 'B', 'C');
    j.seat('A', 7);
    j.seat('B', 2);
    j.start();
    j.bombPot(1);
    expect(open(state(j))).toMatchObject({ players: ['B', 'A', 'C'], firstToAct: null });
  });

  it('хедз-ап: баттон — он же SB, первое слово после флопа у BB', () => {
    const j = journal().join('A', 'B');
    j.seat('A', 1);
    j.seat('B', 3);
    j.button(1);
    j.start();
    j.bombPot(2);
    const s = state(j);
    expect(tablePositions(s).sb?.playerId).toBe('A');
    expect(open(s)).toMatchObject({ players: ['B', 'A'], firstToAct: 'B' });
  });

  it('игрок на баттоне вылетел: первое слово — первый в игре слева от баттона', () => {
    const j = table();
    j.wait(5).bust('B', ['A']);
    j.bombPot(1);
    // Баттон на 3 (B вне игры): слева от него C (5), дальше D, A.
    expect(open(state(j))).toMatchObject({ players: ['C', 'D', 'A'], firstToAct: 'C' });
  });

  it('переброс: отменённые броски раздачи — в previousBbs, пометка reroll', () => {
    const j = table();
    const first = j.bombPot(2);
    j.voidEvent(first);
    j.bombPot(4, [2]);
    const s = state(j);
    expect(s.errors).toEqual([]);
    expect(open(s)).toMatchObject({ bbs: 4, previousBbs: [2], reroll: true, stake: 40 });
    expect(s.bombPots).toHaveLength(1);
  });

  it('шторка до броска: BB уровня, вилка взноса, участники, первое слово и баттон', () => {
    const j = table();
    j.wait(200); // уровень 6: 50/100
    const s = state(j);
    expect(bombPotPreview(s)).toEqual({
      players: ['C', 'D', 'A', 'B'],
      firstToAct: 'C',
      bb: 100,
      minStake: 100,
      maxStake: 500,
      buttonSeat: 3,
    });
    expect(bombPotLineup(s)).toEqual({ players: ['C', 'D', 'A', 'B'], firstToAct: 'C' });
  });
});

describe('отказы объявления', () => {
  it('до старта таймера, при одном игроке в игре и после финиша — нельзя', () => {
    const j = journal().join('A', 'B');
    const early = j.bombPot(3);
    j.start();
    j.wait(5).bust('B', ['A']);
    const alone = j.bombPot(3);
    j.finish();
    const after = j.bombPot(3);
    const s = state(j);
    expect(errorOf(s, early)).toBe('Таймер не запущен');
    expect(errorOf(s, alone)).toBe(BOMB_POT_FEW_ERROR);
    expect(errorOf(s, after)).toBe('Вечер уже завершён');
    expect(s.bombPots).toEqual([]);
  });

  it('один бомб-пот на раздачу: второй — отказ, после «Следующей раздачи» — можно', () => {
    const j = table();
    j.bombPot(3);
    const twice = j.bombPot(5);
    j.hand();
    const next = j.bombPot(1);
    const s = state(j);
    expect(errorOf(s, twice)).toBe(BOMB_POT_OPEN_ERROR);
    expect(errorOf(s, next)).toBeNull();
    expect(s.bombPots.map((b) => b.bbs)).toEqual([3, 1]);
    expect(open(s).eventId).toBe(next);
  });

  it('неверный бросок — отказ формы; на паузе — можно', () => {
    const j = table();
    const bad = j.bombPot(6);
    j.pause();
    const paused = j.bombPot(2);
    const s = state(j);
    expect(errorOf(s, bad)).toBe(BOMB_POT_SHAPE_ERROR);
    expect(errorOf(s, paused)).toBeNull();
    expect(canApply(F, s, 'bomb_pot', { bbs: 9 }, j.now())).toBe(BOMB_POT_SHAPE_ERROR);
  });

  it('черновик клиента {}: canApply принимает, в состоянии — «кубик ещё не брошен»', () => {
    const j = table();
    const before = state(j);
    expect(canApply(F, before, 'bomb_pot', BOMB_POT_DRAFT.payload, j.now())).toBeNull();
    expect(BOMB_POT_DRAFT).toEqual({ type: 'bomb_pot', payload: {} });
    j.bombPot();
    expect(open(state(j))).toMatchObject({ bbs: 0, stake: 0, pot: 0, reroll: false });
  });
});

describe('кто забрал банк', () => {
  it('результат и раздача: банк у победителя, бомб-пот закрыт раздачей', () => {
    const j = table();
    const bp = j.bombPot(3);
    const res = j.wait(4).bombPotResult(bp, ['D']);
    const hand = j.hand();
    const s = state(j);
    expect(s.errors).toEqual([]);
    expect(s.bombPot).toBeNull();
    expect(s.bombPots[0]).toMatchObject({
      result: { eventId: res, winners: ['D'] },
      closed: { eventId: hand, by: 'hand' },
    });
    expect(s.bombPots[0]?.result?.at).toBe(j.events.find((e) => e.id === res)?.at);
  });

  it('делёж — несколько забравших', () => {
    const j = table();
    const bp = j.bombPot(2);
    j.bombPotResult(bp, ['A', 'C']);
    expect(open(state(j)).result?.winners).toEqual(['A', 'C']);
  });

  it('отказы: не тот бомб-пот, повтор, повторы, не участник, вне игры, форма, финиш', () => {
    const j = table();
    const first = j.bombPot(2);
    j.hand();
    const closed = j.bombPotResult(first, ['A']);
    const unknown = j.bombPotResult(999, ['A']);
    const bp = j.bombPot(4);
    j.join('E');
    j.wait(3).bust('B', ['A']);
    const dup = j.bombPotResult(bp, ['A', 'A']);
    const late = j.bombPotResult(bp, ['E']);
    const out = j.bombPotResult(bp, ['B']);
    const shape = j.add('bomb_pot_result', { eventId: bp, winners: [] });
    const ok = j.bombPotResult(bp, ['C']);
    const again = j.bombPotResult(bp, ['D']);
    const s = state(j);
    expect(errorOf(s, closed)).toBe('Этот бомб-пот уже закрыт');
    expect(errorOf(s, unknown)).toBe(
      'Бомб-пот не принят журналом или отменён — отмечать, кто забрал банк, нечего',
    );
    expect(errorOf(s, dup)).toBe('Игрок повторяется в списке забравших банк');
    expect(errorOf(s, late)).toBe('Забрать бомб-пот может только его участник');
    expect(errorOf(s, out)).toBe('Забрать бомб-пот может только игрок, который сейчас в игре');
    expect(errorOf(s, shape)).toBe(BOMB_POT_RESULT_SHAPE_ERROR);
    expect(errorOf(s, ok)).toBeNull();
    expect(errorOf(s, again)).toBe(
      'Кто забрал бомб-пот, уже отмечено — сначала отмени прежнюю запись',
    );
    expect(open(s).result?.winners).toEqual(['C']);
  });

  it('отменённый бомб-пот — отмечать некого; после финиша — «Вечер уже завершён»', () => {
    const j = journal().join('A', 'B');
    j.start();
    const bp = j.bombPot(1);
    j.voidEvent(bp);
    const voided = j.bombPotResult(bp, ['A']);
    const bp2 = j.bombPot(3, [1]);
    j.wait(2).bust('B', ['A']);
    j.finish();
    const late = j.bombPotResult(bp2, ['A']);
    const s = state(j);
    expect(errorOf(s, voided)).toBe(
      'Бомб-пот не принят журналом или отменён — отмечать, кто забрал банк, нечего',
    );
    expect(errorOf(s, late)).toBe('Вечер уже завершён');
  });

  it('ряд «Кто забрал»: участники в игре по часовой от первого слова', () => {
    const j = table();
    j.join('E');
    j.bombPot(2);
    j.wait(2).bust('D', ['A']);
    const s = state(j);
    expect(bombPotWinnerChoices(s)).toEqual(['C', 'A', 'B', 'E']);
    j.hand();
    expect(bombPotWinnerChoices(state(j))).toEqual([]);
  });

  it('победитель олл-ина в бомб-поте подсвечен; до ривера и олл-ин до бомб-пота — нет', () => {
    const j = table();
    j.showdown(SD0, [
      ['A', 'As', 'Ah'],
      ['B', '2c', '7d'],
    ]);
    j.bombPot(2);
    expect(bombPotAllInWinners(state(j))).toEqual([]); // олл-ин открыт до бомб-пота
    j.showdown(
      SD1,
      [
        ['C', 'Kd', 'Kh'],
        ['D', '2s', '3s'],
      ],
      ['Kc', '9h', '4d'],
    );
    expect(bombPotAllInWinners(state(j))).toEqual([]); // флоп — ривера нет
    j.showdown(
      SD1,
      [
        ['C', 'Kd', 'Kh'],
        ['D', '2s', '3s'],
      ],
      ['Kc', '9h', '4d', '8c', 'Jd'],
    );
    expect(bombPotAllInWinners(state(j))).toEqual(['C']);
    // Ответ на «Фишек хватило?» закрывает раздачу олл-ина раньше, чем ряд «Кто забрал» открывается:
    // подсказка остаётся («Остаётся за столом» — showdown_close, «Вылет» — bust и showdown_close).
    j.closeShowdown(SD1);
    expect(state(j).showdown).toBeNull();
    expect(bombPotAllInWinners(state(j))).toEqual(['C']);
    expect(open(state(j)).allIn?.board).toEqual(['Kc', '9h', '4d', '8c', 'Jd']);
    // Раздача закрыта — бомб-пот закрыт, подсказки нет.
    j.hand();
    expect(bombPotAllInWinners(state(j))).toEqual([]);
  });

  it('подсказка после вылета проигравшего: олл-ин закрыт, победитель в игре — подсвечен', () => {
    const j = table();
    const bp = j.bombPot(2);
    j.showdown(
      SD1,
      [
        ['C', 'Kd', 'Kh'],
        ['D', '2s', '3s'],
      ],
      ['Kc', '9h', '4d', '8c', 'Jd'],
    );
    j.bust('D', ['C']);
    j.closeShowdown(SD1);
    const s = state(j);
    expect(s.showdown).toBeNull();
    expect(bombPotAllInWinners(s)).toEqual(['C']);
    expect(state(j).bombPots.find((b) => b.eventId === bp)?.allIn?.hands).toHaveLength(2);
    // Олл-ин до бомб-пота в него не попадает.
    const k = table();
    k.showdown(SD0, [
      ['A', 'As', 'Ah'],
      ['B', '2c', '7d'],
    ]);
    k.bombPot(2);
    k.showdown(
      SD0,
      [
        ['A', 'As', 'Ah'],
        ['B', '2c', '7d'],
      ],
      ['Kc', '9h', '4d', '8c', 'Jd'],
    );
    k.closeShowdown(SD0);
    expect(open(state(k)).allIn).toBeNull();
    expect(bombPotAllInWinners(state(k))).toEqual([]);
  });
});

describe('закрытие и баттон', () => {
  it('после бомб-пота баттон стоит: те же D, SB и BB; следующая обычная раздача его двигает', () => {
    const j = table();
    const before = tablePositions(state(j));
    expect(blindsInHand(state(j))).toBe(true);
    j.bombPot(3);
    // Взнос заменяет блайнды: позиции те же, блайндов в раздаче нет.
    expect(blindsInHand(state(j))).toBe(false);
    expect(tablePositions(state(j))).toEqual(before);
    j.hand();
    expect(blindsInHand(state(j))).toBe(true);
    const after = state(j);
    expect(after.buttonSeat).toBe(3);
    expect(tablePositions(after)).toEqual(before);
    j.hand();
    expect(state(j).buttonSeat).toBe(5);
  });

  it('игрок на баттоне вылетел в бомб-поте — баттон к следующему в игре', () => {
    const j = table();
    j.bombPot(3);
    j.wait(2).bust('B', ['C']);
    const s = state(j);
    expect(buttonAfterBombPot(s)).toBe(5);
    j.hand();
    expect(state(j).buttonSeat).toBe(5);
  });

  it('игрок на баттоне пересел — баттон к следующему в игре по часовой', () => {
    const j = table();
    j.bombPot(3);
    j.seat('B', 9);
    j.hand();
    expect(state(j).buttonSeat).toBe(5);
  });

  it('баттон не задан: раздача закрывает бомб-пот, баттона по-прежнему нет', () => {
    const j = journal().join('A', 'B');
    j.start();
    j.bombPot(1);
    const hand = j.hand();
    const s = state(j);
    expect(s.buttonSeat).toBeNull();
    expect(s.bombPot).toBeNull();
    expect(s.bombPots[0]?.closed).toMatchObject({ eventId: hand, by: 'hand' });
    expect(buttonAfterBombPot(s)).toBeNull();
  });

  it('уровень по раздачам: раздача-бомб-пот — раздача уровня', () => {
    const f: TournamentFormat = {
      ...F,
      levels: [
        { sb: 5, bb: 10, trigger: { type: 'hands', count: 2 } },
        { sb: 10, bb: 20, trigger: { type: 'hands', count: 2 } },
      ],
    };
    const j = table();
    j.hand();
    j.bombPot(2);
    j.hand();
    const s = state(j, f);
    expect(s.errors).toEqual([]);
    expect(s.timer.levelIndex).toBe(1);
    expect(s.bombPots[0]).toMatchObject({ bb: 10, stake: 20 });
  });

  it('финиш закрывает бомб-пот, отмена финиша возвращает его', () => {
    const j = journal().join('A', 'B');
    j.start();
    const bp = j.bombPot(5);
    j.wait(3).bust('B', ['A']);
    const finish = j.finish();
    const s = state(j);
    expect(s.bombPot).toBeNull();
    expect(s.bombPots[0]?.closed).toMatchObject({ eventId: finish, by: 'finish' });
    j.voidEvent(finish);
    expect(open(state(j))).toMatchObject({ eventId: bp, closed: null });
  });

  it('отмена: бомб-пота — обычная раздача двигает баттон; раздачи — бомб-пот снова открыт', () => {
    const j = table();
    const bp = j.bombPot(3);
    const hand = j.hand();
    j.voidEvent(hand);
    expect(open(state(j)).eventId).toBe(bp);
    const hand2 = j.hand();
    expect(state(j).buttonSeat).toBe(3);
    j.voidEvent(bp);
    const s = state(j);
    expect(s.bombPots).toEqual([]);
    expect(s.buttonSeat).toBe(5);
    expect(errorOf(s, hand2)).toBeNull();
  });
});

describe('одним действием', () => {
  it('«Кто забрал банк» — результат и раздача; «Не отмечать» — только раздача', () => {
    const j = table();
    const bp = j.bombPot(2);
    const s = state(j);
    const drafts = bombPotCloseDrafts(open(s), ['A']);
    expect(drafts).toEqual([
      { type: 'bomb_pot_result', payload: { eventId: bp, winners: ['A'] } },
      { type: 'hand', payload: {} },
    ]);
    expect(bombPotCloseDrafts(open(s), [])).toEqual([{ type: 'hand', payload: {} }]);
    expect(canApplySequence(F, j.events, drafts, j.now())).toBeNull();
    expect(canApplySequence(F, j.events, bombPotCloseDrafts(open(s), ['A', 'A']), j.now())).toEqual(
      { index: 0, message: 'Игрок повторяется в списке забравших банк' },
    );
  });

  it('отметка уже есть (раздачу, закрывшую бомб-пот, отменили отдельно) — закрытие только раздачей', () => {
    const j = table();
    const bp = j.bombPot(2);
    j.bombPotResult(bp, ['C']);
    const hand = j.hand();
    j.voidEvent(hand);
    const s = state(j);
    expect(open(s).result?.winners).toEqual(['C']);
    expect(bombPotCloseDrafts(open(s), ['A'])).toEqual([{ type: 'hand', payload: {} }]);
    expect(canApplySequence(F, j.events, bombPotCloseDrafts(open(s), ['A']), j.now())).toBeNull();
  });

  it('объявить на следующую раздачу — раздача и черновик бомб-пота; два подряд — отказ второго', () => {
    const j = table();
    expect(bombPotNextRefusal(state(j))).toBeNull();
    j.bombPot(2);
    // Журнал цепочку примет (раздача закроет бомб-пот), но пульт и RPC — нет: закрыть бомб-пот
    // можно только рядом «Кто забрал».
    expect(
      canApplySequence(F, j.events, [{ type: 'hand', payload: {} }, BOMB_POT_DRAFT], j.now()),
    ).toBeNull();
    expect(bombPotNextRefusal(state(j))).toBe(BOMB_POT_NEXT_OPEN_ERROR);
    expect(canApplySequence(F, j.events, [BOMB_POT_DRAFT], j.now())).toEqual({
      index: 0,
      message: BOMB_POT_OPEN_ERROR,
    });
    j.hand();
    expect(bombPotNextRefusal(state(j))).toBeNull();
    const k = table();
    expect(canApplySequence(F, k.events, [BOMB_POT_DRAFT, BOMB_POT_DRAFT], k.now())).toEqual({
      index: 1,
      message: BOMB_POT_OPEN_ERROR,
    });
  });
});

describe('время показа', () => {
  it('телефоны показывают взнос через 9 с после броска по серверному времени', () => {
    const j = table();
    j.bombPot(3);
    const bp = open(state(j));
    const at = Date.parse(bp.at);
    expect(BOMB_REVEAL_MS).toBe(9_000);
    expect(bombPotRevealAtMs(bp)).toBe(at + 9_000);
    expect(isBombPotRevealed(bp, at + 8_999)).toBe(false);
    expect(isBombPotRevealed(bp, at + 9_000)).toBe(true);
    expect(isBombPotRevealed({ at: 'сломано' }, at)).toBe(true);
  });

  it('незакрытый бомб-пот гаснет через 20 минут; закрытый не показывается', () => {
    const j = table();
    j.bombPot(3);
    const s = state(j);
    const at = Date.parse(open(s).at);
    expect(BOMB_POT_IDLE_HIDE_MS).toBe(20 * MIN);
    expect(visibleBombPot(s, at + 20 * MIN)).toBe(s.bombPot);
    expect(visibleBombPot(s, at + 20 * MIN + 1)).toBeNull();
    j.hand();
    const after = state(j);
    expect(visibleBombPot(after, at)).toBeNull();
    expect(lastBombPot(after)?.closed?.by).toBe('hand');
  });
});

describe('бомб-пот не меняет игру, деньги и итоги', () => {
  const strip = (s: EveningState) => ({ ...s, bombPot: null, bombPots: [], buttonSeat: null });
  const bombIds = (events: readonly EveningEvent[]) =>
    new Set(events.filter((e) => isBombPotEvent(e.type)).map((e) => e.id));

  it('состояние то же, кроме бомб-потов и баттона; деньги и summarize те же', () => {
    const j = table();
    j.wait(10).hand();
    const bp1 = j.bombPot(3);
    j.wait(5).bust('C', ['A']);
    j.bombPotResult(bp1, ['A']);
    j.hand();
    j.rebuy('C');
    j.wait(30).hand();
    const bp2 = j.bombPot(5, [2]);
    j.wait(250).bust('C', ['A', 'B']);
    j.bombPotResult(bp2, ['A', 'B']);
    j.hand();
    j.bust('D', ['B']);
    j.bombPot(1);
    j.bust('B', ['A']);
    j.finish();
    const ids = bombIds(j.events);
    const without = j.events.map((e) => (ids.has(e.id) ? { ...e, voided: true } : e));
    const lastMs = j.now() + 5 * MIN;
    const a = replayLog(F, j.events, lastMs);
    const b = replayLog(F, without, lastMs);
    expect(a.state.errors).toEqual([]);
    expect(a.state.bombPots.map((x) => x.closed?.by)).toEqual(['hand', 'hand', 'finish']);
    expect(strip(a.state)).toEqual(strip(b.state));
    expect(a.applied.filter((e) => !ids.has(e.id))).toEqual(b.applied);
    expect(computeMoney(F, a.state)).toEqual(computeMoney(F, b.state));
    expect(summarize('e1', '2026-10-08', F, j.events, DEFAULT_SCORING)).toEqual(
      summarize('e1', '2026-10-08', F, without, DEFAULT_SCORING),
    );
  });

  it('сгенерированные вечера: снимок, закрытие раздачей, баттон стоит, без бомб-потов — та же игра', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const rnd = prng(seed);
      const ids = ['A', 'B', 'C', 'D', 'E', 'F'].slice(0, 2 + Math.floor(rnd() * 5));
      const j = journal().join(...ids);
      ids.forEach((id, i) => {
        if (rnd() < 0.85) j.seat(id, 1 + ((i * 3) % TABLE_SEATS));
      });
      if (rnd() < 0.8) j.button(1);
      j.start();
      const bombs: number[] = [];
      for (let step = 0; step < 50; step += 1) {
        const s = state(j);
        const alive = s.joinOrder.filter((id) => s.players[id]?.alive);
        const dead = s.joinOrder.filter((id) => !s.players[id]?.alive);
        const r = rnd();
        if (r < 0.2) {
          const bbs = 1 + Math.floor(rnd() * 5);
          bombs.push(rnd() < 0.2 ? j.bombPot(bbs, [1 + Math.floor(rnd() * 5)]) : j.bombPot(bbs));
        } else if (r < 0.3 && s.bombPot) {
          const pick = s.bombPot.players.filter(() => rnd() < 0.5);
          bombs.push(
            j.bombPotResult(s.bombPot.eventId, pick.length > 0 ? pick : alive.slice(0, 1)),
          );
        } else if (r < 0.55) {
          const holder = s.buttonSeat === null ? null : seatHolder(s, s.buttonSeat);
          const wasBomb = s.bombPot;
          const handId = j.wait(1).hand();
          const after = state(j);
          if (errorOf(after, handId) === null) {
            expect(after.bombPot).toBeNull();
            if (wasBomb) {
              expect(after.bombPots.find((b) => b.eventId === wasBomb.eventId)?.closed).toEqual({
                eventId: handId,
                at: j.events.at(-1)?.at,
                by: 'hand',
              });
              // Баттон стоит, если игрок на нём в игре; иначе — к следующему в игре.
              if (holder?.alive) expect(after.buttonSeat).toBe(s.buttonSeat);
            }
            if (after.buttonSeat !== null && tablePositions(after).order.length > 0)
              expect(seatHolder(after, after.buttonSeat)?.alive).toBe(true);
          }
        } else if (r < 0.75 && alive.length > 1) {
          const victim = alive[Math.floor(rnd() * alive.length)] as string;
          j.wait(1).bust(victim, alive.filter((x) => x !== victim).slice(0, 1));
        } else if (r < 0.85 && dead.length > 0 && s.rebuysOpen) {
          j.rebuy(dead[Math.floor(rnd() * dead.length)] as string);
        } else if (r < 0.92 && bombs.length > 0) {
          j.voidEvent(bombs[Math.floor(rnd() * bombs.length)] as number);
        } else {
          j.wait(5);
        }
        const now = state(j);
        // Открытый бомб-пот — последний принятый и без закрытия; закрытые — с закрытием.
        if (now.bombPot) {
          expect(now.bombPots.at(-1)).toBe(now.bombPot);
          expect(now.bombPot.closed).toBeNull();
        }
        now.bombPots.forEach((bp, i) => {
          if (bp !== now.bombPot) expect(bp.closed).not.toBeNull();
          if (i > 0) expect(bp.eventId).toBeGreaterThan(now.bombPots[i - 1]?.eventId ?? 0);
          expect(isBombPotBbs(bp.bbs)).toBe(true);
          expect(bp.stake).toBe(bp.bbs * bp.bb);
          expect(bp.pot).toBe(bp.stake * bp.players.length);
          expect(bp.players.length).toBeGreaterThanOrEqual(2);
          expect(new Set(bp.players).size).toBe(bp.players.length);
          expect(bp.reroll).toBe(bp.previousBbs.length > 0);
          if (bp.firstToAct !== null) expect(bp.players[0]).toBe(bp.firstToAct);
          for (const w of bp.result?.winners ?? []) expect(bp.players).toContain(w);
        });
        // Без записей бомб-пота — та же игра (кроме баттона: бомб-пот его держит).
        const bombIdsNow = bombIds(j.events);
        const without = j.events.map((e) => (bombIdsNow.has(e.id) ? { ...e, voided: true } : e));
        expect({
          ...strip(now),
          errors: now.errors.filter((e) => !bombIdsNow.has(e.eventId)),
        }).toEqual(strip(replay(F, without, j.now())));
      }
    }
  }, 60_000);
});
