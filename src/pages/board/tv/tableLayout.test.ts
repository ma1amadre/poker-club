import { describe, expect, it } from 'vitest';
import {
  dealMove,
  fitDown,
  LIST_BOTTOM,
  LIST_NAME_MIN,
  LIST_NAME_PX,
  KO_CARD,
  NAME_H,
  NAME_TWO_LH,
  NAME_TWO_MAX,
  nameLimit,
  nameTop,
  markerXY,
  markersAt,
  railDuration,
  railPath,
  railPoints,
  railPosition,
  SEAT_POINTS,
  seatLabels,
  stackTop,
  TABLE,
  TABLE_CX,
  TABLE_CY,
} from './tableLayout';

describe('стол: места по сукну клуба', () => {
  it('ближний край 1·10·9 слева направо, дальний 4·5·6, левый торец 2·3 снизу вверх, правый 7·8 сверху вниз', () => {
    const p = (n: number) => SEAT_POINTS[n]!;
    expect([1, 10, 9].map((n) => p(n).side)).toEqual(['b', 'b', 'b']);
    expect(p(1).x).toBeLessThan(p(10).x);
    expect(p(10).x).toBeLessThan(p(9).x);
    expect([4, 5, 6].map((n) => p(n).side)).toEqual(['t', 't', 't']);
    expect(p(4).x).toBeLessThan(p(5).x);
    expect(p(5).x).toBeLessThan(p(6).x);
    expect([2, 3].map((n) => p(n).side)).toEqual(['l', 'l']);
    expect(p(2).y).toBeGreaterThan(p(3).y);
    expect([7, 8].map((n) => p(n).side)).toEqual(['r', 'r']);
    expect(p(7).y).toBeLessThan(p(8).y);
  });

  it('по часовой на экране: 1 → 2 → … → 10 обходят стол один раз', () => {
    // Угол точки вокруг центра стола растёт по часовой (ось y вниз) — без возвратов.
    const angle = (n: number) => {
      const p = SEAT_POINTS[n]!;
      return Math.atan2(p.y - TABLE_CY, p.x - TABLE_CX);
    };
    let turned = 0;
    for (let n = 1; n <= 10; n += 1) {
      let d = angle((n % 10) + 1) - angle(n);
      if (d < 0) d += 2 * Math.PI;
      turned += d;
    }
    expect(Math.round(turned / (2 * Math.PI))).toBe(1);
  });

  it('стол — в центре кадра по вертикали; карточка нокаута — по его оси', () => {
    expect(TABLE_CY).toBe(540);
    expect(KO_CARD.x + KO_CARD.w / 2).toBe(TABLE_CX);
  });

  it('подписи: номер у борта, имя снаружи, гнездо стека ещё дальше; ничего не выходит за безопасную зону', () => {
    const top = seatLabels(5);
    expect(top.no.y).toBeLessThan(TABLE.y0);
    expect(top.name.y).toBeLessThan(top.no.y);
    expect(top.stack.y).toBeLessThan(top.name.y);
    expect(top.stack.y).toBeGreaterThan(54);
    const bottom = seatLabels(10);
    expect(bottom.no.y).toBeGreaterThan(TABLE.y1);
    expect(bottom.stack.y + 50).toBeLessThan(1026);
    const left = seatLabels(3);
    expect(left.no.align).toBe('end');
    expect(left.name.x).toBeLessThan(left.no.x);
    const right = seatLabels(7);
    expect(right.no.align).toBe('start');
    // Имя справа — до безопасной зоны 1824, слева — правее выросшего ряда блайндов (750).
    expect(right.name.x + nameLimit('r')).toBeLessThanOrEqual(1824);
    expect(left.name.x - nameLimit('l')).toBeGreaterThan(750);
    // Сверху и снизу соседние имена не сходятся: между центрами мест — треть стола.
    expect(nameLimit('t')).toBeLessThan(TABLE_CX - SEAT_POINTS[4]!.x);
  });

  it('имя двумя строками не задевает номер места; гнездо стека (флап «ВЫЛЕТ») отходит от второй строки', () => {
    // Высота блока — с межстрочным интервалом CSS: глифы Inter выше строки в 1 em (живая проверка
    // 26.10: флап «ВЫЛЕТ» у места 10 закрывал вторую строку «Анна-Мария Шереметева»).
    const two = Math.round(2 * NAME_TWO_MAX * NAME_TWO_LH);
    for (let seat = 1; seat <= 10; seat += 1) {
      const L = seatLabels(seat);
      const top = nameTop(L.side, L.name.y, two);
      const bottom = top + two;
      const slot = stackTop(L.side, L.stack.y, two);
      if (L.side === 't') {
        expect(bottom).toBeLessThanOrEqual(L.no.y);
        expect(top).toBeGreaterThanOrEqual(slot + 50 + 8);
        expect(slot).toBeGreaterThanOrEqual(54);
      } else if (L.side === 'b') {
        expect(top).toBeGreaterThanOrEqual(L.no.y + 20);
        expect(slot).toBeGreaterThanOrEqual(bottom + 8);
        expect(slot + 50).toBeLessThanOrEqual(1026);
      } else {
        expect(slot).toBeGreaterThanOrEqual(bottom + 8);
      }
      // Одна строка — всё на своих местах.
      expect(nameTop(L.side, L.name.y, NAME_H)).toBe(L.name.y);
      expect(stackTop(L.side, L.stack.y, NAME_H)).toBe(L.stack.y);
    }
  });
});

