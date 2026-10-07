// Табло для ТВ/ноутбука: без входа, по токену из QR. Realtime без сессии ничего не получит
// (postgres_changes фильтруется RLS), поэтому табло опрашивает board_state раз в 3 с.
import { useQuery } from '@tanstack/react-query';
import { addClockSample } from '../lib/serverClock';
import { supabase } from '../supabase';
import { toError } from './errors';
import { queryKeys } from './keys';
import type { BoardState } from './types';

export const BOARD_POLL_MS = 3000;

/** null — токен неизвестен или вечер давно закончился (ссылка погасла). */
export async function fetchBoardState(token: string): Promise<BoardState | null> {
  const t0 = Date.now();
  const { data, error } = await supabase.rpc('board_state', { p_token: token });
  const t1 = Date.now();
  if (error) throw toError(error);
  const state = (data as unknown as BoardState | null) ?? null;
  // Табло живёт часами на ноутбуке у ТВ — сверяем его часы с сервером на каждом опросе.
  if (state?.server_now) addClockSample(state.server_now, t0, t1);
  return state;
}

/** Клип голоса табло из board_voice_clips (миграция 016): MP3 в base64. */
export interface VoiceClipData {
  hash: string;
  mime: string;
  duration_ms: number;
  audio: string;
}

/** Сколько хешей просить за раз: сервер принимает до 100, ответ держим в пределах ~1–2 МБ. */
export const VOICE_CLIPS_CHUNK = 40;

/**
 * Клипы голоса по хешам — те, что уже озвучены (остальных в ответе нет). Без входа, по токену
 * табло, с теми же правилами срока, что у board_state; null — ссылка погасла.
 */
export async function fetchVoiceClips(
  token: string,
  voice: string,
  hashes: string[],
): Promise<VoiceClipData[] | null> {
  const { data, error } = await supabase.rpc('board_voice_clips', {
    p_token: token,
    p_voice: voice,
    p_hashes: hashes,
  });
  if (error) throw toError(error);
  return (data as unknown as VoiceClipData[] | null) ?? null;
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
    // Без сети (браузер поймал offline) опрос по умолчанию встаёт на паузу без ошибки — и табло
    // молча тикает по старому журналу. 'always' — запрос падает, табло показывает «Нет связи».
    networkMode: 'always',
  });
}
