import { computeAchievements, titles } from '@domain/achievements.ts';
import { playEvening, simpleEvening } from '@domain/test-utils.ts';
import { describe, expect, it } from 'vitest';
import {
  achievementsForPlayer,
  cumulativeNet,
  headToHead,
  nemesisOf,
  niceTicks,
  paidPlaces,
  playerEvenings,
  playerNumbers,
  recentForm,
  standingPosition,
} from './stats';

const day = (m: number, d: number) =>
  `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T16:00:00.000Z`;

// Порядок массива специально не хронологический: хелперы сортируют сами.
const summaries = [
  simpleEvening('e3', day(10, 15), ['A', 'C', 'B'], 'winner'),
  simpleEvening('e1', day(10, 1), ['A', 'B', 'C'], 'winner'),
  simpleEvening('e2', day(10, 8), ['B', 'C', 'A'], 'winner'),
  simpleEvening('x', day(10, 9), ['B', 'C']), // A не играл
];

describe('вечера игрока', () => {
  it('только сыгранные, от старых к новым, с местом и числом участников', () => {
    const list = playerEvenings(summaries, 'A');
    expect(list.map((e) => [e.eveningId, e.place, e.entrants])).toEqual([
      ['e1', 1, 3],
      ['e2', 3, 3],
      ['e3', 1, 3],
    ]);
  });

  it('очки, нетто, нокауты и ребаи — из итога домена', () => {
    const [first] = playerEvenings(summaries, 'A');
    const s = summaries[1];
    if (!first || !s) throw new Error('нет данных');
    expect(first.points).toBe(s.points.A);
    expect(first.netRub).toBe(s.netRub.A);
    expect(first.kos).toBe(2);
    expect(first.rebuys).toBe(0);
  });

  it('при одинаковой дате порядок по id вечера', () => {
    const same = [
      simpleEvening('b', day(10, 1), ['A', 'B']),
      simpleEvening('a', day(10, 1), ['B', 'A']),
    ];
    expect(playerEvenings(same, 'A').map((e) => e.eveningId)).toEqual(['a', 'b']);
  });
});

describe('накопленный нетто', () => {
  it('нарастающая сумма нетто по вечерам', () => {
    const evenings = playerEvenings(summaries, 'A');
    const points = cumulativeNet(evenings);
    let sum = 0;
    for (const [i, p] of points.entries()) {
      sum += evenings[i]?.netRub ?? NaN;
      expect(p.cumulativeRub).toBe(sum);
    }
    // Победитель с выбиванием всех в плюсе, последнее место — минус бай-ин.
    expect(points.map((p) => p.netRub)).toEqual([evenings[0]?.netRub, -500, evenings[2]?.netRub]);
    expect(points.at(-1)?.cumulativeRub).toBe(sum);
  });

  it('нет вечеров — нет точек', () => {
    expect(cumulativeNet([])).toEqual([]);
  });
});

describe('форма', () => {
  it('последние n вечеров, свежий справа', () => {
    const list = playerEvenings(summaries, 'A');
    expect(recentForm(list, 2).map((e) => e.eveningId)).toEqual(['e2', 'e3']);
    expect(recentForm(list).map((e) => e.eveningId)).toEqual(['e1', 'e2', 'e3']);
  });
});

describe('личные встречи', () => {
  it('кто кого выбивал и сколько вечеров вместе', () => {
    // e1, e3 — A выбивает обоих; e2 — B выбивает A и C.
    const rows = headToHead(summaries, 'A');
    expect(rows).toEqual([
      { opponentId: 'B', knockedOut: 2, knockedOutBy: 1, together: 3 },
      { opponentId: 'C', knockedOut: 2, knockedOutBy: 0, together: 3 },
    ]);
  });

  it('сплит-нокаут засчитывается каждому выбившему', () => {
    const s = playEvening(
      's',
      day(10, 22),
      ['A', 'B', 'C'],
      [
        ['bust', 'C', ['A', 'B']],
        ['bust', 'B', ['A']],
      ],
    );
    expect(headToHead([s], 'B')).toEqual([
      { opponentId: 'A', knockedOut: 0, knockedOutBy: 1, together: 1 },
      { opponentId: 'C', knockedOut: 1, knockedOutBy: 0, together: 1 },
    ]);
  });

  it('нокаут с последующим ребаем тоже считается', () => {
    const s = playEvening(
      'r',
      day(10, 22),
      ['A', 'B'],
      [
        ['bust', 'B', ['A']],
        ['rebuy', 'B'],
        ['bust', 'B', ['A']],
      ],
    );
    expect(headToHead([s], 'A')[0]?.knockedOut).toBe(2);
  });

  it('игрок без вечеров — пустая таблица', () => {
    expect(headToHead(summaries, 'Z')).toEqual([]);
  });
});

