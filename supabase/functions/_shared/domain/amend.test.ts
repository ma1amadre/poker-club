// Правка записи на месте (миграция 022): поправка встаёт на место исходной записи.
import { describe, expect, it } from 'vitest';
import {
  AMEND_IMPACT_ERROR,
  amendDraft,
  amendField,
  amendImpact,
  canAmend,
  currentAmendValue,
  hasAmendImpact,
} from './amend.ts';
import { DEFAULT_FORMAT } from './format.ts';
import { computeMoney, isSettled, payouts, settlement } from './money.ts';
import { canApply, replay, replayLog } from './replay.ts';
import { DEFAULT_SCORING } from './scoring.ts';
import { summarize } from './summary.ts';
import { journal, MIN, prng } from './test-utils.ts';
import type { EveningEvent, EveningState, PlayerId, TournamentFormat } from './types.ts';

const F = DEFAULT_FORMAT;
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const errorsOf = (s: EveningState) => s.errors.map((e) => e.message);
const kosOf = (s: EveningState) =>
  Object.fromEntries(s.joinOrder.map((id) => [id, s.players[id]?.kos ?? 0]));

/**
 * Журнал «как будто так и записали»: поправки в силе вписаны в исходные записи, сами поправки
 * убраны. Правка на месте обязана давать ровно то же, что этот журнал.
 */
function materialize(format: TournamentFormat, events: readonly EveningEvent[], nowMs: number) {
  const { applied, amended } = replayLog(format, events, nowMs);
  const effective = new Map(applied.map((e) => [e.id, e]));
  return events
    .filter((e) => e.type !== 'amend')
    .map((e) =>
      amended.has(e.id) ? { ...e, payload: effective.get(e.id)?.payload ?? e.payload } : e,
    );
}

describe('правка вылета на месте: ребай после него не ломается', () => {
  // Сценарий аудита (проблема 2): «кто выбил» исправляют у вылета, после которого был ребай.
  const j = journal().join('A', 'B', 'C', 'D');
  j.start();
  const bustB = j.wait(10).bust('B', ['A']); // ошибка: на самом деле выбил D
  const rebuyB = j.wait(1).rebuy('B');
  j.wait(10).bust('C', ['A']);

  it('отмена и новая запись в конце снимают ребай (как было до 022)', () => {
    const events = j.events.map((e) => (e.id === bustB ? { ...e, voided: true } : e));
    events.push({ ...events[0]!, id: 99, type: 'bust', payload: { playerId: 'B', by: ['D'] } });
    const s = replay(F, events, j.now());
    expect(s.errors.find((e) => e.eventId === rebuyB)?.message).toBe(
      'Игрок ещё в игре — ребай только после вылета',
    );
    expect(s.prizePoolRub).toBe(4 * 500); // ребай выпал из фонда
  });

  it('поправка: ребай на месте, нокаут — у нового выбившего, деньги и места те же', () => {
    const before = replay(F, j.events, j.now());
    const amendId = j.wait(1).amend(bustB, { by: ['D'] });
    const { state: s, applied, amended } = replayLog(F, j.events, j.now());
    expect(errorsOf(s)).toEqual([]);
    expect(amended.get(bustB)).toBe(amendId);
    expect(s.players.B).toMatchObject({ alive: true, rebuys: 1, feeRub: 1000, busts: 1 });
    expect(kosOf(s)).toEqual({ A: 1, B: 0, C: 0, D: 1 });
    expect(s.players.D?.koVictims).toEqual(['B']);
    expect(s.prizePoolRub).toBe(before.prizePoolRub);
    expect(computeMoney(F, s)).toEqual(computeMoney(F, before));
    // Исправленная запись — на своём месте с новым payload, поправка — в своей позиции.
    expect(applied.map((e) => e.id)).toEqual(j.events.map((e) => e.id));
    expect(applied.find((e) => e.id === bustB)?.payload).toEqual({ playerId: 'B', by: ['D'] });
    expect(s.firstBustPlayerId).toBe('B');
  });

  it('отмена поправки возвращает исходное', () => {
    const last = j.events.at(-1)!;
    j.voidEvent(last.id);
    const s = replay(F, j.events, j.now());
    expect(kosOf(s)).toEqual({ A: 2, B: 0, C: 0, D: 0 });
    expect(replayLog(F, j.events, j.now()).amended.size).toBe(0);
  });
});

describe('правка кратности входа и ребая (правки 022–026)', () => {
  it('вход ×1 → ×2: взнос, фонд и фишки — как будто вход сразу был ×2', () => {
    const j = journal();
    const joinA = j.add('join', { playerId: 'A' });
    j.join('B', 'C');
    j.start();
    j.wait(5).bust('C', ['A']);
    j.amend(joinA, { stacks: 2 });
    const s = replay(F, j.events, j.now());
    expect(errorsOf(s)).toEqual([]);
    expect(s.players.A).toMatchObject({ entries: 1, feeRub: 1000, chips: 1000 });
    expect(s.prizePoolRub).toBe(2000);
    expect(s.totalChips).toBe(2000);
    expect(computeMoney(F, s).A?.owesRub).toBe(1000);
    // Поправка в ×1 хранит единицу явно — значение то же, что у входа без поля.
    j.amend(joinA, { stacks: 1 });
    expect(replay(F, j.events, j.now()).prizePoolRub).toBe(1500);
  });

  it('ребай ×3 → ×1 и последняя поправка в силе; отмена последней — предыдущая', () => {
    const j = journal().join('A', 'B');
    j.start();
    j.wait(5).bust('A', ['B']);
    const rebuy = j.rebuy('A', 3);
    const first = j.wait(1).amend(rebuy, { stacks: 1 });
    const second = j.wait(1).amend(rebuy, { stacks: 2 });
    let log = replayLog(F, j.events, j.now());
    expect(log.state.players.A?.feeRub).toBe(1500);
    expect(log.amended.get(rebuy)).toBe(second);
    expect(log.state.errors).toEqual([]);
    j.voidEvent(second);
    log = replayLog(F, j.events, j.now());
    expect(log.state.players.A?.feeRub).toBe(1000);
    expect(log.amended.get(rebuy)).toBe(first);
    j.voidEvent(first);
    expect(replay(F, j.events, j.now()).players.A?.feeRub).toBe(2000);
  });
});

