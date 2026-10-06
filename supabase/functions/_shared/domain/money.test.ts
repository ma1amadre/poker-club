import { describe, expect, it } from 'vitest';
import { DEFAULT_FORMAT } from './format.ts';
import {
  computeMoney,
  isSettled,
  payouts,
  paymentsFromEvents,
  settlement,
  type MoneyTable,
} from './money.ts';
import { replay } from './replay.ts';
import { journal, prng } from './test-utils.ts';
import type { PlayerId, TournamentFormat } from './types.ts';

const F = DEFAULT_FORMAT;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('payouts', () => {
  it('70/30 ровно', () => {
    expect(payouts(2800, [70, 30], 5)).toEqual([1960, 840]);
  });
  it('округление вниз до рубля, остаток — 1-му месту', () => {
    expect(payouts(1001, [70, 30], 6)).toEqual([701, 300]);
    expect(payouts(1009, [70, 30], 6)).toEqual([707, 302]); // 706.3 → 706 (+1), 302.7 → 302
    expect(payouts(100, [33.3, 33.3, 33.4], 3)).toEqual([34, 33, 33]); // 33+33+33=99, остаток 1 первому
    expect(payouts(1000, [33.3, 33.3, 33.4], 3)).toEqual([333, 333, 334]);
    expect(payouts(10, [33.3, 33.3, 33.4], 3)).toEqual([4, 3, 3]); // 3.33/3.33/3.34 → остаток 1 первому
  });
  it('перенормировка, если игроков меньше призовых мест', () => {
    expect(payouts(800, [70, 30], 1)).toEqual([800]);
    expect(payouts(1000, [50, 30, 20], 2)).toEqual([625, 375]);
    expect(payouts(0, [70, 30], 2)).toEqual([0, 0]);
    expect(payouts(500, [70, 30], 0)).toEqual([]);
  });
});

describe('деньги: ручной расчёт вечера на 5 игроков с ребаями и сплит-нокаутами', () => {
  // Сценарий для сверки с ручным расчётом (см. план проверки в концепции).
  const j = journal().join('A', 'B', 'C', 'D', 'E');
  j.start();
  j.wait(10).bust('B', ['A']);
  j.rebuy('B');
  j.wait(10).bust('C', ['A', 'D']); // сплит: голова 50/50, KO обоим
  j.rebuy('C');
  j.wait(10).bust('C', ['E']); // окончательный
  j.wait(10).bust('B', []); // сиротская голова — победителю
  j.wait(10).bust('E', ['A', 'D']);
  j.wait(10).bust('D', ['A']);
  j.finish();
  const s = replay(F, j.events, j.now());
  const m = computeMoney(F, s);

  it('состояние', () => {
    expect(s.errors).toEqual([]);
    expect(s.totalEntries).toBe(7);
    expect(s.prizePoolRub).toBe(2800);
    expect(s.places).toEqual(['A', 'D', 'E', 'B', 'C']);
    expect(s.players.A?.kos).toBe(4);
    expect(s.players.D?.kos).toBe(2);
    expect(s.players.E?.kos).toBe(1);
  });

  it('таблица', () => {
    expect(m).toEqual({
      // приз 1960; головы: B 100 + C 50 + E 50 + D 100 = 300, своя 100, сиротская B 100 → 500
      A: { owesRub: 500, prizeRub: 1960, bountyRub: 500, netRub: 1960 },
      B: { owesRub: 1000, prizeRub: 0, bountyRub: 0, netRub: -1000 },
      C: { owesRub: 1000, prizeRub: 0, bountyRub: 0, netRub: -1000 },
      D: { owesRub: 500, prizeRub: 840, bountyRub: 100, netRub: 440 },
      E: { owesRub: 500, prizeRub: 0, bountyRub: 100, netRub: -400 },
    });
  });

  it('до finish призов и «своей головы» нет', () => {
    const before = j.events.filter((e) => e.type !== 'finish');
    const mb = computeMoney(F, replay(F, before, j.now()));
    expect(mb.A).toEqual({ owesRub: 500, prizeRub: 0, bountyRub: 300, netRub: -200 });
    expect(mb.D?.prizeRub).toBe(0);
  });

  it('settlement: owes / awaits / settled, частичные платежи', () => {
    j.payment('B', 1000);
    j.payment('C', 400); // частично
    j.payment('E', 400);
    j.payment('A', -1000); // банкир выплатил часть выигрыша
    const voided = j.payment('D', -440);
    j.voidEvent(voided);
    const pays = paymentsFromEvents(j.events);
    expect(pays).toEqual([
      { playerId: 'B', amountRub: 1000 },
      { playerId: 'C', amountRub: 400 },
      { playerId: 'E', amountRub: 400 },
      { playerId: 'A', amountRub: -1000 },
    ]);
    const t = settlement(m, pays);
    expect(t).toEqual({
      A: { dueRub: -1960, paidRub: -1000, remainingRub: -960, status: 'awaits' },
      B: { dueRub: 1000, paidRub: 1000, remainingRub: 0, status: 'settled' },
      C: { dueRub: 1000, paidRub: 400, remainingRub: 600, status: 'owes' },
      D: { dueRub: -440, paidRub: 0, remainingRub: -440, status: 'awaits' },
      E: { dueRub: 400, paidRub: 400, remainingRub: 0, status: 'settled' },
    });
    expect(isSettled(t)).toBe(false);

    const rest = settlement(m, [
      ...pays,
      { playerId: 'C', amountRub: 600 },
      { playerId: 'A', amountRub: -960 },
      { playerId: 'D', amountRub: -440 },
    ]);
    expect(isSettled(rest)).toBe(true);
    // Переплата: игрок отдал больше, чем должен, — банкир должен вернуть.
    const over = settlement(m, [{ playerId: 'B', amountRub: 1500 }]);
    expect(over.B).toEqual({ dueRub: 1000, paidRub: 1500, remainingRub: -500, status: 'awaits' });
  });

  it('платёж постороннему не теряется', () => {
    const t = settlement(m, [{ playerId: 'Z', amountRub: 300 }]);
    expect(t.Z).toEqual({ dueRub: 0, paidRub: 300, remainingRub: -300, status: 'awaits' });
  });
});

