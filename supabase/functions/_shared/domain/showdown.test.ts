import { describe, expect, it } from 'vitest';
import { DEFAULT_FORMAT } from './format.ts';
import { computeMoney } from './money.ts';
import { canApply, replay, replayLog } from './replay.ts';
import { DEFAULT_SCORING } from './scoring.ts';
import {
  CARD_RANKS,
  CARD_SUITS,
  isCardCode,
  isShowdownEvent,
  readShowdown,
  SHOWDOWN_IDLE_HIDE_MS,
  SHOWDOWN_RIVER_HOLD_MS,
  streetOf,
  visibleShowdown,
} from './showdown.ts';
import { summarize } from './summary.ts';
import { journal, MIN } from './test-utils.ts';
import {
  EVENT_TYPES,
  SHOWDOWN_EVENT_TYPES,
  type EveningEvent,
  type ShowdownState,
} from './types.ts';

const F = DEFAULT_FORMAT;
const SD1 = '5d000000-0000-4000-8000-000000000001';
const SD2 = '5d000000-0000-4000-8000-000000000002';

const payload = (hands: [string, string, string][], board: string[] = [], showdownId = SD1) => ({
  showdownId,
  hands: hands.map(([playerId, a, b]) => ({ playerId, cards: [a, b] })),
  board,
});

describe('нотация карт', () => {
  it('52 разные карты: ранг 2–9TJQKA, масть shdc', () => {
    const all = [...CARD_RANKS].flatMap((r) => [...CARD_SUITS].map((s) => r + s));
    expect(new Set(all).size).toBe(52);
    expect(all.every(isCardCode)).toBe(true);
  });

  it('другие записи — не карты', () => {
    for (const bad of ['as', 'AS', '10s', 'Ax', '1s', 'A', '', 'Ass', 'As ', null, 14]) {
      expect(isCardCode(bad)).toBe(false);
    }
  });

  it('улица по числу карт стола', () => {
    expect([0, 3, 4, 5].map(streetOf)).toEqual(['preflop', 'flop', 'turn', 'river']);
  });

  it('типы олл-ина есть среди событий журнала', () => {
    expect(SHOWDOWN_EVENT_TYPES.every((t) => EVENT_TYPES.includes(t))).toBe(true);
    expect(EVENT_TYPES.filter(isShowdownEvent)).toEqual(['showdown', 'showdown_close']);
  });
});

