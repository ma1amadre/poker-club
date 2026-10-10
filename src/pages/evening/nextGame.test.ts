import { describe, expect, it } from 'vitest';
import {
  eveningTitle,
  NEXT_GAME_WINDOW_MS,
  nextGameAvailable,
  nextGameToast,
  previousGameRoster,
  promotedToast,
  promoteQuestion,
} from './nextGame';

const sp = (text: string | undefined) => text?.replace(/ /g, ' ');

describe('«Ещё игра сегодня» (миграция 026)', () => {
  // Дневная игра 09.10: начало 06:00 МСК, финал 08:00 МСК — окно в 12 ч кончается до полуночи.
  const NOW = Date.parse('2026-10-09T06:00:00Z');
  const finished = {
    status: 'finished',
    scheduled_at: '2026-10-09T03:00:00Z',
    finished_at: '2026-10-09T05:00:00Z',
    is_training: false,
  };

  it('банкиру и админу 12 ч после финала настоящего вечера', () => {
    expect(nextGameAvailable(finished, true, NOW)).toBe(true);
    expect(nextGameAvailable({ ...finished, status: 'settled' }, true, NOW)).toBe(true);
    expect(nextGameAvailable(finished, false, NOW)).toBe(false);
    expect(nextGameAvailable({ ...finished, is_training: true }, true, NOW)).toBe(false);
    expect(nextGameAvailable({ ...finished, status: 'live' }, true, NOW)).toBe(false);
    expect(nextGameAvailable({ ...finished, finished_at: null }, true, NOW)).toBe(false);
    const finishedMs = Date.parse(finished.finished_at);
    expect(nextGameAvailable(finished, true, finishedMs + NEXT_GAME_WINDOW_MS - 1)).toBe(true);
    expect(nextGameAvailable(finished, true, finishedMs + NEXT_GAME_WINDOW_MS)).toBe(false);
  });

  it('после полуночи по Москве — нет: новая игра легла бы на другую дату', () => {
    // Игра 1 — 19:00 МСК 09.10, финал 23:50 МСК: окно в 12 ч ещё идёт, но день кончается в 00:00 МСК.
    const late = {
      ...finished,
      scheduled_at: '2026-10-09T16:00:00Z',
      finished_at: '2026-10-09T20:50:00Z',
    };
    expect(nextGameAvailable(late, true, Date.parse('2026-10-09T20:59:00Z'))).toBe(true);
    expect(nextGameAvailable(late, true, Date.parse('2026-10-09T21:00:00Z'))).toBe(false);
    expect(nextGameAvailable(late, true, Date.parse('2026-10-09T21:10:00Z'))).toBe(false);
  });

  it('тост: создана или уже была', () => {
    expect(nextGameToast({ gameNo: 2, created: true }).success).toBe('Игра 2 создана');
    expect(nextGameToast({ gameNo: 2, created: false })).toEqual({
      success: 'Игра 2 уже создана',
      detail: 'Открываю её.',
    });
  });

  it('шапка: «Вечер 9 октября · игра 2»; у игры 1 и тренировки — без номера', () => {
    expect(sp(eveningTitle(false, '9 октября', 2))).toBe('Вечер 9 октября · игра 2');
    expect(eveningTitle(false, '9 октября', 1)).toBe('Вечер 9 октября');
    expect(eveningTitle(false, '9 октября', undefined)).toBe('Вечер 9 октября');
    expect(eveningTitle(true, '9 октября', 2)).toBe('Тренировка 9 октября');
  });
});

describe('состав прошлой игры дня', () => {
  const game1 = { id: 'g1', scheduled_at: '2026-10-09T12:00:00Z', game_no: 1 };
  const game2 = { id: 'g2', scheduled_at: '2026-10-09T19:30:00Z', game_no: 2 };
  const game3 = { id: 'g3', scheduled_at: '2026-10-09T20:00:00Z', game_no: 3 };
  const other = { id: 'x', scheduled_at: '2026-10-02T12:00:00Z', game_no: 1 };
  const history = {
    evenings: [game2, game1, other],
    summaryById: new Map([
      ['g1', { entrants: ['a', 'b', 'c'] }],
      ['g2', { entrants: ['a', 'd'] }],
      ['x', { entrants: ['z'] }],
    ]),
  };

  it('игра 2 — состав игры 1; игра 3 — состав игры 2', () => {
    expect(previousGameRoster(game2, history)).toEqual({ gameNo: 1, playerIds: ['a', 'b', 'c'] });
    expect(previousGameRoster(game3, history)).toEqual({ gameNo: 2, playerIds: ['a', 'd'] });
  });

  it('игра 1, тренировка, нет истории или прошлой игры в ней — null', () => {
    expect(previousGameRoster(game1, history)).toBeNull();
    expect(previousGameRoster({ ...game2, is_training: true }, history)).toBeNull();
    expect(previousGameRoster(game2, undefined)).toBeNull();
    expect(
      previousGameRoster(game2, { evenings: [other], summaryById: history.summaryById }),
    ).toBeNull();
    // Игра другого дня — не прошлая игра этого.
    expect(
      previousGameRoster({ ...game2, scheduled_at: '2026-10-10T12:00:00Z' }, history),
    ).toBeNull();
  });
});

describe('зачёт тренировки', () => {
  it('вопрос: последствия, необратимость и гости', () => {
    const q = promoteQuestion([]);
    expect(q.title).toBe('Засчитать как настоящий вечер?');
    expect(q.danger).toBe(true);
    for (const word of [
      'рейтинг',
      'ачивки',
      'деньги',
      'пост итогов',
      '24 часа',
      'отменить это нельзя',
    ])
      expect(q.message).toContain(word);
    expect(q.message).not.toMatch(/Гост/);
    expect(promoteQuestion(['Вова']).message).toContain('Гость Вова в рейтинг не попадёт');
    expect(promoteQuestion(['Вова', 'Петя']).message).toContain(
      'Гости Вова и Петя в рейтинг не попадут',
    );
  });

  it('тост: номер игры и судьба поста итогов', () => {
    expect(promotedToast(2, 'posted')).toEqual({
      success: 'Тренировка засчитана как вечер',
      detail: 'Это игра 2 дня. Голосование открыто 24 часа. Итоги — в группе.',
    });
    expect(promotedToast(1, 'failed').detail).toBe(
      'Голосование открыто 24 часа. Итоги бот отправит в группу сам в течение 15 минут.',
    );
    expect(promotedToast(1, 'no_group').detail).toMatch(/не подключена/);
  });
});
