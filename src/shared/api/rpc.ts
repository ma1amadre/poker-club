// Запись через RPC (security definer, права проверяют сами — см. 003_rpc.sql). Таблицы
// evening_events, rsvps, predictions, votes напрямую не пишутся: RLS это запрещает.
import type { EventPayload, EventType } from '@domain/types.ts';
import type { VoteCategory } from '@domain/votes.ts';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/context';
import { addClockSample } from '../lib/serverClock';
import { supabase } from '../supabase';
import { toError } from './errors';
import { queryKeys } from './keys';
import { toEventRecord, type EveningEventRecord, type RsvpStatus } from './types';

// --- Сырые вызовы ----------------------------------------------------------------------------

export interface AddEventInput {
  eveningId: string;
  type: EventType;
  /** Для timer_*, level_*, hand, finish — пустой объект (по умолчанию). */
  payload?: EventPayload;
  /**
   * Ключ повтора (миграция 007): один на намерение пользователя. Повтор с тем же ключом после
   * потерянного ответа вернёт уже записанное событие, а не задвоит платёж или раздачу.
   */
  clientId?: string;
}

/** Случайный uuid v4 — ключ повтора add_event. */
export function newClientId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Событие в журнал вечера. Перед вызовом страница проверяет его доменной canApply. */
export async function addEvent({
  eveningId,
  type,
  payload = {},
  clientId,
}: AddEventInput): Promise<EveningEventRecord> {
  const t0 = Date.now();
  const { data, error } = await supabase.rpc('add_event', {
    p_evening: eveningId,
    p_type: type,
    p_payload: payload,
    ...(clientId ? { p_client_id: clientId } : {}),
  });
  const t1 = Date.now();
  if (error) throw toError(error);
  const record = toEventRecord(data);
  // `at` ставит сервер — заодно замер часов (см. serverClock.ts). Повтор по ключу вернёт старое
  // событие — его `at` о часах ничего не говорит.
  if (Date.parse(record.at) >= t0 - 60_000) addClockSample(record.at, t0, t1);
  return record;
}

/** Отменить событие (пометка voided, история сохраняется). Отмена finish возвращает вечер в live. */
export async function voidEvent(eventId: number): Promise<void> {
  const { error } = await supabase.rpc('void_event', { p_event: eventId });
  if (error) throw toError(error);
}

export async function markSettled(eveningId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_settled', { p_evening: eveningId });
  if (error) throw toError(error);
}

export async function unmarkSettled(eveningId: string): Promise<void> {
  const { error } = await supabase.rpc('unmark_settled', { p_evening: eveningId });
  if (error) throw toError(error);
}

export async function setRsvp(eveningId: string, status: RsvpStatus): Promise<void> {
  const { error } = await supabase.rpc('set_rsvp', { p_evening: eveningId, p_status: status });
  if (error) throw toError(error);
}

export interface PredictionInput {
  eveningId: string;
  winnerId: string | null;
  firstOutId: string | null;
}

export async function setPrediction({
  eveningId,
  winnerId,
  firstOutId,
}: PredictionInput): Promise<void> {
  const { error } = await supabase.rpc('set_prediction', {
    p_evening: eveningId,
    // SQL принимает null («без прогноза»), а типы в стиле генератора аргументы nullable не помечают.
    p_winner: winnerId as string,
    p_first_out: firstOutId as string,
  });
  if (error) throw toError(error);
}

export interface CastVoteInput {
  eveningId: string;
  category: VoteCategory;
  nomineeId: string;
  caption?: string | null;
  /** Путь в бакете vote-photos из uploadVotePhoto. */
  photoPath?: string | null;
}

