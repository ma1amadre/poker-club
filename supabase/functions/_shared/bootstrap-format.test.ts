// Клубный формат, который миграция 011 заводит в облаке (там seed.sql не выполняется), должен
// совпадать с DEFAULT_FORMAT домена: иначе cron-tick и форма вечера в облаке взяли бы другой формат,
// чем тот, что проверяют тесты домена.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FORMAT, validateFormat } from './domain/index.ts';

const migration = readFileSync(
  fileURLToPath(new URL('../../migrations/011_cloud_bootstrap.sql', import.meta.url)),
  'utf8',
);

/** jsonb-литерал конфига: первая строка в одинарных кавычках, за которой идёт ::jsonb. */
function formatLiteral(sql: string): unknown {
  const m = /'(\{[^']*\})'::jsonb/.exec(sql);
  if (!m?.[1]) throw new Error('В 011_cloud_bootstrap.sql не найден jsonb-литерал формата');
  return JSON.parse(m[1]);
}

describe('миграция 011: клубный формат', () => {
  it('совпадает с DEFAULT_FORMAT', () => {
    expect(formatLiteral(migration)).toEqual(DEFAULT_FORMAT);
  });

  it('проходит validateFormat', () => {
    expect(validateFormat(formatLiteral(migration))).toEqual([]);
  });

  it('строка formats называется так же, как формат', () => {
    expect(migration).toMatch(new RegExp(`'${DEFAULT_FORMAT.name}',\\s*'\\{`));
  });
});
