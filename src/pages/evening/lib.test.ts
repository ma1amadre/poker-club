import { DEFAULT_FORMAT } from '@domain/format.ts';
import { computeMoney, paymentsFromEvents, settlement } from '@domain/money.ts';
import { canApplySequence, replay, replayLog, type EventDraft } from '@domain/replay.ts';
import { journal, MIN } from '@domain/test-utils.ts';
import type { EveningEvent, TournamentFormat } from '@domain/types.ts';
import { describe, expect, it } from 'vitest';
import {
  averageStackBb,
  bestHunters,
  bustButtonLabel,
  bustRebuyDrafts,
  bustRebuyLabel,
  clockView,
  describeEvent,
  describeTrigger,
  entryPayload,
  eventPlayerId,
  feedEvents,
  formatBb,
  formatBbValue,
  initialKillers,
  killersHint,
  lastBust,
  lastUndoable,
  levelLabel,
  levelNextClosesRebuys,
  linkedPayment,
  mySeat,
  nameMatches,
  nameMatchKey,
  nameMatchNotice,
  normalizeGuestName,
  orderedPlayers,
  ordinalPlace,
  parsePayouts,
  parseRub,
  payoutTextSum,
  paymentEvents,
  playerLine,
  possibleKillers,
  prepaidHint,
  rebuyDrafts,
  rebuysClosingText,
  rebuyText,
  rejectedPart,
  rejectedToast,
  journalVersion,
  landedQuestion,
  levelEdgeLeftMs,
  levelMovedText,
  reopenedNotice,
  settledNotice,
  rebuyWindow,
  seatButtonLabel,
  seatCandidates,
  seatSpectator,
  seatDrafts,
  settleDirection,
  settleLabel,
  settleOrder,
  settleShareText,
  settleTotals,
  signedPayment,
  stacksAmountText,
  totalRebuys,
  triggerProgress,
  voidImpact,
  voidImpactText,
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
    // Денег за голову нет: при дележе нокаут засчитывается каждому.
    expect(ev('bust', { playerId: 'b', by: ['a', 'c'] }).detail).toBe(
      'выбивают Женя и Дима — нокаут каждому',
    );
    expect(ev('bust', { playerId: 'b', by: ['a', 'c', 'd'] }).detail).toBe(
      'выбивают Женя, Дима и Лёша — нокаут каждому',
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

  it('олл-ин: руки, улицы с картами, закрытие', () => {
    const hands = [
      { playerId: 'a', cards: ['As', 'Kd'] },
      { playerId: 'b', cards: ['Th', 'Tc'] },
    ];
    const sd = (board: string[]) => ({
      showdownId: '5d000000-0000-4000-8000-000000000001',
      hands,
      board,
    });
    expect(ev('showdown', sd([]))).toEqual({
      kind: 'showdown',
      title: 'Олл-ин: Женя и Саша',
      detail: 'Женя — A♠ K♦, Саша — 10♥ 10♣',
    });
    expect(ev('showdown', sd(['2c', '7d', '9h']))).toEqual({
      kind: 'showdown',
      title: 'Флоп: 2♣ 7♦ 9♥',
      detail: 'олл-ин: Женя и Саша',
    });
    expect(ev('showdown', sd(['2c', '7d', '9h', 'Jd'])).title).toBe('Тёрн: J♦');
    expect(ev('showdown', sd(['2c', '7d', '9h', 'Jd', 'Ah'])).title).toBe('Ривер: A♥');
    expect(ev('showdown_close', { showdownId: '5d000000-0000-4000-8000-000000000001' })).toEqual({
      kind: 'showdown',
      title: 'Олл-ин закрыт',
      detail: null,
    });
    // Кривая раздача (журнал её не примет) — подпись без подробностей.
    expect(ev('showdown', { showdownId: 'x' })).toEqual({
      kind: 'showdown',
      title: 'Олл-ин',
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
    expect(settleLabel(before.b ?? { remainingRub: 0 }, rub)).toBe('Должен банкиру 200 ₽'); // 500 − 30 % от фонда 1000
    expect(settleLabel(before.a ?? { remainingRub: 0 }, rub)).toMatch(/^Банкир должен /);
    expect(settleLabel({ remainingRub: 0 }, rub)).toBe('В расчёте');
  });

  it('расчёт текстом для чата: кто банкиру, кому банкир, кто в расчёте; строки банкира нет', () => {
    // 4 игрока по 500 ₽, фонд 2 000 → 1 400 / 600. Женя (a) выигрывает, Саша (b) второй.
    const j = journal().join('a', 'b', 'c', 'd');
    j.start();
    j.bust('d', ['a']);
    j.bust('c', ['a']);
    j.bust('b', ['a']);
    j.finish();
    j.payment('c', 500);
    const s = replay(DEFAULT_FORMAT, j.events, j.now());
    const table = settlement(computeMoney(DEFAULT_FORMAT, s), paymentsFromEvents(j.events));
    const ids = settleOrder(s, Object.keys(table));
    const text = settleShareText({
      dateLabel: '9 октября',
      bankerId: 'b',
      ids,
      table,
      nameOf,
      formatRub: rub,
    });
    expect(text).toBe(
      [
        'Расчёт за вечер 9 октября · банкир — Саша',
        'Лёша → банкиру: 500 ₽',
        'Банкир → Женя: 900 ₽',
        'В расчёте: Дима',
      ].join('\n'),
    );
    // Без банкира — без подписи; всё закрыто — «Все в расчёте».
    expect(
      settleShareText({
        dateLabel: '9 октября',
        bankerId: null,
        ids: ['a', 'b'],
        table: { a: { remainingRub: 0 }, b: { remainingRub: 0 } },
        nameOf,
        formatRub: rub,
      }),
    ).toBe('Расчёт за вечер 9 октября\nВсе в расчёте');
    // Сумма строк текста — те же остатки, что в settlement (без строки банкира).
    const owed = Object.entries(table)
      .filter(([id]) => id !== 'b')
      .reduce((sum, [, row]) => sum + Math.abs(row.remainingRub), 0);
    const inText = [...text.matchAll(/: (\d+) ₽/g)].reduce((sum, m) => sum + Number(m[1]), 0);
    expect(inText).toBe(owed);
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

  it('кратность: сумма и фишки, payload', () => {
    expect(stacksAmountText(DEFAULT_FORMAT, 1)).toBe(`500${NB}₽ · 500${NB}фишек`);
    expect(stacksAmountText(DEFAULT_FORMAT, 2)).toBe(`1${NB}000${NB}₽ · 1${NB}000${NB}фишек`);
    expect(stacksAmountText({ ...DEFAULT_FORMAT, startingChips: 1 }, 1)).toBe(
      `500${NB}₽ · 1${NB}фишка`,
    );
    expect(entryPayload('a', 1)).toEqual({ playerId: 'a' });
    expect(entryPayload('a', 4)).toEqual({ playerId: 'a', stacks: 4 });
  });

  it('seatButtonLabel: при ×k сумма видна на кнопке до записи', () => {
    expect(seatButtonLabel(0, DEFAULT_FORMAT, 2)).toBe('Выбери, кого посадить');
    // Стандартный вход — подпись как раньше.
    expect(seatButtonLabel(6, DEFAULT_FORMAT, 1)).toBe('Посадить за стол: 6');
    expect(seatButtonLabel(6, DEFAULT_FORMAT, 2)).toBe(`Посадить: 6 · по${NB}1${NB}000${NB}₽`);
    expect(seatButtonLabel(1, DEFAULT_FORMAT, 3)).toBe(`Посадить: 1 · 1${NB}500${NB}₽`);
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
    extra: Partial<{ is_active: boolean; is_guest: boolean; is_spectator: boolean | null }> = {},
  ) => ({
    id,
    display_name: name,
    is_active: true,
    is_guest: false,
    is_spectator: null as boolean | null,
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

  it('болельщик (миграция 024): посадить можно, но после игроков своей группы и до гостей', () => {
    const state = replay(DEFAULT_FORMAT, journal().join('a').events, 0);
    const players = [
      p('b', 'Борис'),
      p('c', 'Вова', { is_guest: true }),
      p('s', 'Аня', { is_spectator: true }),
      p('t', 'Алла', { is_spectator: true }),
      p('d', 'Глеб'),
    ];
    const list = seatCandidates(players, state, [{ player_id: 't', status: 'yes' }]);
    // Алла сказала «иду» — на этот вечер игрок и сверху; Аня — болельщик среди молчащих.
    expect(list.map((c) => c.player.id)).toEqual(['t', 'b', 'd', 's', 'c']);
    expect(list.map(seatSpectator)).toEqual([false, false, false, true, false]);
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
    expect(totals.outRub).toBe(1500); // инвариант домена: всё, что внесли, выплачено призовыми
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

describe('шторка вылета: кто выбил', () => {
  it('выбить может любой в игре, кроме самого игрока; хедз-ап — соперник отмечен заранее', () => {
    const j = journal().join('a', 'b', 'c');
    j.start();
    let s = replay(DEFAULT_FORMAT, j.events, j.now());
    expect(possibleKillers(s, 'b')).toEqual(['a', 'c']);
    expect(initialKillers(s, 'b')).toEqual([]);

    j.bust('c', ['a']);
    s = replay(DEFAULT_FORMAT, j.events, j.now());
    expect(possibleKillers(s, 'b')).toEqual(['a']);
    expect(initialKillers(s, 'b')).toEqual(['a']);
    expect(initialKillers(s, 'a')).toEqual(['b']);
  });

  it('подсказка: двое и больше — выбили вместе, нокаут каждому; без денег', () => {
    expect(killersHint([], false)).toBe(
      'Отметь, кто выбил. Выбили вместе — отметь каждого, нокаут засчитается всем.',
    );
    expect(killersHint(['Женя'], false)).toBe(
      'Нокаут засчитается: Женя. Выбили вместе — отметь и остальных.',
    );
    expect(killersHint(['Женя', 'Дима'], false)).toBe(
      'Выбивают вместе Женя и Дима — нокаут засчитается каждому.',
    );
    expect(killersHint([], true)).toBe('Нокаут никому не засчитается.');
    for (const hint of [killersHint(['Женя', 'Дима'], false), killersHint([], true)]) {
      expect(hint).not.toMatch(/₽|голов|деньг/);
    }
  });

  it('кнопка: пока не ясно, кто выбил, — что сделать', () => {
    expect(bustButtonLabel(0, false)).toBe('Выбери, кто выбил');
    expect(bustButtonLabel(0, true)).toBe('Отметить вылет');
    expect(bustButtonLabel(2, false)).toBe('Отметить вылет');
  });
});

describe('voidImpact / voidImpactText', () => {
  const label = (e: EveningEvent) => `«${describeEvent(e, nameOf, rub, DEFAULT_FORMAT).title}»`;

  it('отмена старого вылета: ребай после него перестаёт приниматься — это видно до отмены', () => {
    const j = journal().join('a', 'b', 'c');
    j.start();
    j.wait(5);
    const bust = j.bust('b', ['a']);
    j.wait(1);
    const rebuy = j.rebuy('b');
    j.wait(1);
    j.bust('c', ['a']);
    const impact = voidImpact(DEFAULT_FORMAT, j.events, bust, j.now());
    expect(impact.voided?.id).toBe(bust);
    expect(impact.revived).toEqual([]);
    expect(impact.rejected.map((r) => [r.event.id, r.message])).toEqual([
      [rebuy, 'Игрок ещё в игре — ребай только после вылета'],
    ]);
    expect(voidImpactText(impact, label)).toBe(
      'Журнал перестанет принимать запись: «Ребай: Саша» (игрок ещё в игре — ребай только после вылета). Она останется в ленте с пометкой «Не принято», места, нокауты и деньги посчитаются без неё.',
    );
  });

  it('отмена вылета финалиста в завершённом вечере — прямо: придётся вернуть в игру', () => {
    const j = journal().join('a', 'b', 'c');
    j.start();
    j.bust('c', ['a']);
    const last = j.bust('b', ['a']);
    const finish = j.finish();
    const impact = voidImpact(DEFAULT_FORMAT, j.events, last, j.now());
    expect(impact.finishedBefore).toBe(true);
    expect(impact.finishedAfter).toBe(false);
    expect(impact.rejected.map((r) => r.event.id)).toEqual([finish]);
    const text = voidImpactText(impact, label);
    expect(text).toContain('Вечер перестанет быть завершённым — придётся вернуть его в игру');
    // «Игра окончена» отдельной строкой «не принято» не дублируется.
    expect(text).not.toContain('Журнал перестанет принимать');
  });

  it('отмена самой «Игра окончена» — без фразы о завершённом вечере (её пишет вызывающий)', () => {
    const j = journal().join('a', 'b');
    j.start();
    j.bust('b', ['a']);
    const finish = j.finish();
    const impact = voidImpact(DEFAULT_FORMAT, j.events, finish, j.now());
    expect(impact.finishedAfter).toBe(false);
    expect(voidImpactText(impact, label)).toBe('');
  });

  it('оживающая запись и отмена без последствий', () => {
    const j = journal().join('a', 'b', 'c');
    j.start();
    const first = j.bust('b', ['a']);
    const second = j.bust('b', ['c']); // журнал не принял: игрок уже выбыл
    const impact = voidImpact(DEFAULT_FORMAT, j.events, first, j.now());
    expect(impact.revived.map((e) => e.id)).toEqual([second]);
    expect(impact.rejected).toEqual([]);
    expect(voidImpactText(impact, label)).toBe(
      'После отмены вступит в силу запись, которую журнал сейчас не принимает: «Вылет: Саша». Если она тоже лишняя — отмени и её.',
    );

    const k = journal().join('a', 'b', 'c');
    k.start();
    const bust = k.bust('b', ['a']);
    const quiet = voidImpact(DEFAULT_FORMAT, k.events, bust, k.now());
    expect(quiet).toMatchObject({
      revived: [],
      rejected: [],
      finishedBefore: false,
      finishedAfter: false,
    });
    expect(voidImpactText(quiet, label)).toBe('');
  });
});

describe('levelNextClosesRebuys / rebuysClosingText', () => {
  const closes = (format: TournamentFormat, events: EveningEvent[], now: number) =>
    levelNextClosesRebuys(format, replay(format, events, now));

  it('переход с 5-го уровня на 6-й закрывает ребаи; кто из вылетевших не сможет докупиться', () => {
    const j = journal().join('a', 'b', 'c', 'd');
    expect(closes(DEFAULT_FORMAT, j.events, j.now())).toBe(null); // таймер не запущен
    j.start();
    for (let i = 0; i < 3; i += 1) j.next(); // 4-й уровень: переход на 5-й ребаи не закрывает
    j.bust('b', ['a']);
    j.bust('d', ['a']);
    expect(closes(DEFAULT_FORMAT, j.events, j.now())).toBe(null);
    j.next(); // 5-й уровень
    expect(closes(DEFAULT_FORMAT, j.events, j.now())).toEqual({ busted: ['b', 'd'] });

    // Лимит ребаев исчерпан — докупиться и так нельзя.
    const limited = { ...DEFAULT_FORMAT, rebuyLimit: 0 };
    expect(closes(limited, j.events, j.now())).toEqual({ busted: [] });

    j.next(); // 6-й: ребаи уже закрыты
    expect(closes(DEFAULT_FORMAT, j.events, j.now())).toBe(null);
  });

  it('с последнего уровня перехода нет', () => {
    const forever = { ...DEFAULT_FORMAT, rebuyUntilLevel: DEFAULT_FORMAT.levels.length };
    const j = journal().join('a', 'b');
    j.start();
    for (let i = 1; i < DEFAULT_FORMAT.levels.length; i += 1) j.next();
    expect(closes(forever, j.events, j.now())).toBe(null);
  });

  it('текст без рода', () => {
    expect(rebuysClosingText([])).toBe(
      'Ребаи и поздняя регистрация закроются: докупиться и сесть за стол будет нельзя.',
    );
    expect(rebuysClosingText(['Саша'])).toBe(
      'Ребаи закроются — Саша не сможет докупиться. Поздняя регистрация тоже закроется.',
    );
    expect(rebuysClosingText(['Саша', 'Дима'])).toBe(
      'Ребаи закроются — вылетевшие Саша и Дима не смогут докупиться. Поздняя регистрация тоже закроется.',
    );
  });
});

describe('levelEdgeLeftMs / levelMovedText — вопрос «Уровень вперёд» висел, а уровень сменился', () => {
  const EDGE = 5000;

  it('до авто-перехода меньше края — сколько осталось; пауза и не начатый таймер — null', () => {
    const j = journal().join('a', 'b');
    expect(levelEdgeLeftMs(replay(DEFAULT_FORMAT, j.events, j.now()), EDGE)).toBe(null);
    j.start();
    j.wait(39);
    expect(levelEdgeLeftMs(replay(DEFAULT_FORMAT, j.events, j.now()), EDGE)).toBe(null); // 60 с
    j.wait(58 / 60);
    expect(levelEdgeLeftMs(replay(DEFAULT_FORMAT, j.events, j.now()), EDGE)).toBe(2000);
    j.pause();
    expect(levelEdgeLeftMs(replay(DEFAULT_FORMAT, j.events, j.now()), EDGE)).toBe(null);
  });

  it('уровень по раздачам времени не считает — края нет', () => {
    const byHands: TournamentFormat = {
      ...DEFAULT_FORMAT,
      levels: [
        { sb: 5, bb: 10, trigger: { type: 'hands', count: 3 } },
        { sb: 10, bb: 20, trigger: { type: 'hands', count: 3 } },
      ],
    };
    const j = journal().join('a', 'b');
    j.start();
    expect(levelEdgeLeftMs(replay(byHands, j.events, j.now()), EDGE)).toBe(null);
  });

  it('сценарий ревью: вопрос о закрытии ребаев висел 25 с, уровень сменился сам — запись не уходит', () => {
    const j = journal().join('a', 'b', 'c');
    j.start();
    for (let i = 0; i < 4; i += 1) j.next(); // 5-й уровень — последний с ребаями
    j.bust('b', ['a']);
    j.wait(40 - 20 / 60); // до конца 5-го уровня 20 с: вопрос «Перейти на 6-й?» открыт
    const before = replay(DEFAULT_FORMAT, j.events, j.now());
    expect(before.timer.levelIndex).toBe(4);
    expect(levelEdgeLeftMs(before, EDGE)).toBe(null); // 20 с — не край, спрашивают о ребаях
    expect(levelNextClosesRebuys(DEFAULT_FORMAT, before)).toEqual({ busted: ['b'] });
    expect(levelMovedText(4, before)).toBe(null);

    j.wait(25 / 60); // банкир читает список вылетевших — уровень сменился сам
    const after = replay(DEFAULT_FORMAT, j.events, j.now());
    expect(after.timer.levelIndex).toBe(5);
    expect(levelMovedText(4, after)).toBe('Уровень уже сменился — сейчас 6-й');

    // Без проверки запись ушла бы — и replay перескочил бы на 7-й уровень, 6-й пропущен.
    j.next();
    expect(replay(DEFAULT_FORMAT, j.events, j.now()).timer.levelIndex).toBe(6);
  });

  it('уровень назад с другого устройства — тоже отказ', () => {
    const j = journal().join('a', 'b');
    j.start();
    j.next();
    j.next();
    j.prev();
    expect(levelMovedText(2, replay(DEFAULT_FORMAT, j.events, j.now()))).toBe(
      'Уровень уже сменился — сейчас 2-й',
    );
  });
});

describe('landedQuestion — повтор записи, которая дошла без ответа', () => {
  it('говорит, что повторять не нужно, и даёт записать ещё одну', () => {
    const q = landedQuestion('«Раздача сыграна», 20:15');
    expect(q).toEqual({
      title: 'Запись уже в журнале',
      message:
        '«Раздача сыграна», 20:15 — прошлое нажатие дошло до сервера, хотя ответа не было. Повторять не нужно. Ещё одна запись нужна, только если это новое действие, например следующая раздача.',
      confirmText: 'Записать ещё одну',
      cancelText: 'Не записывать',
    });
  });
});

describe('nameMatches / nameMatchNotice — подсказка под полем «Гость»', () => {
  const pl = (id: string, display_name: string, is_guest = true, is_active = true) => ({
    id,
    display_name,
    is_guest,
    is_active,
  });
  const players = [
    pl('g1', 'Вова (гость)'),
    pl('g2', 'Петя'),
    pl('g3', 'Петя'),
    pl('p1', 'Алёна', false),
    pl('off', 'Костя', true, false),
    pl('a', 'Женя', false),
  ];
  const s = replay(DEFAULT_FORMAT, journal().join('a').events, 0);

  it('сравнение: регистр, ё/е, пробелы и пометка в скобках не важны', () => {
    expect(nameMatchKey('  вова ')).toBe('вова');
    expect(nameMatchKey('Вова (гость)')).toBe('вова');
    expect(nameMatchKey('АЛЕНА')).toBe(nameMatchKey('Алёна'));
    expect(nameMatchKey('   ')).toBe('');
  });

  it('один гость с таким именем — посадить его одной кнопкой', () => {
    const notice = nameMatchNotice(nameMatches(players, s, 'вова'));
    expect(notice).toEqual({
      title: 'Такой гость уже есть: Вова (гость)',
      text: 'Тот же человек — посади этого гостя, и вечера останутся в одном профиле. Другой человек с тем же именем — нажми «Добавить гостя».',
      seat: { label: 'Посадить этого гостя', playerId: 'g1' },
    });
  });

  it('игрок клуба с таким именем — посадить из клуба, а не гостем', () => {
    const notice = nameMatchNotice(nameMatches(players, s, 'Алена'));
    expect(notice?.title).toBe('Такой игрок клуба уже есть: Алёна');
    expect(notice?.seat).toEqual({ label: 'Посадить этого игрока', playerId: 'p1' });
  });

  it('несколько — выбрать в списке; уже в турнире — сказать; неактивных и пустое — не трогать', () => {
    expect(nameMatchNotice(nameMatches(players, s, 'петя'))).toEqual({
      title: 'В клубе несколько: Петя',
      text: 'Отметь нужного в списке выше. Другой человек с тем же именем — нажми «Добавить гостя».',
      seat: null,
    });
    expect(nameMatchNotice(nameMatches(players, s, 'Женя'))).toEqual({
      title: 'Женя уже в этом вечере',
      text: 'Другой человек с тем же именем — нажми «Добавить гостя».',
      seat: null,
    });
    expect(nameMatchNotice(nameMatches(players, s, 'Костя'))).toBe(null);
    expect(nameMatchNotice(nameMatches(players, s, 'Новенький'))).toBe(null);
    expect(nameMatchNotice(nameMatches(players, s, ''))).toBe(null);
  });
});

describe('одно действие — несколько записей: черновики пульта', () => {
  const F = DEFAULT_FORMAT;

  it('посадка: вход каждого, с «Оплачено сразу» — его платёж следом на сумму взноса', () => {
    expect(seatDrafts(F, ['a', 'b'], 1, false)).toEqual([
      { type: 'join', payload: { playerId: 'a' } },
      { type: 'join', payload: { playerId: 'b' } },
    ]);
    expect(seatDrafts(F, ['a', 'b'], 2, true)).toEqual([
      { type: 'join', payload: { playerId: 'a', stacks: 2 } },
      { type: 'payment', payload: { playerId: 'a', amountRub: 1000 } },
      { type: 'join', payload: { playerId: 'b', stacks: 2 } },
      { type: 'payment', payload: { playerId: 'b', amountRub: 1000 } },
    ]);
  });

  it('ребай и «вылет и ребай»: оплата — на сумму ребая, не входа', () => {
    expect(rebuyDrafts(F, 'c', 1, false)).toEqual([{ type: 'rebuy', payload: { playerId: 'c' } }]);
    expect(rebuyDrafts(F, 'c', 3, true)).toEqual([
      { type: 'rebuy', payload: { playerId: 'c', stacks: 3 } },
      { type: 'payment', payload: { playerId: 'c', amountRub: 1500 } },
    ]);
    expect(bustRebuyDrafts(F, { playerId: 'c', by: ['a', 'b'] }, 2, true)).toEqual([
      { type: 'bust', payload: { playerId: 'c', by: ['a', 'b'] } },
      { type: 'rebuy', payload: { playerId: 'c', stacks: 2 } },
      { type: 'payment', payload: { playerId: 'c', amountRub: 1000 } },
    ]);
  });

  it('черновики проходят доменную проверку цепочкой и дают ожидаемый расчёт', () => {
    const j = journal().join('a', 'b', 'c');
    j.start();
    j.wait(5);
    const drafts = bustRebuyDrafts(F, { playerId: 'c', by: ['a'] }, 2, true);
    expect(canApplySequence(F, j.events, drafts, j.now())).toBeNull();
    for (const d of drafts) j.add(d.type, d.payload);
    const s = replay(F, j.events, j.now());
    const t = settlement(computeMoney(F, s), paymentsFromEvents(j.events));
    expect(s.players.c).toMatchObject({ alive: true, stacks: 3 });
    // Ребай ×2 оплачен сразу: остаётся только первый вход.
    expect(t.c).toMatchObject({ dueRub: 1500, paidRub: 1000, remainingRub: 500 });
  });

  it('подписи: кратность на кнопке — только у крупного ребая; подсказка оплаты', () => {
    expect(bustRebuyLabel(1)).toBe('Вылет и ребай');
    expect(bustRebuyLabel(3)).toBe('Вылет и ребай ×3');
    expect(prepaidHint(F, 'rebuy', 2)).toBe(
      'Вместе с ребаем запишется платёж банкиру — 1\u00a0000\u00a0₽. В расчёте это обычный платёж.',
    );
    expect(prepaidHint(F, 'entry', 1, true)).toBe(
      'Вместе со входом каждого запишется его платёж банкиру — по\u00a0500\u00a0₽. В расчёте это обычный платёж.',
    );
  });
});

describe('linkedPayment: оплата, записанная вместе со входом', () => {
  const F = DEFAULT_FORMAT;
  type Rec = EveningEvent & { createdBy: string | null };
  const rec = (
    id: number,
    type: EveningEvent['type'],
    payload: object,
    at = '2026-10-08T16:00:00.000Z',
    createdBy: string | null = 'bank',
  ): Rec => ({ id, type, payload: payload as never, at, voided: false, createdBy });

  it('тот же игрок, та же сумма, то же время и автор — это оплата входа', () => {
    const join = rec(1, 'join', { playerId: 'a', stacks: 2 });
    const pay = rec(2, 'payment', { playerId: 'a', amountRub: 1000 });
    expect(linkedPayment([join, pay], join, F)?.id).toBe(2);
    const rebuy = rec(3, 'rebuy', { playerId: 'b' }, '2026-10-08T17:00:00.000Z');
    const payB = rec(4, 'payment', { playerId: 'b', amountRub: 500 }, '2026-10-08T17:00:00.000Z');
    expect(linkedPayment([join, pay, rebuy, payB], rebuy, F)?.id).toBe(4);
  });

  it('другое время, сумма, игрок, автор или отменённый платёж — не оплата входа', () => {
    const join = rec(1, 'join', { playerId: 'a' });
    const cases: Rec[] = [
      rec(2, 'payment', { playerId: 'a', amountRub: 500 }, '2026-10-08T16:00:01.000Z'),
      rec(2, 'payment', { playerId: 'a', amountRub: 1000 }),
      rec(2, 'payment', { playerId: 'b', amountRub: 500 }),
      rec(2, 'payment', { playerId: 'a', amountRub: 500 }, undefined, 'admin'),
      { ...rec(2, 'payment', { playerId: 'a', amountRub: 500 }), voided: true },
    ];
    for (const pay of cases) expect(linkedPayment([join, pay], join, F)).toBeNull();
    const bust = rec(3, 'bust', { playerId: 'a', by: [] });
    expect(
      linkedPayment([bust, rec(4, 'payment', { playerId: 'a', amountRub: 500 })], bust, F),
    ).toBeNull();
  });

  it('посадка нескольких: у каждого входа — свой платёж', () => {
    const drafts = seatDrafts(F, ['a', 'b'], 1, true);
    const recs = drafts.map((d, i) => rec(i + 1, d.type, d.payload));
    expect(linkedPayment(recs, recs[0] as Rec, F)?.id).toBe(2);
    expect(linkedPayment(recs, recs[2] as Rec, F)?.id).toBe(4);
  });
});

describe('voidImpact: отмена действия целиком', () => {
  it('вылет и ребай одной отменой — ни оживших, ни «не принято»; по отдельности вылет задел бы ребай', () => {
    const j = journal().join('a', 'b', 'c');
    j.start();
    const bust = j.bust('c', ['a']);
    const rebuy = j.rebuy('c');
    const pay = j.payment('c', 500);
    const alone = voidImpact(DEFAULT_FORMAT, j.events, bust, j.now());
    expect(alone.rejected.map((r) => r.event.id)).toEqual([rebuy]);
    const all = voidImpact(DEFAULT_FORMAT, j.events, [rebuy, pay, bust], j.now());
    expect(all.voided?.id).toBe(rebuy);
    expect(all).toMatchObject({
      revived: [],
      rejected: [],
      finishedBefore: false,
      finishedAfter: false,
    });
  });
});

describe('rejectedPart / rejectedToast: записано, но журнал принял не всё', () => {
  const F = DEFAULT_FORMAT;
  /** Ребаи клубного формата закрываются с концом 5-го уровня: 5 × 40 мин от старта часов. */
  const CLOSE_MIN = 5 * 40;
  /** Записи одного действия — одна транзакция, одно серверное время. */
  const addAll = (j: ReturnType<typeof journal>, drafts: readonly EventDraft[]) =>
    drafts.map((d) => j.events[j.add(d.type, d.payload) - 1] as EveningEvent);
  const errorsOf = (j: ReturnType<typeof journal>) => replay(F, j.events, j.now()).errors;
  const plain = (text: string) => text.replace(/ /g, ' ');

  it('«Вылет и ребай» на полсекунды позже закрытия: отменяется ребай с оплатой, вылет остаётся', () => {
    const j = journal().join('a', 'b', 'c');
    j.start();
    // Клиент проверил цепочку за полсекунды до закрытия — она проходила.
    j.wait(CLOSE_MIN - 0.5 / 60);
    const drafts = bustRebuyDrafts(F, { playerId: 'a', by: ['b'] }, 1, true);
    expect(canApplySequence(F, j.events, drafts, j.now())).toBeNull();
    // А на сервер записи пришли через 0,3 с после закрытия.
    j.wait(0.8 / 60);
    const recs = addAll(j, drafts);
    const [bust, rebuy, pay] = recs;

    const part = rejectedPart(F, recs, errorsOf(j));
    expect(part?.rejected.map((r) => [r.event.id, r.message])).toEqual([
      [rebuy?.id, 'Ребаи закрыты'],
    ]);
    expect(part?.toVoid.map((e) => e.id)).toEqual([rebuy?.id, pay?.id]);
    expect(part?.kept.map((e) => e.id)).toEqual([bust?.id]);

    // Кнопка тоста отменяет только toVoid: без вопросов (никого не задевает), вылет и нокаут целы,
    // платёж за непринятый ребай снят.
    const ids = part?.toVoid.map((e) => e.id) ?? [];
    expect(voidImpact(F, j.events, ids, j.now())).toMatchObject({ revived: [], rejected: [] });
    for (const id of ids) j.voidEvent(id);
    const s = replay(F, j.events, j.now());
    expect(s.players.a).toMatchObject({ alive: false, rebuys: 0 });
    expect(s.players.b?.kos).toBe(1);
    expect(paymentsFromEvents(j.events)).toEqual([]);

    const toast = rejectedToast(part as NonNullable<typeof part>, '19:20');
    expect(toast.title).toBe('Ребай не принят: Ребаи закрыты');
    expect(toast.actionLabel).toBe('Отменить ребай');
    expect(plain(toast.detail)).toBe(
      'Вылет записан. Ребай пришёл на сервер в 19:20 и помечен в ленте «Не принято». «Отменить ребай» снимет и оплату — деньги верни игроку.',
    );
  });

  it('без оплаты: кнопка снимает только ребай', () => {
    const j = journal().join('a', 'b');
    j.start();
    j.wait(CLOSE_MIN + 0.3 / 60);
    const recs = addAll(j, bustRebuyDrafts(F, { playerId: 'a', by: [] }, 2, false));
    const part = rejectedPart(F, recs, errorsOf(j));
    expect(part?.toVoid.map((e) => e.type)).toEqual(['rebuy']);
    expect(part?.kept.map((e) => e.type)).toEqual(['bust']);
    const toast = rejectedToast(part as NonNullable<typeof part>, '19:20');
    expect(toast.detail).toBe(
      'Вылет записан. Ребай пришёл на сервер в 19:20 и помечен в ленте «Не принято». Если он лишний — отмени его.',
    );
  });

  it('посадка нескольких: непринятый вход — со своей оплатой, остальные входы остаются', () => {
    const j = journal().join('a');
    // «a» уже за столом (второе устройство), «b» садится впервые.
    const recs = addAll(j, seatDrafts(F, ['a', 'b'], 1, true));
    const part = rejectedPart(F, recs, errorsOf(j));
    expect(part?.rejected).toHaveLength(1);
    expect(part?.toVoid.map((e) => [e.type, e.payload])).toEqual([
      ['join', { playerId: 'a' }],
      ['payment', { playerId: 'a', amountRub: 500 }],
    ]);
    expect(part?.kept.map((e) => [e.type, e.payload])).toEqual([
      ['join', { playerId: 'b' }],
      ['payment', { playerId: 'b', amountRub: 500 }],
    ]);
    const toast = rejectedToast(part as NonNullable<typeof part>, '18:05');
    expect(toast.actionLabel).toBe('Отменить вход');
    expect(toast.detail).toBe(
      'Остальное записано. Вход пришёл на сервер в 18:05 и помечен в ленте «Не принято». «Отменить вход» снимет и оплату — деньги верни игроку.',
    );
  });

  it('не принято ничего, кроме оплаты: отменяется всё действие', () => {
    const j = journal().join('a', 'b');
    j.start();
    j.bust('a');
    j.wait(CLOSE_MIN + 1);
    const recs = addAll(j, rebuyDrafts(F, 'a', 1, true));
    const part = rejectedPart(F, recs, errorsOf(j));
    expect(part?.toVoid).toHaveLength(2);
    expect(part?.kept).toEqual([]);
    const toast = rejectedToast(part as NonNullable<typeof part>, '19:21');
    expect(toast.detail).toBe(
      'Ребай пришёл на сервер в 19:21 и помечен в ленте «Не принято». «Отменить ребай» снимет и оплату — деньги верни игроку.',
    );
  });

  it('несколько непринятых и одиночная запись без своего слова', () => {
    const j = journal().join('a', 'b');
    const many = addAll(j, seatDrafts(F, ['a', 'b'], 1, false));
    const part = rejectedPart(F, many, errorsOf(j));
    const toast = rejectedToast(part as NonNullable<typeof part>, '18:05');
    expect(toast.actionLabel).toBe('Отменить записи');
    expect(toast.detail).toBe(
      'Непринятые записи пришли на сервер в 18:05 и помечены в ленте «Не принято». Если они лишние — отмени их.',
    );

    const k = journal().join('a', 'b');
    const one = rejectedPart(F, addAll(k, [{ type: 'level_next', payload: {} }]), errorsOf(k));
    const single = rejectedToast(one as NonNullable<typeof one>, '20:00');
    expect(single.title).toBe('Переход уровня не принят: Таймер не запущен');
    expect(single.actionLabel).toBe('Отменить запись');
    expect(single.detail).toBe(
      'Запись пришла на сервер в 20:00 и помечена в ленте «Не принято». Если она лишняя — отмени её.',
    );
  });

  it('принято всё — null', () => {
    const j = journal().join('a', 'b');
    j.start();
    const recs = addAll(j, bustRebuyDrafts(F, { playerId: 'a', by: ['b'] }, 1, true));
    expect(rejectedPart(F, recs, errorsOf(j))).toBeNull();
  });
});

describe('mySeat: «Ты за столом»', () => {
  const F = DEFAULT_FORMAT;
  // Неразрывные пробелы (в числах и перед единицами) в ожиданиях — обычные: так читается тест.
  const plain = <T extends object | null>(v: T): T =>
    v && (JSON.parse(JSON.stringify(v).replace(/\u00a0/g, ' ')) as T);
  const seat = (j: ReturnType<typeof journal>, id: string) => {
    const { state, applied } = replayLog(F, j.events, j.now());
    return plain(mySeat(F, state, applied, paymentsFromEvents(j.events), id));
  };

  it('в игре: входы, взнос, нокауты и долг банкиру', () => {
    const j = journal().join('a', 'b', 'c');
    j.start();
    j.wait(10).bust('c', ['a']);
    expect(seat(j, 'a')).toEqual({
      alive: true,
      place: null,
      rebuyNote: null,
      entries: '1 вход · взнос 500 ₽',
      kos: '1 нокаут',
      balance: 'Твой долг банкиру — 500 ₽',
      paid: null,
      balanceTone: 'owe',
    });
    expect(seat(j, 'zzz')).toBeNull();
  });

  it('вылетевший при открытых ребаях: сколько ещё можно докупиться; кратные входы и оплата', () => {
    const j = journal();
    j.joinStacks('a', 2);
    j.join('b', 'c');
    j.payment('a', 1000);
    j.start();
    j.wait(10).bust('a', ['b']);
    j.rebuy('a');
    j.wait(10).bust('a', ['c']);
    const me = seat(j, 'a');
    expect(me).toMatchObject({
      alive: false,
      place: null,
      // Ребаи до конца 5-го уровня по 40 мин: прошло 20 мин — ещё 3 ч.
      rebuyNote: 'Можно докупиться — ещё 3 ч',
      entries: '2 входа: ×2, ×1 · взнос 1 500 ₽',
      kos: 'Нокаутов пока нет',
      balance: 'Твой долг банкиру — 500 ₽',
      paid: 'оплачено 1 000 ₽',
    });
  });

  it('ребаи закрыты или лимит исчерпан — докупиться нельзя; место уже известно', () => {
    const j = journal().join('a', 'b', 'c');
    j.start();
    j.wait(5 * 40 + 1).bust('c', ['a']);
    expect(seat(j, 'c')).toMatchObject({ place: '3-е место', rebuyNote: null });

    const k = journal().join('a', 'b', 'c');
    k.start();
    k.bust('c', ['a']);
    k.rebuy('c');
    k.bust('c', ['a']);
    const { state, applied } = replayLog({ ...F, rebuyLimit: 1 }, k.events, k.now());
    expect(mySeat({ ...F, rebuyLimit: 1 }, state, applied, [], 'c')?.rebuyNote).toBeNull();
  });

  it('переплата — банкир должен; ровно — в расчёте', () => {
    const j = journal().join('a', 'b');
    j.payment('a', 500);
    j.payment('b', 700);
    j.start();
    expect(seat(j, 'a')).toMatchObject({ balance: 'С банкиром в расчёте', balanceTone: 'none' });
    expect(seat(j, 'b')).toMatchObject({
      balance: 'Банкир должен тебе 200 ₽',
      balanceTone: 'await',
    });
  });
});
