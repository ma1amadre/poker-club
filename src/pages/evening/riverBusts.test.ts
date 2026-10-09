// Пульт после ривера: записи действия «вылеты и ребаи одной раздачи», подписи, вопрос и тост.
// Кто кого выбил и места считает домен (riverBusts.test.ts домена) — здесь проверяется, что действие
// пульта даёт те места, нокауты и ребаи, которые задал банкир, а инвариант «призовые = взносы» и
// replay не страдают.
import { DEFAULT_FORMAT } from '@domain/format.ts';
import { computeMoney, paymentsFromEvents } from '@domain/money.ts';
import { canApplySequence, replay, replayLog } from '@domain/replay.ts';
import { journal, MIN, type Journal } from '@domain/test-utils.ts';
import type { TournamentFormat } from '@domain/types.ts';
import { describe, expect, it } from 'vitest';
import { finishDueAfter } from './lib';
import {
  keepChipOrder,
  killerKey,
  killersInColumn,
  moveUp,
  pultRiverSuggestion,
  readRiverDeclined,
  RIVER_BUST_HOLD_MS,
  riverBustLabel,
  riverBustQuestion,
  riverDeclinedKey,
  riverKillersText,
  riverPlanDrafts,
  riverToast,
  writeRiverDeclined,
  type RiverPlan,
} from './riverBusts';

const F = DEFAULT_FORMAT;
const SD = '00000000-0000-4000-8000-0000000000aa';
const plan = (p: Partial<RiverPlan> & Pick<RiverPlan, 'byChips' | 'killers'>): RiverPlan => ({
  showdownId: SD,
  rebuys: [],
  paid: false,
  ...p,
});
const names: Record<string, string> = { a: 'Женя', b: 'Саша', c: 'Дима', d: 'Лёша', e: 'Вова' };
const nameOf = (id: string) => names[id] ?? id;

/** Вечер пятерых, таймер идёт 10 минут: ребаи открыты. */
function evening() {
  const j = journal();
  j.join('a', 'b', 'c', 'd', 'e');
  j.start();
  j.wait(10);
  return j;
}

describe('riverPlanDrafts: вылеты в порядке мест, затем ребаи', () => {
  it('без ребаев — только вылеты, от меньшего стека к большему', () => {
    expect(
      riverPlanDrafts(F, plan({ byChips: ['c', 'd'], killers: { c: ['a'], d: ['b'] } })),
    ).toEqual([
      { type: 'bust', payload: { playerId: 'd', by: ['b'] } },
      { type: 'bust', payload: { playerId: 'c', by: ['a'] } },
    ]);
  });

  it('вылет и ребай одного: как «Вылет и ребай» на пульте — одна цепочка, игрок снова в игре', () => {
    const drafts = riverPlanDrafts(
      F,
      plan({ byChips: ['c'], killers: { c: ['a'] }, rebuys: ['c'] }),
    );
    expect(drafts).toEqual([
      { type: 'bust', payload: { playerId: 'c', by: ['a'] } },
      { type: 'rebuy', payload: { playerId: 'c' } },
    ]);
    const j = evening();
    expect(canApplySequence(F, j.events, drafts, j.now())).toBeNull();
    for (const d of drafts) j.add(d.type, d.payload);
    const s = replay(F, j.events, j.now());
    expect(s.errors).toEqual([]);
    expect(s.players.c?.alive).toBe(true);
    expect(s.players.c?.rebuys).toBe(1);
    expect(s.players.a?.kos).toBe(1);
  });

  it('два вылета, один докупается с оплатой сразу: места, нокауты, платёж и деньги', () => {
    const drafts = riverPlanDrafts(
      F,
      plan({ byChips: ['c', 'd'], killers: { c: ['a'], d: ['b'] }, rebuys: ['d'], paid: true }),
    );
    expect(drafts.map((d) => d.type)).toEqual(['bust', 'bust', 'rebuy', 'payment']);
    const j = evening();
    expect(canApplySequence(F, j.events, drafts, j.now())).toBeNull();
    for (const d of drafts) j.add(d.type, d.payload);
    const s = replay(F, j.events, j.now());
    expect(s.errors).toEqual([]);
    expect(s.players.c?.alive).toBe(false);
    expect(s.players.d?.alive).toBe(true);
    expect(s.players.a?.koVictims).toEqual(['c']);
    expect(s.players.b?.koVictims).toEqual(['d']);
    expect(paymentsFromEvents(j.events).map((p) => p.playerId)).toEqual(['d']);
    // Доигрываем: призовые ровно равны взносам.
    j.wait(1).bust('d', ['a']);
    j.wait(1).bust('e', ['a']);
    j.wait(1).bust('b', ['a']);
    j.finish();
    const done = replay(F, j.events, j.now());
    expect(done.errors).toEqual([]);
    expect(done.places[0]).toBe('a');
    const money = computeMoney(F, done);
    const prizes = Object.values(money).reduce((sum, m) => sum + m.prizeRub, 0);
    const owes = Object.values(money).reduce((sum, m) => sum + m.owesRub, 0);
    expect(prizes).toBe(owes);
  });

  it('ребаи закрыты — цепочка с ребаем не проходит, без ребая — проходит', () => {
    const closed: TournamentFormat = { ...F, rebuyUntilLevel: 0 };
    const j = journal();
    j.join('a', 'b', 'c');
    j.start();
    j.wait(1);
    const withRebuy = riverPlanDrafts(
      closed,
      plan({ byChips: ['c'], killers: { c: ['a'] }, rebuys: ['c'] }),
    );
    expect(canApplySequence(closed, j.events, withRebuy, j.now())?.message).toBe('Ребаи закрыты');
    const bustOnly = riverPlanDrafts(closed, plan({ byChips: ['c'], killers: { c: ['a'] } }));
    expect(canApplySequence(closed, j.events, bustOnly, j.now())).toBeNull();
  });
});