describe('правка суммы входа и ребая (миграция 027)', () => {
  it('вход 500 → 700: взнос, фонд и фишки по записи; запись на месте', () => {
    const j = journal();
    const joinA = j.add('join', { playerId: 'A' });
    j.join('B', 'C');
    j.start();
    j.wait(5).bust('C', ['A']);
    const fix = j.amend(joinA, { rub: 700 });
    const log = replayLog(F, j.events, j.now());
    expect(errorsOf(log.state)).toEqual([]);
    expect(log.amended.get(joinA)).toBe(fix);
    expect(log.state.players.A).toMatchObject({ entries: 1, feeRub: 700, chips: 700 });
    expect(log.state.prizePoolRub).toBe(1700);
    expect(log.state.totalChips).toBe(1700);
    expect(computeMoney(F, log.state).A?.owesRub).toBe(700);
    // Применённая запись — с суммой в payload.
    expect(log.applied.find((e) => e.id === joinA)?.payload).toEqual({ playerId: 'A', rub: 700 });
  });

  it('сумма заменяет кратность и наоборот: в силе последняя правка', () => {
    const j = journal().join('A', 'B');
    j.start();
    j.wait(5).bust('A', ['B']);
    const rebuy = j.rebuy('A', 3); // 1 500
    const toRub = j.wait(1).amend(rebuy, { rub: 300 });
    let log = replayLog(F, j.events, j.now());
    expect(log.state.players.A?.feeRub).toBe(800);
    expect(log.applied.find((e) => e.id === rebuy)?.payload).toEqual({ playerId: 'A', rub: 300 });
    const toStacks = j.wait(1).amend(rebuy, { stacks: 2 });
    log = replayLog(F, j.events, j.now());
    expect(log.state.players.A?.feeRub).toBe(1500);
    expect(log.applied.find((e) => e.id === rebuy)?.payload).toEqual({
      playerId: 'A',
      stacks: 2,
    });
    j.voidEvent(toStacks);
    expect(replay(F, j.events, j.now()).players.A?.feeRub).toBe(800);
    j.voidEvent(toRub);
    expect(replay(F, j.events, j.now()).players.A?.feeRub).toBe(2000);
  });

  it('правка суммы входа со «свободной» суммой: 700 → 300, фишки по курсу формата', () => {
    const fmt = { ...F, startingChips: 1000 };
    const j = journal();
    const joinA = j.add('join', { playerId: 'A', rub: 700 });
    j.join('B');
    expect(replay(fmt, j.events, j.now()).players.A).toMatchObject({ feeRub: 700, chips: 1400 });
    j.amend(joinA, { rub: 300 });
    expect(replay(fmt, j.events, j.now()).players.A).toMatchObject({ feeRub: 300, chips: 600 });
    expect(currentAmendValue(fmt, j.events, joinA, j.now())).toEqual({ rub: 300 });
    expect(canAmend(fmt, j.events, { eventId: joinA, rub: 300 }, j.now())).toBe(
      'Правка ничего не меняет',
    );
    expect(canAmend(fmt, j.events, { eventId: joinA, rub: 500 }, j.now())).toBeNull();
    expect(amendDraft(joinA, { rub: 500 })).toEqual({
      type: 'amend',
      payload: { eventId: joinA, rub: 500 },
    });
  });
});

