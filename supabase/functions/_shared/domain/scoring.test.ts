import { describe, expect, it } from 'vitest';
import { DEFAULT_FORMAT } from './format.ts';
import { replay } from './replay.ts';
import { DEFAULT_SCORING, eveningPoints, placePoints, roundPoints } from './scoring.ts';
import { summarize } from './summary.ts';
import { journal } from './test-utils.ts';

const F = DEFAULT_FORMAT;

describe('очки вечера', () => {
  it('пример из концепции: 6 игроков, победитель с 2 KO — 5 + 1 + 1 = 7, первый вылетевший — 0', () => {
    const j = journal().join('A', 'B', 'C', 'D', 'E', 'F');
    j.start();
    j.bust('F', ['A']);
    j.bust('E', ['B']);
    j.bust('D', ['C']);
    j.bust('C', ['B']);
    j.bust('B', ['A']);
    j.finish();
    const pts = eveningPoints(replay(F, j.events, j.now()), DEFAULT_SCORING);
    expect(pts).toEqual({ A: 7, B: 4 + 1, C: 3 + 0.5, D: 2, E: 1, F: 0 });
  });

  it('KO засчитывается обоим при дележе', () => {
    const j = journal().join('A', 'B', 'C');
    j.bust('C', ['A', 'B']);
    j.bust('B', ['A']);
    j.finish();
    const pts = eveningPoints(replay(F, j.events, j.now()), DEFAULT_SCORING);
    // A: 2 за места + 2 KO·0.5 + 1 победа; B: 1 за место + 0.5 за долю в нокауте C.
    expect(pts).toEqual({ A: 4, B: 1.5, C: 0 });
  });

  it('вылет с ребаем тоже нокаут для выбившего', () => {
    const j = journal().join('A', 'B');
    j.bust('B', ['A']);
    j.rebuy('B');
    j.bust('B', ['A']);
    j.finish();
    expect(eveningPoints(replay(F, j.events, j.now()), DEFAULT_SCORING)).toEqual({
      A: 1 + 1 + 1,
      B: 0,
    });
  });

  it('до finish очков нет', () => {
    const j = journal().join('A', 'B');
    j.bust('B', ['A']);
    expect(eveningPoints(replay(F, j.events, j.now()), DEFAULT_SCORING)).toEqual({});
  });

  it('настраиваемый конфиг и округление хвостов', () => {
    expect(placePoints(1, 4, 3, { koPoints: 0.1, winBonus: 0.2 })).toBe(3.5);
    expect(placePoints(2, 4, 0, { koPoints: 1, winBonus: 5 })).toBe(2);
    expect(roundPoints(0.1 + 0.2)).toBe(0.3);
  });
});

describe('summarize', () => {
  it('компактный итог вечера', () => {
    const j = journal('2026-10-08T16:00:00.000Z').join('A', 'B', 'C', 'D');
    j.start();
    j.wait(30).bust('B', ['A']);
    j.rebuy('B');
    j.wait(30).bust('D', ['A', 'C']); // уровень 2
    j.wait(200).bust('C', ['B']); // уровень 7, ребаи закрыты
    j.bust('B', []);
    j.finish();
    j.payment('B', 1000);
    const sum = summarize('ev1', '2026-10-08T16:00:00.000Z', F, j.events, DEFAULT_SCORING);
    expect(sum).toEqual({
      eveningId: 'ev1',
      date: '2026-10-08T16:00:00.000Z',
      seasonKey: '2026-Q4',
      entrants: ['A', 'B', 'C', 'D'],
      places: ['A', 'B', 'C', 'D'],
      points: { A: 3 + 1 + 1, B: 2 + 0.5, C: 1 + 0.5, D: 0 },
      // фонд 5·400 = 2000 → 1400/600; головы A: 100 + 50 + своя 100 + сиротская B 100 = 350
      netRub: { A: 1400 + 350 - 500, B: 600 + 100 - 1000, C: 50 - 500, D: -500 },
      kos: { A: 2, B: 1, C: 1, D: 0 },
      koPairs: [
        ['A', 'B'],
        ['A', 'D'],
        ['C', 'D'],
        ['B', 'C'],
      ],
      rebuys: { A: 0, B: 1, C: 0, D: 0 },
      bustLevel: { A: null, B: 7, C: 7, D: 2 },
      firstBustPlayerId: 'B',
      busts: [
        { victim: 'B', by: ['A'] },
        { victim: 'D', by: ['A', 'C'] },
        { victim: 'C', by: ['B'] },
        { victim: 'B', by: [] },
      ],
    });
  });

  it('незавершённый вечер — ошибка, а не нулевые очки', () => {
    const j = journal().join('A', 'B');
    expect(() =>
      summarize('ev2', '2026-10-08T16:00:00.000Z', F, j.events, DEFAULT_SCORING),
    ).toThrow(/не завершён/);
  });
});