describe('немезида', () => {
  it('жертвы, для которых игрок — немезида', () => {
    expect(nemesisOf({ B: 'A', C: 'A', A: null, D: 'B' }, 'A')).toEqual(['B', 'C']);
    expect(nemesisOf({ B: 'A' }, 'Z')).toEqual([]);
  });

  it('согласуется с titles домена', () => {
    const t = titles({ summaries, excluded: new Set() });
    // A выбивал C дважды (e1, e3), B — один раз: немезида C — A.
    expect(t.nemesis.C).toBe('A');
    expect(nemesisOf(t.nemesis, 'A')).toContain('C');
  });
});

describe('ачивки игрока', () => {
  it('все коды по порядку META, полученные — со счётчиком и датой последней', () => {
    const list = [
      simpleEvening('h1', day(10, 1), ['A', 'B', 'C', 'D'], 'winner'),
      simpleEvening('h2', day(10, 8), ['A', 'B', 'C', 'D'], 'winner'),
    ];
    const all = computeAchievements({
      summaries: list,
      excluded: new Set(),
      predictions: [],
      stars: [],
      bestN: 10,
      currentSeasonKey: '2026-Q4',
    });
    const dates = new Map(list.map((s) => [s.eveningId, s.date]));
    const views = achievementsForPlayer(all, 'A', (id) => dates.get(id));
    expect(views).toHaveLength(10);
    const hunter = views.find((v) => v.code === 'hunter');
    expect(hunter).toMatchObject({ count: 2, lastDate: day(10, 8), title: 'Охотник' });
    const firstBlood = views.find((v) => v.code === 'first_blood');
    expect(firstBlood).toMatchObject({ count: 1, lastDate: day(10, 1) });
    expect(views.find((v) => v.code === 'champion')?.count).toBe(0);
  });

  it('сезонная ачивка — с последним сезоном', () => {
    const views = achievementsForPlayer(
      [
        { playerId: 'A', code: 'champion', eveningId: null, seasonKey: '2026-Q2', count: 1 },
        { playerId: 'A', code: 'champion', eveningId: null, seasonKey: '2026-Q3', count: 1 },
        { playerId: 'B', code: 'champion', eveningId: null, seasonKey: '2026-Q1', count: 1 },
      ],
      'A',
      () => undefined,
    );
    expect(views.find((v) => v.code === 'champion')).toMatchObject({
      count: 2,
      lastSeasonKey: '2026-Q3',
      lastDate: null,
    });
  });
});

describe('деления оси', () => {
  it('круглые деления, включают ноль и края', () => {
    expect(niceTicks(-300, 1250, 5)).toEqual([-500, 0, 500, 1000, 1500]);
    expect(niceTicks(0, 1000, 5)).toEqual([0, 250, 500, 750, 1000]);
    expect(niceTicks(-1200, -100, 4)).toEqual([-1500, -1000, -500, 0]);
  });

  it('одно значение — ось от нуля до него', () => {
    expect(niceTicks(800, 800, 5)).toEqual([0, 200, 400, 600, 800]);
    expect(niceTicks(0, 0, 5)).toEqual([0]);
  });

  it('не больше maxTicks делений и без -0', () => {
    for (const [lo, hi] of [
      [-37, 4120],
      [-5000, 120],
      [3, 7],
      [-1, 1],
    ] as const) {
      const ticks = niceTicks(lo, hi, 5);
      expect(ticks.length).toBeLessThanOrEqual(5);
      expect(ticks[0]).toBeLessThanOrEqual(lo);
      expect(ticks.at(-1)).toBeGreaterThanOrEqual(hi);
      expect(ticks.some((t) => Object.is(t, -0))).toBe(false);
    }
  });

  it('нечисла не ломают ось', () => {
    expect(niceTicks(Number.NaN, 5)).toEqual([0]);
  });
});

