// Предел ожидания ответа сервера. Зависшее соединение хуже обрыва: без него заставка входа и шторки
// пульта висят бесконечно, а закрыть их нельзя, пока идёт отправка. Чистый модуль (без React и
// supabase-js) — тестируется в node.

/** Вход в клуб (tg-auth + verifyOtp + профиль): дольше — экран ошибки с «Повторить вход». */
export const SIGN_IN_TIMEOUT_MS = 12_000;
/** Через столько на заставке входа появляется «Связь медленная» и кнопка повтора. */
export const SIGN_IN_SLOW_MS = 7_000;
/** Запись в журнал вечера, платёж, олл-ин, гость, призовые, отметка расчёта. */
export const WRITE_TIMEOUT_MS = 15_000;

/** Сервер не ответил за отведённое время. Сообщение — по-русски, его показывают как есть. */
export class TimeoutError extends Error {
  readonly ms: number;

  constructor(message: string, ms: number) {
    super(message);
    this.name = 'TimeoutError';
    this.ms = ms;
  }
}

export function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof TimeoutError;
}

/**
 * Запустить запрос с пределом ожидания. `run` получает сигнал отмены — его отдают fetch или
 * supabase-js (`abortSignal`, `signal`), чтобы зависший запрос не держал соединение. По истечении
 * `ms` промис отклоняется ошибкой `onTimeout()` сразу, не дожидаясь, чем кончится сам запрос:
 * сервер мог успеть записать — повтор с тем же ключом повтора это учтёт. Внешний `signal` (повтор
 * входа вручную) отменяет запрос так же, с его `reason`.
 */
export function withTimeout<T>(
  run: (signal: AbortSignal) => PromiseLike<T>,
  ms: number,
  onTimeout: () => Error,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const stop = (error: unknown) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onOuterAbort);
      reject(error);
      controller.abort();
    };
    const onOuterAbort = () => stop(signal?.reason ?? new Error('Запрос отменён'));
    const timer = setTimeout(() => stop(onTimeout()), ms);
    if (signal?.aborted) {
      onOuterAbort();
      return;
    }
    signal?.addEventListener('abort', onOuterAbort);
    let pending: PromiseLike<T>;
    try {
      pending = run(controller.signal);
    } catch (error) {
      stop(error);
      return;
    }
    Promise.resolve(pending).then(
      (value) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onOuterAbort);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onOuterAbort);
        reject(error);
      },
    );
  });
}