describe('readShowdown — форма payload', () => {
  const ok = payload([
    ['A', 'As', 'Kd'],
    ['B', 'Qh', 'Qc'],
  ]);

  it('правильная раздача читается как есть, id — в нижнем регистре', () => {
    expect(readShowdown(ok)).toEqual({ ok: true, value: ok });
    const upper = { ...ok, showdownId: SD1.toUpperCase() };
    expect(readShowdown(upper)).toEqual({ ok: true, value: ok });
  });

  it('стол — только 0, 3, 4 или 5 карт', () => {
    const board = ['2c', '7d', '9h', 'Jd', 'Tc'];
    for (const n of [0, 3, 4, 5])
      expect(readShowdown({ ...ok, board: board.slice(0, n) }).ok).toBe(true);
    for (const n of [1, 2]) {
      expect(readShowdown({ ...ok, board: board.slice(0, n) })).toEqual({
        ok: false,
        error: 'Олл-ин: на столе 0, 3, 4 или 5 карт',
      });
    }
    expect(readShowdown({ ...ok, board: [...board, '3s'] }).ok).toBe(false);
  });

  it('от 2 до 9 рук', () => {
    const ranks = '23456789TJ';
    const many = (n: number) =>
      payload(
        Array.from({ length: n }, (_, i): [string, string, string] => [
          `P${i}`,
          `${ranks[i]}s`,
          `${ranks[i]}h`,
        ]),
      );
    expect(readShowdown(many(9)).ok).toBe(true);
    expect(readShowdown(many(10))).toEqual({ ok: false, error: 'Олл-ин: игроков — от 2 до 9' });
    expect(readShowdown(many(1)).ok).toBe(false);
  });

  it('повтор карты — у двух игроков или на столе', () => {
    expect(
      readShowdown(
        payload([
          ['A', 'As', 'Kd'],
          ['B', 'As', 'Qc'],
        ]),
      ),
    ).toEqual({ ok: false, error: 'Олл-ин: карта As указана дважды' });
    expect(readShowdown({ ...ok, board: ['Kd', '2c', '3c'] })).toEqual({
      ok: false,
      error: 'Олл-ин: карта Kd указана дважды',
    });
    expect(readShowdown({ ...ok, board: ['2c', '2c', '3c'] }).ok).toBe(false);
  });

  it('кривые карты, игроки и id', () => {
    expect(
      readShowdown(
        payload([
          ['A', 'as', 'Kd'],
          ['B', 'Qh', 'Qc'],
        ]),
      ),
    ).toEqual({
      ok: false,
      error: 'Олл-ин: «as» — не карта, нужна запись вида As, Td, 9h',
    });
    expect(
      readShowdown(
        payload([
          ['A', '10s', 'Kd'],
          ['B', 'Qh', 'Qc'],
        ]),
      ).ok,
    ).toBe(false);
    expect(
      readShowdown(
        payload([
          ['A', 'As', 'Kd'],
          ['A', 'Qh', 'Qc'],
        ]),
      ),
    ).toEqual({ ok: false, error: 'Олл-ин: игрок указан дважды' });
    expect(readShowdown({ ...ok, hands: [{ playerId: 'A', cards: ['As'] }, ok.hands[1]] })).toEqual(
      { ok: false, error: 'Олл-ин: у каждого игрока — две карты' },
    );
    expect(readShowdown({ ...ok, hands: [{ cards: ['As', 'Kd'] }, ok.hands[1]] }).ok).toBe(false);
    expect(readShowdown({ ...ok, showdownId: 'not-a-uuid' })).toEqual({
      ok: false,
      error: 'Олл-ин: нет id раздачи',
    });
    expect(readShowdown({ ...ok, board: undefined }).ok).toBe(false);
    expect(readShowdown(null).ok).toBe(false);
    expect(readShowdown([]).ok).toBe(false);
  });
});

/** Вечер на четверых: таймер идёт, все за столом. */
function table() {
  const j = journal().join('A', 'B', 'C', 'D');
  j.start();
  j.wait(10);
  return j;
}