describe('поправка проверяется в позиции исходной записи', () => {
  const setup = () => {
    const j = journal().join('A', 'B', 'C');
    j.start();
    const bustC = j.wait(5).bust('C', ['A']);
    const bustB = j.wait(5).bust('B', ['A']);
    return { j, bustC, bustB };
  };

  it('выбивший, которого тогда уже не было в игре, — отказ, запись как была', () => {
    const { j, bustB, bustC } = setup();
    const bad = j.amend(bustB, { by: ['C'] }); // C вылетел раньше B
    const s = replay(F, j.events, j.now());
    expect(s.errors).toEqual([
      {
        eventId: bad,
        message: 'Правка не подходит: выбить может только игрок, который сейчас в игре',
      },
    ]);
    expect(kosOf(s)).toEqual({ A: 2, B: 0, C: 0 });
    // А для более раннего вылета B ещё был в игре — можно.
    j.amend(bustC, { by: ['B'] });
    expect(kosOf(replay(F, j.events, j.now()))).toEqual({ A: 1, B: 1, C: 0 });
  });

  it('сам себя, повтор, пустой список выбивших', () => {
    const { j, bustB } = setup();
    const self = j.amend(bustB, { by: ['B'] });
    const dup = j.amend(bustB, { by: ['A', 'A'] });
    const s = replay(F, j.events, j.now());
    expect(s.errors.map((e) => [e.eventId, e.message])).toEqual([
      [self, 'Правка не подходит: игрок не может выбить сам себя'],
      [dup, 'Правка не подходит: игрок повторяется в списке выбивших'],
    ]);
    j.amend(bustB, { by: [] }); // «не знаю, кто выбил» — законно
    expect(kosOf(replay(F, j.events, j.now()))).toEqual({ A: 1, B: 0, C: 0 });
  });

  it('отказы по форме и по журналу', () => {
    const { j, bustB } = setup();
    const startId = j.events.find((e) => e.type === 'timer_start')!.id;
    const joinA = j.events.find((e) => e.type === 'join')!.id;
    const cases: [number, string][] = [
      [j.add('amend', { eventId: 999, by: [] }), 'Правка: исправляемой записи нет в журнале'],
      [
        j.add('amend', { eventId: startId, by: [] }),
        'Правка: исправить можно только вход, ребай или вылет',
      ],
      [j.amend(bustB, { stacks: 2 }), 'Правка: у вылета исправляются выбившие, а не сумма'],
      [j.amend(bustB, { rub: 700 }), 'Правка: у вылета исправляются выбившие, а не сумма'],
      [j.amend(joinA, { by: ['B'] }), 'Правка: у входа и ребая исправляется сумма, а не выбившие'],
    ];
    const shape = 'Правка: нужна исправляемая запись и одно новое значение — сумма или выбившие';
    cases.push([j.amend(joinA, { stacks: 0 }), shape]);
    cases.push([j.amend(joinA, { stacks: 11 }), shape]);
    cases.push([j.amend(joinA, { rub: 0 }), shape]);
    cases.push([j.amend(joinA, { rub: 100_001 }), shape]);
    cases.push([j.amend(joinA, { rub: 700.5 }), shape]);
    cases.push([j.add('amend', { eventId: joinA } as never), shape]);
    cases.push([j.add('amend', { eventId: joinA, stacks: 2, by: [] } as never), shape]);
    cases.push([j.add('amend', { eventId: joinA, stacks: 2, rub: 700 } as never), shape]);
    cases.push([j.add('amend', { eventId: joinA, rub: '700' } as never), shape]);
    cases.push([j.add('amend', { eventId: '1', stacks: 2 } as never), shape]);
    // Ссылка на себя или вперёд: исправить можно только более раннюю запись.
    const nextId = j.events.length + 2;
    cases.push([
      j.add('amend', { eventId: nextId, stacks: 2 }),
      'Правка: исправить можно только более раннюю запись',
    ]);
    j.join('D'); // id = nextId
    const s = replay(F, j.events, j.now());
    expect(s.errors.map((e) => [e.eventId, e.message])).toEqual(cases);
    expect(kosOf(s)).toEqual({ A: 2, B: 0, C: 0, D: 0 });
  });

  it('отменённая исходная запись — поправка не принимается', () => {
    const { j, bustC } = setup();
    const amend = j.amend(bustC, { by: ['B'] });
    j.voidEvent(bustC);
    const s = replay(F, j.events, j.now());
    expect(s.errors).toEqual([{ eventId: amend, message: 'Правка: исправляемая запись отменена' }]);
  });

  it('поправка чинит непринятую запись: вылет с выбывшим выбившим', () => {
    const j = journal().join('A', 'B', 'C');
    j.start();
    j.wait(5).bust('C', ['A']);
    const bustB = j.wait(5).bust('B', ['C']); // C уже выбыл — запись не принята
    expect(replay(F, j.events, j.now()).errors.map((e) => e.eventId)).toEqual([bustB]);
    j.amend(bustB, { by: ['A'] });
    const s = replay(F, j.events, j.now());
    expect(s.errors).toEqual([]);
    expect(s.players.B?.alive).toBe(false);
    expect(s.aliveCount).toBe(1);
  });

  it('после «Игра окончена»: правка вылета финалиста не снимает завершение, места те же', () => {
    const j = journal().join('A', 'B', 'C');
    j.start();
    j.wait(5).bust('C', ['A']);
    const bustB = j.wait(5).bust('B', ['A']);
    j.finish();
    const before = replay(F, j.events, j.now());
    j.wait(60).amend(bustB, { by: [] });
    const s = replay(F, j.events, j.now());
    expect(s.errors).toEqual([]);
    expect(s.finished).toBe(true);
    expect(s.places).toEqual(before.places);
    expect(kosOf(s)).toEqual({ A: 1, B: 0, C: 0 });
    // Сумма после финала меняет деньги: призовые — по новому фонду, инвариант держится.
    const joinC = j.events.find(
      (e) => e.type === 'join' && (e.payload as { playerId: string }).playerId === 'C',
    )!.id;
    j.amend(joinC, { stacks: 3 });
    const after = replay(F, j.events, j.now());
    const m = computeMoney(F, after);
    expect(after.prizePoolRub).toBe(2500);
    expect(sum(Object.values(m).map((x) => x.prizeRub))).toBe(2500);
    expect(sum(Object.values(m).map((x) => x.owesRub))).toBe(2500);
  });
});

describe('места при правке вылета не сдвигаются', () => {
  it('порядок окончательных вылетов — по исходным записям, а не по поправкам', () => {
    const j = journal().join('A', 'B', 'C', 'D');
    j.start();
    const bustD = j.wait(5).bust('D', ['A']);
    j.wait(5).bust('C', ['B']);
    j.wait(5).bust('B', ['A']);
    j.finish();
    const before = replay(F, j.events, j.now());
    expect(before.places).toEqual(['A', 'B', 'C', 'D']);
    j.amend(bustD, { by: ['C'] });
    const s = replay(F, j.events, j.now());
    expect(s.places).toEqual(['A', 'B', 'C', 'D']);
    expect(s.players.D?.finalBustEventId).toBe(bustD);
    expect(s.players.D?.bustLevel).toBe(before.players.D?.bustLevel);
    expect(kosOf(s)).toEqual({ A: 1, B: 1, C: 1, D: 0 });
  });
});