describe('место игрока в таблице', () => {
  it('место с дележом и размер таблицы', () => {
    const rows = [{ playerId: 'a' }, { playerId: 'b' }, { playerId: 'c' }];
    expect(standingPosition(rows, [1, 1, 3], 'b')).toEqual({
      row: { playerId: 'b' },
      place: 1,
      of: 3,
    });
    expect(standingPosition(rows, [1, 1, 3], 'z')).toBeNull();
  });
});

describe('цифры игрока', () => {
  // A: e1 — 1-е, e2 — 3-е, e3 — 1-е, e4 — 1-е (серия 2: e3, e4); x — без A.
  const list = [...summaries, simpleEvening('e4', day(10, 22), ['A', 'B', 'C'], 'winner')];
  const evenings = playerEvenings(list, 'A');

  it('личные рекорды: лучший нетто, нокауты и серия — с вечером, где поставлены впервые', () => {
    const n = playerNumbers(evenings, () => 2);
    const netOf = (id: string) => list.find((s) => s.eveningId === id)?.netRub.A ?? 0;
    // Все победы с одинаковым составом дают одинаковый нетто — берётся самый ранний вечер.
    expect(n.bestNet).toEqual({ value: netOf('e1'), eveningId: 'e1', date: day(10, 1) });
    expect(n.mostKos).toEqual({ value: 2, eveningId: 'e1', date: day(10, 1) });
    expect(n.bestStreak).toEqual({ value: 2, eveningId: 'e4', date: day(10, 22) });
  });

  it('порядок входа не важен: серия считается по хронологии', () => {
    const n = playerNumbers([...evenings].reverse(), () => 2);
    expect(n.bestStreak?.value).toBe(2);
    expect(n.bestStreak?.eveningId).toBe('e4');
  });

  it('в призах — место не ниже числа призовых; неизвестный вечер в долю не входит', () => {
    const n = playerNumbers(evenings, (id) => (id === 'e2' ? undefined : 2));
    expect(n.inTheMoney).toEqual({ count: 3, of: 3 });
    const all = playerNumbers(evenings, () => 2);
    expect(all.inTheMoney).toEqual({ count: 3, of: 4 });
    const three = playerNumbers(evenings, () => 3);
    expect(three.inTheMoney).toEqual({ count: 4, of: 4 });
  });

  it('среднее место — по вечерам с местом', () => {
    const n = playerNumbers(evenings, () => 2);
    expect(n.averagePlace).toBe((1 + 3 + 1 + 1) / 4);
    expect(n.placed).toBe(4);
  });

  it('без побед и нокаутов — пустые рекорды, без вечеров — всё пусто', () => {
    const c = playerEvenings(list, 'C');
    const n = playerNumbers(c, () => 2);
    expect(n.mostKos).toBeNull();
    expect(n.bestStreak).toBeNull();
    expect(n.bestNet).not.toBeNull();
    const none = playerNumbers([], () => 2);
    expect(none).toEqual({
      bestNet: null,
      mostKos: null,
      bestStreak: null,
      inTheMoney: { count: 0, of: 0 },
      averagePlace: null,
      placed: 0,
    });
  });

  it('лучший нетто бывает и отрицательным — если в плюс ещё не выходил', () => {
    const c = playerEvenings(list, 'C');
    const n = playerNumbers(c, () => 2);
    expect(n.bestNet?.value).toBe(Math.max(...c.map((e) => e.netRub)));
  });
});

describe('призовые места вечера', () => {
  it('доли формата на первые min(участники, доли) мест', () => {
    expect(paidPlaces([70, 30], 5, 2000)).toBe(2);
    expect(paidPlaces([50, 30, 20], 2, 1000)).toBe(2);
    expect(paidPlaces([100], 6, 3000)).toBe(1);
  });

  it('нулевая доля приза не даёт', () => {
    expect(paidPlaces([100, 0], 4, 2000)).toBe(1);
  });
});
