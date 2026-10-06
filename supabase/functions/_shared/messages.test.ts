// Тексты постов: заголовок итога вечера и его исправленной версии.
import { describe, expect, it } from 'vitest';
import { resultsPost, type ResultsPostInput } from './messages.ts';

const base: ResultsPostInput = {
  eveningId: 'e1',
  scheduledAt: '2026-10-08T16:00:00.000Z',
  location: null,
  names: { a: 'Женя', b: 'Саша' },
  places: ['a', 'b'],
  money: {},
  kos: {},
  totalEntries: 2,
  rebuysTotal: 0,
  prizePoolRub: 800,
  newAchievements: [],
  votingClosesAt: null,
  botUsername: null,
  nowMs: Date.parse('2026-10-08T21:00:00.000Z'),
};

// Даты в постах склеены неразрывным пробелом — для сравнения заменяем обычным.
const firstLine = (text: string) => (text.split('\n')[0] ?? '').replace(/ /g, ' ');

describe('resultsPost', () => {
  it('обычный итог', () => {
    const text = resultsPost(base).text;
    expect(firstLine(text)).toBe('♠️ <b>Итоги вечера 8 октября</b>');
    expect(text).not.toMatch(/устарел/);
  });

  it('повторная публикация после отмены finish или правки — «Исправленные итоги»', () => {
    const text = resultsPost({ ...base, corrected: true }).text;
    expect(firstLine(text)).toBe('♠️ <b>Исправленные итоги вечера 8 октября</b>');
    expect(text).toMatch(/Прошлый пост с итогами устарел/);
  });
});