describe('итог вечера и ачивки видят поправку', () => {
  it('summarize: пары нокаутов и вылеты — по поправке', () => {
    const j = journal('2026-10-09T12:00:00.000Z').join('A', 'B', 'C');
    j.start();
    const bustC = j.wait(5).bust('C', ['A']);
    j.wait(5).bust('B', ['A']);
    j.finish();
    j.amend(bustC, { by: ['A', 'B'] });
    const sum1 = summarize('e1', '2026-10-09T12:00:00.000Z', F, j.events, DEFAULT_SCORING);
    expect(sum1.koPairs).toEqual([
      ['A', 'C'],
      ['B', 'C'],
      ['A', 'B'],
    ]);
    expect(sum1.busts[0]).toEqual({ victim: 'C', by: ['A', 'B'] });
    expect(sum1.kos).toEqual({ A: 2, B: 1, C: 0 });
    expect(sum1.places).toEqual(['A', 'B', 'C']);
  });
});

describe('canAmend и помощники пульта', () => {
  const j = journal().join('A', 'B', 'C');
  j.start();
  const bustC = j.wait(5).bust('C', ['A']);
  const joinA = j.events[0]!.id;
  const now = () => j.now();

  it('что исправляется у записи', () => {
    expect(amendField({ type: 'join' })).toBe('rub');
    expect(amendField({ type: 'rebuy' })).toBe('rub');
    expect(amendField({ type: 'bust' })).toBe('by');
    expect(amendField({ type: 'payment' })).toBe(null);
    expect(currentAmendValue(F, j.events, bustC, now())).toEqual({ by: ['A'] });
    expect(currentAmendValue(F, j.events, joinA, now())).toEqual({ rub: 500 });
    expect(amendDraft(bustC, { by: ['B'] })).toEqual({
      type: 'amend',
      payload: { eventId: bustC, by: ['B'] },
    });
  });

  it('то же значение — «ничего не меняет»; порядок выбивших не важен', () => {
    expect(canAmend(F, j.events, { eventId: bustC, by: ['A'] }, now())).toBe(
      'Правка ничего не меняет',
    );
    expect(canAmend(F, j.events, { eventId: joinA, stacks: 1 }, now())).toBe(
      'Правка ничего не меняет',
    );
    expect(canAmend(F, j.events, { eventId: joinA, rub: 500 }, now())).toBe(
      'Правка ничего не меняет',
    );
    expect(canAmend(F, j.events, { eventId: bustC, by: ['B'] }, now())).toBe(null);
    expect(canAmend(F, j.events, { eventId: joinA, stacks: 2 }, now())).toBe(null);
    expect(canAmend(F, j.events, { eventId: joinA, rub: 700 }, now())).toBe(null);
  });

  it('отказ — тот же текст, что даст replay', () => {
    expect(canAmend(F, j.events, { eventId: bustC, by: ['C'] }, now())).toBe(
      'Правка не подходит: игрок не может выбить сам себя',
    );
    expect(canAmend(F, j.events, { eventId: 999, stacks: 2 }, now())).toBe(
      'Правка: исправляемой записи нет в журнале',
    );
    const startId = j.events.find((e) => e.type === 'timer_start')!.id;
    expect(canAmend(F, j.events, { eventId: startId, stacks: 2 }, now())).toBe(
      'Правка: исправить можно только вход, ребай или вылет',
    );
    // canApply по состоянию проверяет только форму.
    const state = replay(F, j.events, now());
    expect(canApply(F, state, 'amend', { eventId: bustC, by: ['B'] }, now())).toBe(null);
    expect(canApply(F, state, 'amend', { eventId: bustC } as never, now())).toMatch(/^Правка:/);
  });

  it('текущее значение — с поправкой в силе', () => {
    const k = journal().join('A', 'B');
    k.start();
    const bust = k.wait(1).bust('B', ['A']);
    k.amend(bust, { by: [] });
    expect(currentAmendValue(F, k.events, bust, k.now())).toEqual({ by: [] });
    expect(canAmend(F, k.events, { eventId: bust, by: [] }, k.now())).toBe(
      'Правка ничего не меняет',
    );
  });
});

// ---------- сгенерированные вечера с правками ----------

interface Generated {
  fmt: TournamentFormat;
  events: EveningEvent[];
  nowMs: number;
  amends: number;
  rejectedAmends: number;
  voidedAmends: number;
  bustAmends: number;
  stackAmends: number;
  rubAmends: number;
}

/**
 * Вечер на 2–6 игроков с кратными входами и входами свободной суммой (027), ребаями и сплитами; по
 * ходу игры (и после финала) банкир правит прошлые записи: сумму или кратность входа/ребая,
 * выбивших вылета — иногда неверно (выбивший, которого тогда не было в игре), иногда отменяет свою
 * правку. Шаг призовых формата — разный (нет поля, 1, 50, 100, 1 000 ₽).
 */