describe('без рассадки: список «За столом»', () => {
  it('имена мельчают, пока низ списка не выше подвала; помещаются сразу — базовый кегль', () => {
    // Строка имени — кегль + зазор 14; имена по одному в строке (длинные), список начинается с 495.
    const rows = (n: number) => (px: number) => 495 + n * (px + 14);
    expect(fitDown(rows(6), LIST_BOTTOM)).toBe(LIST_NAME_PX);
    const ten = fitDown(rows(10), LIST_BOTTOM);
    expect(ten).toBeLessThan(LIST_NAME_PX);
    expect(rows(10)(ten)).toBeLessThanOrEqual(LIST_BOTTOM);
    expect(rows(10)(ten + 1)).toBeGreaterThan(LIST_BOTTOM);
    // Не помещается и мельче — кегль не ниже наименьшего.
    expect(fitDown(rows(30), LIST_BOTTOM)).toBe(LIST_NAME_MIN);
    // Низ стола — выше подвала: подвал начинается не выше 930.
    expect(LIST_BOTTOM).toBeLessThanOrEqual(900);
  });
});

describe('стол: метки D / SB / BB', () => {
  const widths = { D: 48, SB: 114, BB: 132 };

  it('метка стоит у своего места внутри стола', () => {
    const [x, y] = markerXY(5, 'D', ['D'], widths);
    expect(x + 24).toBe(TABLE_CX);
    expect(y).toBe(TABLE.y0 + 22);
    const [, yb] = markerXY(10, 'BB', ['BB'], widths);
    expect(yb + 48).toBe(TABLE.y1 - 22);
    const [xr] = markerXY(7, 'SB', ['SB'], widths);
    expect(xr + 114).toBe(TABLE.x1 - 22);
  });

  it('вдвоём баттон и SB на одном месте — рядом вдоль кромки, не друг на друге', () => {
    const seats = { D: 5, SB: 5, BB: 1 };
    const same = markersAt(seats, 5);
    expect(same).toEqual(['D', 'SB']);
    const [dx] = markerXY(5, 'D', same, widths);
    const [sx] = markerXY(5, 'SB', same, widths);
    expect(dx + 48).toBeLessThanOrEqual(sx);
  });

  it('путь по борту — только по часовой: от 7 к 10 через правый торец и ближний край', () => {
    const w = 48;
    const from: [number, number] = [TABLE.x1 - 22 - w / 2, SEAT_POINTS[7]!.y];
    const to: [number, number] = [TABLE_CX, TABLE.y1 - 46];
    const path = railPath(w, from, to);
    // Вниз по правому краю, потом влево по ближнему: x не растёт, y не убывает.
    const pts = path.points.map(([, p]) => p);
    for (let i = 1; i < pts.length; i += 1) {
      expect(pts[i]![0]).toBeLessThanOrEqual(pts[i - 1]![0] + 0.001);
      expect(pts[i]![1]).toBeGreaterThanOrEqual(pts[i - 1]![1] - 0.001);
    }
    // Доли пути — по возрастанию, от 0 до длины.
    const s = path.points.map(([d]) => d);
    expect(s[0]).toBe(0);
    expect(s[s.length - 1]).toBeCloseTo(path.length, 6);
    expect([...s].sort((a, b) => a - b)).toEqual(s);
  });

  it('назад по кольцу не едет: к месту «раньше» — через весь круг', () => {
    const w = 48;
    const P = railPoints(w);
    const { length } = railPosition(P, P[0]!);
    const a: [number, number] = [TABLE_CX, TABLE.y0 + 46];
    const b: [number, number] = [TABLE.x0 + 22 + w / 2 + 28, TABLE.y0 + 46];
    expect(railPath(w, a, b).length).toBeGreaterThan(length / 2);
  });

  it('длительность переезда — 420–600 мс', () => {
    expect(railDuration(0)).toBe(420);
    expect(railDuration(400)).toBe(460);
    expect(railDuration(5000)).toBe(600);
  });
});

describe('стол: метки едут вдоль борта только по раздаче', () => {
  const alive = new Set([1, 3, 4, 5, 9]);
  it('«Следующая раздача» — к следующему игроку в игре по часовой (пустые и вылетевшие места — мимо)', () => {
    expect(dealMove(1, 3, alive)).toBe(true);
    expect(dealMove(5, 9, alive)).toBe(true);
    expect(dealMove(9, 1, alive)).toBe(true);
  });

  it('отмена раздачи (баттон на место назад) и баттон руками через игроков — без переезда', () => {
    expect(dealMove(3, 1, alive)).toBe(false);
    expect(dealMove(1, 4, alive)).toBe(false);
    expect(dealMove(4, 4, alive)).toBe(false);
  });

  it('вдвоём баттон по раздаче и назад — одно и то же: по часовой', () => {
    expect(dealMove(4, 5, new Set([4, 5]))).toBe(true);
    expect(dealMove(5, 4, new Set([4, 5]))).toBe(true);
  });
});
