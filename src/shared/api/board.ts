// Табло для ТВ/ноутбука: без входа, по токену из QR. Realtime без сессии ничего не получит
// (postgres_changes фильтруется RLS), поэтому табло опрашивает board_state раз в 3 с.
// Табло клуба (миграция 023) — постоянная ссылка /tv/<код>: club_board_state сам выбирает вечер
// (идущий, итог за 6 ч, сегодняшний анонс), между вечерами — экран «Следующая игра».
// «Табло на связи» — board_ping раз в 20 с (board_presence; читает проверка перед игрой у банкира).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addClockSample } from '../lib/serverClock';
import { supabase } from '../supabase';
import { toError } from './errors';
import { queryKeys } from './keys';
import type { BoardState, ClubBoardState } from './types';

export const BOARD_POLL_MS = 3000;
/** Табло клуба между вечерами: новый вечер появляется не чаще раза в 15 минут (cron-tick). */
export const CLUB_BOARD_IDLE_POLL_MS = 30_000;
/** Как часто табло отмечается «на связи». */
export const BOARD_PING_MS = 20_000;
/** Отметка свежее — табло на связи (три пропущенные отметки — нет). */
export const BOARD_ONLINE_MS = 60_000;

/** Чем открыто табло: ссылкой вечера (uuid) или постоянной ссылкой клуба (код). */
export type BoardSource = { kind: 'evening'; token: string } | { kind: 'club'; code: string };

/** Токен для RPC табло: board_ping принимает и то и другое. */
export function boardSourceToken(source: BoardSource): string {
  return source.kind === 'evening' ? source.token : source.code;
}

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

/** null — код табло клуба не тот (админ перевыпустил ссылку или ссылка обрезана). */
export async function fetchClubBoardState(code: string): Promise<ClubBoardState | null> {
  const t0 = Date.now();
  const { data, error } = await supabase.rpc('club_board_state', { p_code: code });
  const t1 = Date.now();
  if (error) throw toError(error);
  const state = (data as unknown as ClubBoardState | null) ?? null;
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
 * Клипы голоса по хешам — те, что уже озвучены (остальных в ответе нет). Без входа: по токену
 * вечера (срок как у board_state) или по коду табло клуба; null — ссылка погасла.
 */
export async function fetchVoiceClips(
  source: BoardSource,
  voice: string,
  hashes: string[],
): Promise<VoiceClipData[] | null> {
  const { data, error } =
    source.kind === 'evening'
      ? await supabase.rpc('board_voice_clips', {
          p_token: source.token,
          p_voice: voice,
          p_hashes: hashes,
        })
      : await supabase.rpc('club_board_voice_clips', {
          p_code: source.code,
          p_voice: voice,
          p_hashes: hashes,
        });
  if (error) throw toError(error);
  return (data as unknown as VoiceClipData[] | null) ?? null;
}

/**
 * «Табло на связи»: отметка вечера, который табло показывает (миграция 023). Сбой — молча: отметка
 * нужна только проверке перед игрой, табло от неё не зависит. До миграции функции нет — тоже молча.
 */
export async function pingBoard(source: BoardSource, voiceOn: boolean): Promise<void> {
  try {
    await supabase.rpc('board_ping', { p_token: boardSourceToken(source), p_voice: voiceOn });
  } catch {
    // сеть — следующая отметка через BOARD_PING_MS
  }
}

const boardQueryOptions = {
  // Табло висит на экране часами: опрос не должен останавливаться без фокуса окна.
  refetchIntervalInBackground: true,
  // Кратковременный сбой сети не должен гасить табло — показываем последнее состояние.
  retry: 2,
  staleTime: 0,
  // Без сети (браузер поймал offline) опрос по умолчанию встаёт на паузу без ошибки — и табло
  // молча тикает по старому журналу. 'always' — запрос падает, табло показывает «Нет связи».
  networkMode: 'always',
} as const;

export function useBoardState(token: string | undefined) {
  return useQuery({
    queryKey: queryKeys.board(token ?? ''),
    queryFn: () => fetchBoardState(token ?? ''),
    enabled: Boolean(token),
    refetchInterval: BOARD_POLL_MS,
    ...boardQueryOptions,
  });
}

/** Табло клуба: при вечере — опрос раз в 3 с, между вечерами — раз в 30 с. */
export function useClubBoardState(code: string | undefined) {
  return useQuery({
    queryKey: queryKeys.clubBoard(code ?? ''),
    queryFn: () => fetchClubBoardState(code ?? ''),
    enabled: Boolean(code),
    refetchInterval: (query) => (query.state.data?.board ? BOARD_POLL_MS : CLUB_BOARD_IDLE_POLL_MS),
    ...boardQueryOptions,
  });
}

// --- Для банкира и админа (под входом) --------------------------------------------------------

/** Строка board_presence (миграция 023): последняя отметка табло по вечеру. */
export interface BoardPresence {
  seen_at: string;
  voice_at: string | null;
}

/** Последняя отметка табло этого вечера; null — табло вечер ещё не показывало. */
export async function fetchBoardPresence(eveningId: string): Promise<BoardPresence | null> {
  const { data, error } = await supabase
    .from('board_presence')
    .select('seen_at, voice_at')
    .eq('evening_id', eveningId)
    .maybeSingle();
  if (error) throw toError(error);
  return data;
}

/** Отметка табло вечера, перечитывается раз в 10 с (проверка перед игрой). */
export function useBoardPresence(eveningId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.boardPresence(eveningId ?? ''),
    queryFn: () => fetchBoardPresence(eveningId ?? ''),
    enabled: Boolean(eveningId) && enabled,
    refetchInterval: 10_000,
    staleTime: 0,
  });
}

/** Какие хеши уже озвучены (миграция 023, без звука): до 300 за запрос. */
export async function fetchVoiceClipsPresent(
  voice: string,
  hashes: readonly string[],
): Promise<Set<string>> {
  if (hashes.length === 0) return new Set();
  const { data, error } = await supabase.rpc('voice_clips_present', {
    p_voice: voice,
    p_hashes: [...hashes],
  });
  if (error) throw toError(error);
  return new Set(data ?? []);
}

/** Озвученные фразы из списка; перечитываются раз в 5 минут (генератор могли запустить вручную). */
export function useVoiceClipsPresent(voice: string, hashes: readonly string[] | null) {
  const key = hashes ? [...hashes].sort().join(',') : '';
  return useQuery({
    queryKey: queryKeys.voicePresent(voice, key),
    queryFn: () => fetchVoiceClipsPresent(voice, hashes ?? []),
    enabled: hashes !== null,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

/** Новый код табло клуба (только админ): старая ссылка гаснет сразу. */
export async function rotateClubBoardToken(): Promise<string> {
  const { data, error } = await supabase.rpc('rotate_club_board_token');
  if (error) throw toError(error);
  if (typeof data !== 'string') throw new Error('Сервер не вернул новую ссылку. Повтори попытку.');
  return data;
}

export function useRotateClubBoardToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: rotateClubBoardToken,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.settings }),
  });
}