describe('баунти', () => {
  it('победитель забирает свою голову и сиротские', () => {
    const j = journal().join('A', 'B', 'C');
    j.bust('B', []);
    j.bust('C', ['A']);
    j.finish();
    const m = computeMoney(F, replay(F, j.events, j.now()));
    expect(m.A?.bountyRub).toBe(300); // C + своя + сиротская B
    expect(m.B?.bountyRub).toBe(0);
  });

  it('сплит на 3: делится в целых рублях, остаток — первому в списке', () => {
    const j = journal().join('A', 'B', 'C', 'D');
    j.bust('D', ['C', 'A', 'B']);
    const s = replay(F, j.events, j.now());
    expect([
      s.players.C?.bountyWonRub,
      s.players.A?.bountyWonRub,
      s.players.B?.bountyWonRub,
    ]).toEqual([34, 33, 33]);
    expect([s.players.A?.kos, s.players.B?.kos, s.players.C?.kos]).toEqual([1, 1, 1]);
  });

  it('сплит на 2', () => {
    const fmt: TournamentFormat = { ...F, bountyRub: 75 };
    const j = journal().join('A', 'B', 'C');
    j.bust('C', ['B', 'A']);
    const s = replay(fmt, j.events, j.now());
    expect([s.players.B?.bountyWonRub, s.players.A?.bountyWonRub]).toEqual([38, 37]);
  });
});

// ---------- инвариант сохранения денег на сгенерированных вечерах ----------

const PAYOUTS: number[][] = [[70, 30], [100], [50, 30, 20], [33.3, 33.3, 33.4], [60, 25, 10, 5]];
const BUYINS: [number, number][] = [
  [500, 100],
  [500, 0],
  [300, 33],
  [1000, 1],
  [7, 7],
  [500, 500],
  [101, 50],
];

interface Coverage {
  split2: number;
  split3: number;
  orphan: number;
  rebuys: number;
  finishOpen: number;
  lateJoin: number;
  players: Set<number>;
}

