import { describe, expect, it } from 'vitest';
import {
  cellKind,
  clockParts,
  drumVia,
  fallMs,
  fitTileWidth,
  flipOrder,
  pctText,
  Riffle,
  rowPattern,
  rowWidth,
} from './flapLogic';

describe('флапы: раскладка строки', () => {
  it('«/» блайндов — печать без плитки, разряд «1 000» — узкая ячейка, остальное — плитки', () => {
    const o = { plain: '/' };
    expect(cellKind('5', o)).toBe('tile');
    expect(cellKind('/', o)).toBe('plain');
    expect(cellKind(' ', o)).toBe('narrow');
    expect(cellKind(' ', o)).toBe('narrow');
    // Пробел — плитка, пока не просили узкий (слова улиц — узкий).
    expect(cellKind(' ', o)).toBe('tile');
    expect(cellKind(' ', { narrow: true })).toBe('narrow');
    expect(rowPattern('75/150', o)).toBe('xx/xxx');
    expect(rowPattern('1 000/2 000', o)).toBe('x_xxx/x_xxx');
    expect(rowPattern('ДО ФЛОПА', { narrow: true })).toBe('xx_xxxxx');
  });

  it('50/100 и 75/150 — одна раскладка (переворот по ячейкам), 75/150 и 100/200 — нет (пересборка)', () => {
    const o = { plain: '/' };
    expect(rowPattern('50/100', o)).toBe(rowPattern('75/150', o));
    expect(rowPattern('75/150', o)).not.toBe(rowPattern('100/200', o));
  });

  it('ширина ряда: печать — 0,66 плитки, разряд — 0,3, зазоры между ячейками', () => {
    const o = { plain: '/' };
    // 50/100: пять плиток по 82, «/» 54, пять зазоров по 6.
    expect(rowWidth('50/100', 82, 6, o)).toBe(5 * 82 + 54 + 5 * 6);
    expect(rowWidth('1 000', 82, 6, o)).toBe(4 * 82 + 25 + 4 * 6);
  });

  it('ряд блайндов не шире колонки 554: пять цифр — плитка 82, шесть — уже, «1 000/2 000» — ещё уже', () => {
    const o = { plain: '/' };
    expect(fitTileWidth('50/100', 82, 554, 6, o)).toBe(82);
    const six = fitTileWidth('100/200', 82, 554, 6, o);
    expect(six).toBeLessThan(82);
    expect(rowWidth('100/200', six, 6, o)).toBeLessThanOrEqual(554);
    expect(rowWidth('100/200', six + 1, 6, o)).toBeGreaterThan(554);
    const wide = fitTileWidth('1 000/2 000', 82, 554, 6, o, 36);
    expect(rowWidth('1 000/2 000', wide, 6, o)).toBeLessThanOrEqual(554);
  });
});

describe('флапы: барабан и перебор', () => {
  const r = () => new Riffle();

  it('цифры идут вперёд по барабану, не больше max промежуточных — ближайшие к цели', () => {
    expect(drumVia('2', '7', 'up', 3, r())).toEqual(['4', '5', '6']);
    expect(drumVia('2', '3', 'up', 3, r())).toEqual([]);
    expect(drumVia('9', '1', 'up', 2, r())).toEqual(['0']);
    expect(drumVia('8', '1', 'up', 2, r())).toEqual(['9', '0']);
  });

  it('назад — тоже ближайшие к цели: 57 → 26 перекатывается вниз', () => {
    expect(drumVia('5', '2', 'down', 2, r())).toEqual(['4', '3']);
    expect(drumVia('7', '6', 'down', 2, r())).toEqual([]);
  });

  it('из пустой ячейки и к букве — один знак перебора; к пусто — сразу', () => {
    expect(drumVia(' ', '4', 'up', 2, r())).toHaveLength(1);
    expect(drumVia('4', ' ', 'up', 2, r())).toEqual([]);
    const via = drumVia('Т', 'Ы', 'up', 2, r());
    expect(via).toHaveLength(1);
    expect(via[0]).toMatch(/[А-Я]/);
  });

  it('перебор детерминирован: тот же генератор — те же знаки (кадр снимка повторяется)', () => {
    expect(new Riffle().take('Ы', 3)).toEqual(new Riffle().take('Ы', 3));
    const digits = new Riffle().take('5', 4);
    expect(digits.every((d) => /\d/.test(d))).toBe(true);
  });
});

describe('флапы: время и порядок', () => {
  it('падение листа — тяжелее у крупного флапа, в пределах 170–340 мс', () => {
    expect(fallMs(26)).toBe(170);
    expect(fallMs(50)).toBe(170);
    expect(fallMs(128)).toBe(192);
    expect(fallMs(224)).toBe(254);
    expect(fallMs(2000)).toBe(340);
  });

  it('младший разряд первым — справа налево', () => {
    expect(flipOrder(4, false)).toEqual([0, 1, 2, 3]);
    expect(flipOrder(4, true)).toEqual([3, 2, 1, 0]);
  });

  it('часы делятся на минуты и секунды; минут бывает три цифры', () => {
    expect(clockParts('28:00')).toEqual({ minutes: '28', seconds: '00' });
    expect(clockParts('120:05')).toEqual({ minutes: '120', seconds: '05' });
  });

  it('проценты — два знака, прижаты вправо; шансов нет — пусто', () => {
    expect(pctText(5)).toBe(' 5');
    expect(pctText(57)).toBe('57');
    expect(pctText(100)).toBe('100');
    expect(pctText(null)).toBe('  ');
  });
});
