// Табло для ТВ/ноутбука: без входа, по токену из QR. Realtime без сессии ничего не получит
// (postgres_changes фильтруется RLS), поэтому табло опрашивает board_state раз в 3 с.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabase';
import { toError } from './errors';
import { queryKeys } from './keys';
import type { BoardState } from './types';

export const BOARD_POLL_MS = 3000;

/** null — токен неизвестен или вечер давно закончился (ссылка погасла). */
export async function fetchBoardState(token: string): Promise<BoardState | null> {
  const { data, error } = await supabase.rpc('board_state', { p_token: token });
  if (error) throw toError(error);
  return (data as unknown as BoardState | null) ?? null;
}

export function useBoardState(token: string | undefined) {
  return useQuery({
    queryKey: queryKeys.board(token ?? ''),
    queryFn: () => fetchBoardState(token ?? ''),
    enabled: Boolean(token),
    refetchInterval: BOARD_POLL_MS,
    // Табло висит на экране часами: опрос не должен останавливаться без фокуса окна.
    refetchIntervalInBackground: true,
    // Кратковременный сбой сети не должен гасить табло — показываем последнее состояние.
    retry: 2,
    staleTime: 0,
  });
}
