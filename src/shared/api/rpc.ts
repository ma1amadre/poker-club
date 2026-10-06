// Запись через RPC (security definer, права проверяют сами — см. 003_rpc.sql). Таблицы
// evening_events, rsvps, predictions, votes напрямую не пишутся: RLS это запрещает.
import type { EventPayload, EventType } from '@domain/types.ts';
import type { VoteCategory } from '@domain/votes.ts';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/context';
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
}

/** Событие в журнал вечера. Перед вызовом страница проверяет его доменной canApply. */
export async function addEvent({
  eveningId,
  type,
  payload = {},
}: AddEventInput): Promise<EveningEventRecord> {
  const { data, error } = await supabase.rpc('add_event', {
    p_evening: eveningId,
    p_type: type,
    p_payload: payload,
  });
  if (error) throw toError(error);
  return toEventRecord(data);
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
export type NotifyOutcome = 'posted' | 'already_posted' | 'no_group';

/**
 * Пост итогов вечера в группу — банкир (или админ) после finish. Текст собирает сервер из БД;
 * повторный вызов безопасен (already_posted). Если не вызвать, итоги добьёт cron-tick.
 */
export async function notifyEveningFinished(eveningId: string): Promise<NotifyOutcome> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; outcome: NotifyOutcome }>(
    'notify',
    { body: { kind: 'evening_finished', eveningId } },
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.votes(eveningId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.clubHistory });
    },
  });
}

export function useNotifyEveningFinished(eveningId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => notifyEveningFinished(eveningId),
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
    onSuccess: (_void, name) => {
      // Сервер схлопывает пробелы так же (regexp_replace '\s+' → ' ', btrim).
      updatePlayer({ display_name: name.replace(/\s+/g, ' ').trim() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.players });
      void queryClient.invalidateQueries({ queryKey: queryKeys.clubHistory });
    },
  });
}
