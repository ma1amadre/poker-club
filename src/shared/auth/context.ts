import { createContext, useContext } from 'react';
import type { Player } from '../api/types';
import type { AuthError } from './signIn';

export type AuthStatus = 'loading' | 'ready' | 'denied' | 'error';

export interface AuthState {
  status: AuthStatus;
  /** Игрок текущей сессии; есть только при status = 'ready'. */
  player: Player | null;
  isAdmin: boolean;
  /** Причина для 'denied' и 'error'. */
  error: AuthError | null;
}

export interface AuthContextValue extends AuthState {
  /** Повторить вход (экран ошибки, истёкшая сессия). */
  retry: () => void;
  /** Обновить игрока в контексте после правки профиля (set_my_name и т. п.). */
  updatePlayer: (patch: Partial<Player>) => void;
  /**
   * Вход с готовым initData. Нужен dev-экрану выбора тестового игрока; в Telegram вход
   * запускается сам при старте.
   */
  signInWithInitData: (initData: string) => Promise<void>;
  /** Выйти (dev: сменить тестового игрока). В Telegram смысла не имеет — вход автоматический. */
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth вызван вне AuthProvider');
  return value;
}

/** Игрок текущей сессии; вызывать только под AuthGate (status = 'ready'). */
export function useCurrentPlayer(): Player {
  const { player } = useAuth();
  if (!player) throw new Error('useCurrentPlayer вызван до входа');
  return player;
}