describe('finishDueAfter: «Завершить вечер» в тосте последнего вылета', () => {
  it('остался один и ребаи закрыты — да; ребаи открыты или в игре двое — нет', () => {
    const closed: TournamentFormat = { ...F, rebuyUntilLevel: 0 };
    const j = journal();
    j.join('a', 'b', 'c');
    j.start();
    j.wait(1).bust('c', ['a']);
    const last = [{ type: 'bust' as const, payload: { playerId: 'b', by: ['a'] } }];
    expect(finishDueAfter(closed, j.events, last, j.now())).toBe(true);
    expect(finishDueAfter(F, j.events, last, j.now())).toBe(false);
    expect(finishDueAfter(closed, j.events, [], j.now())).toBe(false);
    // Вылет на троих: двое ещё в игре.
    const k = journal();
    k.join('a', 'b', 'c', 'd');
    k.start();
    k.wait(1);
    expect(finishDueAfter(closed, k.events, last, k.now())).toBe(false);
  });

  it('несколько вылетов одной раздачи разом — последний стоящий', () => {
    const closed: TournamentFormat = { ...F, rebuyUntilLevel: 0 };
    const j = journal();
    j.join('a', 'b', 'c');
    j.start();
    j.wait(1);
    const drafts = riverPlanDrafts(
      closed,
      plan({ byChips: ['b', 'c'], killers: { b: ['a'], c: ['a'] } }),
    );
    expect(finishDueAfter(closed, j.events, drafts, j.now())).toBe(true);
  });

  it('запись, которую журнал не примет, — нет', () => {
    const closed: TournamentFormat = { ...F, rebuyUntilLevel: 0 };
    const j = journal();
    j.join('a', 'b', 'c');
    j.start();
    j.wait(1).bust('c', ['a']);
    // Выбивший уже вне игры — журнал вылет не примет.
    const wrong = [{ type: 'bust' as const, payload: { playerId: 'b', by: ['c'] } }];
    expect(finishDueAfter(closed, j.events, wrong, j.now())).toBe(false);
  });
});

describe('порядок по фишкам в шторке', () => {
  it('keepChipOrder: прежние на месте, новые — в конец, снятые уходят', () => {
    expect(keepChipOrder(['a', 'c'], ['c', 'a'])).toEqual(['a', 'c']);
    expect(keepChipOrder(['a', 'c'], ['c', 'b'])).toEqual(['c', 'b']);
    expect(keepChipOrder([], ['b', 'a'])).toEqual(['b', 'a']);
  });

  it('moveUp: на строку выше, первый остаётся первым', () => {
    expect(moveUp(['a', 'b', 'c'], 'c')).toEqual(['a', 'c', 'b']);
    expect(moveUp(['a', 'b', 'c'], 'a')).toEqual(['a', 'b', 'c']);
    expect(moveUp(['a', 'b'], 'x')).toEqual(['a', 'b']);
  });

  it('killersInColumn: длинные имена и больше двух вариантов — столбиком', () => {
    expect(killersInColumn(['Женя', 'Саша'])).toBe(false);
    expect(killersInColumn(['Женя и Саша', 'Дима'])).toBe(false);
    expect(killersInColumn(['Женя', 'Саша', 'Дима'])).toBe(true);
    expect(killersInColumn(['Женя', 'Александр Константинопольский'])).toBe(true);
  });

  it('killerKey: вариант «кто выбил» — значение переключателя', () => {
    expect(killerKey(['a'])).toBe('a');
    expect(killerKey(['a', 'b'])).toBe('a,b');
    expect(killerKey([])).toBe('');
  });
});

