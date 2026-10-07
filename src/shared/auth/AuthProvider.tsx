import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Player } from '../api/types';
import { supabase } from '../supabase';
import { getInitData } from '../telegram';
import { AuthContext, type AuthContextValue, type AuthState } from './context';
import { AuthError, DENIED_KINDS, forgetSignIn, signInOnce, toAuthError } from './signIn';

const LOADING: AuthState = { status: 'loading', player: null, isAdmin: false, error: null };

function readyState(player: Player): AuthState {
  return { status: 'ready', player, isAdmin: player.is_admin, error: null };
}

function failedState(error: unknown): AuthState {
  const authError = toAuthError(error);
  return {
    status: DENIED_KINDS.has(authError.kind) ? 'denied' : 'error',
    player: null,
    isAdmin: false,
    error: authError,
  };
}

// initData последнего входа — для повтора и тихого перевхода после потери сессии. На уровне
// модуля, а не в ref: провайдер перемонтируется при переходе на табло и обратно, а вход должен
// переиспользоваться (signInOnce вернёт тот же результат без нового запроса).
let lastInitData: string | null = null;

const NO_TELEGRAM = new AuthError(
  'no_telegram',
  'Открой приложение из Telegram — по кнопке в группе клуба или в чате с ботом.',
);

const DENIED_NO_TELEGRAM: AuthState = {
  status: 'denied',
  player: null,
  isAdmin: false,
  error: NO_TELEGRAM,
};

function currentInitData(): string | null {
  return lastInitData ?? (getInitData() || null);
}

/**
 * Вход при старте: initData из Telegram → tg-auth → verifyOtp. Сессия только в памяти, поэтому
 * вход повторяется при каждом открытии Mini App (это дёшево: один вызов функции).
 * Вне Telegram status = 'denied' с kind 'no_telegram'; в dev AuthGate показывает на этом месте
 * экран выбора тестового игрока, который вызывает signInWithInitData.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  // Начальное состояние известно сразу: есть initData — идёт вход, нет — «открой в Telegram».
  const [state, setState] = useState<AuthState>(() =>
    currentInitData() ? LOADING : DENIED_NO_TELEGRAM,
  );
  const alive = useRef(true);
  // Во время выхода SIGNED_OUT ожидаем и перевходить не нужно.
  const signingOut = useRef(false);
  // Номер попытки входа: состояние ставит только последняя. «Повторить вход» с заставки отменяет
  // прежнюю попытку, и её отказ (или запоздалый успех) не должен перебить новую.
  const attempt = useRef(0);

  /** Асинхронная часть входа: состояние меняется только по результату своей попытки. */
  const complete = useCallback(async (initData: string) => {
    lastInitData = initData;
    const mine = ++attempt.current;
    try {
      const player = await signInOnce(initData);
      if (alive.current && attempt.current === mine) setState(readyState(player));
    } catch (error) {
      if (alive.current && attempt.current === mine) setState(failedState(error));
    }
  }, []);

  /** Начать вход заново (повтор, перевход, выход) — из обработчиков событий, не из эффекта. */
  const restart = useCallback(
    (initData: string | null) => {
      forgetSignIn();
      if (!initData) {
        attempt.current += 1;
        setState(DENIED_NO_TELEGRAM);
        return Promise.resolve();
      }
      setState(LOADING);
      return complete(initData);
    },
    [complete],
  );

  // Вход при монтировании. Состояние меняется только в колбэках промиса — после ответа сервера.
  useEffect(() => {
    alive.current = true;
    const initData = currentInitData();
    if (initData) {
      lastInitData = initData;
      const mine = ++attempt.current;
      signInOnce(initData).then(
        (player) => {
          if (alive.current && attempt.current === mine) setState(readyState(player));
        },
        (error: unknown) => {
          if (alive.current && attempt.current === mine) setState(failedState(error));
        },
      );
    }
    return () => {
      alive.current = false;
    };
  }, []);

  // Сессию можно потерять, если refresh-токен не обновился (телефон долго спал). Пробуем войти
  // заново тем же initData (tg-auth принимает его 24 ч); не вышло — экран ошибки с повтором.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_OUT' || !lastInitData || signingOut.current) return;
      void restart(lastInitData);
    });
    return () => data.subscription.unsubscribe();
  }, [restart]);

  const retry = useCallback(() => void restart(currentInitData()), [restart]);

  const updatePlayer = useCallback((patch: Partial<Player>) => {
    setState((prev) => (prev.player ? readyState({ ...prev.player, ...patch }) : prev));
  }, []);

  const signInWithInitData = useCallback((initData: string) => restart(initData), [restart]);

  const signOut = useCallback(async () => {
    signingOut.current = true;
    lastInitData = null;
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } finally {
      signingOut.current = false;
    }
    await restart(getInitData() || null);
  }, [restart]);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, retry, updatePlayer, signInWithInitData, signOut }),
    [state, retry, updatePlayer, signInWithInitData, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
