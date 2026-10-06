// Чтение данных клуба. Все хуки работают только под AuthGate: RLS отдаёт строки лишь активному
// участнику клуба (current_player_id() is not null).
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { supabase } from '../supabase';
import { toError } from './errors';
import { fetchAll } from './fetchAll';
import { queryKeys } from './keys';
import { useRealtimeInvalidation } from './realtime';
import {
  toEvening,
  toEventRecord,
  toFormatRow,
  toRsvp,
  toVote,
  type Evening,
  type EveningEventRecord,
  type EveningStatus,
  type FormatRow,
  type Player,
  type PredictionRow,
  type Rsvp,
  type Settings,
  type VoteRow,
} from './types';

// --- Справочники -----------------------------------------------------------------------------

export async function fetchPlayers(): Promise<Player[]> {
  return fetchAll(() => supabase.from('players').select('*').order('display_name').order('id'));
}

/** Все игроки, включая гостей и неактивных (их имена нужны в истории). Фильтруют страницы. */
export function usePlayers() {
  return useQuery({
    queryKey: queryKeys.players,
    queryFn: fetchPlayers,
    staleTime: 5 * 60_000,
  });
}

/** Игроки по id — для подписей в списках событий, таблицах и т. п. */
export function usePlayersById(): Map<string, Player> {
  const { data } = usePlayers();
  return useMemo(() => new Map((data ?? []).map((p) => [p.id, p])), [data]);
}

export async function fetchSettings(): Promise<Settings | null> {
  const { data, error } = await supabase.from('settings').select('*').eq('id', 1).maybeSingle();
  if (error) throw toError(error);
  return data;
}

/** Настройки клуба (строка id = 1 создаётся миграцией, но null возможен на пустой БД). */
export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: fetchSettings,
    staleTime: 5 * 60_000,
  });
}

export async function fetchFormats(): Promise<FormatRow[]> {
  const { data, error } = await supabase
    .from('formats')
    .select('*')
    .order('created_at')
    .order('id');
  if (error) throw toError(error);
  return (data ?? []).map(toFormatRow);
}

/** Форматы (пресеты), включая архивные — архивные страница прячет сама. */
export function useFormats() {
  return useQuery({
    queryKey: queryKeys.formats,
    queryFn: fetchFormats,
    staleTime: 5 * 60_000,
  });
}

// --- Вечера ----------------------------------------------------------------------------------

export interface EveningsFilter {
  status?: EveningStatus | readonly EveningStatus[];
}

export async function fetchEvenings(filter: EveningsFilter = {}): Promise<Evening[]> {
  const statuses = filter.status === undefined ? null : [filter.status].flat();
  const rows = await fetchAll(() => {
    const q = supabase.from('evenings').select('*');
    return (statuses ? q.in('status', statuses) : q)
      .order('scheduled_at', { ascending: false })
      .order('id');
  });
  return rows.map(toEvening);
}

/** Вечера, новые сверху. `status` — один или несколько статусов. */
export function useEvenings(filter: EveningsFilter = {}) {
  return useQuery({
    queryKey: queryKeys.evenings(filter.status),
    queryFn: () => fetchEvenings(filter),
  });
}

export async function fetchEvening(id: string): Promise<Evening | null> {
  const { data, error } = await supabase.from('evenings').select('*').eq('id', id).maybeSingle();
  if (error) throw toError(error);
  return data ? toEvening(data) : null;
}

/** Один вечер; null — не найден (или скрыт RLS). */
export function useEvening(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.evening(id ?? ''),
    queryFn: () => fetchEvening(id ?? ''),
    enabled: Boolean(id),
  });
}

export async function fetchEveningEvents(eveningId: string): Promise<EveningEventRecord[]> {
  const rows = await fetchAll(() =>
    supabase.from('evening_events').select('*').eq('evening_id', eveningId).order('id'),
  );
  return rows.map(toEventRecord);
}

/**
 * Журнал вечера (включая отменённые — replay их пропускает, а лента показывает зачёркнутыми)
 * + Realtime: новые события и смена статуса вечера приходят всем экранам без перезагрузки.
 */
export function useEveningEvents(eveningId: string | undefined) {
  useRealtimeInvalidation(eveningId ? `evening:${eveningId}` : undefined, [
    {
      table: 'evening_events',
      filter: `evening_id=eq.${eveningId}`,
      invalidate: [queryKeys.eveningEvents(eveningId ?? '')],
    },
    {
      // У evenings нет колонки evening_id — фильтруем по первичному ключу.
      table: 'evenings',
      filter: `id=eq.${eveningId}`,
      invalidate: [queryKeys.evening(eveningId ?? ''), queryKeys.eveningsAll],
    },
  ]);
  return useQuery({
    queryKey: queryKeys.eveningEvents(eveningId ?? ''),
    queryFn: () => fetchEveningEvents(eveningId ?? ''),
    enabled: Boolean(eveningId),
    // Свежесть обеспечивает Realtime; фоновые перезапросы на фокус оставляем как страховку.
    staleTime: 10_000,
  });
}

// --- Вокруг вечера: RSVP, прогнозы, голоса ---------------------------------------------------

export async function fetchRsvps(eveningId: string): Promise<Rsvp[]> {
  const { data, error } = await supabase
    .from('rsvps')
    .select('*')
    .eq('evening_id', eveningId)
    .order('updated_at');
  if (error) throw toError(error);
  return (data ?? []).map(toRsvp);
}

/** Ответы на анонс; обновляются вживую (rsvps в публикации Realtime). */
export function useRsvps(eveningId: string | undefined) {
  useRealtimeInvalidation(eveningId ? `rsvps:${eveningId}` : undefined, [
    {
      table: 'rsvps',
      filter: `evening_id=eq.${eveningId}`,
      invalidate: [queryKeys.rsvps(eveningId ?? '')],
    },
  ]);
  return useQuery({
    queryKey: queryKeys.rsvps(eveningId ?? ''),
    queryFn: () => fetchRsvps(eveningId ?? ''),
    enabled: Boolean(eveningId),
  });
}

export async function fetchPredictions(eveningId: string): Promise<PredictionRow[]> {
  const { data, error } = await supabase
    .from('predictions')
    .select('*')
    .eq('evening_id', eveningId)
    .order('updated_at');
  if (error) throw toError(error);
  return data ?? [];
}

/**
 * Прогнозы на вечер. Пока вечер в статусе announced, RLS отдаёт только свой прогноз —
 * чужие появятся после старта (страница должна это учитывать, а не считать, что прогнозов нет).
 */
export function usePredictions(eveningId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.predictions(eveningId ?? ''),
    queryFn: () => fetchPredictions(eveningId ?? ''),
    enabled: Boolean(eveningId),
  });
}

export async function fetchVotes(eveningId: string): Promise<VoteRow[]> {
  const { data, error } = await supabase
    .from('votes')
    .select('*')
    .eq('evening_id', eveningId)
    .order('created_at');
  if (error) throw toError(error);
  return (data ?? []).map(toVote);
}

/** Голоса вечера. До voting_closes_at RLS отдаёт только свои голоса. */
export function useVotes(eveningId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.votes(eveningId ?? ''),
    queryFn: () => fetchVotes(eveningId ?? ''),
    enabled: Boolean(eveningId),
  });
}