describe('тексты', () => {
  it('кнопка и кто выбивает', () => {
    expect(riverBustLabel([])).toBe('Отметь, кто вылетел');
    expect(riverBustLabel(['Дима'])).toBe('Записать вылет: Дима');
    expect(riverBustLabel(['Дима'], 1)).toBe('Вылет и ребай: Дима');
    expect(riverBustLabel(['Дима', 'Лёша'])).toBe('Записать вылеты: 2');
    expect(riverBustLabel(['Дима', 'Лёша'], 1)).toBe('Записать вылеты: 2 и ребай');
    expect(riverBustLabel(['Дима', 'Лёша', 'Вова'], 2)).toBe('Записать вылеты: 3 и 2 ребая');
    expect(riverKillersText(['Женя'])).toBe('выбивает Женя');
    expect(riverKillersText(['Женя', 'Саша'])).toBe('выбивают Женя и Саша — нокаут каждому');
    expect(riverKillersText([])).toBe('кто выбил — не указано');
  });

  it('вопрос перед вылетом с пульта: раздача закроется', () => {
    expect(riverBustQuestion('Дима', ['Женя'])).toEqual({
      title: 'Записать вылет: Дима?',
      message:
        'Дима — вылет, выбивает Женя. Раздача закроется. Фишек хватило и игрок остаётся за столом — нажми «Не записывать».',
      confirmText: 'Записать вылет',
    });
  });

  it('тост: один вылет, вылет и ребай, побочный банк — у каждого свой выбивший', () => {
    expect(riverToast(plan({ byChips: ['c'], killers: { c: ['a'] } }), nameOf)).toEqual({
      success: 'Вылет записан: Дима',
      detail: 'Выбивает Женя.',
    });
    expect(
      riverToast(
        plan({ byChips: ['c'], killers: { c: ['a'] }, rebuys: ['c'], paid: true }),
        nameOf,
      ),
    ).toEqual({ success: 'Вылет и ребай: Дима', detail: 'Выбивает Женя. Ребай оплачен сразу.' });
    expect(
      riverToast(plan({ byChips: ['c', 'd'], killers: { c: ['a'], d: ['a'] } }), nameOf),
    ).toEqual({ success: 'Вылеты записаны: Дима и Лёша', detail: 'Выбивает Женя.' });
    expect(
      riverToast(
        plan({ byChips: ['c', 'd'], killers: { c: ['a'], d: ['b'] }, rebuys: ['d'] }),
        nameOf,
      ),
    ).toEqual({
      success: 'Вылеты записаны: Дима и Лёша',
      detail: 'Дима: выбивает Женя; Лёша: выбивает Саша. Ребай: Лёша.',
    });
    expect(riverToast(plan({ byChips: ['c'], killers: { c: ['a', 'b'] } }), nameOf).detail).toBe(
      'Выбивают Женя и Саша — нокаут каждому.',
    );
  });
});

