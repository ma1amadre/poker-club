import { DEFAULT_FORMAT } from '@domain/format.ts';
import { computeMoney, paymentsFromEvents, settlement } from '@domain/money.ts';
import { replay, replayLog } from '@domain/replay.ts';
import { journal, MIN } from '@domain/test-utils.ts';
import type { TournamentFormat } from '@domain/types.ts';
import { describe, expect, it } from 'vitest';
import {
  averageStackBb,
  bestHunters,
  describeEvent,
  describeTrigger,
  eventPlayerId,
  feedEvents,
  formatBb,
  formatBbValue,
  lastBust,
  lastUndoable,
  levelLabel,
  normalizeGuestName,
  orderedPlayers,
  ordinalPlace,
  parseRub,
  paymentEvents,
  playerLine,
  rebuyText,
  rebuyWindow,
  seatCandidates,
  settleDirection,
  settleLabel,
  settleOrder,
  settleTotals,
  signedPayment,
  totalRebuys,
  triggerProgress,
} from './lib';
import { joinNames } from '../../shared/lib/text';

const names: Record<string, string> = { a: 'Женя', b: 'Саша', c: 'Дима', d: 'Лёша' };
const nameOf = (id: string) => names[id] ?? '?';
const rub = (n: number) => `${n} ₽`;

describe('joinNames', () => {
  it('склеивает с «и» перед последним', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['А'])).toBe('А');
    expect(joinNames(['А', 'Б'])).toBe('А и Б');
    expect(joinNames(['А', 'Б', 'В'])).toBe('А, Б и В');
  });
});

describe('describeEvent', () => {
  const ev = (type: Parameters<typeof describeEvent>[0]['type'], payload: object = {}) =>
    describeEvent(
      { id: 1, type, payload: payload as never, at: '2026-10-08T16:00:00Z', voided: false },
      nameOf,
      rub,
    );

  it('вылет: один, дележ, без выбившего', () => {
    expect(ev('bust', { playerId: 'b', by: ['a'] })).toEqual({
      kind: 'bust',
      title: 'Вылет: Саша',
      detail: 'выбивает Женя',
    });
    expect(ev('bust', { playerId: 'b', by: ['a', 'c'] }).detail).toBe(
      'выбивают Женя и Дима — голова пополам',
    );
    expect(ev('bust', { playerId: 'b', by: [] }).detail).toBe('кто выбил — не указано');
  });

  it('платёж: направление по знаку', () => {
    expect(ev('payment', { playerId: 'a', amountRub: 500 }).title).toBe('Женя → банкиру 500 ₽');
    expect(ev('payment', { playerId: 'a', amountRub: -300 }).title).toBe('Банкир → Женя 300 ₽');
  });

  it('вход и ребай', () => {
    expect(ev('join', { playerId: 'c' }).title).toBe('Вход: Дима');
    expect(ev('rebuy', { playerId: 'c' }).title).toBe('Ребай: Дима');
  });
});

describe('lastUndoable / feedEvents', () => {
  it('пропускает отменённые и платежи; лента — от новых к старым без платежей', () => {
    const j = journal().join('a', 'b');
    j.start();
    const bustId = j.bust('b', ['a']);
    j.payment('a', 500);
    const rebuyId = j.rebuy('b');
    j.voidEvent(rebuyId);
    expect(lastUndoable(j.events)?.id).toBe(bustId);
    const feed = feedEvents(j.events);
    expect(feed.map((e) => e.type)).toEqual(['rebuy', 'bust', 'timer_start', 'join', 'join']);
  });

  it('пустой журнал — null', () => {
    expect(lastUndoable([])).toBeNull();
  });
});

describe('orderedPlayers', () => {
  it('живые по входу, затем вылетевшие — свежий вылет выше', () => {
    const j = journal().join('a', 'b', 'c', 'd');
    j.start();
    j.bust('b', ['a']);
    j.bust('d', ['c']);
    const s = replay(DEFAULT_FORMAT, j.events, j.now());
    expect(orderedPlayers(s).map((p) => p.playerId)).toEqual(['a', 'c', 'd', 'b']);
  });

  it('после finish — по местам', () => {
    const j = journal().join('a', 'b', 'c');
    j.start();
    j.bust('b', ['a']);
    j.bust('a', ['c']);
    j.finish();
    const s = replay(DEFAULT_FORMAT, j.events, j.now());
    expect(orderedPlayers(s).map((p) => p.playerId)).toEqual(['c', 'a', 'b']);
  });
});

describe('averageStackBb / formatBb', () => {
  it('фишки в игре / живые / BB', () => {
    const j = journal().join('a', 'b', 'c', 'd');
    j.start();
    j.bust('d', ['a']);
    const s = replay(DEFAULT_FORMAT, j.events, j.now());
    // 4 входа × 500 = 2000 фишек на 3 живых при BB 10 → 66,7 BB
    expect(averageStackBb(s)).toBeCloseTo(2000 / 3 / 10);
    expect(formatBb(averageStackBb(s) ?? 0)).toBe('67 BB');
    expect(formatBb(12.34)).toBe('12,3 BB');
  });

  it('никого нет — null', () => {
    expect(averageStackBb(replay(DEFAULT_FORMAT, [], 0))).toBeNull();
  });
});