function generate(seed: number): Generated {
  const r = prng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
  const fmt: TournamentFormat = {
    ...F,
    buyInRub: pick([500, 333, 101, 1000]),
    payoutPct: pick([[70, 30], [100], [50, 30, 20], [33.3, 33.3, 33.4]]),
    payoutStepRub: pick([undefined, 1, 50, 100, 1000]),
    rebuyLimit: r() < 0.2 ? 1 : null,
    levels: F.levels.map((l) => ({
      ...l,
      trigger: { type: 'time' as const, minutes: 5 + Math.floor(r() * 20) },
    })),
  };
  const n = 2 + Math.floor(r() * 5);
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  const j = journal();
  const out = {
    amends: 0,
    rejectedAmends: 0,
    voidedAmends: 0,
    bustAmends: 0,
    stackAmends: 0,
    rubAmends: 0,
  };
  const stacks = () => (r() < 0.6 ? 1 : pick([2, 3, 10]));
  const freeRub = () => pick([300, 700, 750, 1000, 1, 2500, 333, 100_000]);
  // Вход и ребай: то кратностью (записи до 027), то свободной суммой (027).
  const enter = (id: PlayerId) =>
    r() < 0.5 ? j.joinStacks(id, stacks()) : j.joinRub(id, freeRub());
  const rebuy = (id: PlayerId) => (r() < 0.5 ? j.rebuy(id, stacks()) : j.rebuyRub(id, freeRub()));
  for (const id of ids) enter(id);
  j.start();

  const tryAmend = () => {
    const targets = j.events.filter(
      (e) => !e.voided && (e.type === 'join' || e.type === 'rebuy' || e.type === 'bust'),
    );
    if (targets.length === 0) return;
    const t = pick(targets);
    if (t.type === 'bust') {
      // Кто был в игре в момент вылета (кроме жертвы) — из журнала до исходной записи.
      const before = replay(
        fmt,
        j.events.filter((e) => e.id < t.id),
        Date.parse(t.at),
      );
      const victim = (t.payload as { playerId: PlayerId }).playerId;
      const alive = before.joinOrder.filter((id) => before.players[id]?.alive && id !== victim);
      const dead = before.joinOrder.filter((id) => !before.players[id]?.alive && id !== victim);
      const wrong = dead.length > 0 && r() < 0.15;
      const by = wrong ? [pick(dead)] : alive.filter(() => r() < 0.4);
      j.amend(t.id, { by });
      out.bustAmends += 1;
      if (wrong) out.rejectedAmends += 1;
    } else if (r() < 0.5) {
      j.amend(t.id, { stacks: stacks() });
      out.stackAmends += 1;
    } else {
      j.amend(t.id, { rub: freeRub() });
      out.rubAmends += 1;
    }
    out.amends += 1;
    if (r() < 0.15) {
      j.voidEvent(j.events.at(-1)!.id);
      out.voidedAmends += 1;
    }
  };

  for (let guard = 0; guard < 400; guard++) {
    j.wait(r() * 10);
    const s = replay(fmt, j.events, j.now());
    if (r() < 0.25) {
      tryAmend();
      continue;
    }
    const alive = s.joinOrder.filter((id) => s.players[id]?.alive);
    if (alive.length <= 1) {
      const canRebuy = s.joinOrder.filter(
        (id) =>
          !s.players[id]?.alive &&
          (fmt.rebuyLimit === null || (s.players[id]?.rebuys ?? 0) < fmt.rebuyLimit),
      );
      if (s.rebuysOpen && canRebuy.length > 0 && r() < 0.5) {
        rebuy(pick(canRebuy));
        continue;
      }
      j.finish();
      break;
    }
    const victim = pick(alive);
    const others = alive.filter((id) => id !== victim);
    const by = others.filter(() => r() < 0.45).slice(0, 3);
    j.bust(victim, by);
    const p = s.players[victim];
    if (s.rebuysOpen && r() < 0.4 && (fmt.rebuyLimit === null || (p?.rebuys ?? 0) < fmt.rebuyLimit))
      rebuy(victim);
  }
  // Правки после финала (админ правит закрытый вечер).
  for (let i = 0; i < 2; i++) if (r() < 0.4) tryAmend();
  return { fmt, events: j.events, nowMs: j.now(), ...out };
}

