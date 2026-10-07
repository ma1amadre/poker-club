import { RECORD_KINDS } from '@domain/records.ts';
import { describe, expect, it } from 'vitest';
import { recordValueParts as recordValue, recordValueText } from '../../shared/lib/clubLife';
import { recordEmptyText } from './records';

const sp = (text: string | null) => text?.replace(/ /g, ' ') ?? null;

describe('значение рекорда', () => {
  it('рубли — по правилам набора, выигрыш со знаком', () => {
    expect(sp(recordValue('biggest_win', 2300).value)).toBe('+2 300 ₽');
    expect(recordValue('biggest_win', 2300).unit).toBeNull();
    expect(sp(recordValue('biggest_pool', 12500).value)).toBe('12 500 ₽');
  });

  it('штуки — число и слово в нужной форме', () => {
    expect(recordValue('most_kos', 1)).toEqual({ value: '1', unit: 'нокаут' });
    expect(recordValue('most_kos', 4)).toEqual({ value: '4', unit: 'нокаута' });
    expect(recordValue('win_streak', 5)).toEqual({ value: '5', unit: 'побед подряд' });
    expect(recordValue('win_streak', 2)).toEqual({ value: '2', unit: 'победы подряд' });
  });

  it('одной строкой — то же значение, что во вкладке «Рекорды»', () => {
    expect(sp(recordValueText('biggest_win', 3130))).toBe('+3 130 ₽');
    expect(sp(recordValueText('most_kos', 4))).toBe('4 нокаута');
    expect(sp(recordValueText('win_streak', 3))).toBe('3 победы подряд');
    expect(sp(recordValueText('longest_game', (4 * 60 + 10) * 60_000))).toBe('4 ч 10 мин');
  });

  it('длина игры — часы и минуты', () => {
    expect(sp(recordValue('longest_game', (3 * 60 + 20) * 60_000).value)).toBe('3 ч 20 мин');
    expect(sp(recordValue('longest_game', 45 * 60_000).value)).toBe('45 мин');
  });

  it('у каждого вида есть подпись пустого рекорда', () => {
    for (const kind of RECORD_KINDS) expect(recordEmptyText(kind).length).toBeGreaterThan(0);
    expect(recordEmptyText('win_streak')).toBe('Серия считается с 2 побед подряд');
  });
});