describe('pultRiverSuggestion: сколько предложение держится на пульте', () => {
  // Стол без стрита и флеша: у a тузы, у b короли, у c дамы.
  const BOARD = ['2c', '7h', '9s', 'Jc', '3d'];
  const AA: [string, string, string] = ['a', 'As', 'Ah'];
  const KK: [string, string, string] = ['b', 'Kd', 'Ks'];
  const QQ: [string, string, string] = ['c', 'Qs', 'Qh'];
  /** Что видит пульт по журналу на этот момент: предложение (кто проиграл) или null. */
  const pult = (j: Journal, declined: number | null = null) => {
    const { state, applied } = replayLog(F, j.events, j.now());
    const isAlive = (id: string) => Boolean(state.players[id]?.alive);
    return (
      pultRiverSuggestion(state.showdown, isAlive, applied, j.now(), declined)?.victims ?? null
    );
  };
  /** Олл-ин a против b до ривера: b проиграл, но фишек у него больше — он остался в игре. */
  function riverAvsB() {
    const j = evening();
    j.wait(1).showdown(SD, [AA, KK], BOARD);
    return j;
  }

  it('держится дольше табло (2 минуты), но не дольше срока', () => {
    const j = riverAvsB();
    expect(pult(j)).toEqual(['b']);
    j.wait(3);
    expect(pult(j)).toEqual(['b']);
    j.wait(RIVER_BUST_HOLD_MS / MIN - 3 - 0.01);
    expect(pult(j)).toEqual(['b']);
    j.wait(0.01);
    expect(pult(j)).toBeNull();
  });

  it('ревьюер: b остался в игре, через полчаса вылетает в другой раздаче — старой кнопки уже нет', () => {
    const j = riverAvsB();
    j.wait(30);
    expect(pult(j)).toBeNull();
  });

  it('игра ушла дальше: вылет любого игрока, сыгранная раздача, смена уровня вручную', () => {
    const steps: [string, (j: Journal) => void][] = [
      ['вылет другого игрока', (j) => j.bust('d', ['e'])],
      ['раздача сыграна', (j) => j.hand()],
      ['уровень вперёд', (j) => j.next()],
      ['уровень назад', (j) => j.prev()],
    ];
    for (const [what, step] of steps) {
      const j = evening();
      // Уровень назад — со второго уровня.
      if (what === 'уровень назад') j.next();
      j.wait(1).showdown(SD, [AA, KK], BOARD);
      expect(pult(j)).toEqual(['b']);
      step(j.wait(0.5));
      expect(pult(j), what).toBeNull();
    }
  });

  it('ребай, вход, платёж, пауза и вылет до ривера игру дальше не двигают', () => {
    const j = evening();
    j.wait(1).showdown(SD, [AA, KK]);
    // Вылет, записанный до ривера, — не после него: раздачу он позади не оставляет.
    j.wait(0.2).bust('e', ['d']);
    j.wait(0.2).showdown(SD, [AA, KK], BOARD);
    j.wait(0.2).rebuy('e');
    j.payment('e', 1000);
    j.join('f');
    j.pause();
    expect(pult(j)).toEqual(['b']);
  });

  it('правка карты после ривера — новая версия, срок с начала', () => {
    const j = riverAvsB();
    j.wait(4);
    j.showdown(SD, [AA, ['b', 'Kd', 'Kh']], BOARD);
    j.wait(4);
    expect(pult(j)).toEqual(['b']);
  });

  it('«Не записывать» — по этой версии раздачи; правка карты — снова предложение', () => {
    const j = riverAvsB();
    const { state } = replayLog(F, j.events, j.now());
    const version = state.showdown?.eventId ?? null;
    expect(pult(j, version)).toBeNull();
    j.wait(0.5).showdown(SD, [AA, ['b', 'Kd', 'Kh']], BOARD);
    expect(pult(j, version)).toEqual(['b']);
  });

  it('олл-ин на троих: записали вылет c, b остался, закрыть раздачу не вышло — b не предлагается', () => {
    const j = evening();
    j.wait(1).showdown(SD, [AA, KK, QQ], BOARD);
    expect(pult(j)).toEqual(['b', 'c']);
    // Действие из шторки: c вылетел, с b отметку сняли; «Закрыть раздачу» следом не прошло.
    const bust = j.wait(0.3).bust('c', ['a']);
    expect(pult(j)).toBeNull();
    // «Отменить» вылет — раздача снова ждёт ответа.
    j.voidEvent(bust);
    expect(pult(j)).toEqual(['b', 'c']);
  });

  it('раздачу закрыли или начали новую — предложения нет', () => {
    const j = riverAvsB();
    j.closeShowdown(SD);
    expect(pult(j)).toBeNull();
  });
});

describe('«Не записывать» в sessionStorage', () => {
  const memory = () => {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
  };

  it('пишется и читается по вечеру', () => {
    const s = memory();
    expect(readRiverDeclined(s, 'ev1')).toBeNull();
    writeRiverDeclined(s, 'ev1', 42);
    expect(readRiverDeclined(s, 'ev1')).toBe(42);
    expect(readRiverDeclined(s, 'ev2')).toBeNull();
    expect(riverDeclinedKey('ev1')).toBe('poker-club:river-declined:ev1');
  });

  it('мусор, пустое хранилище и исключения — null, запись не бросает', () => {
    const s = memory();
    s.setItem(riverDeclinedKey('ev1'), 'abc');
    expect(readRiverDeclined(s, 'ev1')).toBeNull();
    expect(readRiverDeclined(null, 'ev1')).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(readRiverDeclined(broken, 'ev1')).toBeNull();
    expect(() => writeRiverDeclined(broken, 'ev1', 1)).not.toThrow();
  });
});