function randomEvening(seed: number, cov: Coverage) {
  const r = prng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
  const n = 2 + Math.floor(r() * 5); // 2..6
  const [buyInRub, bountyRub] = pick(BUYINS);
  const fmt: TournamentFormat = {
    ...F,
    buyInRub,
    bountyRub,
    payoutPct: pick(PAYOUTS),
    rebuyLimit: r() < 0.2 ? 1 : null,
    // Короткие уровни — чтобы ребаи закрывались и до, и после окончания игры.
    levels: F.levels.map((l) => ({
      ...l,
      trigger: { type: 'time' as const, minutes: 5 + Math.floor(r() * 20) },
    })),
  };
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  const firstWave = 2 + Math.floor(r() * (n - 1));
  const j = journal();
  j.join(...ids.slice(0, firstWave));
  const late = ids.slice(firstWave);
  j.start();
  let finishedOpen = false;
  for (let guard = 0; guard < 500; guard++) {
    j.wait(r() * 15);
    const s = replay(fmt, j.events, j.now());
    const alive = s.joinOrder.filter((id) => s.players[id]?.alive);
    const dead = s.joinOrder.filter((id) => !s.players[id]?.alive);
    if (late.length > 0 && s.rebuysOpen && r() < 0.3) {
      j.join(late.shift() as PlayerId);
      cov.lateJoin += 1;
      continue;
    }
    if (alive.length <= 1) {
      const canRebuy = dead.filter(
        (id) => fmt.rebuyLimit === null || (s.players[id]?.rebuys ?? 0) < fmt.rebuyLimit,
      );
      if (s.rebuysOpen && canRebuy.length > 0 && r() < 0.5) {
        j.rebuy(pick(canRebuy));
        continue;
      }
      if (s.rebuysOpen) finishedOpen = true;
      j.finish();
      break;
    }
    const victim = pick(alive);
    const others = alive.filter((id) => id !== victim);
    const x = r();
    const k = Math.min(others.length, x < 0.15 ? 0 : x < 0.6 ? 1 : x < 0.85 ? 2 : 3);
    const by: PlayerId[] = [];
    while (by.length < k) {
      const c = pick(others);
      if (!by.includes(c)) by.push(c);
    }
    j.bust(victim, by);
    if (k === 0) cov.orphan += 1;
    if (k === 2) cov.split2 += 1;
    if (k === 3) cov.split3 += 1;
    if (
      s.rebuysOpen &&
      r() < 0.4 &&
      (fmt.rebuyLimit === null || (s.players[victim]?.rebuys ?? 0) < fmt.rebuyLimit)
    ) {
      // Ребай может оказаться ошибочным, если уровень закрылся между событиями — тогда это
      // ошибка в state.errors; проверяем ниже, что таких нет, поэтому ребай — сразу, без wait.
      j.rebuy(victim);
    }
  }
  const s = replay(fmt, j.events, j.now());
  if (finishedOpen) cov.finishOpen += 1;
  cov.rebuys += sum(s.joinOrder.map((id) => s.players[id]?.rebuys ?? 0));
  cov.players.add(s.joinOrder.length);
  return { fmt, s, j };
}

function checkInvariant(fmt: TournamentFormat, m: MoneyTable, ids: PlayerId[]) {
  const rows = ids.map((id) => m[id]);
  expect(rows.every((x) => x !== undefined)).toBe(true);
  const owes = sum(rows.map((x) => x?.owesRub ?? 0));
  const paid = sum(rows.map((x) => (x?.prizeRub ?? 0) + (x?.bountyRub ?? 0)));
  expect(paid).toBe(owes);
  expect(sum(rows.map((x) => x?.netRub ?? 0))).toBe(0);
  for (const x of rows) {
    if (!x) continue;
    for (const v of [x.owesRub, x.prizeRub, x.bountyRub, x.netRub])
      expect(Number.isInteger(v)).toBe(true);
    expect(x.prizeRub).toBeGreaterThanOrEqual(0);
    expect(x.bountyRub).toBeGreaterThanOrEqual(0);
    expect(x.owesRub % fmt.buyInRub).toBe(0);
  }
}