describe('replay: раздача олл-ина', () => {
  it('открытие, флоп, тёрн, ривер — версия обновляется, раздача та же', () => {
    const j = table();
    const opened = j.showdown(SD1, [
      ['A', 'As', 'Kd'],
      ['B', 'Qh', 'Qc'],
    ]);
    let s = replay(F, j.events, j.now());
    expect(s.errors).toEqual([]);
    expect(s.showdown).toMatchObject({
      showdownId: SD1,
      board: [],
      openedEventId: opened,
      eventId: opened,
    });
    j.wait(0.5);
    j.showdown(
      SD1,
      [
        ['A', 'As', 'Kd'],
        ['B', 'Qh', 'Qc'],
      ],
      ['2c', '7d', '9h'],
    );
    j.wait(0.5);
    const river = j.showdown(
      SD1,
      [
        ['A', 'As', 'Kd'],
        ['B', 'Qh', 'Qc'],
      ],
      ['2c', '7d', '9h', 'Jd', 'Ah'],
    );
    s = replay(F, j.events, j.now());
    expect(s.errors).toEqual([]);
    expect(s.showdown).toMatchObject({
      board: ['2c', '7d', '9h', 'Jd', 'Ah'],
      openedEventId: opened,
      eventId: river,
      openedAt: j.events.find((e) => e.id === opened)?.at,
      updatedAt: j.events.find((e) => e.id === river)?.at,
    });
    j.closeShowdown(SD1);
    s = replay(F, j.events, j.now());
    expect(s.showdown).toBeNull();
    expect(s.errors).toEqual([]);
  });

  it('отмена последней правки возвращает предыдущую версию, отмена закрытия — раздачу', () => {
    const j = table();
    const hands: [string, string, string][] = [
      ['A', 'As', 'Kd'],
      ['B', 'Qh', 'Qc'],
    ];
    j.showdown(SD1, hands, ['2c', '7d', '9h']);
    const turn = j.showdown(SD1, hands, ['2c', '7d', '9h', 'Jd']);
    const close = j.closeShowdown(SD1);
    j.voidEvent(close);
    expect(replay(F, j.events, j.now()).showdown?.board).toEqual(['2c', '7d', '9h', 'Jd']);
    j.voidEvent(turn);
    expect(replay(F, j.events, j.now()).showdown?.board).toEqual(['2c', '7d', '9h']);
  });

  it('новый олл-ин заменяет незакрытый', () => {
    const j = table();
    j.showdown(SD1, [
      ['A', 'As', 'Kd'],
      ['B', 'Qh', 'Qc'],
    ]);
    const second = j.showdown(SD2, [
      ['C', '7s', '7h'],
      ['D', 'Ac', 'Jc'],
    ]);
    const s = replay(F, j.events, j.now());
    expect(s.showdown).toMatchObject({ showdownId: SD2, openedEventId: second });
    // Старую раздачу закрыть уже нельзя — её нет на экране.
    expect(canApply(F, s, 'showdown_close', { showdownId: SD1 }, j.now())).toBe(
      'Эта раздача олл-ина уже закрыта',
    );
  });

  it('новая раздача — только из тех, кто в игре; правка открытой — и с вылетевшим', () => {
    const j = table();
    const hands: [string, string, string][] = [
      ['A', 'As', 'Kd'],
      ['B', 'Qh', 'Qc'],
    ];
    j.showdown(SD1, hands, ['2c', '7d', '9h', 'Jd', 'Ah']);
    j.bust('B', ['A']);
    // Опечатку в карте вылетевшего правят и после вылета.
    const fix = j.showdown(
      SD1,
      [hands[0] as [string, string, string], ['B', 'Qh', 'Qd']],
      ['2c', '7d', '9h', 'Jd', 'Ah'],
    );
    let s = replay(F, j.events, j.now());
    expect(s.errors).toEqual([]);
    expect(s.showdown?.eventId).toBe(fix);
    // А в новую раздачу вылетевшего не взять.
    const fresh = payload(
      [
        ['B', '2s', '2h'],
        ['C', '3s', '3h'],
      ],
      [],
      SD2,
    );
    expect(canApply(F, s, 'showdown', fresh, j.now())).toBe(
      'Олл-ин: игрок уже выбыл — в раздачу берутся только те, кто в игре',
    );
    // Добавить в открытую раздачу вылетевшего, которого в ней не было, тоже нельзя.
    j.closeShowdown(SD1);
    j.bust('D', ['C']);
    j.showdown(SD2, [
      ['A', 'Ts', 'Th'],
      ['C', '9s', '9h'],
    ]);
    s = replay(F, j.events, j.now());
    expect(
      canApply(
        F,
        s,
        'showdown',
        payload(
          [
            ['A', 'Ts', 'Th'],
            ['C', '9s', '9h'],
            ['D', '8s', '8h'],
          ],
          [],
          SD2,
        ),
        j.now(),
      ),
    ).toBe('Олл-ин: игрок уже выбыл — в раздачу берутся только те, кто в игре');
  });

  it('игрок не из турнира и кривая раздача — ошибка журнала, вечер не ломается', () => {
    const j = table();
    const bad = j.showdown(SD1, [
      ['A', 'As', 'Kd'],
      ['Z', 'Qh', 'Qc'],
    ]);
    const dup = j.add(
      'showdown',
      payload([
        ['A', 'As', 'Kd'],
        ['B', 'As', 'Qc'],
      ]),
    );
    const close = j.closeShowdown(SD1);
    const s = replay(F, j.events, j.now());
    expect(s.showdown).toBeNull();
    expect(s.errors).toEqual([
      { eventId: bad, message: 'Олл-ин: игрок не входил в турнир' },
      { eventId: dup, message: 'Олл-ин: карта As указана дважды' },
      { eventId: close, message: 'Эта раздача олл-ина уже закрыта' },
    ]);
    expect(s.aliveCount).toBe(4);
  });

  it('finish закрывает раздачу, после finish олл-ин не принимается', () => {
    const j = journal().join('A', 'B');
    j.start();
    j.showdown(
      SD1,
      [
        ['A', 'As', 'Kd'],
        ['B', 'Qh', 'Qc'],
      ],
      ['2c', '7d', '9h', 'Jd', 'Ah'],
    );
    j.bust('B', ['A']);
    const fin = j.finish();
    let s = replay(F, j.events, j.now());
    expect(s.finished).toBe(true);
    expect(s.showdown).toBeNull();
    const late = j.showdown(SD2, [
      ['A', '2s', '2h'],
      ['B', '3s', '3h'],
    ]);
    s = replay(F, j.events, j.now());
    expect(s.errors).toEqual([{ eventId: late, message: 'Вечер уже завершён' }]);
    // Отмена финиша возвращает и вечер, и раздачу (B вылетел, но был в ней).
    j.voidEvent(late);
    j.voidEvent(fin);
    s = replay(F, j.events, j.now());
    expect(s.finished).toBe(false);
    expect(s.showdown?.showdownId).toBe(SD1);
  });

  it('canApply и replay судят одинаково', () => {
    const j = table();
    const s = replay(F, j.events, j.now());
    const good = payload([
      ['A', 'As', 'Kd'],
      ['B', 'Qh', 'Qc'],
    ]);
    expect(canApply(F, s, 'showdown', good, j.now())).toBeNull();
    expect(canApply(F, s, 'showdown', { ...good, board: ['2c'] }, j.now())).toBe(
      'Олл-ин: на столе 0, 3, 4 или 5 карт',
    );
    expect(canApply(F, s, 'showdown_close', { showdownId: SD1 }, j.now())).toBe(
      'Эта раздача олл-ина уже закрыта',
    );
  });
});