describe('сгенерированные вечера с правками на месте', () => {
  it('2000 вечеров: replay ≡ журнал «как будто так и записали», инвариант денег, отмена правок', () => {
    const cov = { amends: 0, rejected: 0, voided: 0, bust: 0, stacks: 0, rub: 0, finished: 0 };
    for (let seed = 1; seed <= 2000; seed++) {
      const g = generate(seed);
      const { fmt, events, nowMs } = g;
      cov.amends += g.amends;
      cov.rejected += g.rejectedAmends;
      cov.voided += g.voidedAmends;
      cov.bust += g.bustAmends;
      cov.stacks += g.stackAmends;
      cov.rub += g.rubAmends;
      const label = `seed ${seed}`;

      const log = replayLog(fmt, events, nowMs);
      const s = log.state;
      const flat = materialize(fmt, events, nowMs);
      const m = replay(fmt, flat, nowMs);
      const amendIds = new Set(events.filter((e) => e.type === 'amend').map((e) => e.id));

      // 1) Согласованность: правка на месте — то же, что запись сразу с исправленным значением.
      expect(
        {
          players: s.players,
          joinOrder: s.joinOrder,
          places: s.places,
          timer: s.timer,
          finished: s.finished,
          pool: s.prizePoolRub,
          chips: s.totalChips,
          first: s.firstBustPlayerId,
          errors: s.errors.filter((e) => !amendIds.has(e.eventId)),
          money: computeMoney(fmt, s),
        },
        label,
      ).toEqual({
        players: m.players,
        joinOrder: m.joinOrder,
        places: m.places,
        timer: m.timer,
        finished: m.finished,
        pool: m.prizePoolRub,
        chips: m.totalChips,
        first: m.firstBustPlayerId,
        errors: m.errors,
        money: computeMoney(fmt, m),
      });

      // 2) Правка не меняет приём других записей: без правок журнал принимает и отклоняет то же.
      const plain = replay(
        fmt,
        events.map((e) => (amendIds.has(e.id) ? { ...e, voided: true } : e)),
        nowMs,
      );
      expect(
        s.errors.filter((e) => !amendIds.has(e.eventId)).map((e) => e.eventId),
        label,
      ).toEqual(plain.errors.map((e) => e.eventId));
      expect(s.places, label).toEqual(plain.places);
      expect(s.timer, label).toEqual(plain.timer);

      // 3) Инвариант денег на завершённом вечере: призовые = взносы, взносы — по журналу с правками.
      expect(
        s.errors.filter((e) => !amendIds.has(e.eventId)),
        label,
      ).toEqual([]);
      if (s.finished) {
        cov.finished += 1;
        const money = computeMoney(fmt, s);
        const owes = sum(Object.values(money).map((x) => x.owesRub));
        // Независимо от replay: сумма записи (027) или кратность × вход формата.
        const expectedOwes = sum(
          flat
            .filter((e) => !e.voided && (e.type === 'join' || e.type === 'rebuy'))
            .map((e) => {
              const p = e.payload as { stacks?: number; rub?: number };
              return p.rub ?? fmt.buyInRub * (p.stacks ?? 1);
            }),
        );
        expect(owes, label).toBe(expectedOwes);
        expect(s.prizePoolRub, label).toBe(owes);
        expect(sum(Object.values(money).map((x) => x.prizeRub)), label).toBe(owes);
        expect(sum(Object.values(money).map((x) => x.netRub)), label).toBe(0);
        const byPlace = payouts(
          s.prizePoolRub,
          fmt.payoutPct,
          s.joinOrder.length,
          fmt.payoutStepRub ?? 1,
        );
        s.places.forEach((id, i) => expect(money[id]?.prizeRub, label).toBe(byPlace[i] ?? 0));
        const due = settlement(money, []);
        const pays = s.joinOrder.map((id) => ({ playerId: id, amountRub: due[id]?.dueRub ?? 0 }));
        expect(isSettled(settlement(money, pays)), label).toBe(true);
        // Итог для статистики — тот же, что у журнала без правок, но с исправленными записями.
        const date = '2026-10-09T12:00:00.000Z';
        expect(summarize('e', date, fmt, events, DEFAULT_SCORING), label).toEqual(
          summarize('e', date, fmt, flat, DEFAULT_SCORING),
        );
      }
    }
    expect(cov.amends).toBeGreaterThan(2000);
    expect(cov.bust).toBeGreaterThan(500);
    expect(cov.stacks).toBeGreaterThan(250);
    expect(cov.rub).toBeGreaterThan(250);
    expect(cov.rejected).toBeGreaterThan(50);
    expect(cov.voided).toBeGreaterThan(100);
    expect(cov.finished).toBeGreaterThan(1500);
  });

  it('с правкой вылета в середине: ребаи после него приняты, нокауты — по поправке (100 вечеров)', () => {
    for (let seed = 9001; seed <= 9100; seed++) {
      const g = generate(seed);
      const busts = g.events.filter((e) => e.type === 'bust' && !e.voided);
      if (busts.length < 2) continue;
      const first = busts[0]!;
      const events = [
        ...g.events,
        {
          id: g.events.length + 1,
          type: 'amend' as const,
          payload: { eventId: first.id, by: [] },
          at: new Date(g.nowMs + MIN).toISOString(),
          voided: false,
        },
      ];
      const before = replay(g.fmt, g.events, g.nowMs + MIN);
      const after = replay(g.fmt, events, g.nowMs + MIN);
      expect(after.errors.length, `seed ${seed}`).toBe(before.errors.length);
      expect(after.places).toEqual(before.places);
      expect(after.prizePoolRub).toBe(before.prizePoolRub);
      expect(sum(Object.values(kosOf(after)))).toBeLessThanOrEqual(
        sum(Object.values(kosOf(before))),
      );
    }
  });
});

// ---------- починка непринятой записи не должна задевать другие записи (ревью 08.10.2026) ----------

/** id принятых записей журнала, кроме перечисленных. */
const appliedIds = (
  format: TournamentFormat,
  events: readonly EveningEvent[],
  nowMs: number,
  skip: readonly number[],
) =>
  replayLog(format, events, nowMs)
    .applied.map((e) => e.id)
    .filter((id) => !skip.includes(id));