/** Голос в номинации (upsert: повторный голос в той же категории заменяет прежний). */
export async function castVote({
  eveningId,
  category,
  nomineeId,
  caption,
  photoPath,
}: CastVoteInput): Promise<void> {
  const { error } = await supabase.rpc('cast_vote', {
    p_evening: eveningId,
    p_category: category,
    p_nominee: nomineeId,
    p_caption: caption?.trim() || undefined,
    p_photo_path: photoPath || undefined,
  });
  if (error) throw toError(error);
}

export interface DeleteVoteInput {
  eveningId: string;
  voterId: string;
  category: VoteCategory;
}

/** Отозвать свой голос (пока голосование открыто) или удалить любой — админ. Фото удаляется отдельно. */
export async function deleteVote({ eveningId, voterId, category }: DeleteVoteInput): Promise<void> {
  const { error } = await supabase.rpc('delete_vote', {
    p_evening: eveningId,
    p_voter: voterId,
    p_category: category,
  });
  if (error) throw toError(error);
}

/** Ответ Edge Function notify (supabase/functions/notify/results.ts → PostOutcome). */
export type NotifyOutcome = 'posted' | 'already_posted' | 'no_group' | 'no_changes';

export type NotifyKind = 'evening_finished' | 'evening_corrected';

/**
 * Пост итогов вечера в группу — банкир (или админ) после finish. Текст собирает сервер из БД;
 * повторный вызов безопасен (already_posted). Если не вызвать, итоги добьёт cron-tick.
 * `evening_corrected` — только админ: исправленный итог закрытого вечера после правки журнала
 * (no_changes — с прошлого поста журнал не менялся).
 */
export async function notifyEveningFinished(
  eveningId: string,
  kind: NotifyKind = 'evening_finished',
): Promise<NotifyOutcome> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; outcome: NotifyOutcome }>(
    'notify',
    { body: { kind, eveningId } },
  );
  if (error) {
    // Тело ошибки функции: {error: текст по-русски, code}.
    const response = (error as { context?: unknown }).context;
    if (response instanceof Response) {
      const body = (await response
        .clone()
        .json()
        .catch(() => null)) as { error?: unknown } | null;
      if (typeof body?.error === 'string') throw new Error(body.error);
    }
    throw toError(error);
  }
  if (!data) throw new Error('Сервер уведомлений вернул пустой ответ.');
  return data.outcome;
}

/**
 * Создать гостя и сразу посадить его за стол (join) — миграция 006. Права как у add_event для
 * join: банкир вечера или админ. Возвращает id нового игрока.
 */
export async function addGuest(eveningId: string, name: string): Promise<string> {
  const { data, error } = await supabase.rpc('add_guest', { p_evening: eveningId, p_name: name });
  if (error) throw toError(error);
  if (typeof data !== 'string') throw new Error('Сервер не вернул id гостя. Повторите попытку.');
  return data;
}

/** Призовые доли вечера до старта (миграция 007) — банкир вечера или админ. */
export async function setPayout(eveningId: string, payoutPct: number[]): Promise<void> {
  const { error } = await supabase.rpc('set_payout', { p_evening: eveningId, p_pct: payoutPct });
  if (error) throw toError(error);
}

export async function setMyName(name: string): Promise<void> {
  const { error } = await supabase.rpc('set_my_name', { p_name: name });
  if (error) throw toError(error);
}

// --- Хуки-мутации ----------------------------------------------------------------------------

/** Изменился вечер: его карточка, списки вечеров и (для завершённых) статистика клуба. */
function invalidateEvening(queryClient: QueryClient, eveningId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.evening(eveningId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.eveningsAll });
  void queryClient.invalidateQueries({ queryKey: queryKeys.clubHistory });
}

