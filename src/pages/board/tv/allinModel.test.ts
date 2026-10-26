import type { ShowdownHand } from '@domain/types.ts';
import { describe, expect, it } from 'vitest';
import { analyzeShowdown } from '../../../shared/lib/poker/analysis';
import { computeEquity } from '../../../shared/lib/poker/equity';
import {
  allinLayout,
  allinTitle,
  handSlot,
  handViews,
  handY,
  holeCardsText,
  outsByPlayer,
  outsPlates,
  PCT_GAP,
  pctSignWidth,
  pctTile,
  potFontSize,
  potPlateWidth,
  resultWidth,
  riverHits,
  SAFE_BOTTOM,
  shortHandText,
  winningCards,
} from './allinModel';

/** Разбор раздачи точным перебором (флоп и дальше), как у табло. */
function analysis(hands: ShowdownHand[], board: string[]) {
  const codes = hands.map((x) => x.cards);
  return analyzeShowdown(codes, board, computeEquity(codes, board));
}

const SASHA: ShowdownHand = { playerId: 'sasha', cards: ['Qd', 'Qc'] };
const ZHENYA: ShowdownHand = { playerId: 'zhenya', cards: ['As', 'Ks'] };
const MISHA: ShowdownHand = { playerId: 'misha', cards: ['Jh', 'Th'] };
const THREE = [SASHA, ZHENYA, MISHA];
const BOARD = ['Qh', '9s', '4s', '2c', '7s'];

describe('олл-ин на табло: раскладка по числу рук', () => {
  it('2–9 рук: колонки внутри поля 96…1824, руки и подписи — выше нижней безопасной линии', () => {
    for (let n = 2; n <= 9; n += 1) {
      const L = allinLayout(n);
      const Y = handY(L);
      for (let i = 0; i < n; i += 1) {
        const s = handSlot(L, i);
        expect(s.x).toBeGreaterThanOrEqual(96);
        expect(s.x + L.colW).toBeLessThanOrEqual(1824 + 0.5);
        expect(s.y + Y.bottom).toBeLessThanOrEqual(SAFE_BOTTOM);
      }
      // Борд — над руками.
      expect(L.board.y + L.board.h).toBeLessThan(L.top);
      expect(L.board.xs[4]! + L.board.w).toBeLessThanOrEqual(1824);
    }
  });

  it('2–4 — один ряд, 5–9 — два (3, 4, 5 колонок)', () => {
    expect(allinLayout(3).perRow).toEqual([3]);
    expect(allinLayout(5).perRow).toEqual([3, 2]);
    expect(allinLayout(8).perRow).toEqual([4, 4]);
    expect(allinLayout(9).perRow).toEqual([5, 4]);
    const L = allinLayout(9);
    expect(handSlot(L, 5)).toMatchObject({ row: 1, x: 96 });
  });

  it('карты, проценты, ауты и плашки — не мельче прода (showdown.css при 1920×1080, --sd-u 10,8 px)', () => {
    const prod: Record<number, { card: number; chip: number; outs: number; pct: number }> = {
      2: { card: 173, chip: 45, outs: 71, pct: 140 },
      3: { card: 130, chip: 41, outs: 65, pct: 103 },
      4: { card: 97, chip: 36, outs: 58, pct: 70 },
      5: { card: 76, chip: 30, outs: 56, pct: 65 },
      6: { card: 76, chip: 30, outs: 56, pct: 65 },
      7: { card: 60, chip: 24, outs: 29, pct: 58 },
      8: { card: 60, chip: 24, outs: 29, pct: 58 },
      9: { card: 54, chip: 24, outs: 29, pct: 50 },
    };
    for (let n = 2; n <= 9; n += 1) {
      const L = allinLayout(n);
      expect(L.cw).toBeGreaterThanOrEqual(prod[n]!.card);
      expect(L.chip).toBeGreaterThanOrEqual(prod[n]!.chip);
      expect(L.cnt).toBeGreaterThanOrEqual(prod[n]!.outs);
      expect(L.pct).toBeGreaterThanOrEqual(prod[n]!.pct);
    }
  });

  it('подписи аутов и рука словами — не мельче прода (--sd-outs-text и --sd-text при 1920×1080)', () => {
    // showdown.css: подписи аутов, «Впереди», «Устоит/Догонит…», «Аутов нет» — --sd-outs-text
    // (2,5 доли у 2–3 рук, 2,3 у 4, 2,25 у 5–9; доля — 10,8 px); рука словами — --sd-text (2 и 1,8).
    const u = 10.8;
    const outsText = (n: number) => Math.round((n <= 3 ? 2.5 : n === 4 ? 2.3 : 2.25) * u);
    const handText = (n: number) => Math.round((n <= 4 ? 2 : 1.8) * u);
    for (let n = 2; n <= 9; n += 1) {
      const L = allinLayout(n);
      expect(L.ol).toBeGreaterThanOrEqual(outsText(n));
      expect(L.st).toBeGreaterThanOrEqual(outsText(n));
      expect(L.cap).toBeGreaterThanOrEqual(outsText(n));
      expect(L.made).toBeGreaterThanOrEqual(handText(n));
    }
  });

  it('«100 %» не заходит на карты руки: у 3–4 рук плитка трёх цифр мельче', () => {
    for (let n = 2; n <= 9; n += 1) {
      const L = allinLayout(n);
      const two = pctTile(L, 2);
      expect(two).toEqual({ w: Math.round(L.pct * 0.6) + 2, fs: L.pct });
      const three = pctTile(L, 3);
      const left = L.colW - 3 * three.w - pctSignWidth(L.pct);
      expect(left).toBeGreaterThanOrEqual(2 * L.cw + L.cg + PCT_GAP);
      expect(three.fs).toBeLessThanOrEqual(L.pct);
    }
    expect(pctTile(allinLayout(3), 3).w).toBeLessThan(pctTile(allinLayout(3), 2).w);
    expect(pctTile(allinLayout(4), 3).w).toBeLessThan(pctTile(allinLayout(4), 2).w);
  });

  it('до флопа блок рук опущен к центру свободного поля, на флопе поднимается', () => {
    expect(allinLayout(3).shift).toBeGreaterThan(0);
    expect(allinLayout(2).shift).toBeGreaterThan(0);
  });

  it('«Олл-ин · 3 руки», «· 5 рук»', () => {
    expect(allinTitle(3)).toBe('Олл-ин · 3 руки');
    expect(allinTitle(5)).toBe('Олл-ин · 5 рук');
  });
});