describe('rebuyWindow', () => {
  it('до старта — открыты до уровня из формата', () => {
    const s = replay(DEFAULT_FORMAT, journal().join('a').events, 0);
    expect(rebuyWindow(DEFAULT_FORMAT, s)).toEqual({ kind: 'not_started', untilLevel: 5 });
  });

  it('считает остаток до конца 5-го уровня по времени', () => {
    const j = journal().join('a', 'b');
    j.start();
    j.wait(50); // 2-й уровень, 10 минут прошло
    const s = replay(DEFAULT_FORMAT, j.events, j.now());
    // 30 мин 2-го + 40 × 3 (3–5-й) = 150 мин
    expect(rebuyWindow(DEFAULT_FORMAT, s)).toEqual({
      kind: 'open',
      untilLevel: 5,
      msLeft: 150 * MIN,
    });
  });

  it('после 5-го уровня — закрыты', () => {
    const j = journal().join('a', 'b');
    j.start();
    j.wait(201);
    const s = replay(DEFAULT_FORMAT, j.events, j.now());
    expect(rebuyWindow(DEFAULT_FORMAT, s)).toEqual({ kind: 'closed' });
  });

  it('уровни не по времени — срок неизвестен; ребаи на всю игру', () => {
    const hands: TournamentFormat = {
      ...DEFAULT_FORMAT,
      rebuyUntilLevel: 2,
      levels: DEFAULT_FORMAT.levels.map((l) => ({ ...l, trigger: { type: 'hands', count: 5 } })),
    };
    const j = journal().join('a', 'b');
    j.start();
    const s = replay(hands, j.events, j.now());
    expect(rebuyWindow(hands, s)).toEqual({ kind: 'open', untilLevel: 2, msLeft: null });
    expect(triggerProgress(s)).toEqual({ label: 'Раздач на уровне', done: 0, total: 5 });

    const forever = { ...DEFAULT_FORMAT, rebuyUntilLevel: DEFAULT_FORMAT.levels.length };
    expect(rebuyWindow(forever, replay(forever, j.events, j.now()))).toEqual({
      kind: 'whole_game',
    });
  });
});

describe('bestHunters / lastBust', () => {
  it('максимум нокаутов, при равенстве — все; последний нокаут из принятых', () => {
    const j = journal().join('a', 'b', 'c', 'd');
    j.start();
    j.bust('b', ['a']);
    j.bust('d', ['c', 'a']);
    const { state, applied } = replayLog(DEFAULT_FORMAT, j.events, j.now());
    expect(bestHunters(state)).toEqual(['a']);
    expect(lastBust(applied)).toMatchObject({ victim: 'd', by: ['c', 'a'] });
    expect(bestHunters(replay(DEFAULT_FORMAT, journal().join('a').events, 0))).toEqual([]);
  });
});

describe('расчёт', () => {
  it('знак платежа «полностью» обнуляет остаток', () => {
    const j = journal().join('a', 'b');
    j.start();
    j.bust('b', ['a']);
    j.finish();
    const s = replay(DEFAULT_FORMAT, j.events, j.now());
    const money = computeMoney(DEFAULT_FORMAT, s);
    const before = settlement(money, []);
    const pay = (id: string) => {
      const row = before[id];
      if (!row) throw new Error('нет строки');
      return { playerId: id, amountRub: signedPayment(row.remainingRub, settleDirection(row)) };
    };
    const after = settlement(money, [pay('a'), pay('b')]);
    expect(Object.values(after).every((r) => r.remainingRub === 0)).toBe(true);
    expect(settleLabel(before.b ?? { remainingRub: 0 }, rub)).toBe('Должен банкиру 260 ₽'); // 500 − 30 % от фонда 800
    expect(settleLabel(before.a ?? { remainingRub: 0 }, rub)).toMatch(/^Банкир должен /);
    expect(settleLabel({ remainingRub: 0 }, rub)).toBe('В расчёте');
  });

  it('parseRub', () => {
    expect(parseRub('1 500')).toBe(1500);
    expect(parseRub('500 ₽')).toBe(500);
    expect(parseRub('0')).toBeNull();
    expect(parseRub('-5')).toBeNull();
    expect(parseRub('12,5')).toBeNull();
    expect(parseRub('')).toBeNull();
  });
});

const NB = ' ';