describe('правка, которая задела бы другие записи, — отказ', () => {
  it('починка вылета, после которого всё записано заново: вечер не ломается', () => {
    // Ребай K отменили — вылет «A, выбил K» стал «не принято». Дальше записано: B выбыл (выбил A),
    // A выбыл заново, «Игра окончена». Правка непринятого вылета A (by=[]) поставила бы вылет A на
    // его место: вылет B (выбил A), повторный вылет A и «Игра окончена» перестали бы приниматься.
    const j = journal().join('A', 'B', 'C', 'K');
    j.start();
    j.wait(5).bust('K', ['C']);
    const rebuyK = j.wait(1).rebuy('K');
    const bustA = j.wait(5).bust('A', ['K']);
    j.voidEvent(rebuyK);
    expect(replay(F, j.events, j.now()).errors.map((e) => e.eventId)).toEqual([bustA]);
    const bustB = j.wait(5).bust('B', ['A']);
    const bustA2 = j.wait(5).bust('A', ['C']);
    const finish = j.wait(1).finish();
    const before = replay(F, j.events, j.now());
    expect(before.finished).toBe(true);
    expect(before.places).toEqual(['C', 'A', 'B', 'K']);

    const payload = { eventId: bustA, by: [] };
    expect(canAmend(F, j.events, payload, j.now())).toBe(AMEND_IMPACT_ERROR);
    const impact = amendImpact(F, j.events, payload, j.now());
    expect(impact.revived).toEqual([]);
    expect(impact.rejected).toEqual([
      { eventId: bustB, message: 'Выбить может только игрок, который сейчас в игре' },
      { eventId: bustA2, message: 'Игрок уже выбыл' },
      { eventId: finish, message: 'Завершить можно, когда в игре остался один игрок' },
    ]);
    expect(impact.resultChanged).toBe(true);
    // Принятый вылет так же исправлять можно: другие записи правка не задевает.
    expect(canAmend(F, j.events, { eventId: bustB, by: [] }, j.now())).toBe(null);
    expect(hasAmendImpact(amendImpact(F, j.events, { eventId: bustB, by: [] }, j.now()))).toBe(
      false,
    );
  });

  it('повторно записанный вылет: деньги не переходят от одного игрока к другому', () => {
    // Второе устройство со старым состоянием записало «A выбыл, выбил B», когда B уже вылетел.
    // Банкир записал вылет A заново. Починка первой записи перенесла бы вылет A раньше вылета D —
    // места A и D поменялись бы, 500 ₽ ушли бы от A к D.
    const fmt: TournamentFormat = { ...F, payoutPct: [50, 30, 20] };
    const j = journal().join('A', 'B', 'C', 'D', 'E');
    j.start();
    j.wait(5).bust('B', ['C']);
    const staleA = j.wait(1).bust('A', ['B']);
    j.wait(5).bust('D', ['C']);
    const againA = j.wait(1).bust('A', ['C']);
    j.wait(5).bust('E', ['C']);
    j.wait(1).finish();
    const before = replay(fmt, j.events, j.now());
    expect(before.errors.map((e) => e.eventId)).toEqual([staleA]);
    expect(before.places).toEqual(['C', 'E', 'A', 'D', 'B']);

    const payload = { eventId: staleA, by: ['C'] };
    expect(canAmend(fmt, j.events, payload, j.now())).toBe(AMEND_IMPACT_ERROR);
    expect(amendImpact(fmt, j.events, payload, j.now()).rejected).toEqual([
      { eventId: againA, message: 'Игрок уже выбыл' },
    ]);
    // Совет из отказа: отменить непринятую запись — ничего, кроме неё, не меняется.
    j.voidEvent(staleA);
    const after = replay(fmt, j.events, j.now());
    expect(after.errors).toEqual([]);
    expect(after.places).toEqual(before.places);
    expect(computeMoney(fmt, after)).toEqual(computeMoney(fmt, before));
  });

  it('починка, которая оживила бы ребай вслед за вылетом, — тоже отказ', () => {
    // Вылет и ребай одним действием со старого устройства: вылет не принят (выбивший уже вне
    // игры), ребай — тоже (игрок ещё в игре). Починка вылета молча оживила бы ребай.
    const j = journal().join('A', 'B', 'C');
    j.start();
    j.wait(5).bust('C', ['A']);
    const bustB = j.wait(5).bust('B', ['C']);
    const rebuyB = j.rebuy('B');
    expect(replay(F, j.events, j.now()).errors.map((e) => e.eventId)).toEqual([bustB, rebuyB]);
    const payload = { eventId: bustB, by: ['A'] };
    expect(canAmend(F, j.events, payload, j.now())).toBe(AMEND_IMPACT_ERROR);
    expect(amendImpact(F, j.events, payload, j.now())).toEqual({
      revived: [rebuyB],
      rejected: [],
      resultChanged: false,
    });
  });

  it('починка, после которой ничего не записано, — можно', () => {
    const j = journal().join('A', 'B', 'C');
    j.start();
    j.wait(5).bust('C', ['A']);
    const bustB = j.wait(5).bust('B', ['C']);
    const payload = { eventId: bustB, by: ['A'] };
    expect(canAmend(F, j.events, payload, j.now())).toBe(null);
    expect(hasAmendImpact(amendImpact(F, j.events, payload, j.now()))).toBe(false);
  });
});

/**
 * Вечер со «вторым устройством со старым состоянием»: среди обычных записей — непринятые вылеты
 * (выбивший уже вне игры, вылет уже вылетевшего), иногда ребай вслед за непринятым вылетом и вылет,
 * записанный банкиром заново.
 */
