// Бомб-пот на экранах вечера (миграция 030): розыгрыш взноса (общая с табло партитура), что
// показать на месте числа, полоса, шторка, «Кто забрал» и тосты. Кто играет, взнос и баттон —
// домен (bombPot.test.ts); здесь — тексты и время показа по его состоянию.
import { BOMB_REVEAL_MS } from '@domain/bombPot.ts';
import { DEFAULT_FORMAT } from '@domain/format.ts';
import { replay } from '@domain/replay.ts';
import { journal, type Journal } from '@domain/test-utils.ts';
import type { BombPotState } from '@domain/types.ts';
import { describe, expect, it } from 'vitest';
import {
  bombAnnounceToast,
  bombCloseToast,
  bombIntentKey,
  bombMarkedText,
  bombPositionsText,
  bombPotBar,
  bombSheetView,
  bombSplitSuggestion,
  bombStakeText,
  bombWinnerChoices,
  boardOnlineFrom,
  firstToActNow,
  myBombText,
  PHONE_ROLL_LEAD_MS,
  phoneBombView,
  rollFace,
  rollInterval,
  rollPlan,
  splitButtonLabel,
} from './bombPotView';
import { stateAfter } from './seating';

const F = DEFAULT_FORMAT;
const NAMES: Record<string, string> = { a: 'Петя', b: 'Лёня', c: 'Саша', d: 'Ваня', e: 'Женя' };
const nameOf = (id: string) => NAMES[id] ?? id;
/** Неразрывные пробелы → обычные: ожидания читаются как текст. */
const sp = (text: string | null | undefined) => (text == null ? null : text.replace(/[  ]/g, ' '));
const at = (j: Journal) => replay(F, j.events, j.now());

/** Петя на 1, Лёня на 3 (баттон), Саша на 5 (SB), Ваня на 8 (BB); таймер идёт, уровень 1 (BB 10). */
function table(): Journal {
  const j = journal();
  j.join('a', 'b', 'c', 'd');
  j.seat('a', 1);
  j.seat('b', 3);
  j.seat('c', 5);
  j.seat('d', 8);
  j.button(3);
  j.start();
  j.wait(1);
  return j;
}

function openBomb(j: Journal, bbs = 3, prev?: number[]): BombPotState {
  j.bombPot(bbs, prev);
  const bp = at(j).bombPot;
  if (!bp) throw new Error('бомб-пот не открыт');
  return bp;
}

describe('розыгрыш: одна партитура у табло и телефонов', () => {
  it('два круга 1…5 и посадка на выпавшем — листы только вперёд', () => {
    for (let k = 1; k <= 5; k += 1) {
      const plan = rollPlan(k);
      expect(plan.flips).toBe(10 + k);
      expect(plan.values.slice(0, 10)).toEqual([1, 2, 3, 4, 5, 1, 2, 3, 4, 5]);
      expect(plan.values.at(-1)).toBe(k);
      expect(plan.hit).toBeLessThan(plan.end);
    }
  });

  it('темп исход не выдаёт: до остановки кадр при любом исходе одинаковый', () => {
    const one = rollPlan(1);
    const five = rollPlan(5);
    // Первые 10 листов (два круга) идут в одно время с одной длительностью.
    expect(five.starts.slice(0, 10)).toEqual(one.starts.slice(0, 10));
    expect(five.durations.slice(0, 10)).toEqual(one.durations.slice(0, 10));
  });

  it('интервалы растут без потолка — торможение непрерывное (замечание судей к v2)', () => {
    for (let i = 1; i < 15; i += 1) expect(rollInterval(i)).toBeGreaterThan(rollInterval(i - 1));
    expect(rollInterval(0)).toBe(80);
    expect(rollInterval(13)).toBeGreaterThan(420);
  });

  it('последний лист — самый медленный, посадка тяжёлая (вторая фаза ×1,5)', () => {
    const plan = rollPlan(3);
    const last = plan.durations.at(-1) ?? 0;
    expect(last).toBeGreaterThanOrEqual(Math.max(...plan.durations.slice(0, -1)));
    const fall = Math.round(last / 2);
    expect(plan.end - (plan.starts.at(-1) ?? 0)).toBe(fall + Math.round((last - fall) * 1.5));
  });

  it('знак в окне меняется на середине листа; до первого — пусто, после посадки — выпавшее', () => {
    const plan = rollPlan(4);
    expect(rollFace(plan, -1)).toBeNull();
    expect(rollFace(plan, 39)).toBeNull();
    expect(rollFace(plan, 40)).toBe(1);
    expect(rollFace(plan, plan.end + 1000)).toBe(4);
  });

  it('вне 1..5 — как 1 (бросок сервера таким не бывает)', () => {
    expect(rollPlan(0).flips).toBe(11);
    expect(rollPlan(7).flips).toBe(11);
  });
});

