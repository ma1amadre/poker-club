// Бомб-пот на табло ТВ (миграция 030): раскладка бейджа раздачи на столе, откуда и куда летят
// взносы, тексты и партитура сцены. Замечания судей к макету v2 — проверками: взносы не налезают на
// цифры банка, зазоры столбца не меньше 24 px, табло показывает число раньше телефонов.
import { BOMB_REVEAL_MS } from '@domain/bombPot.ts';
import { describe, expect, it } from 'vitest';
import { rollPlan } from '../../evening/bombPotView';
import {
  bombColumn,
  CARD,
  COLUMN_GAP,
  COLUMN_H,
  columnInsideFelt,
  formText,
  inNest,
  oddsText,
  POT,
  potRowWidth,
  resultCaption,
  scaleCells,
  sceneBeats,
  SCENE_PACES,
  scenePace,
  seatNest,
  stakeFlapText,
  stakeSeats,
  stakeTarget,
  TAG,
  TAG_W,
} from './bombScene';
import { MARKER_D_W, MARKER_H, markerXY, TABLE, TABLE_CX } from './tableLayout';

const sp = (text: string) => text.replace(/[  ]/g, ' ');

describe('бейдж раздачи на столе', () => {
  it('столбец — внутри сукна при любом месте баттона', () => {
    for (const d of [null, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      expect(columnInsideFelt(bombColumn(d))).toBe(true);
    }
  });

  it('метка баттона на оси стола (места 5 и 10) — столбец уходит от неё, не задевая', () => {
    for (const d of [5, 10]) {
      const c = bombColumn(d);
      const [, my] = markerXY(d, 'D', ['D'], { D: MARKER_D_W, SB: 0, BB: 0 });
      const top = c.tag.y;
      const bottom = c.formY + 26;
      const clear = my + MARKER_H <= top - 16 || my >= bottom + 16;
      expect(clear).toBe(true);
    }
  });

  it('остальные метки баттона столбец не задевают по ширине', () => {
    const left = Math.min(bombColumn(null).tag.x, bombColumn(null).cards.x);
    const right = Math.max(
      bombColumn(null).tag.x + TAG_W,
      bombColumn(null).cards.x + 3 * CARD.w + 2 * CARD.gap,
    );
    for (const d of [1, 2, 3, 4, 6, 7, 8, 9]) {
      const [mx] = markerXY(d, 'D', ['D'], { D: MARKER_D_W, SB: 0, BB: 0 });
      expect(mx + MARKER_D_W <= left || mx >= right).toBe(true);
    }
  });

  it('зазоры столбца — не меньше 24 px: табличка, флоп, банк (замечание судей к v2)', () => {
    const c = bombColumn(null);
    expect(c.cards.y - (c.tag.y + TAG.h)).toBeGreaterThanOrEqual(COLUMN_GAP);
    expect(c.potY - (c.cards.y + CARD.h)).toBeGreaterThanOrEqual(COLUMN_GAP);
    expect(c.formY).toBeGreaterThan(c.potY + POT.h);
    expect(c.formY + 26 - c.tag.y).toBe(COLUMN_H);
    expect(Math.abs(c.tag.x + TAG_W / 2 - TABLE_CX)).toBeLessThanOrEqual(1);
  });

  it('банк флапами: «1 800» — четыре плитки и узкий пробел разряда', () => {
    expect(potRowWidth('1 800')).toBe(4 * POT.w + Math.round(POT.w * 0.3) + 4 * POT.gap);
    expect(potRowWidth('600')).toBe(3 * POT.w + 2 * POT.gap);
  });

  it('гнездо места — то же, что у флапа «ВЫЛЕТ»; взнос в нём — по краю к столу у торцов', () => {
    const left = seatNest(3);
    const [x] = inNest(3, 70, 32);
    expect(x + 70).toBe(left.x + left.w);
    const right = seatNest(7);
    expect(inNest(7, 70, 32)[0]).toBe(right.x);
    const top = seatNest(5);
    expect(inNest(5, 70, 32)[0]).toBe(Math.round(top.x + (top.w - 70) / 2));
  });
});

describe('взносы: одно схождение и без наезда на цифры банка', () => {
  const pot = { x: TABLE_CX - 126, y: 551, w: 252, h: 76 };

  it('взнос гаснет у кромки банка, раздвинутой на 40 px, — на цифры не ложится', () => {
    for (const from of [
      [900, 300],
      [1700, 470],
      [1288, 850],
      [880, 784],
      [1500, 250],
    ] as [number, number][]) {
      const [x, y] = stakeTarget(from, pot);
      const inside =
        x > pot.x - 39 && x < pot.x + pot.w + 39 && y > pot.y - 39 && y < pot.y + pot.h + 39;
      expect(inside).toBe(false);
      // Точка — на луче к центру банка: ближе к центру, чем начало.
      const d0 = Math.hypot(from[0] - TABLE_CX, from[1] - (pot.y + pot.h / 2));
      const d1 = Math.hypot(x - TABLE_CX, y - (pot.y + pot.h / 2));
      expect(d1).toBeLessThan(d0);
    }
  });

  it('участники с местами — по порядку бомб-пота (от первого слова), без места — отдельно', () => {
    const out = stakeSeats({
      players: ['c', 'd', 'a', 'x'],
      seating: { seats: { a: 1, c: 5, d: 8, x: null }, buttonSeat: 3 },
    });
    expect(out.seats).toEqual([
      { playerId: 'c', seat: 5 },
      { playerId: 'd', seat: 8 },
      { playerId: 'a', seat: 1 },
    ]);
    expect(out.unseated).toEqual(['x']);
  });
});

describe('тексты сцены', () => {
  it('до броска — исходов пять и они равны; переброс — с отменённым броском', () => {
    expect(oddsText({ previousBbs: [] })).toEqual({
      text: 'Взнос — случайно, от 1 до 5 BB',
      struck: null,
    });
    const reroll = oddsText({ previousBbs: [4] });
    expect(reroll.text).toBe('Переброс · отменён бросок');
    expect(sp(reroll.struck ?? '')).toBe('4 BB');
    expect(scaleCells(100).map((c) => sp(c.value))).toEqual(['100', '200', '300', '400', '500']);
  });

  it('банк номинальный: «по 300 × 6»; взнос флапами — шириной наибольшего', () => {
    expect(sp(formText({ stake: 300, players: ['a', 'b', 'c', 'd', 'e', 'f'] }))).toBe(
      'по 300 × 6',
    );
    expect(sp(stakeFlapText({ stake: 300, bb: 100 }))).toBe('300');
    expect(sp(stakeFlapText({ stake: 200, bb: 200 }))).toBe('  200');
  });

  it('развязка: «Бомб-пот забирает» и имя; делёж — «делят» и имена', () => {
    expect(resultCaption([])).toBeNull();
    expect(resultCaption(['Костя'])).toEqual({ verb: 'Бомб-пот забирает', names: 'Костя' });
    expect(resultCaption(['Саша', 'Костя', 'Миша'])).toEqual({
      verb: 'Бомб-пот делят',
      names: 'Саша, Костя и Миша',
    });
  });
});

describe('партитура сцены', () => {
  it('такты идут по порядку; голос взноса — после удара', () => {
    for (let k = 1; k <= 5; k += 1) {
      const b = sceneBeats(k, 6, false);
      const order = [
        b.voiceBomb,
        b.rollStart,
        b.hit,
        b.stake,
        b.stakes,
        b.converge,
        b.tag,
        b.flop,
        b.exit,
        b.end,
      ];
      expect([...order].sort((x, y) => x - y)).toEqual(order);
      expect(b.voiceStake).toBeGreaterThan(b.hit);
      expect(b.hit).toBe(b.rollStart + rollPlan(k).hit);
    }
  });

  it('табло показывает число раньше телефонов: опрос до 3 с + удар < 9 с от записи', () => {
    for (let k = 1; k <= 5; k += 1) {
      expect(3000 + 600 + sceneBeats(k, 10, false).hit).toBeLessThan(BOMB_REVEAL_MS);
    }
  });

  it('сцена ждала в очереди (идущий нокаут или заставка доигрывали) до 4 с — темп короче, число всё равно раньше телефонов', () => {
    for (let k = 1; k <= 5; k += 1) {
      for (const waited of [0, 500, 1000, 2000, 3000, 4000]) {
        const start = 3000 + 600 + waited; // опрос, сеть, ожидание в очереди
        const pace = scenePace(k, BOMB_REVEAL_MS - start, false);
        expect(start + sceneBeats(k, 10, false, pace).hit).toBeLessThan(BOMB_REVEAL_MS);
        const calm = scenePace(k, BOMB_REVEAL_MS - start, true);
        if (waited <= 2000)
          expect(start + sceneBeats(k, 10, true, calm).hit).toBeLessThan(BOMB_REVEAL_MS);
      }
    }
    // Без очереди — полный темп: вступление 1,2 с и два круга перебора.
    expect(scenePace(5, BOMB_REVEAL_MS - 3600, false)).toEqual({ rollStart: 1200, laps: 2 });
    // Опоздала безнадёжно — самый короткий темп, а не полный.
    expect(scenePace(3, -5000, false)).toEqual(SCENE_PACES[SCENE_PACES.length - 1]);
  });

  it('короткий темп: такты по порядку, вступление короче, кругов меньше', () => {
    for (const pace of SCENE_PACES) {
      for (let k = 1; k <= 5; k += 1) {
        const b = sceneBeats(k, 6, false, pace);
        expect(b.rollStart).toBe(pace.rollStart);
        expect(b.voiceBomb).toBeLessThan(b.rollStart);
        expect(b.hit).toBe(pace.rollStart + rollPlan(k, pace.laps).hit);
        expect(rollPlan(k, pace.laps).values.at(-1)).toBe(k);
        expect(rollPlan(k, pace.laps).flips).toBe(pace.laps * 5 + k);
      }
    }
  });

  it('сцена — не дольше 12 с и на 10 участниках', () => {
    expect(sceneBeats(5, 10, false).end).toBeLessThan(12_000);
    expect(sceneBeats(1, 2, false).end).toBeGreaterThan(6000);
  });

  it('спокойный режим: ячейки одним проходом по 300 мс', () => {
    expect(sceneBeats(3, 6, true).hit).toBe(1200 + 900 + 200);
  });

  it('стол в покое не задевает кромку сукна снизу и сверху', () => {
    expect(TABLE.y1 - TABLE.y0).toBeGreaterThan(COLUMN_H + 2 * 16);
  });
});