describe('олл-ин не влияет на игру, деньги и итоги', () => {
  /** Вечер с ребаем, дележом нокаута и олл-инами между вылетами — и тот же журнал без них. */
  function evening(): { withShowdowns: EveningEvent[]; without: EveningEvent[]; ids: number[] } {
    const j = journal().join('A', 'B', 'C');
    j.joinStacks('D', 2);
    j.start();
    const ids: number[] = [];
    const hands: [string, string, string][] = [
      ['B', 'As', 'Kd'],
      ['C', 'Qh', 'Qc'],
    ];
    j.wait(15);
    ids.push(j.showdown(SD1, hands));
    j.wait(1);
    ids.push(j.showdown(SD1, hands, ['2c', '7d', '9h']));
    ids.push(j.showdown(SD1, hands, ['2c', '7d', '9h', 'Jd', 'Ah']));
    j.bust('C', ['B']);
    ids.push(j.closeShowdown(SD1));
    j.payment('A', 500);
    j.wait(30);
    j.rebuy('C');
    j.wait(50);
    ids.push(
      j.showdown(SD2, [
        ['A', 'Ts', 'Th'],
        ['C', '9s', '9h'],
        ['D', '8s', '8h'],
      ]),
    );
    j.bust('C', ['A', 'D']);
    j.wait(60);
    j.bust('D', ['B']);
    ids.push(
      j.showdown(
        SD2,
        [
          ['A', 'Ts', 'Th'],
          ['B', '9s', '9h'],
        ],
        ['2d', '3d', '4d'],
      ),
    );
    j.bust('A', ['B']);
    j.finish();
    const without = j.events.map((e) => (ids.includes(e.id) ? { ...e, voided: true } : e));
    return { withShowdowns: j.events, without, ids };
  }

  it('состояние replay то же, кроме самой раздачи', () => {
    const { withShowdowns, without } = evening();
    const lastMs = Date.parse(withShowdowns.at(-1)?.at ?? '') + 5 * MIN;
    const a = replayLog(F, withShowdowns, lastMs);
    const b = replayLog(F, without, lastMs);
    // После finish раздачи нет, ошибок тоже: последний олл-ин — правка с другим составом,
    // но A и B живы.
    expect(a.state.errors).toEqual([]);
    expect(a.state).toEqual(b.state);
    expect(a.applied.filter((e) => !isShowdownEvent(e.type))).toEqual(b.applied);
  });

  it('деньги и итог вечера не меняются', () => {
    const { withShowdowns, without } = evening();
    const lastMs = Date.parse(withShowdowns.at(-1)?.at ?? '');
    expect(computeMoney(F, replay(F, withShowdowns, lastMs))).toEqual(
      computeMoney(F, replay(F, without, lastMs)),
    );
    expect(summarize('e1', '2026-10-08', F, withShowdowns, DEFAULT_SCORING)).toEqual(
      summarize('e1', '2026-10-08', F, without, DEFAULT_SCORING),
    );
  });

  it('на середине вечера — те же места, нокауты, таймер и фонд', () => {
    const { withShowdowns, without } = evening();
    for (const cut of [3, 8, 12, 15]) {
      const at = Date.parse(withShowdowns[cut]?.at ?? '') + MIN;
      const a = replay(F, withShowdowns.slice(0, cut + 1), at);
      const b = replay(F, without.slice(0, cut + 1), at);
      expect({ ...a, showdown: null }).toEqual(b);
    }
  });
});