describe('число на телефонах (решение 10)', () => {
  const bp = { at: '2026-10-08T16:00:00.000Z', bbs: 3 };
  const t0 = Date.parse(bp.at);

  it('табло на связи — «смотри на табло» до at + 9 с, потом взнос', () => {
    expect(phoneBombView(bp, t0 + 1000, true).phase).toBe('hidden');
    expect(phoneBombView(bp, t0 + BOMB_REVEAL_MS - 1, true).phase).toBe('hidden');
    expect(phoneBombView(bp, t0 + BOMB_REVEAL_MS, true)).toEqual({
      phase: 'shown',
      face: 3,
      revealAtMs: t0 + BOMB_REVEAL_MS,
    });
  });

  it('связь с табло неизвестна (отметка грузится) — ждём, как с табло', () => {
    expect(phoneBombView(bp, t0 + 2000, null).phase).toBe('hidden');
  });

  it('табло не на связи — телефон разыгрывает сам той же партитурой и встаёт на выпавшем', () => {
    const plan = rollPlan(3);
    const mid = phoneBombView(bp, t0 + PHONE_ROLL_LEAD_MS + 100, false);
    expect(mid.phase).toBe('rolling');
    expect(mid.face).toBe(rollFace(plan, 100));
    expect(mid.revealAtMs).toBe(t0 + PHONE_ROLL_LEAD_MS + plan.end);
    expect(phoneBombView(bp, t0 + PHONE_ROLL_LEAD_MS + plan.end, false).phase).toBe('shown');
  });

  it('спокойный режим — без перебора, число сразу', () => {
    expect(phoneBombView(bp, t0 + 100, false, true)).toMatchObject({ phase: 'shown', face: 3 });
  });

  it('черновик (bbs 0) — кубик ещё не брошен: числа нет', () => {
    expect(phoneBombView({ ...bp, bbs: 0 }, t0 + 60_000, false).phase).toBe('hidden');
  });
});