/** Добавить событие в журнал вечера `eveningId`. */
export function useAddEvent(eveningId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<AddEventInput, 'eveningId'>) => addEvent({ ...input, eveningId }),
    onSuccess: (record) => {
      // Сразу кладём событие в кеш: экран банкира не ждёт ни Realtime, ни перезапроса.
      queryClient.setQueryData<EveningEventRecord[]>(queryKeys.eveningEvents(eveningId), (old) =>
        old && !old.some((e) => e.id === record.id) ? [...old, record] : old,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.eveningEvents(eveningId) });
      invalidateEvening(queryClient, eveningId);
    },
    // Ответ мог потеряться после того, как запись прошла: сверяем журнал с сервером, чтобы
    // шторка до повторного нажатия уже показала то, что записано на самом деле.
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.eveningEvents(eveningId) });
      invalidateEvening(queryClient, eveningId);
    },
  });
}

export function useVoidEvent(eveningId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (eventId: number) => voidEvent(eventId),
    onSuccess: (_void, eventId) => {
      queryClient.setQueryData<EveningEventRecord[]>(queryKeys.eveningEvents(eveningId), (old) =>
        old?.map((e) =>
          e.id === eventId ? { ...e, voided: true, voidedAt: new Date().toISOString() } : e,
        ),
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.eveningEvents(eveningId) });
      invalidateEvening(queryClient, eveningId);
    },
  });
}

export function useAddGuest(eveningId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => addGuest(eveningId, name),
    onSuccess: () => {
      // Новый игрок нужен в справочнике (имя в ленте), новый join — в журнале.
      void queryClient.invalidateQueries({ queryKey: queryKeys.players });
      void queryClient.invalidateQueries({ queryKey: queryKeys.eveningEvents(eveningId) });
      invalidateEvening(queryClient, eveningId);
    },
  });
}

export function useMarkSettled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (eveningId: string) => markSettled(eveningId),
    onSuccess: (_void, eveningId) => invalidateEvening(queryClient, eveningId),
  });
}

export function useUnmarkSettled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (eveningId: string) => unmarkSettled(eveningId),
    onSuccess: (_void, eveningId) => invalidateEvening(queryClient, eveningId),
  });
}

export function useSetRsvp(eveningId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (status: RsvpStatus) => setRsvp(eveningId, status),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.rsvps(eveningId) }),
  });
}

export function useSetPrediction(eveningId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<PredictionInput, 'eveningId'>) =>
      setPrediction({ ...input, eveningId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.predictions(eveningId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.clubHistory });
    },
  });
}

export function useCastVote(eveningId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CastVoteInput, 'eveningId'>) => castVote({ ...input, eveningId }),
    meta: { silent: true }, // тост ошибки с контекстом показывает VoteSheet
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.votes(eveningId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.clubHistory });
    },
  });
}

export function useDeleteVote(eveningId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<DeleteVoteInput, 'eveningId'>) => deleteVote({ ...input, eveningId }),
    meta: { silent: true }, // тост ошибки с контекстом показывают VotePage и VoteResults
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.votes(eveningId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.clubHistory });
    },
  });
}

export function useSetPayout(eveningId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payoutPct: number[]) => setPayout(eveningId, payoutPct),
    onSuccess: () => invalidateEvening(queryClient, eveningId),
  });
}

export function useNotifyEveningFinished(eveningId: string, kind: NotifyKind = 'evening_finished') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => notifyEveningFinished(eveningId, kind),
    // results_posted_at изменился — перечитать вечер.
    onSuccess: () => invalidateEvening(queryClient, eveningId),
  });
}

/** Сменить своё имя; обновляет и список игроков, и игрока в контексте входа. */
export function useSetMyName() {
  const queryClient = useQueryClient();
  const { updatePlayer } = useAuth();
  return useMutation({
    mutationFn: (name: string) => setMyName(name),
    meta: { silent: true }, // ошибку («имя уже занято») RenameSheet показывает под полем
    onSuccess: (_void, name) => {
      // Сервер схлопывает пробелы так же (regexp_replace '\s+' → ' ', btrim).
      updatePlayer({ display_name: name.replace(/\s+/g, ' ').trim() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.players });
      void queryClient.invalidateQueries({ queryKey: queryKeys.clubHistory });
    },
  });
}
