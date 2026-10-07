// Удержание экрана (Screen Wake Lock API): табло часами висит на ТВ, телефон банкира лежит на столе
// с пультом. Браузер снимает удержание, когда страница уходит в фон, и может отказать (энергосбережение,
// нет жеста пользователя) — тогда пробуем снова при возврате на экран и на ближайшем касании.
// Чистая логика без React: окружение (navigator.wakeLock, document) передаётся — тестируется в node.
// Telegram своего метода «не гасить экран» не даёт; работает ли API внутри WebView Telegram, зависит
// от платформы — где его нет, экран показывает подсказку (wakeLockHint).

export type WakeLockStatus =
  /** API нет: браузер (WebView) не умеет держать экран. */
  | 'unsupported'
  /** Экран удерживается. */
  | 'held'
  /** Удержания сейчас нет (страница в фоне, браузер снял) — возьмём снова при возврате. */
  | 'released'
  /** Браузер отказал в удержании; повторим на касании или при возврате на экран. */
  | 'denied';

export interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

export interface WakeLockEnv {
  wakeLock: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
  doc: {
    visibilityState: string;
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
  };
}

/**
 * Держать экран включённым, пока не вызвана функция-отмена. Статус — в onStatus. После отмены
 * удержание снимается, статус больше не сообщается.
 */
export function keepScreenAwake(
  env: WakeLockEnv,
  onStatus: (status: WakeLockStatus) => void,
): () => void {
  let sentinel: WakeLockSentinelLike | null = null;
  let disposed = false;
  let pending = false;

  const acquire = async () => {
    if (disposed || pending || sentinel || env.doc.visibilityState !== 'visible') return;
    pending = true;
    try {
      const lock = await env.wakeLock.request('screen');
      if (disposed) {
        void lock.release().catch(() => undefined);
        return;
      }
      sentinel = lock;
      onStatus('held');
      lock.addEventListener('release', () => {
        sentinel = null;
        if (!disposed) onStatus('released');
      });
    } catch {
      if (!disposed) onStatus('denied');
    } finally {
      pending = false;
    }
  };

  const retry = () => {
    if (env.doc.visibilityState === 'visible') void acquire();
  };

  void acquire();
  env.doc.addEventListener('visibilitychange', retry);
  // Некоторые браузеры дают удержание только после жеста пользователя — пробуем на касании.
  env.doc.addEventListener('pointerdown', retry);
  return () => {
    disposed = true;
    env.doc.removeEventListener('visibilitychange', retry);
    env.doc.removeEventListener('pointerdown', retry);
    void sentinel?.release().catch(() => undefined);
    sentinel = null;
  };
}

/** Подсказка, когда экран не удержать: API нет или браузер отказал. null — подсказка не нужна. */
export function wakeLockHint(status: WakeLockStatus): string | null {
  return status === 'unsupported' || status === 'denied'
    ? 'Отключи автоблокировку на время игры: телефон не даёт приложению держать экран включённым.'
    : null;
}