describe('visibleShowdown — когда раздачу больше не показывать', () => {
  const at = '2026-10-08T17:00:00.000Z';
  const base: ShowdownState = {
    showdownId: SD1,
    hands: [
      { playerId: 'A', cards: ['As', 'Kd'] },
      { playerId: 'B', cards: ['Qh', 'Qc'] },
    ],
    board: [],
    openedEventId: 1,
    eventId: 1,
    openedAt: at,
    updatedAt: at,
  };
  const t0 = Date.parse(at);

  it('нет раздачи — нечего показывать', () => {
    expect(visibleShowdown(null, t0)).toBeNull();
  });

  it('после ривера — ещё две минуты с последней правки', () => {
    const river = { ...base, board: ['2c', '7d', '9h', 'Jd', 'Ah'] };
    expect(visibleShowdown(river, t0 + SHOWDOWN_RIVER_HOLD_MS - 1)).toBe(river);
    expect(visibleShowdown(river, t0 + SHOWDOWN_RIVER_HOLD_MS)).toBeNull();
    expect(SHOWDOWN_RIVER_HOLD_MS).toBe(2 * MIN);
  });

  it('до ривера — пока правят; без правок десять минут — прячется', () => {
    const turn = { ...base, board: ['2c', '7d', '9h', 'Jd'] };
    expect(visibleShowdown(turn, t0 + SHOWDOWN_RIVER_HOLD_MS + MIN)).toBe(turn);
    expect(visibleShowdown(turn, t0 + SHOWDOWN_IDLE_HIDE_MS - 1)).toBe(turn);
    expect(visibleShowdown(turn, t0 + SHOWDOWN_IDLE_HIDE_MS)).toBeNull();
    expect(visibleShowdown(base, t0 + SHOWDOWN_IDLE_HIDE_MS)).toBeNull();
  });
});