describe('подписи уровня и игрока', () => {
  it('levelLabel не уходит за число уровней', () => {
    const j = journal().join('a', 'b');
    j.start();
    j.wait(40 * 12); // далеко за последним уровнем
    const s = replay(DEFAULT_FORMAT, j.events, j.now());
    expect(levelLabel(DEFAULT_FORMAT, s)).toBe('Уровень 8 из 8');
    expect(levelLabel(DEFAULT_FORMAT, replay(DEFAULT_FORMAT, [], 0))).toBe('Уровень 1 из 8');
  });

  it('playerLine: место, уровень вылета, входы, нокауты; живой без лишнего', () => {
    const j = journal().join('a', 'b', 'c');
    j.start();
    j.bust('b', ['a']);
    j.rebuy('b');
    j.bust('b', ['a']);
    j.bust('c', ['a']);
    j.finish();
    const s = replay(DEFAULT_FORMAT, j.events, j.now());
    const a = s.players.a;
    const b = s.players.b;
    if (!a || !b) throw new Error('нет игрока');
    expect(playerLine(a)).toBe(`3${NB}нокаута`);
    expect(playerLine(b)).toBe(`3-е место · вылет на${NB}1-м уровне · 2${NB}входа`);
    expect(ordinalPlace(2)).toBe('2-е');
  });

  it('describeTrigger и formatBbValue', () => {
    expect(describeTrigger({ sb: 5, bb: 10, trigger: { type: 'time', minutes: 40 } })).toBe(
      `40${NB}мин`,
    );
    expect(describeTrigger({ sb: 5, bb: 10, trigger: { type: 'hands', count: 5 } })).toBe(
      `5${NB}раздач`,
    );
    expect(describeTrigger({ sb: 5, bb: 10, trigger: { type: 'eliminations', count: 2 } })).toBe(
      `2${NB}вылета`,
    );
    expect(formatBbValue(66.66)).toBe('67');
    expect(formatBbValue(9.95)).toBe('10');
  });

  it('rebuyText по окну ребаев', () => {
    expect(rebuyText({ kind: 'closed' })).toBe('Ребаи и поздняя регистрация закрыты');
    expect(rebuyText({ kind: 'open', untilLevel: 5, msLeft: 80 * MIN })).toBe(
      `Ребаи открыты до конца 5-го уровня — ещё 1${NB}ч 20${NB}мин`,
    );
    expect(rebuyText({ kind: 'open', untilLevel: 5, msLeft: null })).toBe(
      'Ребаи открыты до конца 5-го уровня',
    );
  });
});

describe('seatCandidates / normalizeGuestName', () => {
  const p = (
    id: string,
    name: string,
    extra: Partial<{ is_active: boolean; is_guest: boolean }> = {},
  ) => ({
    id,
    display_name: name,
    is_active: true,
    is_guest: false,
    ...extra,
  });

  it('без уже вошедших и неактивных; «иду» сверху, гости после своих', () => {
    const state = replay(DEFAULT_FORMAT, journal().join('a').events, 0);
    const players = [
      p('a', 'Аня'),
      p('b', 'Борис'),
      p('c', 'Вова', { is_guest: true }),
      p('d', 'Глеб'),
      p('e', 'Дина', { is_active: false }),
      p('f', 'Ева'),
    ];
    const list = seatCandidates(players, state, [
      { player_id: 'f', status: 'yes' },
      { player_id: 'b', status: 'no' },
      { player_id: 'd', status: 'maybe' },
    ]);
    expect(list.map((c) => c.player.id)).toEqual(['f', 'd', 'c', 'b']);
    expect(list[0]?.rsvp).toBe('yes');
    expect(list[2]?.rsvp).toBeNull();
  });

  it('имя гостя: пробелы схлопываются, 1–40 символов', () => {
    expect(normalizeGuestName('  Петя   Гость ')).toBe('Петя Гость');
    expect(normalizeGuestName('   ')).toBeNull();
    expect(normalizeGuestName('я'.repeat(40))).toBe('я'.repeat(40));
    expect(normalizeGuestName('я'.repeat(41))).toBeNull();
  });
});

describe('раскладка расчёта', () => {
  it('порядок по местам, платёж «чужого» — в конце; итоги взносов, выплат и кассы банкира', () => {
    const j = journal().join('a', 'b', 'c');
    j.start();
    j.bust('c', ['a']);
    j.bust('b', ['a']);
    j.finish();
    j.payment('b', 500);
    j.payment('c', 500);
    const voided = j.payment('a', 100);
    j.voidEvent(voided);
    j.payment('x', 50); // ошибка ввода: игрока нет за столом
    const s = replay(DEFAULT_FORMAT, j.events, j.now());
    const money = computeMoney(DEFAULT_FORMAT, s);
    const table = settlement(money, paymentsFromEvents(j.events));
    expect(settleOrder(s, Object.keys(table))).toEqual(['a', 'b', 'c', 'x']);
    const totals = settleTotals(money, table);
    expect(totals.inRub).toBe(1500);
    expect(totals.outRub).toBe(1500); // инвариант домена: всё, что внесли, выплачено
    expect(totals.bankerHoldsRub).toBe(1050);
    expect(paymentEvents(j.events).map((e) => eventPlayerId(e))).toEqual(['x', 'a', 'c', 'b']);
  });

  it('totalRebuys', () => {
    const j = journal().join('a', 'b');
    j.start();
    j.bust('b', ['a']);
    j.rebuy('b');
    j.bust('b', ['a']);
    j.rebuy('b');
    expect(totalRebuys(replay(DEFAULT_FORMAT, j.events, j.now()))).toBe(2);
  });
});
