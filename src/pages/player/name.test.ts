import { describe, expect, it } from 'vitest';
import { nameError } from './name';
import { normalizeName } from '../../shared/lib/text';

describe('имя игрока', () => {
  it('пробелы схлопываются, как на сервере', () => {
    expect(normalizeName('  Женя   Смирнов ')).toBe('Женя Смирнов');
  });

  it('пустое и слишком длинное — с подсказкой, как исправить', () => {
    expect(nameError('   ')).toMatch(/Введите/);
    expect(nameError('я'.repeat(41))).toMatch(/Сократите/);
    expect(nameError('я'.repeat(40))).toBeNull();
  });

  it('то же имя — не отправляем', () => {
    expect(nameError(' Женя ', 'Женя')).toMatch(/уже стоит/);
    expect(nameError('Евгений', 'Женя')).toBeNull();
  });
});