describe('олл-ин на табло: руки на улице', () => {
  it('до флопа — карты словами: «Пара дам», «Туз-король»', () => {
    expect(holeCardsText(['Qd', 'Qc'])).toBe('Пара дам');
    expect(holeCardsText(['Ks', 'As'])).toBe('Туз-король');
    expect(holeCardsText(['Th', 'Jh'])).toBe('Валет-десятка');
  });

  it('флоп: лидер — при отрыве от 5 п. п., у него «Впереди» и «устоит на тёрне N из M», у отстающих — ауты и «догонит на тёрне N %»', () => {
    const board = BOARD.slice(0, 3);
    const views = handViews({
      hands: THREE,
      board,
      analysis: analysis(THREE, board),
      previousOuts: new Map(),
      busted: new Set(),
    });
    expect(views.map((v) => v.pct)).toEqual([57, 26, 17]);
    expect(views.map((v) => v.lead)).toEqual([true, false, false]);
    expect(views[0]).toMatchObject({
      ahead: true,
      outs: null,
      caption: ['устоит на тёрне', '29 из 43'],
    });
    expect(views[1]?.outs?.count).toBe(8);
    expect(views[1]?.outs?.word).toBe('аутов');
    expect(views[1]?.caption).toEqual(['догонит на тёрне', '19 %']);
    expect(views[2]?.outs?.count).toBe(6);
    expect(views[2]?.caption).toEqual(['догонит на тёрне', '14 %']);
  });

  it('тёрн: аут с флопа, который больше не аут, гаснет на месте; число аутов — новое', () => {
    const flop = BOARD.slice(0, 3);
    const turn = BOARD.slice(0, 4);
    const prev = outsByPlayer(THREE, analysis(THREE, flop));
    const views = handViews({
      hands: THREE,
      board: turn,
      analysis: analysis(THREE, turn),
      previousOuts: prev,
      busted: new Set(),
    });
    const zhenya = views[1]!;
    expect(zhenya.outs?.count).toBe(7);
    const spades = zhenya.outs?.plates.find((p) => p.suit === 's');
    // 2♠ спаривает стол — у Саши фулл-хаус: аут погас.
    expect(spades?.ranks.find((r) => r.code === '2s')?.dead).toBe(true);
    expect(spades?.ranks.filter((r) => r.dead)).toHaveLength(1);
    // На тёрне подписи следующей карты нет — процент и есть шанс последней карты.
    expect(views.every((v) => v.caption === null)).toBe(true);
  });

  it('ривер: сработавший аут, победитель — «Лучшая рука», вылетевший — по журналу, остальные — без статуса', () => {
    const turn = BOARD.slice(0, 4);
    const hits = riverHits(outsByPlayer(THREE, analysis(THREE, turn)), BOARD);
    expect([...hits]).toEqual([['zhenya', '7s']]);
    const views = handViews({
      hands: THREE,
      board: BOARD,
      analysis: analysis(THREE, BOARD),
      previousOuts: new Map(),
      busted: new Set(['misha']),
    });
    expect(views.map((v) => v.result?.kind)).toEqual(['lose', 'win', 'out']);
    expect(views[1]?.result?.pot).toBe('Лучшая рука');
    expect(views[1]?.lead).toBe(true);
    expect(views[1]?.made).toBe('Флеш до туза');
    // Ответ банкира пришёл: Саше хватило фишек — «остаётся в игре»; на троих «удвоения» нет.
    const answered = handViews({
      hands: THREE,
      board: BOARD,
      analysis: analysis(THREE, BOARD),
      previousOuts: new Map(),
      busted: new Set(['misha']),
      stayed: new Set(['sasha']),
    });
    expect(answered.map((v) => v.result)).toEqual([
      { kind: 'stay', pot: null },
      { kind: 'win', pot: 'Лучшая рука' },
      { kind: 'out', pot: null },
    ]);
  });

  it('на двоих победитель забирает весь банк; делёж — «Делёж банка» у обоих', () => {
    const two: ShowdownHand[] = [
      { playerId: 'lesha', cards: ['8h', '8s'] },
      { playerId: 'kostya', cards: ['Ac', 'Qd'] },
    ];
    const board = ['Ks', '7d', '2c', '5h', 'Qc'];
    const views = handViews({
      hands: two,
      board,
      analysis: analysis(two, board),
      previousOuts: new Map(),
      busted: new Set(),
    });
    expect(views[1]?.result).toEqual({ kind: 'win', pot: 'Весь банк' });
    const split: ShowdownHand[] = [
      { playerId: 'a', cards: ['Ah', 'Kd'] },
      { playerId: 'b', cards: ['Ad', 'Kh'] },
    ];
    const sb = ['2c', '7s', '9d', 'Jc', '3h'];
    const sv = handViews({
      hands: split,
      board: sb,
      analysis: analysis(split, sb),
      previousOuts: new Map(),
      busted: new Set(),
    });
    expect(sv.map((v) => v.result)).toEqual([
      { kind: 'split', pot: 'Делёж банка' },
      { kind: 'split', pot: 'Делёж банка' },
    ]);
  });

  it('плашка банка на 2–3 руках не заходит на карты: «Лучшая рука» на троих — кеглем мельче', () => {
    for (let n = 2; n <= 3; n += 1) {
      const L = allinLayout(n);
      expect(L.stackRes).toBe(false);
      const maxW = resultWidth(L);
      for (const pot of ['Весь банк', 'Лучшая рука', 'Делёж банка']) {
        const px = potFontSize(pot, L.st, maxW);
        expect(potPlateWidth(pot, px)).toBeLessThanOrEqual(maxW);
        expect(px).toBeGreaterThanOrEqual(Math.round(L.st * 0.7));
      }
    }
    const three = allinLayout(3);
    // Живая проверка 26.10: на троих «Лучшая рука» базовым кеглем наезжала на вторую карту.
    expect(potPlateWidth('Лучшая рука', three.st)).toBeGreaterThan(resultWidth(three));
    // Короткая плашка на двоих — базовым кеглем.
    const two = allinLayout(2);
    expect(potFontSize('Весь банк', two.st, resultWidth(two))).toBe(two.st);
  });

  it('плашки аутов: по мастям ♠ ♥ ♦ ♣, ранги от туза вниз, «10» — двумя знаками', () => {
    const plates = outsPlates(['Ts', 'Ks', '8h', '8d'], [], []);
    expect(plates.map((p) => p.suit)).toEqual(['s', 'h', 'd']);
    expect(plates[0]?.ranks.map((r) => r.rank)).toEqual(['K', '10']);
  });

  it('рука словами короче для узкой колонки: «Старший туз», «Старшая дама», «Две пары», «Фулл-хаус»', () => {
    expect(shortHandText('Старшая карта: туз')).toBe('Старший туз');
    expect(shortHandText('Старшая карта: король')).toBe('Старший король');
    expect(shortHandText('Старшая карта: дама')).toBe('Старшая дама');
    expect(shortHandText('Старшая карта: десятка')).toBe('Старшая десятка');
    expect(shortHandText('Две пары: восьмёрки и шестёрки')).toBe('Две пары');
    expect(shortHandText('Фулл-хаус: дамы и восьмёрки')).toBe('Фулл-хаус');
    expect(shortHandText('Флеш до туза')).toBe('Флеш до туза');
    expect(shortHandText('Пара дам')).toBe('Пара дам');
  });

  it('карты победителя: флеш — три пики стола и обе руки', () => {
    expect(winningCards(['As', 'Ks'], BOARD)).toEqual({ board: [1, 2, 4], hole: [0, 1] });
  });
});