describe('табло на связи по отметке board_presence', () => {
  const now = Date.parse('2026-10-08T16:10:00.000Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const read = (seenAt: string | null) => ({ missing: false, seenAt, current: true });

  it('отметка свежее минуты — на связи, старше или её нет — нет', () => {
    expect(boardOnlineFrom(read(ago(8_000)), now)).toBe(true);
    expect(boardOnlineFrom(read(ago(60_000)), now)).toBe(true);
    expect(boardOnlineFrom(read(ago(61_000)), now)).toBe(false);
    expect(boardOnlineFrom(read(null), now)).toBe(false);
  });

  it('ответа нет (грузится или упал) — не известно', () => {
    expect(boardOnlineFrom({ missing: true, seenAt: null, current: false }, now)).toBeNull();
    expect(boardOnlineFrom({ ...read(ago(5_000)), missing: true }, now)).toBeNull();
  });

  // Живая проверка 26.10.2026: второй бомб-пот через пару минут после первого — в кеше ответ
  // прошлого окна чтения (отметка в нём старше минуты), свежий запрос в пути. Раньше это было
  // «табло не на связи», и телефон при работающем табло начинал свой розыгрыш.
  it('ответ из прошлого окна чтения — не известно, пока не придёт свежий', () => {
    const stale = { ...read(ago(125_000)), current: false };
    expect(boardOnlineFrom(stale, now)).toBeNull();
    const thrown = { at: ago(1_000), bbs: 3 };
    expect(phoneBombView(thrown, now, boardOnlineFrom(stale, now)).phase).toBe('hidden');
    // Свежий ответ пришёл: табло на связи — «смотри на табло», не на связи — розыгрыш на телефоне.
    expect(boardOnlineFrom(read(ago(4_000)), now)).toBe(true);
    expect(phoneBombView(thrown, now, boardOnlineFrom(read(ago(4_000)), now)).phase).toBe('hidden');
    expect(boardOnlineFrom(read(ago(125_000)), now)).toBe(false);
    expect(phoneBombView(thrown, now, boardOnlineFrom(read(ago(125_000)), now)).phase).toBe(
      'rolling',
    );
  });
});

describe('полоса бомб-пота', () => {
  it('до показа — «смотри на табло» и вилка; после — взнос, банк, первое слово', () => {
    const j = table();
    const bp = openBomb(j);
    const state = at(j);
    const t0 = Date.parse(bp.at);
    const hidden = bombPotBar(bp, state, phoneBombView(bp, t0, true), nameOf);
    expect(hidden.eyebrow).toBe('Бомб-пот');
    expect(hidden.main).toBe('Кубик брошен — смотри на табло');
    expect(sp(hidden.detail)).toBe('Взнос от 10 до 50 · в игре 4');
    const shown = bombPotBar(bp, state, phoneBombView(bp, t0 + BOMB_REVEAL_MS, true), nameOf);
    expect(sp(shown.main)).toBe('3 BB — по 30');
    expect(sp(shown.detail)).toBe('Банк 120 · в игре 4 · первое слово — Саша');
    expect(shown.reroll).toBeNull();
  });

  it('переброс — пометка и отменённый бросок', () => {
    const j = table();
    const bp = openBomb(j, 2, [5]);
    const bar = bombPotBar(bp, at(j), phoneBombView(bp, j.now() + BOMB_REVEAL_MS, true), nameOf);
    expect(sp(bar.eyebrow)).toBe('Бомб-пот · переброс');
    expect(sp(bar.reroll)).toBe('переброс — отменён бросок 5 BB');
  });

  it('первое слово вылетело — следующий участник в игре по часовой', () => {
    const j = table();
    const bp = openBomb(j);
    j.bust('c', ['d']);
    expect(firstToActNow(bp, at(j))).toBe('d');
  });

  it('своя строка: первое слово и взнос — только после показа числа; не участник — ничего', () => {
    const j = table();
    const bp = openBomb(j);
    const state = at(j);
    expect(myBombText(bp, state, 'c', false)).toBe('У тебя первое слово');
    expect(sp(myBombText(bp, state, 'c', true))).toBe('У тебя первое слово · твой взнос — 30');
    expect(sp(myBombText(bp, state, 'a', true))).toBe('Твой взнос — 30');
    expect(myBombText(bp, state, 'a', false)).toBeNull();
    expect(myBombText(bp, state, 'z', true)).toBeNull();
    expect(sp(bombStakeText(bp))).toBe('3 BB — по 30');
  });

  it('позиции в бомб-поте — без блайндов: баттон остаётся, SB и BB нет', () => {
    const j = table();
    openBomb(j);
    expect(sp(bombPositionsText(at(j), nameOf))).toBe('Баттон — Лёня · блайндов нет');
  });
});

describe('шторка «Бомб-пот»', () => {
  it('эта раздача: баттон и первое слово, вилка по BB уровня, кто платит', () => {
    const j = table();
    const v = bombSheetView(at(j), nameOf);
    expect(sp(v.positions)).toBe('Баттон — Лёня · первое слово — Саша');
    expect(sp(v.range)).toBe('BB 10 — взнос от 10 до 50');
    expect(v.players).toBe('Платят все в игре: 4');
  });

  it('следующая раздача — по состоянию после записи раздачи: баттон уже у Саши', () => {
    const j = table();
    const next = stateAfter(F, j.events, [{ type: 'hand', payload: {} }], j.now());
    expect(sp(bombSheetView(next, nameOf).positions)).toBe('Баттон — Саша · первое слово — Ваня');
  });

  it('без баттона — первое слово решает стол', () => {
    const j = journal();
    j.join('a', 'b');
    j.start();
    expect(bombSheetView(at(j), nameOf).positions).toBe(
      'Баттон не задан — кто говорит первым, решает стол.',
    );
  });

  it('ключ повтора — по последней принятой раздаче: «hand-<id>», раздач нет — «hand-0»', () => {
    const j = table();
    expect(bombIntentKey([])).toBe('hand-0');
    const h1 = j.hand();
    const h2 = j.wait(1).hand();
    const applied = j.events.map((e) => ({ id: e.id, type: e.type }));
    expect(bombIntentKey(applied)).toBe(`hand-${h2}`);
    expect(bombIntentKey(applied.filter((e) => e.id !== h2))).toBe(`hand-${h1}`);
  });

  it('тост объявления: табло на связи — «смотри на табло», нет — взнос разыграют экраны', () => {
    expect(bombAnnounceToast(true).detail).toBe('Кубик брошен — смотри на табло.');
    expect(bombAnnounceToast(null).detail).toBe('Кубик брошен — смотри на табло.');
    expect(bombAnnounceToast(false).detail).toBe(
      'Табло не на связи — взнос разыграют экраны вечера.',
    );
  });
});

describe('«Кто забрал бомб-пот»', () => {
  it('участники в игре по часовой от первого слова; вылетевший — нет', () => {
    const j = table();
    openBomb(j);
    j.bust('a', ['b']);
    expect(bombWinnerChoices(at(j))).toEqual([
      { playerId: 'c', main: false },
      { playerId: 'd', main: false },
      { playerId: 'b', main: false },
    ]);
  });

  it('олл-ин в бомб-поте доигран до ривера — победитель главной кнопкой', () => {
    const j = table();
    openBomb(j);
    j.showdown(
      '5d000000-0000-4000-8000-0000000000b1',
      [
        ['c', 'As', 'Ah'],
        ['d', 'Ks', 'Kh'],
      ],
      ['2c', '7d', '9h', 'Js', '3c'],
    );
    const choices = bombWinnerChoices(at(j));
    expect(choices.find((c) => c.playerId === 'c')?.main).toBe(true);
    expect(choices.filter((c) => c.main)).toHaveLength(1);
    expect(bombSplitSuggestion(at(j))).toEqual([]);
    // Ответ на «Фишек хватило?» («Вылет» — вылет и закрытие раздачи олл-ина) открывает ряд — и
    // подсветка остаётся.
    j.bust('d', ['c']);
    j.closeShowdown('5d000000-0000-4000-8000-0000000000b1');
    expect(at(j).showdown).toBeNull();
    const after = bombWinnerChoices(at(j));
    expect(after.filter((c) => c.main).map((c) => c.playerId)).toEqual(['c']);
  });

  it('равные руки на ривере — делёж подсказан', () => {
    const j = table();
    openBomb(j);
    j.showdown(
      '5d000000-0000-4000-8000-0000000000b1',
      [
        ['c', 'As', 'Kh'],
        ['d', 'Ad', 'Kc'],
      ],
      ['2c', '7d', '9h', 'Js', '3c'],
    );
    expect(bombSplitSuggestion(at(j)).sort()).toEqual(['c', 'd']);
  });

  it('тост: забирает один — баттон остаётся, блайнды следующей раздачи', () => {
    const j = table();
    const bp = openBomb(j);
    const before = at(j);
    const after = stateAfter(
      F,
      j.events,
      [
        { type: 'bomb_pot_result', payload: { eventId: bp.eventId, winners: ['d'] } },
        { type: 'hand', payload: {} },
      ],
      j.now(),
    );
    const toast = bombCloseToast(before, after, ['d'], nameOf);
    expect(toast.title).toBe('Бомб-пот забирает Ваня');
    expect(sp(toast.detail)).toBe('Баттон остаётся: Лёня · SB Саша 5 · BB Ваня 10');
  });

  it('тост: делёж и «Не отмечать»', () => {
    const j = table();
    openBomb(j);
    const before = at(j);
    const after = stateAfter(F, j.events, [{ type: 'hand', payload: {} }], j.now());
    expect(bombCloseToast(before, after, ['c', 'd'], nameOf).title).toBe(
      'Бомб-пот делят Саша и Ваня',
    );
    expect(bombCloseToast(before, after, [], nameOf).title).toBe('Бомб-пот сыгран');
  });

  it('тост: игрок на баттоне вылетел — баттон ушёл к следующему, как у «Следующей раздачи»', () => {
    const j = table();
    openBomb(j);
    j.bust('b', ['c']);
    const before = at(j);
    const after = stateAfter(F, j.events, [{ type: 'hand', payload: {} }], j.now());
    // Баттон ушёл с вылетевшего Лёни к Саше: «остаётся» не пишется.
    expect(sp(bombCloseToast(before, after, [], nameOf).detail)).toBe(
      'Баттон — Саша · SB Ваня 5 · BB Петя 10',
    );
  });

  it('тост: без баттона — без строки позиций', () => {
    const j = journal();
    j.join('a', 'b');
    j.start();
    openBomb(j);
    const before = at(j);
    const after = stateAfter(F, j.events, [{ type: 'hand', payload: {} }], j.now());
    expect(bombCloseToast(before, after, ['a'], nameOf)).toEqual({
      title: 'Бомб-пот забирает Петя',
      detail: null,
    });
  });

  it('отметка уже есть (раздачу после неё отменили) — ряд называет отмеченных', () => {
    expect(bombMarkedText(['Саша'])).toBe('Отмечено: бомб-пот забирает Саша');
    expect(sp(bombMarkedText(['Саша', 'Петя']))).toBe('Отмечено: бомб-пот делят Саша и Петя');
  });

  it('кнопка дележа: выбери двоих — потом «Записать делёж · 2 игрока»', () => {
    expect(splitButtonLabel(1)).toBe('Делёж — выбери двоих и больше');
    expect(sp(splitButtonLabel(2))).toBe('Записать делёж · 2 игрока');
  });
});