describe('инвариант: сумма prize + bounty = сумма owes', () => {
  it('на 3000 сгенерированных вечерах (2–6 игроков, ребаи, сплиты на 2 и 3, сиротские головы)', () => {
    const cov: Coverage = {
      split2: 0,
      split3: 0,
      orphan: 0,
      rebuys: 0,
      finishOpen: 0,
      lateJoin: 0,
      players: new Set(),
    };
    for (let seed = 1; seed <= 3000; seed++) {
      const { fmt, s, j } = randomEvening(seed, cov);
      expect(s.errors, `seed ${seed}`).toEqual([]);
      expect(s.finished, `seed ${seed}`).toBe(true);
      expect(s.places.length).toBe(s.joinOrder.length);
      expect(new Set(s.places).size).toBe(s.places.length);
      const m = computeMoney(fmt, s);
      checkInvariant(fmt, m, s.joinOrder);
      expect(sum(Object.values(m).map((x) => x.prizeRub))).toBe(s.prizePoolRub);
      // Независимая проверка голов: победителю — свои нокауты + своя голова + каждая сиротская.
      // (Сам инвариант выше держится по построению computeMoney, а эта проверка ловит потерю
      // рубля при дележе: тогда «лишнее» молча уехало бы победителю.)
      const winner = s.places[0] as PlayerId;
      const orphans = j.events.filter(
        (e) => e.type === 'bust' && (e.payload as { by: PlayerId[] }).by.length === 0,
      ).length;
      expect(m[winner]?.bountyRub).toBe(
        (s.players[winner]?.bountyWonRub ?? 0) + fmt.bountyRub * (1 + orphans),
      );
      for (const id of s.joinOrder) {
        const kos = s.players[id]?.kos ?? 0;
        // Каждый нокаут приносит от floor(голова/3) до полной головы.
        expect(s.players[id]?.bountyWonRub ?? 0).toBeLessThanOrEqual(kos * fmt.bountyRub);
        expect(s.players[id]?.bountyWonRub ?? 0).toBeGreaterThanOrEqual(
          kos * Math.floor(fmt.bountyRub / 3),
        );
      }
      // Без платежей долги игроков банкиру ровно покрывают его долги игрокам.
      const t0 = settlement(m, []);
      expect(sum(Object.values(t0).map((x) => x.dueRub))).toBe(0);
      // Каждый закрыл свой остаток — расчёт сходится.
      for (const id of s.joinOrder) {
        const due = t0[id]?.dueRub ?? 0;
        if (due !== 0) j.payment(id, due);
      }
      expect(isSettled(settlement(m, paymentsFromEvents(j.events)))).toBe(true);
    }
    // Генератор действительно покрыл нужные случаи.
    expect(cov.split2).toBeGreaterThan(100);
    expect(cov.split3).toBeGreaterThan(50);
    expect(cov.orphan).toBeGreaterThan(100);
    expect(cov.rebuys).toBeGreaterThan(100);
    expect(cov.finishOpen).toBeGreaterThan(10);
    expect(cov.lateJoin).toBeGreaterThan(10);
    expect([...cov.players].sort()).toEqual([2, 3, 4, 5, 6]);
  });

  it('до finish: розданные головы + нераспределённые = все головы', () => {
    const cov: Coverage = {
      split2: 0,
      split3: 0,
      orphan: 0,
      rebuys: 0,
      finishOpen: 0,
      lateJoin: 0,
      players: new Set(),
    };
    for (let seed = 5001; seed <= 5300; seed++) {
      const { fmt, j } = randomEvening(seed, cov);
      const open = j.events.filter((e) => e.type !== 'finish' && e.type !== 'payment');
      const s = replay(fmt, open, j.now());
      const m = computeMoney(fmt, s);
      const bounty = sum(Object.values(m).map((x) => x.bountyRub));
      expect(bounty).toBeLessThanOrEqual(s.totalEntries * fmt.bountyRub);
      expect(sum(Object.values(m).map((x) => x.prizeRub))).toBe(0);
    }
  });
});