function generateStale(seed: number) {
  const r = prng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
  const fmt: TournamentFormat = {
    ...F,
    buyInRub: pick([500, 333]),
    payoutPct: pick([[70, 30], [50, 30, 20], [100]]),
    levels: F.levels.map((l) => ({
      ...l,
      trigger: { type: 'time' as const, minutes: 5 + Math.floor(r() * 20) },
    })),
  };
  const n = 3 + Math.floor(r() * 4);
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  const j = journal();
  for (const id of ids) {
    if (r() < 0.3) j.joinRub(id, pick([300, 700]));
    else j.joinStacks(id, r() < 0.7 ? 1 : 2);
  }
  j.start();
  // Часть вечеров ещё идёт: починка непринятой записи возможна только там.
  const live = r() < 0.4;
  for (let guard = 0; guard < 300; guard++) {
    j.wait(r() * 10);
    if (live && r() < 0.08) break;
    const s = replay(fmt, j.events, j.now());
    const alive = s.joinOrder.filter((id) => s.players[id]?.alive);
    const dead = s.joinOrder.filter((id) => !s.players[id]?.alive);
    if (alive.length <= 1) {
      if (s.rebuysOpen && dead.length > 0 && r() < 0.5) {
        j.rebuy(pick(dead));
        continue;
      }
      j.finish();
      break;
    }
    const roll = r();
    if (roll < 0.15 && dead.length > 0) {
      const victim = pick(alive);
      j.bust(victim, [pick(dead)]); // не принят: выбивший уже вне игры
      if (live && r() < 0.3) break; // банкир ещё не заметил «Не принято»
      if (s.rebuysOpen && r() < 0.4) j.rebuy(victim); // не принят: игрок ещё в игре
      if (r() < 0.5) {
        j.wait(r());
        j.bust(victim, alive.filter((id) => id !== victim && r() < 0.5).slice(0, 1));
      }
      continue;
    }
    if (roll < 0.22 && dead.length > 0) {
      j.bust(pick(dead), []); // не принят: игрок уже выбыл
      continue;
    }
    const victim = pick(alive);
    j.bust(victim, alive.filter((id) => id !== victim && r() < 0.4).slice(0, 2));
    if (s.rebuysOpen && r() < 0.35) j.rebuy(victim);
  }
  return { fmt, events: j.events, nowMs: j.now(), ids, r, pick };
}

describe('сгенерированные вечера с непринятыми записями: правка задевает только себя', () => {
  it('600 вечеров: пропущенная canAmend правка не меняет приём других записей и итог', () => {
    const cov = { tried: 0, allowed: 0, repaired: 0, refusedImpact: 0, finished: 0 };
    for (let seed = 1; seed <= 600; seed++) {
      const { fmt, events, nowMs, ids, r, pick } = generateStale(seed);
      const label = `seed ${seed}`;
      const before = replayLog(fmt, events, nowMs);
      const appliedBefore = new Set(before.applied.map((e) => e.id));
      const targets = events.filter(
        (e) => !e.voided && (e.type === 'join' || e.type === 'rebuy' || e.type === 'bust'),
      );
      // Половина правок — к непринятым записям: «Не принято» в ленте и зовёт их исправить.
      const rejectedTargets = targets.filter((e) => !appliedBefore.has(e.id));
      for (let k = 0; k < 8; k++) {
        const t = rejectedTargets.length > 0 && r() < 0.5 ? pick(rejectedTargets) : pick(targets);
        const victim = (t.payload as { playerId: PlayerId }).playerId;
        // Выбившие — чаще из тех, кто был в игре перед записью (так правку предлагает шторка).
        const pre = replay(
          fmt,
          events.filter((e) => e.id < t.id),
          nowMs,
        );
        const pool = r() < 0.6 ? pre.joinOrder.filter((id) => pre.players[id]?.alive) : ids;
        const payload =
          t.type === 'bust'
            ? { eventId: t.id, by: pool.filter((id) => id !== victim && r() < 0.35).slice(0, 2) }
            : r() < 0.5
              ? { eventId: t.id, stacks: pick([1, 2, 3]) }
              : { eventId: t.id, rub: pick([300, 500, 700, 1000]) };
        cov.tried += 1;
        const problem = canAmend(fmt, events, payload, nowMs);
        const impact = amendImpact(fmt, events, payload, nowMs);
        // Правка принятой записи других записей не задевает никогда.
        if (appliedBefore.has(t.id)) expect(hasAmendImpact(impact), label).toBe(false);
        if (problem === AMEND_IMPACT_ERROR) {
          cov.refusedImpact += 1;
          expect(hasAmendImpact(impact), label).toBe(true);
          continue;
        }
        if (problem !== null) continue;
        cov.allowed += 1;
        if (!appliedBefore.has(t.id)) cov.repaired += 1;
        const amendId = events.length + 1;
        const next = [
          ...events,
          {
            id: amendId,
            type: 'amend' as const,
            payload,
            at: new Date(nowMs).toISOString(),
            voided: false,
          },
        ];
        const after = replayLog(fmt, next, nowMs);
        expect(
          after.state.errors.some((e) => e.eventId === amendId),
          label,
        ).toBe(false);
        expect(appliedIds(fmt, next, nowMs, [t.id, amendId]), label).toEqual(
          appliedIds(fmt, events, nowMs, [t.id]),
        );
        if (before.state.finished) {
          cov.finished += 1;
          expect(after.state.finished, label).toBe(true);
          expect(after.state.places, label).toEqual(before.state.places);
          const money = computeMoney(fmt, after.state);
          const owes = sum(Object.values(money).map((x) => x.owesRub));
          expect(sum(Object.values(money).map((x) => x.prizeRub)), label).toBe(owes);
          expect(after.state.prizePoolRub, label).toBe(owes);
          const date = '2026-10-09T12:00:00.000Z';
          expect(() => summarize('e', date, fmt, next, DEFAULT_SCORING), label).not.toThrow();
        }
      }
    }
    expect(cov.repaired).toBeGreaterThan(50);
    expect(cov.refusedImpact).toBeGreaterThan(200);
    expect(cov.finished).toBeGreaterThan(1000);
    expect(cov.allowed).toBeGreaterThan(1500);
  });
});
