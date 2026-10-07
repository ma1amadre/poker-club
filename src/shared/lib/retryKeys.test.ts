import { describe, expect, it } from 'vitest';
import {
  createRetryKeys,
  RETRY_KEY_MS,
  RETRY_STORAGE_KEY,
  retryIntent,
  type StorageLike,
} from './retryKeys';

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

function ids() {
  let n = 0;
  return () => `key-${++n}`;
}

const T0 = Date.parse('2026-10-09T16:00:00Z');

describe('createRetryKeys', () => {
  it('новое намерение — новый ключ; не дошедшее — тот же ключ при повторе', () => {
    const keys = createRetryKeys(null, ids());
    const intent = retryIntent('ev', 'payment', { playerId: 'a', amountRub: 500 });
    const first = keys.keyFor(intent, T0);
    expect(first).toBe('key-1');
    keys.failed(intent, first, T0);
    expect(keys.keyFor(intent, T0 + 60_000)).toBe(first);
    // Другое намерение — свой ключ.
    expect(keys.keyFor(retryIntent('ev', 'payment', { playerId: 'a', amountRub: 600 }), T0)).toBe(
      'key-2',
    );
  });

  it('прошедшая запись ключ забывает: следующее такое же нажатие — новое намерение', () => {
    const keys = createRetryKeys(null, ids());
    const intent = retryIntent('ev', 'level_next', {});
    const key = keys.keyFor(intent, T0);
    keys.failed(intent, key, T0);
    keys.succeeded(intent);
    expect(keys.keyFor(intent, T0 + 1000)).not.toBe(key);
  });

  it('запись с ключом уже видна в журнале — новое нажатие не повтор: ключ новый', () => {
    // Тайм-аут, но первая попытка дошла: журнал её показал. Ещё один «Уровень вперёд» (или вылет
    // после ребая) с тем же ключом сервер вернул бы старой записью — и новая бы не появилась.
    const storage = memoryStorage();
    const keys = createRetryKeys(storage, ids());
    const intent = retryIntent('ev', 'level_next', {});
    const key = keys.keyFor(intent, T0);
    keys.failed(intent, key, T0);
    const journal = new Set<string>();
    expect(keys.keyFor(intent, T0 + 1000, (k) => journal.has(k))).toBe(key); // ещё не видно — повтор
    journal.add(key);
    const next = keys.keyFor(intent, T0 + 2000, (k) => journal.has(k));
    expect(next).not.toBe(key);
    expect(storage.data.get(RETRY_STORAGE_KEY)).toBe('{}');
  });

  it('landed: попытка без ответа дошла — её ключ, пока решение не принято', () => {
    // Сценарий ревью: «Другая сумма» 300 ₽, тайм-аут на 15-й секунде, сервер дописал платёж на
    // 16-й, перезапрос журнала его привёз. Повтор на 20-й секунде с новым ключом записал бы второй
    // платёж — экран сначала спрашивает (useEveningActions.confirmIfLanded).
    const keys = createRetryKeys(null, ids());
    const intent = retryIntent('ev', 'payment', { playerId: 'a', amountRub: 300 });
    const key = keys.keyFor(intent, T0);
    const journal = new Set<string>();
    const inJournal = (k: string) => journal.has(k);
    expect(keys.landed(intent, T0, inJournal)).toBe(null); // попытки без ответа нет
    keys.failed(intent, key, T0 + 15_000);
    expect(keys.landed(intent, T0 + 15_500, inJournal)).toBe(null); // запись ещё не видна
    journal.add(key);
    expect(keys.landed(intent, T0 + 20_000, inJournal)).toBe(key);
    // Решение принято (не записывать или записать ещё одну) — вопроса больше нет, ключ новый.
    keys.succeeded(intent);
    expect(keys.landed(intent, T0 + 21_000, inJournal)).toBe(null);
    expect(keys.keyFor(intent, T0 + 21_000, inJournal)).not.toBe(key);
  });

  it('landed: прошедшая с ответом запись и старая неудача — не повод спрашивать', () => {
    const keys = createRetryKeys(null, ids());
    const intent = retryIntent('ev', 'hand', {});
    const journal = new Set<string>();
    const inJournal = (k: string) => journal.has(k);
    // Ответ пришёл — ключ забыт: следующая раздача — новое действие без вопроса.
    const ok = keys.keyFor(intent, T0);
    journal.add(ok);
    keys.succeeded(intent);
    expect(keys.landed(intent, T0 + 1000, inJournal)).toBe(null);
    // Неудача дальше окна повтора: следующее нажатие — новое намерение.
    const lost = keys.keyFor(intent, T0);
    keys.failed(intent, lost, T0);
    journal.add(lost);
    expect(keys.landed(intent, T0 + RETRY_KEY_MS - 1, inJournal)).toBe(lost);
    expect(keys.landed(intent, T0 + RETRY_KEY_MS, inJournal)).toBe(null);
  });

  it('окно повтора — RETRY_KEY_MS от последней неудачи', () => {
    const keys = createRetryKeys(null, ids());
    const intent = retryIntent('ev', 'rebuy', { playerId: 'b' });
    const key = keys.keyFor(intent, T0);
    keys.failed(intent, key, T0);
    expect(keys.keyFor(intent, T0 + RETRY_KEY_MS - 1)).toBe(key);
    keys.failed(intent, key, T0 + RETRY_KEY_MS - 1); // снова не дошла — окно сдвигается
    expect(keys.keyFor(intent, T0 + 2 * RETRY_KEY_MS - 2)).toBe(key);
    expect(keys.keyFor(intent, T0 + 2 * RETRY_KEY_MS)).not.toBe(key);
  });

  it('переживает перезагрузку: новое хранилище читает ключи из storage', () => {
    const storage = memoryStorage();
    const before = createRetryKeys(storage, ids());
    const intent = retryIntent('ev', 'payment', { playerId: 'a', amountRub: 500 });
    const key = before.keyFor(intent, T0);
    before.failed(intent, key, T0);

    const after = createRetryKeys(storage, () => 'fresh');
    expect(after.keyFor(intent, T0 + 30_000)).toBe(key);
    after.succeeded(intent);
    expect(createRetryKeys(storage, () => 'fresh').keyFor(intent, T0)).toBe('fresh');
  });

  it('недоступное или битое хранилище не мешает: ключи живут в памяти', () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const keys = createRetryKeys(broken, ids());
    const intent = retryIntent('ev', 'bust', { playerId: 'b', by: [] });
    const key = keys.keyFor(intent, T0);
    expect(() => keys.failed(intent, key, T0)).not.toThrow();
    expect(keys.keyFor(intent, T0 + 1)).toBe(key);

    const junk = memoryStorage();
    junk.data.set(RETRY_STORAGE_KEY, '{не json');
    expect(createRetryKeys(junk, () => 'n').keyFor(intent, T0)).toBe('n');
    junk.data.set(RETRY_STORAGE_KEY, JSON.stringify({ [intent]: { id: 5, failedAt: 'x' } }));
    expect(createRetryKeys(junk, () => 'n').keyFor(intent, T0)).toBe('n');
  });

  it('старые ключи вычищаются, хранится не больше 50', () => {
    const storage = memoryStorage();
    const keys = createRetryKeys(storage, ids());
    for (let i = 0; i < 60; i += 1) keys.failed(`i${i}`, `k${i}`, T0 + i);
    const saved = JSON.parse(storage.data.get(RETRY_STORAGE_KEY) ?? '{}') as Record<
      string,
      unknown
    >;
    expect(Object.keys(saved)).toHaveLength(50);
    expect(saved.i0).toBeUndefined();
    expect(saved.i59).toBeDefined();
    keys.failed('late', 'kl', T0 + RETRY_KEY_MS + 100);
    const pruned = JSON.parse(storage.data.get(RETRY_STORAGE_KEY) ?? '{}') as Record<
      string,
      unknown
    >;
    expect(Object.keys(pruned)).toEqual(['late']);
  });
});
