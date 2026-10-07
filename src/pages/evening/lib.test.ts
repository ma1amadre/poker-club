import { DEFAULT_FORMAT } from '@domain/format.ts';
import { computeMoney, paymentsFromEvents, settlement } from '@domain/money.ts';
import { replay, replayLog } from '@domain/replay.ts';
import { journal, MIN } from '@domain/test-utils.ts';
import type { TournamentFormat } from '@domain/types.ts';
import { describe, expect, it } from 'vitest';
import {
  averageStackBb,
  bestHunters,
  clockView,
  describeEvent,
  describeTrigger,
  entryPayload,
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
  parsePayouts,
  parseRub,
  payoutTextSum,
  paymentEvents,
  playerLine,
  rebuyText,
  journalVersion,
  reopenedNotice,
  settledNotice,
  rebuyWindow,
  seatCandidates,
  settleDirection,
  settleLabel,
  settleOrder,
  settleTotals,
  signedPayment,
  stacksAmountText,
  stacksHint,
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
      DEFAULT_FORMAT,
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
    expect(ev('bust', { playerId: 'b', by: ['a', 'c', 'd'] }).detail).toBe(
      'выбивают Женя, Дима и Лёша — голова поровну на 3',
    );
    expect(ev('bust', { playerId: 'b', by: [] }).detail).toBe('кто выбил — не указано');
  });

  it('платёж: направление по знаку', () => {
    expect(ev('payment', { playerId: 'a', amountRub: 500 }).title).toBe('Женя → банкиру 500 ₽');
    expect(ev('payment', { playerId: 'a', amountRub: -300 }).title).toBe('Банкир → Женя 300 ₽');
  });

  it('вход и ребай', () => {
    expect(ev('join', { playerId: 'c' })).toEqual({
      kind: 'entry',
      title: 'Вход: Дима',
      detail: null,
    });
    expect(ev('rebuy', { playerId: 'c' })).toEqual({
      kind: 'entry',
      title: 'Ребай: Дима',
      detail: null,
    });
  });

  it('вход и ребай кратно стандартному — с суммой; ×1 явно — как стандартный', () => {
    expect(ev('join', { playerId: 'c', stacks: 2 }).detail).toBe('вход на 1000 ₽');
    expect(ev('rebuy', { playerId: 'c', stacks: 3 }).detail).toBe('ребай на 1500 ₽');
    expect(ev('join', { playerId: 'c', stacks: 1 }).detail).toBeNull();
    // Кривая кратность: журнал её не примет — подписи суммы нет.
    expect(ev('join', { playerId: 'c', stacks: 0 }).detail).toBeNull();
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
    // Точка — не мусор: «500.00» раньше превращалось в 50 000 ₽.
    expect(parseRub('500.00')).toBeNull();
    expect(parseRub('1500.5')).toBeNull();
    expect(parseRub('5.0')).toBeNull();
    expect(parseRub('1.500')).toBeNull();
    expect(parseRub('500 руб.')).toBe(500);
    expect(parseRub('500 руб')).toBe(500);
    expect(parseRub('500₽')).toBe(500);
    expect(parseRub('500 р.')).toBe(500);
    expect(parseRub('1 500 ₽')).toBe(1500);
    expect(parseRub('р500')).toBeNull();
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
    expect(playerLine(a, DEFAULT_FORMAT)).toBe(`3${NB}нокаута`);
    expect(playerLine(b, DEFAULT_FORMAT)).toBe(`3-е место · вылет на${NB}1-м уровне · 2${NB}входа`);
    expect(ordinalPlace(2)).toBe('2-е');
  });

  it('playerLine: при кратном входе или ребае — сколько всего внесено', () => {
    const j = journal();
    j.joinStacks('a', 2);
    j.join('b', 'c');
    j.bust('b', ['a']);
    j.rebuy('b', 3);
    j.bust('c', ['b']);
    j.rebuy('c');
    const s = replay(DEFAULT_FORMAT, j.events, j.now());
    const [a, b, c] = ['a', 'b', 'c'].map((id) => s.players[id]);
    if (!a || !b || !c) throw new Error('нет игрока');
    expect(playerLine(a, DEFAULT_FORMAT)).toBe(`взнос 1${NB}000${NB}₽ · 1${NB}нокаут`);
    expect(playerLine(b, DEFAULT_FORMAT)).toBe(
      `2${NB}входа · взнос 2${NB}000${NB}₽ · 1${NB}нокаут`,
    );
    // Только стандартные входы — суммы нет, как раньше.
    expect(playerLine(c, DEFAULT_FORMAT)).toBe(`2${NB}входа`);
  });

  it('кратность: сумма и фишки, подсказка, payload', () => {
    expect(stacksAmountText(DEFAULT_FORMAT, 1)).toBe(`500${NB}₽ · 500${NB}фишек`);
    expect(stacksAmountText(DEFAULT_FORMAT, 2)).toBe(`1${NB}000${NB}₽ · 1${NB}000${NB}фишек`);
    expect(stacksAmountText({ ...DEFAULT_FORMAT, startingChips: 1 }, 1)).toBe(
      `500${NB}₽ · 1${NB}фишка`,
    );
    expect(stacksHint(DEFAULT_FORMAT, 2)).toBe(`Голова — 200${NB}₽, в фонд — 800${NB}₽.`);
    expect(stacksHint({ ...DEFAULT_FORMAT, bountyRub: 0 }, 3)).toBe(
      `Всё в фонд — 1${NB}500${NB}₽.`,
    );
    expect(entryPayload('a', 1)).toEqual({ playerId: 'a' });
    expect(entryPayload('a', 4)).toEqual({ playerId: 'a', stacks: 4 });
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

describe('clockView', () => {
  it('до старта — прочерки', () => {
    const j = journal().join('a', 'b');
    expect(clockView(replay(DEFAULT_FORMAT, j.events, j.now())).text).toBe('--:--');
  });

  it('обычный уровень — обратный отсчёт', () => {
    const j = journal().join('a', 'b');
    j.start();
    j.wait(10);
    const v = clockView(replay(DEFAULT_FORMAT, j.events, j.now()));
    expect(v.text).toBe('30:00');
    expect(v.note).toBeNull();
    expect(v.aria).toMatch(/^До конца уровня/);
  });

  it('последний уровень — не «00:00», а сколько он идёт', () => {
    // 8 уровней по 40 мин: последний начинается на 280-й минуте; на 400-й он идёт 120 мин.
    const j = journal().join('a', 'b');
    j.start();
    j.wait(400);
    const state = replay(DEFAULT_FORMAT, j.events, j.now());
    expect(state.nextLevel).toBeNull();
    const v = clockView(state);
    expect(v.text).toBe('120:00');
    expect(v.note).toBe('Последний уровень — блайнды больше не растут');
    expect(v.aria).toMatch(/^Последний уровень идёт/);
  });
});

describe('parsePayouts', () => {
  it('принимает доли с суммой 100, в том числе с запятой', () => {
    expect(parsePayouts(['50', '30', '20'])).toEqual({ ok: true, pct: [50, 30, 20] });
    expect(parsePayouts(['33,3', '33,3', '33.4'])).toEqual({ ok: true, pct: [33.3, 33.3, 33.4] });
    expect(parsePayouts(['100'])).toEqual({ ok: true, pct: [100] });
  });

  it('как validateFormat и set_payout: доли > 0, сумма 100, 1–10 мест', () => {
    expect(parsePayouts(['60', '30']).ok).toBe(false);
    expect(parsePayouts(['100', '0']).ok).toBe(false);
    expect(parsePayouts(['70', 'тридцать']).ok).toBe(false);
    expect(parsePayouts([]).ok).toBe(false);
    expect(parsePayouts(Array.from({ length: 11 }, () => '1')).ok).toBe(false);
  });

  it('сумма для подсказки', () => {
    expect(payoutTextSum(['33,3', '33,3', '33,4'])).toBe(100);
    expect(payoutTextSum(['50', '30'])).toBe(80);
    expect(payoutTextSum(['50', ''])).toBeNull();
  });
});

describe('reopenedNotice', () => {
  const at = '2026-10-06T12:00:00Z';
  const plain = (text: string | undefined) => text?.replace(/ /g, ' ');

  it('только у вечера «Игра окончена» с меткой «открылся сам»', () => {
    expect(reopenedNotice({ status: 'finished', settle_reopened_at: null }, true, true)).toBeNull();
    expect(reopenedNotice({ status: 'settled', settle_reopened_at: at }, true, true)).toBeNull();
    expect(reopenedNotice({ status: 'live', settle_reopened_at: at }, true, true)).toBeNull();
  });

  it('банкиру и админу — закрыть заново, игроку вечера — проверить долг', () => {
    const mine = reopenedNotice({ status: 'finished', settle_reopened_at: at }, true, false);
    expect(mine?.title).toBe('Расчёт снова открыт');
    expect(plain(mine?.text)).toBe(
      'Журнал изменился после закрытия расчёта — проверь остатки и закрой его заново.',
    );
    expect(
      reopenedNotice({ status: 'finished', settle_reopened_at: at }, false, true)?.text,
    ).toMatch(/сколько осталось перевести/);
  });

  it('тому, кто в вечере не играл, переводить нечего — без «проверь»', () => {
    const text = reopenedNotice({ status: 'finished', settle_reopened_at: at }, false, false)?.text;
    expect(plain(text)).toBe(
      'Журнал изменился после закрытия расчёта — банкир сверит остатки и закроет его заново.',
    );
  });
});

describe('settledNotice', () => {
  it('остатки нулевые — баланс сошёлся, с датой закрытия', () => {
    const n = settledNotice(true, true, '6 октября в 21:00');
    expect(n.tone).toBe('positive');
    expect(n.title).toBe('Расчёт закрыт');
    expect(n.text.replace(/ /g, ' ')).toBe('Баланс банкира сошёлся в ноль — 6 октября в 21:00.');
    expect(settledNotice(true, false, null).text).toBe('Баланс банкира сошёлся в ноль.');
  });

  it('закрыт с ненулевыми остатками — предупреждение, а не «сошёлся»', () => {
    const control = settledNotice(false, true, '6 октября в 21:00');
    expect(control.tone).toBe('caution');
    expect(control.text).not.toMatch(/сошёлся/);
    expect(control.text).toMatch(/проверь остатки ниже и открой расчёт заново/);
    expect(settledNotice(false, false, null).text).toMatch(/проверь остатки ниже\.$/);
  });
});

describe('journalVersion', () => {
  it('последний id и число отменённых записей', () => {
    expect(journalVersion([])).toEqual({ lastEventId: 0, voidedCount: 0 });
    expect(
      journalVersion([
        { id: 5, voided: false },
        { id: 12, voided: true },
        { id: 9, voided: true },
      ]),
    ).toEqual({ lastEventId: 12, voidedCount: 2 });
  });
});
