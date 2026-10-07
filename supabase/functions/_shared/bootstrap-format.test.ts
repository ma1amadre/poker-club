// Клубный формат, который миграция 011 заводит в облаке (там seed.sql не выполняется), должен
// совпадать с DEFAULT_FORMAT домена: иначе cron-tick и форма вечера в облаке взяли бы другой формат,
// чем тот, что проверяют тесты домена. Баунти «за голову» убрано 07.10.2026: литерал 011 ещё несёт
// bountyRub (применённую миграцию не правим), миграция 018 этот ключ вычищает — сверяем итог обеих.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FORMAT, validateFormat } from './domain/index.ts';

const readMigration = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../migrations/${name}`, import.meta.url)), 'utf8');

const migration = readMigration('011_cloud_bootstrap.sql');
const dropBounty = readMigration('018_drop_bounty.sql');

/** jsonb-литерал конфига: первая строка в одинарных кавычках, за которой идёт ::jsonb. */
function formatLiteral(sql: string): Record<string, unknown> {
  const m = /'(\{[^']*\})'::jsonb/.exec(sql);
  if (!m?.[1]) throw new Error('В 011_cloud_bootstrap.sql не найден jsonb-литерал формата');
  return JSON.parse(m[1]) as Record<string, unknown>;
}

/** Что остаётся от конфига после 018: тот же объект без ключа bountyRub. */
function withoutBounty(config: Record<string, unknown>): Record<string, unknown> {
  const { bountyRub: _dropped, ...rest } = config;
  return rest;
}

describe('миграция 011 + 018: клубный формат', () => {
  it('после 018 совпадает с DEFAULT_FORMAT', () => {
    expect(withoutBounty(formatLiteral(migration))).toEqual(DEFAULT_FORMAT);
  });

  it('проходит validateFormat и до 018: bountyRub молча игнорируется', () => {
    expect(formatLiteral(migration)).toHaveProperty('bountyRub');
    expect(validateFormat(formatLiteral(migration))).toEqual([]);
    expect(validateFormat(withoutBounty(formatLiteral(migration)))).toEqual([]);
  });

  it('018 вычищает bountyRub из конфигов форматов и снимков формата всех вечеров', () => {
    const sql = dropBounty.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
    expect(sql).toContain("update public.formats set config = config - 'bountyRub'");
    expect(sql).toContain("update public.evenings set format = format - 'bountyRub'");
    // Без фильтра по статусу: снимок чистится у вечера в любом статусе.
    expect(sql).not.toMatch(/status/);
  });

  it('строка formats называется так же, как формат', () => {
    expect(migration).toMatch(new RegExp(`'${DEFAULT_FORMAT.name}',\\s*'\\{`));
  });
});
