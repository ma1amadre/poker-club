import { describe, expect, it } from 'vitest';
import {
  bestNRule,
  countedSummary,
  formatPointsWithUnit,
  formatShortDate,
  placeLabel,
  pointsWord,
  scoringRule,
  standingMeta,
} from './text';

const NBSP = ' ';

describe('подписи очков', () => {
  it('склонение и дробные', () => {
    expect(pointsWord(1)).toBe('очко');
    expect(pointsWord(3)).toBe('очка');
    expect(pointsWord(11)).toBe('очков');
    expect(pointsWord(21)).toBe('очко');
    expect(pointsWord(4.5)).toBe('очка');
    expect(formatPointsWithUnit(24.5)).toBe(`24,5${NBSP}очка`);
    expect(formatPointsWithUnit(0)).toBe(`0${NBSP}очков`);
  });

  it('место и строка сыгранного', () => {
    expect(placeLabel(1, 5)).toBe(`1-е место из${NBSP}5`);
    expect(placeLabel(null, 5)).toBe('место не определено');
    expect(standingMeta({ played: 6, wins: 1, kos: 2 })).toBe(
      `6${NBSP}вечеров · 1${NBSP}победа · 2${NBSP}нокаута`,
    );
  });
});

describe('правило подсчёта', () => {
  it('из настроек клуба, десятичная запятая', () => {
    expect(scoringRule({ koPoints: 0.5, winBonus: 1 })).toBe(
      'Очки за вечер: +1 за каждого, кто вылетел раньше, +0,5 за нокаут, +1 за победу',
    );
    expect(bestNRule(10)).toBe('В зачёт сезона идут лучшие 10 вечеров игрока');
    expect(bestNRule(4)).toBe('В зачёт сезона идут лучшие 4 вечера игрока');
  });

  it('что из сыгранного в зачёте', () => {
    expect(countedSummary(3, 3)).toBe(`В зачёте все 3${NBSP}вечера`);
    expect(countedSummary(1, 1)).toBe('Единственный вечер в зачёте');
    expect(countedSummary(10, 12)).toBe(`В зачёте лучшие 10 из${NBSP}12`);
    expect(countedSummary(0, 0)).toBe('Вечеров в сезоне ещё не было');
  });
});

describe('короткая дата', () => {
  it('по Москве: 31.12 в 22:00 UTC — уже 1 января', () => {
    expect(formatShortDate('2026-12-31T22:00:00Z')).toMatch(/^1 янв/);
    expect(formatShortDate('2026-10-01T16:00:00Z')).toMatch(/^1 окт/);
  });
});
