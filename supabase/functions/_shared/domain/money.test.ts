import { describe, expect, it } from 'vitest';
import { DEFAULT_FORMAT, validateFormat } from './format.ts';
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
  j.wait(10).bust('C', ['A', 'D']); // сплит: нокаут обоим, денег за него нет
  j.rebuy('C');
  j.wait(10).bust('C', ['E']); // окончательный
  j.wait(10).bust('B', []); // кто выбил — не указано
  j.wait(10).bust('E', ['A', 'D']);
  j.wait(10).bust('D', ['A']);
  j.finish();
  const s = replay(F, j.events, j.now());
  const m = computeMoney(F, s);

  it('состояние', () => {
    expect(s.errors).toEqual([]);
    expect(s.totalEntries).toBe(7);
    // Весь взнос — в фонд: 7 × 500.
    expect(s.prizePoolRub).toBe(3500);
    expect(s.places).toEqual(['A', 'D', 'E', 'B', 'C']);
    expect(s.players.A?.kos).toBe(4);
    expect(s.players.D?.kos).toBe(2);
    expect(s.players.E?.kos).toBe(1);
  });

  it('таблица: выигрыш — только призовые', () => {
    expect(m).toEqual({
      // фонд 3500 → 2450 / 1050
      A: { owesRub: 500, prizeRub: 2450, netRub: 1950 },
      B: { owesRub: 1000, prizeRub: 0, netRub: -1000 },
      C: { owesRub: 1000, prizeRub: 0, netRub: -1000 },
      D: { owesRub: 500, prizeRub: 1050, netRub: 550 },
      E: { owesRub: 500, prizeRub: 0, netRub: -500 },
    });
  });

  it('до finish призовых нет — у каждого только взнос', () => {
    const before = j.events.filter((e) => e.type !== 'finish');
    const mb = computeMoney(F, replay(F, before, j.now()));
    expect(mb.A).toEqual({ owesRub: 500, prizeRub: 0, netRub: -500 });
    expect(mb.D).toEqual({ owesRub: 500, prizeRub: 0, netRub: -500 });
  });

  it('settlement: owes / awaits / settled, частичные платежи', () => {
    j.payment('B', 1000);
    j.payment('C', 400); // частично
    j.payment('E', 500);
    j.payment('A', -1000); // банкир выплатил часть выигрыша
    const voided = j.payment('D', -550);
    j.voidEvent(voided);
    const pays = paymentsFromEvents(j.events);
    expect(pays).toEqual([
      { playerId: 'B', amountRub: 1000 },
      { playerId: 'C', amountRub: 400 },
      { playerId: 'E', amountRub: 500 },
      { playerId: 'A', amountRub: -1000 },
    ]);
    const t = settlement(m, pays);
    expect(t).toEqual({
      A: { dueRub: -1950, paidRub: -1000, remainingRub: -950, status: 'awaits' },
      B: { dueRub: 1000, paidRub: 1000, remainingRub: 0, status: 'settled' },
      C: { dueRub: 1000, paidRub: 400, remainingRub: 600, status: 'owes' },
      D: { dueRub: -550, paidRub: 0, remainingRub: -550, status: 'awaits' },
      E: { dueRub: 500, paidRub: 500, remainingRub: 0, status: 'settled' },
    });
    expect(isSettled(t)).toBe(false);

    const rest = settlement(m, [
      ...pays,
      { playerId: 'C', amountRub: 600 },
      { playerId: 'A', amountRub: -950 },
      { playerId: 'D', amountRub: -550 },
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

describe('нокауты — только статистика, денег за голову нет', () => {
  /** Один и тот же вечер на троих; меняется только то, кто выбил. */
  function evening(byB: PlayerId[], byC: PlayerId[]): EveningState {
    const j = journal().join('A', 'B', 'C');
    j.start();
    j.wait(5).bust('B', byB);
    j.wait(5).bust('C', byC);
    j.finish();
    return replay(F, j.events, j.now());
  }

  it('фонд — все взносы, выигрыш победителя — только призовые', () => {
    const s = evening([], ['A']);
    expect(s.prizePoolRub).toBe(1500);
    expect(computeMoney(F, s)).toEqual({
      // 1500 → 1050 / 450
      A: { owesRub: 500, prizeRub: 1050, netRub: 550 },
      B: { owesRub: 500, prizeRub: 0, netRub: -500 },
      C: { owesRub: 500, prizeRub: 450, netRub: -50 },
    });
  });

  it('нокаут не меняет деньги: выбил один, никто или двое — таблица та же', () => {
    const base = computeMoney(F, evening([], []));
    expect(computeMoney(F, evening(['A'], ['A']))).toEqual(base);
    expect(computeMoney(F, evening(['C'], ['A']))).toEqual(base);
    expect(computeMoney(F, evening(['A', 'C'], ['A']))).toEqual(base);
    expect(evening(['A', 'C'], ['A']).players.A?.kos).toBe(2);
    expect(evening([], []).players.A?.kos).toBe(0);
  });

  it('сплит нокаута: нокаут каждому из выбивших, денег ни у кого', () => {
    const j = journal().join('A', 'B', 'C', 'D');
    j.bust('D', ['C', 'A', 'B']);
    const s = replay(F, j.events, j.now());
    expect([s.players.A?.kos, s.players.B?.kos, s.players.C?.kos]).toEqual([1, 1, 1]);
    expect([s.players.A, s.players.B, s.players.C].map((p) => p?.koVictims)).toEqual([
      ['D'],
      ['D'],
      ['D'],
    ]);
    expect(s.prizePoolRub).toBe(2000);
    const m = computeMoney(F, s);
    for (const id of ['A', 'B', 'C', 'D']) {
      expect(m[id]).toEqual({ owesRub: 500, prizeRub: 0, netRub: -500 });
    }
  });

  it('сплит нокаута кратного входа: нокаут каждому, призовые — по местам', () => {
    const j = journal().join('A', 'B');
    j.joinStacks('C', 3);
    j.bust('C', ['B', 'A']);
    j.bust('B', ['A']);
    j.finish();
    const s = replay(F, j.events, j.now());
    expect([s.players.A?.kos, s.players.B?.kos]).toEqual([2, 1]);
    // Фонд 5 × 500 = 2500 → 1750 / 750.
    expect(computeMoney(F, s)).toEqual({
      A: { owesRub: 500, prizeRub: 1750, netRub: 1250 },
      B: { owesRub: 500, prizeRub: 750, netRub: 250 },
      C: { owesRub: 1500, prizeRub: 0, netRub: -1500 },
    });
  });

  it('формат с bountyRub (до 07.10.2026) считается так же, как без него', () => {
    const legacy = { ...F, bountyRub: 100 } as TournamentFormat;
    expect(validateFormat(legacy)).toEqual([]);
    const j = journal().join('A', 'B');
    j.joinStacks('C', 2);
    j.start();
    j.wait(5).bust('C', ['A']);
    j.wait(5).bust('B', []);
    j.finish();
    const s = replay(legacy, j.events, j.now());
    expect(s).toEqual(replay(F, j.events, j.now()));
    expect(s.prizePoolRub).toBe(2000);
    expect(computeMoney(legacy, s)).toEqual(computeMoney(F, s));
  });
});

describe('вход и ребай кратно стандартному', () => {
  it('entryAmounts: вход на 1 000 ₽ — 1 000 фишек, весь взнос в фонд', () => {
    expect(entryAmounts(F, 2)).toEqual({ stacks: 2, rub: 1000, chips: 1000 });
    expect(entryAmounts(F)).toEqual({ stacks: 1, rub: 500, chips: 500 });
  });

  it('вход ×2: взнос 1 000, фонд +1 000', () => {
    const j = journal().join('A', 'B');
    j.joinStacks('C', 2);
    j.start();
    let s = replay(F, j.events, j.now());
    expect(s.totalEntries).toBe(3);
    expect(s.totalStacks).toBe(4);
    expect(s.totalChips).toBe(2000);
    expect(s.prizePoolRub).toBe(2000);
    expect(s.players.C).toMatchObject({ entries: 1, stacks: 2 });

    j.wait(5).bust('C', ['A']);
    j.wait(5).bust('B', ['A']);
    j.finish();
    s = replay(F, j.events, j.now());
    expect(computeMoney(F, s)).toEqual({
      // фонд 2000: 1400 / 600
      A: { owesRub: 500, prizeRub: 1400, netRub: 900 },
      B: { owesRub: 500, prizeRub: 600, netRub: 100 },
      C: { owesRub: 1000, prizeRub: 0, netRub: -1000 },
    });
  });

  it('ребаи разной кратности: взнос — по сумме кратностей, призовые = взносы', () => {
    const j = journal();
    j.joinStacks('A', 2);
    j.join('B', 'C');
    j.start();
    j.wait(5).bust('A', ['B']);
    j.rebuy('A'); // ×1 без поля
    j.wait(5).bust('A', ['C']);
    j.rebuy('A', 3);
    j.wait(5).bust('B', ['A']);
    j.wait(5).bust('C', ['A']);
    j.finish();
    const s = replay(F, j.events, j.now());
    expect(s.errors).toEqual([]);
    expect(s.players.A).toMatchObject({ entries: 3, rebuys: 2, stacks: 6, kos: 2 });
    expect(s.totalStacks).toBe(8);
    expect(s.prizePoolRub).toBe(4000);
    const m = computeMoney(F, s);
    // Фонд 4000 → 2800 / 1200; A внёс 6 × 500.
    expect(m.A).toEqual({ owesRub: 3000, prizeRub: 2800, netRub: -200 });
    expect(m.B).toEqual({ owesRub: 500, prizeRub: 0, netRub: -500 });
    expect(m.C).toEqual({ owesRub: 500, prizeRub: 1200, netRub: 700 });
    const all = Object.values(m);
    expect(sum(all.map((x) => x.prizeRub))).toBe(sum(all.map((x) => x.owesRub)));
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
const BUYINS: number[] = [500, 300, 1000, 7, 101, 1, 333];

interface Coverage {
  split2: number;
  split3: number;
  /** Вылеты без выбивших. */
  noKiller: number;
  rebuys: number;
  finishOpen: number;
  lateJoin: number;
  players: Set<number>;
  /** Входы и ребаи кратностью больше 1. */
  multi: number;
  /** Ребай другой кратности, чем вход (или прошлый ребай) того же игрока. */
  mixedRebuy: number;
  /** Фонд, который по долям не делится нацело: рубль от округления уходит 1-му месту. */
  unevenPayout: number;
}

const newCoverage = (): Coverage => ({
  split2: 0,
  split3: 0,
  noKiller: 0,
  rebuys: 0,
  finishOpen: 0,
  lateJoin: 0,
  players: new Set(),
  multi: 0,
  mixedRebuy: 0,
  unevenPayout: 0,
});

function randomEvening(seed: number, cov: Coverage) {
  const r = prng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
  const n = 2 + Math.floor(r() * 5); // 2..6
  const fmt: TournamentFormat = {
    ...F,
    buyInRub: pick(BUYINS),
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
    if (k === 0) cov.noKiller += 1;
    if (k === 2) cov.split2 += 1;
    if (k === 3) cov.split3 += 1;
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
  const places = Math.min(s.joinOrder.length, fmt.payoutPct.length);
  const pcts = fmt.payoutPct.slice(0, places);
  const pctSum = sum(pcts);
  if (pcts.some((p) => !Number.isInteger((s.prizePoolRub * p) / pctSum))) cov.unevenPayout += 1;
  return { fmt, s, j };
}

interface Expected {
  /** Взносы игрока: buyInRub × кратность каждого его входа и ребая. */
  owesRub: Map<PlayerId, number>;
  /** Нокауты: каждому из by, при дележе — каждому. */
  kos: Map<PlayerId, number>;
}

/**
 * Независимый пересчёт по журналу — без replay и computeMoney: кратность из payload, нокаут —
 * каждому из by. Годится для журналов, где все события приняты (errors = []).
 */
function expectedFromJournal(fmt: TournamentFormat, events: readonly EveningEvent[]): Expected {
  const e: Expected = { owesRub: new Map(), kos: new Map() };
  const add = (map: Map<PlayerId, number>, id: PlayerId, v: number) =>
    map.set(id, (map.get(id) ?? 0) + v);
  for (const ev of [...events].sort((a, b) => a.id - b.id)) {
    if (ev.voided) continue;
    const p = ev.payload as { playerId: PlayerId; stacks?: number; by?: PlayerId[] };
    if (ev.type === 'join' || ev.type === 'rebuy') {
      add(e.owesRub, p.playerId, fmt.buyInRub * (p.stacks ?? 1));
    } else if (ev.type === 'bust') {
      for (const id of p.by ?? []) add(e.kos, id, 1);
    }
  }
  return e;
}

/** Тот же журнал, где ни у одного вылета нет выбивших: деньги от этого меняться не должны. */
function withoutKillers(events: readonly EveningEvent[]): EveningEvent[] {
  return events.map((ev) =>
    ev.type === 'bust'
      ? { ...ev, payload: { ...(ev.payload as { playerId: PlayerId }), by: [] } }
      : ev,
  );
}

/**
 * Полная проверка завершённого вечера одним сравнением (перебор ниже гоняет её десятки тысяч раз):
 * журнал принят целиком, места полны; инвариант Σ призовых = Σ взносов, сумма нетто — ноль; фонд —
 * ровно взносы; призовые места — доменная раскладка фонда по местам; суммы целые и
 * неотрицательные, взнос кратен buyIn; в строке денег только взнос, призовые и нетто; независимый
 * пересчёт взносов и нокаутов; тот же журнал без выбивших даёт ту же денежную таблицу; расчёт с
 * банкиром сходится, когда каждый закрыл свой остаток.
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
  const exp = expectedFromJournal(fmt, events);
  const prizesByPlace = payouts(s.prizePoolRub, fmt.payoutPct, ids.length);
  const t0 = settlement(m, []);
  const pays = ids
    .map((id) => ({ playerId: id, amountRub: t0[id]?.dueRub ?? 0 }))
    .filter((p) => p.amountRub !== 0);
  const byId = (f: (id: PlayerId) => number | undefined) =>
    Object.fromEntries(ids.map((id) => [id, f(id)]));
  const noKillers = withoutKillers(events);
  // После finish время на деньги не влияет; берём момент последнего события.
  const lastMs = Math.max(...events.map((e) => Date.parse(e.at)));

  const actual = {
    errors: s.errors,
    finished: s.finished,
    places: [s.places.length, new Set(s.places).size],
    rows: all.length,
    paid: sum(all.map((x) => x.prizeRub)),
    net: sum(all.map((x) => x.netRub)),
    pool: s.prizePoolRub,
    keys: [...new Set(all.map((x) => Object.keys(x).sort().join(',')))],
    malformed: all.filter(
      (x) =>
        ![x.owesRub, x.prizeRub, x.netRub].every(Number.isInteger) ||
        x.prizeRub < 0 ||
        x.netRub !== x.prizeRub - x.owesRub ||
        x.owesRub % fmt.buyInRub !== 0,
    ).length,
    owes: byId((id) => m[id]?.owesRub),
    prize: byId((id) => m[id]?.prizeRub),
    kos: byId((id) => s.players[id]?.kos),
    noKillersMoney: computeMoney(fmt, replay(fmt, noKillers, lastMs)),
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
    // Весь взнос — в фонд: buyIn·Σk.
    pool: owes,
    keys: ['netRub,owesRub,prizeRub'],
    malformed: 0,
    owes: byId((id) => exp.owesRub.get(id) ?? 0),
    prize: byId((id) => {
      const place = s.places.indexOf(id) + 1;
      return place > 0 ? (prizesByPlace[place - 1] ?? 0) : 0;
    }),
    kos: byId((id) => exp.kos.get(id) ?? 0),
    noKillersMoney: m,
    dueSum: 0,
    settled: true,
  };
  expect(actual, label).toEqual(expected);
  return m;
}

describe('инвариант: сумма призовых = сумма взносов', () => {
  it('на 3000 сгенерированных вечерах (2–6 игроков, кратные входы и ребаи, сплиты, вылеты без выбивших)', () => {
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
    expect(cov.noKiller).toBeGreaterThan(100);
    expect(cov.rebuys).toBeGreaterThan(100);
    expect(cov.finishOpen).toBeGreaterThan(10);
    expect(cov.lateJoin).toBeGreaterThan(10);
    expect(cov.multi).toBeGreaterThan(1000);
    expect(cov.mixedRebuy).toBeGreaterThan(100);
    expect(cov.unevenPayout).toBeGreaterThan(100);
    expect([...cov.players].sort()).toEqual([2, 3, 4, 5, 6]);
  });

  it('до finish: фонд — все взносы, призовых ещё нет', () => {
    const cov = newCoverage();
    for (let seed = 5001; seed <= 5300; seed++) {
      const { fmt, j } = randomEvening(seed, cov);
      const open = j.events.filter((e) => e.type !== 'finish' && e.type !== 'payment');
      const s = replay(fmt, open, j.now());
      const m = computeMoney(fmt, s);
      const owes = sum(Object.values(m).map((x) => x.owesRub));
      expect(s.prizePoolRub).toBe(owes);
      expect(s.prizePoolRub).toBe(s.totalStacks * fmt.buyInRub);
      expect(sum(Object.values(m).map((x) => x.prizeRub))).toBe(0);
      expect(Object.values(m).every((x) => x.netRub === -x.owesRub)).toBe(true);
    }
  });
});

// ---------- полный перебор маленьких вечеров ----------

/**
 * Все вечера на трёх игроков: каждый входит ×1 (без поля stacks, как старые события) или ×2, любой
 * вылет с любым упорядоченным списком выбивших, один ребай за вечер ×1 или ×3 любым вылетевшим в
 * любой момент, finish, когда остался один. Вход 333 ₽: фонд по 70/30 нацело не делится — рубль от
 * округления виден. Около 22 тысяч вечеров.
 */
describe('перебор: все маленькие вечера на трёх игроков', () => {
  const FMT: TournamentFormat = { ...F, buyInRub: 333, payoutPct: [70, 30] };
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
    let sawTripleRebuy = 0;
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
            if (
              leaf.some(
                (e) => e.type === 'rebuy' && (e.payload as { stacks?: number }).stacks === 3,
              )
            )
              sawTripleRebuy += 1;
          }
        }
    // Перебор действительно большой и с ребаями ×3.
    expect(leaves).toBe(8 * 2820);
    expect(sawTripleRebuy).toBeGreaterThan(1000);
  });
});
