import { describe, expect, it } from 'vitest';
import { gameSuffix } from '../lib/text';
import { gameNoOf, gameNosById } from './types';

describe('номер игры в дне (миграция 026)', () => {
  it('gameNoOf: без колонки и мусор — игра 1', () => {
    expect(gameNoOf({ game_no: 2 })).toBe(2);
    expect(gameNoOf({})).toBe(1);
    expect(gameNoOf({ game_no: null })).toBe(1);
    expect(gameNoOf({ game_no: 0 })).toBe(1);
  });

  it('gameNosById: номер по id — подпись «· игра 2» там, где есть только id и дата', () => {
    const evenings = [{ id: 'g1', game_no: 1 }, { id: 'g2', game_no: 2 }, { id: 'old' }];
    const byId = gameNosById(evenings);
    expect(byId.get('g2')).toBe(2);
    expect(byId.get('old')).toBe(1);
    // Список вечеров игрока, «Моменты», рейтинг сезона: две игры 9 октября различимы.
    const sp = (t: string) => t.replace(/ /g, ' ');
    expect(sp(`9 октября${gameSuffix(byId.get('g2'))}`)).toBe('9 октября · игра 2');
    expect(`9 октября${gameSuffix(byId.get('g1'))}`).toBe('9 октября');
    expect(`9 октября${gameSuffix(byId.get('нет такого'))}`).toBe('9 октября');
    // Один массив — одна карта (кэш на загрузку истории), новый массив — новая.
    expect(gameNosById(evenings)).toBe(byId);
    expect(gameNosById([...evenings])).not.toBe(byId);
  });
});
