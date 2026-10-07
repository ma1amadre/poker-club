import { describe, expect, it } from 'vitest';
import { DEFAULT_FORMAT } from './format.ts';
import {
  computeMoney,
  entryAmounts,
  isSettled,
  payouts,
  paymentsFromEvents,
  settlement,
  type MoneyTable,
} from './money.ts';
import { replay } from './replay.ts';
import { journal, prng } from './test-utils.ts';
import type { EveningEvent, EveningState, PlayerId, TournamentFormat } from './types.ts';

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

describe('вход и ребай кратно стандартному', () => {
  it('entryAmounts: вход на 1 000 ₽ — голова 200, в фонд 800, 1 000 фишек', () => {
    expect(entryAmounts(F, 2)).toEqual({
      stacks: 2,
      rub: 1000,
      chips: 1000,
      bountyRub: 200,
      poolRub: 800,
    });
    expect(entryAmounts(F)).toEqual({
      stacks: 1,
      rub: 500,
      chips: 500,
      bountyRub: 100,
      poolRub: 400,
    });
  });

  it('вход ×2: взнос 1 000, фонд +800, голова 200 уходит выбившему', () => {
    const j = journal().join('A', 'B');
    j.joinStacks('C', 2);
    j.start();
    let s = replay(F, j.events, j.now());
    expect(s.totalEntries).toBe(3);
    expect(s.totalStacks).toBe(4);
    expect(s.totalChips).toBe(2000);
    expect(s.prizePoolRub).toBe(1600);
    expect(s.bountyPoolRub).toBe(400);
    expect(s.players.C).toMatchObject({ entries: 1, stacks: 2, currentStacks: 2 });

    j.wait(5).bust('C', ['A']);
    s = replay(F, j.events, j.now());
    expect(s.players.A?.bountyWonRub).toBe(200);
    j.wait(5).bust('B', ['A']);
    j.finish();
    s = replay(F, j.events, j.now());
    expect(computeMoney(F, s)).toEqual({
      // фонд 1600: 1120 / 480; головы A: C 200 + B 100 + своя 100
      A: { owesRub: 500, prizeRub: 1120, bountyRub: 400, netRub: 1020 },
      B: { owesRub: 500, prizeRub: 480, bountyRub: 0, netRub: -20 },
      C: { owesRub: 1000, prizeRub: 0, bountyRub: 0, netRub: -1000 },
    });
  });

  it('ребаи разной кратности: у каждого входа своя голова, победитель забирает голову текущего', () => {
    const j = journal();
    j.joinStacks('A', 2);
    j.join('B', 'C');
    j.start();
    j.wait(5).bust('A', ['B']); // голова входа ×2 — 200
    j.rebuy('A'); // ×1 без поля
    j.wait(5).bust('A', ['C']); // голова уже 100
    j.rebuy('A', 3);
    j.wait(5).bust('B', ['A']); // 100
    j.wait(5).bust('C', ['A']); // 100
    j.finish();
    const s = replay(F, j.events, j.now());
    expect(s.errors).toEqual([]);
    expect(s.players.A).toMatchObject({ entries: 3, rebuys: 2, stacks: 6, currentStacks: 3 });
    expect(s.totalStacks).toBe(8);
    expect(s.prizePoolRub).toBe(3200);
    const m = computeMoney(F, s);
    // A: взносы 6×500; головы B и C по 100 + своя голова входа ×3 — 300.
    expect(m.A).toEqual({ owesRub: 3000, prizeRub: 2240, bountyRub: 500, netRub: -260 });
    expect(m.B).toEqual({ owesRub: 500, prizeRub: 0, bountyRub: 200, netRub: -300 });
    expect(m.C).toEqual({ owesRub: 500, prizeRub: 960, bountyRub: 100, netRub: 560 });
    const all = Object.values(m);
    expect(sum(all.map((x) => x.prizeRub + x.bountyRub))).toBe(sum(all.map((x) => x.owesRub)));
  });

  it('сплит головы ×2 на троих: 200 → 68 / 66 / 66 (остаток — первому в списке)', () => {
    const j = journal().join('A', 'B', 'C');
    j.joinStacks('D', 2);
    j.bust('D', ['C', 'A', 'B']);
    const s = replay(F, j.events, j.now());
    expect([
      s.players.C?.bountyWonRub,
      s.players.A?.bountyWonRub,
      s.players.B?.bountyWonRub,
    ]).toEqual([68, 66, 66]);
  });

  it('сплит неделимой головы ×3 при 75 ₽: 225 на двоих → 113 / 112', () => {
    const fmt: TournamentFormat = { ...F, bountyRub: 75 };
    const j = journal().join('A', 'B');
    j.joinStacks('C', 3);
    j.bust('C', ['B', 'A']);
    const s = replay(fmt, j.events, j.now());
    expect([s.players.B?.bountyWonRub, s.players.A?.bountyWonRub]).toEqual([113, 112]);
  });

  it('сиротская голова входа ×3 уходит победителю целиком', () => {
    const j = journal().join('A', 'B');
    j.joinStacks('C', 3);
    j.bust('C', []); // 300 — сиротская
    j.bust('B', ['A']);
    j.finish();
    const m = computeMoney(F, replay(F, j.events, j.now()));
    expect(m.A?.bountyRub).toBe(100 + 100 + 300); // B + своя + сиротская ×3
    expect(m.C).toEqual({ owesRub: 1500, prizeRub: 0, bountyRub: 0, netRub: -1500 });
  });

  it('старые события без stacks и явный stacks: 1 дают одно и то же', () => {
    const old = journal().join('A', 'B');
    old.bust('B', ['A']);
    old.rebuy('B');
    old.bust('A', ['B']);
    old.finish();
    const explicit = journal();
    explicit.joinStacks('A', 1);
    explicit.joinStacks('B', 1);
    explicit.bust('B', ['A']);
    explicit.rebuy('B', 1);
    explicit.bust('A', ['B']);
    explicit.finish();
    const a = replay(F, old.events, old.now());
    const b = replay(F, explicit.events, explicit.now());
    expect(b).toEqual(a);
    expect(computeMoney(F, b)).toEqual(computeMoney(F, a));
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
  /** Входы и ребаи кратностью больше 1. */
  multi: number;
  /** Ребай другой кратности, чем вход (или прошлый ребай) того же игрока. */
  mixedRebuy: number;
  /** Сплит головы, которая не делится на число выбивших нацело. */
  unevenSplit: number;
  /** Сиротская голова входа кратностью больше 1. */
  multiOrphan: number;
}

const newCoverage = (): Coverage => ({
  split2: 0,
  split3: 0,
  orphan: 0,
  rebuys: 0,
  finishOpen: 0,
  lateJoin: 0,
  players: new Set(),
  multi: 0,
  mixedRebuy: 0,
  unevenSplit: 0,
  multiOrphan: 0,
});

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

  // Кратность входа: чаще стандартный, иногда ×2–×3 и изредка предельный ×10. Стандартный — то
  // без поля stacks (как события до кратных входов), то с явной единицей.
  const current = new Map<PlayerId, number>();
  const stacksArg = (): number | undefined => {
    const x = r();
    const k = x < 0.55 ? 1 : x < 0.8 ? 2 : x < 0.95 ? 3 : 10;
    if (k > 1) cov.multi += 1;
    return k === 1 && r() < 0.5 ? undefined : k;
  };
  const enter = (id: PlayerId): void => {
    const k = stacksArg();
    if (k === undefined) j.join(id);
    else j.joinStacks(id, k);
    current.set(id, k ?? 1);
  };
  const rebuy = (id: PlayerId): void => {
    const k = stacksArg();
    if ((k ?? 1) !== current.get(id)) cov.mixedRebuy += 1;
    j.rebuy(id, k);
    current.set(id, k ?? 1);
  };

  for (const id of ids.slice(0, firstWave)) enter(id);
  const late = ids.slice(firstWave);
  j.start();
  let finishedOpen = false;
  for (let guard = 0; guard < 500; guard++) {
    j.wait(r() * 15);
    const s = replay(fmt, j.events, j.now());
    const alive = s.joinOrder.filter((id) => s.players[id]?.alive);
    const dead = s.joinOrder.filter((id) => !s.players[id]?.alive);
    if (late.length > 0 && s.rebuysOpen && r() < 0.3) {
      enter(late.shift() as PlayerId);
      cov.lateJoin += 1;
      continue;
    }
    if (alive.length <= 1) {
      const canRebuy = dead.filter(
        (id) => fmt.rebuyLimit === null || (s.players[id]?.rebuys ?? 0) < fmt.rebuyLimit,
      );
      if (s.rebuysOpen && canRebuy.length > 0 && r() < 0.5) {
        rebuy(pick(canRebuy));
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
    const head = fmt.bountyRub * (current.get(victim) ?? 1);
    if (k === 0) cov.orphan += 1;
    if (k === 0 && (current.get(victim) ?? 1) > 1) cov.multiOrphan += 1;
    if (k === 2) cov.split2 += 1;
    if (k === 3) cov.split3 += 1;
    if (k > 1 && head % k !== 0) cov.unevenSplit += 1;
    if (
      s.rebuysOpen &&
      r() < 0.4 &&
      (fmt.rebuyLimit === null || (s.players[victim]?.rebuys ?? 0) < fmt.rebuyLimit)
    ) {
      // Ребай может оказаться ошибочным, если уровень закрылся между событиями — тогда это
      // ошибка в state.errors; проверяем ниже, что таких нет, поэтому ребай — сразу, без wait.
      rebuy(victim);
    }
  }
  const s = replay(fmt, j.events, j.now());
  if (finishedOpen) cov.finishOpen += 1;
  cov.rebuys += sum(s.joinOrder.map((id) => s.players[id]?.rebuys ?? 0));
  cov.players.add(s.joinOrder.length);
  return { fmt, s, j };
}

interface Expected {
  /** Взносы игрока: buyInRub × кратность каждого его входа и ребая. */
  owesRub: Map<PlayerId, number>;
  /** Головы за нокауты: голова ТЕКУЩЕГО входа жертвы, делёж вниз до рубля, остаток — первому. */
  wonRub: Map<PlayerId, number>;
  /** Кратность текущего входа (у победителя — та, чью голову он забирает себе). */
  current: Map<PlayerId, number>;
  /** Сиротские головы — каждая своей кратности. */
  orphanRub: number;
}

/**
 * Независимый пересчёт денег по журналу — без replay и computeMoney: кратность из payload, голова
 * жертвы — от её последнего входа. Годится для журналов, где все события приняты (errors = []).
 */
function expectedMoney(fmt: TournamentFormat, events: readonly EveningEvent[]): Expected {
  const e: Expected = { owesRub: new Map(), wonRub: new Map(), current: new Map(), orphanRub: 0 };
  const add = (map: Map<PlayerId, number>, id: PlayerId, v: number) =>
    map.set(id, (map.get(id) ?? 0) + v);
  for (const ev of [...events].sort((a, b) => a.id - b.id)) {
    if (ev.voided) continue;
    const p = ev.payload as { playerId: PlayerId; stacks?: number; by?: PlayerId[] };
    if (ev.type === 'join' || ev.type === 'rebuy') {
      const k = p.stacks ?? 1;
      add(e.owesRub, p.playerId, fmt.buyInRub * k);
      e.current.set(p.playerId, k);
    } else if (ev.type === 'bust') {
      const by = p.by ?? [];
      const head = fmt.bountyRub * (e.current.get(p.playerId) ?? 1);
      if (by.length === 0) {
        e.orphanRub += head;
        continue;
      }
      const share = Math.floor(head / by.length);
      by.forEach((id, i) => add(e.wonRub, id, share + (i === 0 ? head - share * by.length : 0)));
    }
  }
  return e;
}

/**
 * Полная проверка завершённого вечера одним сравнением (перебор ниже гоняет её десятки тысяч раз):
 * журнал принят целиком, места полны; инвариант prize + bounty = owes, сумма нетто — ноль; фонд и
 * головы — ровно взносы; суммы целые и неотрицательные, взнос кратен buyIn; независимый пересчёт
 * взносов и голов (expectedMoney); расчёт с банкиром сходится, когда каждый закрыл свой остаток.
 * Сам инвариант держится по построению computeMoney, а независимый пересчёт ловит потерю рубля при
 * дележе или голову не той кратности: «лишнее» иначе молча уехало бы победителю.
 */
function checkFinished(
  fmt: TournamentFormat,
  s: EveningState,
  events: readonly EveningEvent[],
  label: string,
): MoneyTable {
  const m = computeMoney(fmt, s);
  const ids = s.joinOrder;
  const rows = ids.map((id) => m[id]);
  const all = rows.filter((x): x is NonNullable<typeof x> => x !== undefined);
  const owes = sum(all.map((x) => x.owesRub));
  const exp = expectedMoney(fmt, events);
  const winner = s.places[0] as PlayerId;
  const t0 = settlement(m, []);
  const pays = ids
    .map((id) => ({ playerId: id, amountRub: t0[id]?.dueRub ?? 0 }))
    .filter((p) => p.amountRub !== 0);
  const byId = (f: (id: PlayerId) => number | undefined) =>
    Object.fromEntries(ids.map((id) => [id, f(id)]));

  const actual = {
    errors: s.errors,
    finished: s.finished,
    places: [s.places.length, new Set(s.places).size],
    rows: all.length,
    paid: sum(all.map((x) => x.prizeRub + x.bountyRub)),
    net: sum(all.map((x) => x.netRub)),
    prizes: sum(all.map((x) => x.prizeRub)),
    poolAndHeads: s.prizePoolRub + s.bountyPoolRub,
    malformed: all.filter(
      (x) =>
        ![x.owesRub, x.prizeRub, x.bountyRub, x.netRub].every(Number.isInteger) ||
        x.prizeRub < 0 ||
        x.bountyRub < 0 ||
        x.owesRub % fmt.buyInRub !== 0,
    ).length,
    owes: byId((id) => m[id]?.owesRub),
    won: byId((id) => s.players[id]?.bountyWonRub),
    bounty: byId((id) => m[id]?.bountyRub),
    winnerStacks: s.players[winner]?.currentStacks,
    dueSum: sum(Object.values(t0).map((x) => x.dueRub)),
    settled: isSettled(settlement(m, pays)),
  };
  const expected = {
    errors: [],
    finished: true,
    places: [ids.length, ids.length],
    rows: ids.length,
    paid: owes,
    net: 0,
    prizes: s.prizePoolRub,
    // (buyIn − bounty)·Σk + bounty·Σk = buyIn·Σk
    poolAndHeads: owes,
    malformed: 0,
    owes: byId((id) => exp.owesRub.get(id) ?? 0),
    won: byId((id) => exp.wonRub.get(id) ?? 0),
    // Победителю — свои нокауты + голова его текущего входа + каждая сиротская (своей кратности).
    bounty: byId((id) =>
      id === winner
        ? (exp.wonRub.get(id) ?? 0) + fmt.bountyRub * (exp.current.get(id) ?? 1) + exp.orphanRub
        : (exp.wonRub.get(id) ?? 0),
    ),
    winnerStacks: exp.current.get(winner) ?? 1,
    dueSum: 0,
    settled: true,
  };
  expect(actual, label).toEqual(expected);
  return m;
}

describe('инвариант: сумма prize + bounty = сумма owes', () => {
  it('на 3000 сгенерированных вечерах (2–6 игроков, кратные входы и ребаи, сплиты, сиротские головы)', () => {
    const cov = newCoverage();
    for (let seed = 1; seed <= 3000; seed++) {
      const { fmt, s, j } = randomEvening(seed, cov);
      const m = checkFinished(fmt, s, j.events, `seed ${seed}`);
      // Платежи через журнал (paymentsFromEvents) — тот же итог, что и списком.
      const t0 = settlement(m, []);
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
    expect(cov.multi).toBeGreaterThan(1000);
    expect(cov.mixedRebuy).toBeGreaterThan(100);
    expect(cov.unevenSplit).toBeGreaterThan(50);
    expect(cov.multiOrphan).toBeGreaterThan(50);
    expect([...cov.players].sort()).toEqual([2, 3, 4, 5, 6]);
  });

  it('до finish: розданные головы + нераспределённые = все головы', () => {
    const cov = newCoverage();
    for (let seed = 5001; seed <= 5300; seed++) {
      const { fmt, j } = randomEvening(seed, cov);
      const open = j.events.filter((e) => e.type !== 'finish' && e.type !== 'payment');
      const s = replay(fmt, open, j.now());
      const m = computeMoney(fmt, s);
      const bounty = sum(Object.values(m).map((x) => x.bountyRub));
      expect(bounty).toBeLessThanOrEqual(s.bountyPoolRub);
      expect(s.bountyPoolRub).toBe(s.totalStacks * fmt.bountyRub);
      expect(sum(Object.values(m).map((x) => x.prizeRub))).toBe(0);
    }
  });
});

// ---------- полный перебор маленьких вечеров ----------

/**
 * Все вечера на трёх игроков: каждый входит ×1 (без поля stacks, как старые события) или ×2, любой
 * вылет с любым упорядоченным списком выбивших (порядок важен: остаток головы — первому), один
 * ребай за вечер ×1 или ×3 любым вылетевшим в любой момент, finish, когда остался один. Голова
 * 75 ₽: головы 75 и 225 (×3) на двоих нацело не делятся — рубль от округления виден, 150 (×2)
 * делится. Около 22 тысяч вечеров.
 */
describe('перебор: все маленькие вечера на трёх игроков', () => {
  const FMT: TournamentFormat = { ...F, buyInRub: 500, bountyRub: 75, payoutPct: [70, 30] };
  const IDS = ['A', 'B', 'C'];
  const MAX_REBUYS = 1;
  const REBUY_STACKS = [1, 3];

  interface Node {
    events: EveningEvent[];
    alive: Set<PlayerId>;
    rebuys: number;
  }

  const mk = (
    events: EveningEvent[],
    type: EveningEvent['type'],
    payload: object,
  ): EveningEvent[] => [
    ...events,
    {
      id: events.length + 1,
      type,
      payload: payload as EveningEvent['payload'],
      at: '2026-10-08T16:00:00.000Z',
      voided: false,
    },
  ];

  /** Упорядоченные подмножества (размещения) списка, включая пустое. */
  function arrangements(xs: PlayerId[]): PlayerId[][] {
    const out: PlayerId[][] = [[]];
    for (const x of xs) {
      for (const rest of arrangements(xs.filter((y) => y !== x))) out.push([x, ...rest]);
    }
    return out;
  }

  function* walk(node: Node): Generator<EveningEvent[]> {
    if (node.alive.size === 1) {
      yield mk(node.events, 'finish', {});
      // И ветки без finish: вылетевший докупается, игра продолжается.
    }
    const dead = IDS.filter((id) => !node.alive.has(id));
    if (node.rebuys < MAX_REBUYS) {
      for (const id of dead) {
        for (const k of REBUY_STACKS) {
          const alive = new Set(node.alive).add(id);
          yield* walk({
            events: mk(node.events, 'rebuy', { playerId: id, stacks: k }),
            alive,
            rebuys: node.rebuys + 1,
          });
        }
      }
    }
    if (node.alive.size < 2) return;
    for (const victim of node.alive) {
      const others = [...node.alive].filter((id) => id !== victim);
      for (const by of arrangements(others)) {
        const alive = new Set(node.alive);
        alive.delete(victim);
        yield* walk({
          events: mk(node.events, 'bust', { playerId: victim, by }),
          alive,
          rebuys: node.rebuys,
        });
      }
    }
  }

  it('инвариант и независимый пересчёт на каждом листе', () => {
    let leaves = 0;
    let sawMixed = 0;
    for (const a of [1, 2])
      for (const b of [1, 2])
        for (const c of [1, 2]) {
          let events: EveningEvent[] = [];
          for (const [id, k] of [
            ['A', a],
            ['B', b],
            ['C', c],
          ] as const) {
            events = mk(events, 'join', k === 1 ? { playerId: id } : { playerId: id, stacks: k });
          }
          for (const leaf of walk({ events, alive: new Set(IDS), rebuys: 0 })) {
            leaves += 1;
            const s = replay(FMT, leaf, Date.parse('2026-10-08T16:00:00.000Z'));
            checkFinished(FMT, s, leaf, `лист ${leaves}`);
            if (new Set(IDS.map((id) => s.players[id]?.currentStacks)).size > 1) sawMixed += 1;
          }
        }
    // Перебор действительно большой и с разными кратностями на руках к финишу.
    expect(leaves).toBe(8 * 2820);
    expect(sawMixed).toBeGreaterThan(1000);
  });
});
