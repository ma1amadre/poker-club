// Тексты постов: заголовок итога вечера и его исправленной версии; анонс и итог — без голов.
import { describe, expect, it } from 'vitest';
import { DEFAULT_FORMAT, type TournamentFormat } from './domain/index.ts';
import { announcePost, resultsPost, type ResultsPostInput } from './messages.ts';

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

describe('без баунти «за голову» (убрано 07.10.2026)', () => {
  const plain = (text: string) => text.replace(/ /g, ' ');

  it('анонс: вход, ребай и фишки, ни слова о голове', () => {
    // Снимок формата вечера из базы до миграции 018 ещё мог нести bountyRub — пост его не читает.
    for (const format of [
      DEFAULT_FORMAT,
      { ...DEFAULT_FORMAT, bountyRub: 100 } as TournamentFormat,
    ]) {
      const text = plain(
        announcePost({
          eveningId: 'e1',
          scheduledAt: '2026-10-08T16:00:00.000Z',
          location: null,
          note: null,
          format,
          botUsername: null,
        }).text,
      );
      expect(text).toContain('Вход и ребай по 500 ₽ (500 фишек).');
      expect(text).not.toMatch(/голов|баунти/i);
    }
  });

  it('итог: у мест только призовые, лучший охотник — по числу нокаутов, без денег', () => {
    const text = plain(
      resultsPost({
        ...base,
        names: { a: 'Женя', b: 'Саша', c: 'Дима' },
        places: ['a', 'b', 'c'],
        money: {
          a: { owesRub: 500, prizeRub: 1050, netRub: 550 },
          b: { owesRub: 500, prizeRub: 450, netRub: -50 },
          c: { owesRub: 500, prizeRub: 0, netRub: -500 },
        },
        kos: { a: 1, b: 1, c: 0 },
        totalEntries: 3,
        prizePoolRub: 1500,
      }).text,
    );
    expect(text).toContain('🥇 <b>Женя</b> — приз 1 050 ₽');
    expect(text).toContain('🥈 Саша — приз 450 ₽');
    expect(text).toMatch(/🥉 Дима$/m);
    expect(text).toContain('💰 Фонд 1 500 ₽ · 3 входа');
    expect(text).toContain('🎯 Лучший охотник: Женя и Саша — по 1 нокауту');
    expect(text).not.toMatch(/голов|баунти/i);
  });
});
