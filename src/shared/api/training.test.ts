import { describe, expect, it } from 'vitest';
import { isTrainingEvening, withoutTraining } from './types';

describe('withoutTraining — история клуба без тренировок (миграция 023)', () => {
  it('убирает только помеченные тренировкой; без колонки — обычный вечер', () => {
    const list = [
      { id: 'a', is_training: false },
      { id: 't', is_training: true },
      { id: 'old' },
      { id: 'n', is_training: null },
    ];
    expect(withoutTraining(list).map((e) => e.id)).toEqual(['a', 'old', 'n']);
    expect(isTrainingEvening({ is_training: true })).toBe(true);
    expect(isTrainingEvening({})).toBe(false);
  });
});
