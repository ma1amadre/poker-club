// Бомб-пот на экране вечера (миграция 030): открытый бомб-пот, на связи ли табло и что показать на
// месте числа (bombPotView.ts, phoneBombView). Отметку табло (board_presence, раз в 10 с) читаем только
// пока она нужна — бомб-пот объявлен меньше полминуты назад или открыта шторка «Бомб-пот»: без табло
// телефоны разыгрывают взнос сами (решение 10). Экран вечера тикает раз в секунду — розыгрыш на
// телефоне идёт своими кадрами (requestAnimationFrame), а число встаёт ровно в at + 9 с (таймер).
import { visibleBombPot } from '@domain/bombPot.ts';
import type { BombPotState } from '@domain/types.ts';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useBoardPresence } from '../../shared/api';
import { serverNow } from '../../shared/lib';
import { boardOnlineFrom, phoneBombView, type PhoneBombView } from './bombPotView';
import type { EveningModel } from './useEveningModel';

/** Отметку табло читаем столько после броска: дольше число уже показано при любом раскладе. */
const PRESENCE_WINDOW_MS = 30_000;

const REDUCED = '(prefers-reduced-motion: reduce)';

function subscribeReduced(onChange: () => void): () => void {
  const media = typeof window === 'undefined' ? undefined : window.matchMedia?.(REDUCED);
  media?.addEventListener?.('change', onChange);
  return () => media?.removeEventListener?.('change', onChange);
}

/** Спокойный режим устройства: розыгрыша на телефоне нет, число — сразу. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () => Boolean(window.matchMedia?.(REDUCED).matches),
    () => false,
  );
}

/**
 * Табло вечера на связи: отметка свежее минуты — true, старше или её нет — false, ещё грузится, не
 * читаем или в кеше ответ прошлого окна (свежий в пути) — null (boardOnlineFrom). enabled — читать
 * ли сейчас.
 */
export function useBoardOnline(eveningId: string, enabled: boolean, nowMs: number): boolean | null {
  const presence = useBoardPresence(eveningId, enabled);
  // Окно чтения открылось — запоминаем время ответа, который лежал в кеше (0 — его нет): он из прошлого
  // окна, ответ «сейчас» — только новее. Правится в отрисовке при смене enabled (не эффектом: уже первая
  // отрисовка окна не верит старому ответу).
  const [win, setWin] = useState({ enabled: false, staleAt: 0 });
  if (win.enabled !== enabled) setWin({ enabled, staleAt: presence.dataUpdatedAt });
  const staleAt = win.enabled === enabled ? win.staleAt : presence.dataUpdatedAt;
  if (!enabled) return null;
  return boardOnlineFrom(
    {
      missing: presence.isPending || presence.isError,
      seenAt: presence.data?.seen_at ?? null,
      current: presence.dataUpdatedAt > staleAt,
    },
    nowMs,
  );
}

export interface BombPotScreen {
  /** Открытый бомб-пот (не дольше 20 мин без закрытия — потом экраны его не показывают). */
  bombPot: BombPotState;
  /** Что на месте числа: «смотри на табло», розыгрыш на телефоне или взнос. */
  view: PhoneBombView;
  boardOnline: boolean | null;
}

/**
 * Бомб-пот на экране вечера или null. extraPresence — читать отметку табло и без открытого бомб-пота
 * (шторка «Бомб-пот»: тост скажет, кто покажет взнос). boardOnline и calm — и для ленты экрана
 * (feedWithBombReveal): взнос в ленте — в тот же миг, что на полосе.
 */
export function useBombPot(
  model: Pick<EveningModel, 'evening' | 'state' | 'nowMs'>,
  extraPresence = false,
): { screen: BombPotScreen | null; boardOnline: boolean | null; calm: boolean } {
  const open = visibleBombPot(model.state, model.nowMs);
  const atMs = open ? Date.parse(open.at) : Number.NaN;
  const recent = open !== null && !(model.nowMs - atMs > PRESENCE_WINDOW_MS);
  const boardOnline = useBoardOnline(model.evening.id, recent || extraPresence, model.nowMs);
  const calm = useReducedMotion();
  // Своё «сейчас» для розыгрыша и для мгновения показа: экран тикает раз в секунду.
  const [fine, setFine] = useState(() => serverNow());
  const now = Math.max(fine, model.nowMs);
  const view = open ? phoneBombView(open, now, boardOnline, calm) : null;
  const phase = view?.phase ?? null;
  const revealAt = view?.revealAtMs ?? 0;

  useEffect(() => {
    if (phase === 'rolling') {
      let raf = requestAnimationFrame(function frame() {
        setFine(serverNow());
        raf = requestAnimationFrame(frame);
      });
      return () => cancelAnimationFrame(raf);
    }
    if (phase === 'hidden' && Number.isFinite(revealAt)) {
      const left = revealAt - serverNow();
      if (left <= 0) return;
      const timer = setTimeout(() => setFine(serverNow()), left + 20);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [phase, revealAt]);

  return {
    screen: open && view ? { bombPot: open, view, boardOnline } : null,
    boardOnline,
    calm,
  };
}
