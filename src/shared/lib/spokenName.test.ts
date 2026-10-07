import { describe, expect, it } from 'vitest';
import { emptySpokenNameNote, isVoiced, spokenNameChanged, spokenNameValue } from './spokenName';

describe('имя для озвучки в формах', () => {
  it('пустое поле: табло скажет имя в клубе или никак', () => {
    expect(emptySpokenNameNote('Женя', true)).toBe('Пусто — табло скажет имя в клубе: «Женя».');
    expect(emptySpokenNameNote('Erdni', true)).toMatch(/не назовёт тебя/);
    expect(emptySpokenNameNote('Erdni', false)).toMatch(/не назовёт игрока/);
  });

  it('значение и изменение — как сохранит сервер', () => {
    expect(spokenNameValue('  Эрдн+и  ')).toBe('Эрдн+и');
    expect(spokenNameValue('   ')).toBeNull();
    expect(spokenNameChanged(' Эрдн+и ', 'Эрдн+и')).toBe(false);
    expect(spokenNameChanged('', null)).toBe(false);
    expect(spokenNameChanged('', 'Эрдн+и')).toBe(true);
    expect(spokenNameChanged('Эрдни', undefined)).toBe(true);
  });

  it('кого табло называет', () => {
    expect(isVoiced({ display_name: 'Erdni', spoken_name: null })).toBe(false);
    expect(isVoiced({ display_name: 'Erdni', spoken_name: 'Эрдн+и' })).toBe(true);
  });
});
