// Ключи повтора записей (миграция 007: add_event, миграция 019: add_guest). Один ключ — одно
// намерение банкира. Запись не дошла (ошибка, тайм-аут, ответ потерялся) — ключ запоминается, и
// повторное нажатие той же кнопки уходит с ним: если первая попытка на самом деле записалась,
// сервер вернёт её, а не запишет второй платёж или второго гостя.
//
// Ключи живут в sessionStorage: переживают перезагрузку страницы WebView (Telegram перезагружает
// Mini App после долгого сна), но не закрытие Mini App. Хранилище бывает недоступно (приватный
// режим, запрет сайта, превью) — тогда ключи живут в памяти, как раньше; всё в try/catch.
// Секретов здесь нет: ключ — случайный uuid, намерение — тип записи, id игроков и суммы.

/** Сколько помнить ключ неудавшейся записи: повтор в этом окне — то же намерение. */
export const RETRY_KEY_MS = 5 * 60_000;
/** Больше ключей не держим: старые вытесняются. */
const MAX_KEYS = 50;
export const RETRY_STORAGE_KEY = 'poker-club:retry-keys';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

interface Entry {
  id: string;
  failedAt: number;
}

export interface RetryKeys {
  /**
   * Ключ для намерения: недавно не дошедшая запись — её ключ, иначе новый. `inJournal(key)` — запись
   * с этим ключом уже видна в журнале: первая попытка дошла, экран это показал, и новое нажатие —
   * новое намерение (вылет после ребая, ещё один уровень), а не повтор; ключ забывается.
   */
  keyFor(intent: string, nowMs: number, inJournal?: (key: string) => boolean): string;
  /**
   * Последняя попытка намерения осталась без ответа (ошибка, тайм-аут), а запись с её ключом уже
   * видна в журнале: сервер записал, ответ потерялся. Ключ этой записи или null. Повтор после
   * этого keyFor считает новым намерением (новый ключ) — и задвоил бы запись, поэтому экран сначала
   * спрашивает, нужна ли ещё одна (useEveningActions). Решение принято — `succeeded(intent)`.
   */
  landed(intent: string, nowMs: number, inJournal: (key: string) => boolean): string | null;
  /** Запись не дошла: повтор этого намерения в течение RETRY_KEY_MS пойдёт с этим ключом. */
  failed(intent: string, key: string, nowMs: number): void;
  /** Запись прошла: ключ больше не нужен. */
  succeeded(intent: string): void;
}

function isEntry(value: unknown): value is Entry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return typeof e.id === 'string' && e.id !== '' && typeof e.failedAt === 'number';
}

function load(storage: StorageLike | null, key: string): Map<string, Entry> {
  const map = new Map<string, Entry>();
  if (!storage) return map;
  try {
    const raw = storage.getItem(key);
    if (!raw) return map;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return map;
    for (const [intent, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (isEntry(entry)) map.set(intent, { id: entry.id, failedAt: entry.failedAt });
    }
  } catch {
    // Битая запись или хранилище недоступно — начинаем с пустого.
  }
  return map;
}

/**
 * Хранилище ключей. Память — источник правды, storage — копия, чтобы пережить перезагрузку:
 * читается один раз при создании, пишется при каждом изменении.
 */
export function createRetryKeys(
  storage: StorageLike | null,
  newId: () => string,
  storageKey = RETRY_STORAGE_KEY,
): RetryKeys {
  const entries = load(storage, storageKey);

  const prune = (nowMs: number) => {
    for (const [intent, e] of entries) {
      // Время из будущего (сбитые часы устройства) тоже не держим.
      if (nowMs - e.failedAt >= RETRY_KEY_MS || e.failedAt - nowMs > RETRY_KEY_MS)
        entries.delete(intent);
    }
    const extra = entries.size - MAX_KEYS;
    if (extra > 0) {
      const oldest = [...entries].sort((a, b) => a[1].failedAt - b[1].failedAt).slice(0, extra);
      for (const [intent] of oldest) entries.delete(intent);
    }
  };

  const save = () => {
    if (!storage) return;
    try {
      storage.setItem(storageKey, JSON.stringify(Object.fromEntries(entries)));
    } catch {
      // Квота или запрет — ключи остаются в памяти.
    }
  };

  /** Неудача в окне повтора; время из будущего (сбитые часы устройства) — тоже не в окне. */
  const recent = (e: Entry, nowMs: number) =>
    nowMs - e.failedAt < RETRY_KEY_MS && e.failedAt - nowMs <= RETRY_KEY_MS;

  return {
    keyFor(intent, nowMs, inJournal) {
      const e = entries.get(intent);
      if (e && inJournal?.(e.id)) {
        entries.delete(intent);
        save();
        return newId();
      }
      if (e && recent(e, nowMs)) return e.id;
      return newId();
    },
    landed(intent, nowMs, inJournal) {
      const e = entries.get(intent);
      return e && recent(e, nowMs) && inJournal(e.id) ? e.id : null;
    },
    failed(intent, key, nowMs) {
      entries.set(intent, { id: key, failedAt: nowMs });
      prune(nowMs);
      save();
    },
    succeeded(intent) {
      if (!entries.delete(intent)) return;
      save();
    },
  };
}

/** sessionStorage, если он есть и доступен; иначе null (ключи — только в памяти). */
export function safeSessionStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined') return null;
    const storage = window.sessionStorage;
    return storage ?? null;
  } catch {
    return null;
  }
}

/** Намерение «тип + данные» вечера: одинаковые нажатия дают одинаковую строку. */
export function retryIntent(eveningId: string, kind: string, payload: unknown): string {
  return `${eveningId}:${kind}:${JSON.stringify(payload)}`;
}
