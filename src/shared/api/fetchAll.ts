import { toError } from './errors';

// PostgREST отдаёт не больше max_rows строк за запрос (1000 в config.toml и по умолчанию в облаке),
// а журнал всех вечеров клуба за пару лет больше. Без постраничной догрузки история молча
// обрезалась бы — и очки, ачивки, деньги считались бы по неполным данным.
const PAGE = 1000;

export interface RangeQuery<T> {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: unknown }>;
}

/**
 * Забирает все строки запроса страницами. `build` должен каждый раз строить НОВЫЙ запрос
 * с детерминированной сортировкой (иначе страницы могут пересекаться).
 */
export async function fetchAll<T>(build: () => RangeQuery<T>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw toError(error);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** Делит список на куски: длинный `in.(...)` в URL упирается в лимиты прокси. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
