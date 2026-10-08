import type { RealtimeChannel } from '@supabase/supabase-js';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useSyncExternalStore } from 'react';
import { supabase } from '../supabase';

// realtime-js возвращает уже существующий канал при повторном supabase.channel(topic) — проверено
// в 2.117.2 (RealtimeClient.channel). Если два экрана подпишутся на один вечер, отписка первого
// убила бы канал второго. Поэтому каналы считаем ссылками: создаём на первом, удаляем на последнем.

type Table = 'evening_events' | 'evenings' | 'rsvps';

export interface RealtimeWatch {
  table: Table;
  /** Фильтр postgres_changes, например `evening_id=eq.<uuid>`. */
  filter: string;
  /** Что инвалидировать при изменении. */
  invalidate: QueryKey[];
}

/**
 * Состояние подписки канала (проверка перед игрой): none — канала нет; connecting — подписка ещё не
 * подтверждена; live — сервер подтвердил (SUBSCRIBED); broken — ошибка, тайм-аут или канал закрыт
 * (realtime-js переподключается сам — статус вернётся в live).
 */
export type RealtimeStatus = 'none' | 'connecting' | 'live' | 'broken';

interface Entry {
  channel: RealtimeChannel;
  refs: number;
  /** Отложенный перезапрос после (пере)подписки. */
  catchUp: ReturnType<typeof setTimeout> | null;
  status: RealtimeStatus;
}

const CATCH_UP_DELAY_MS = 1000;

const channels = new Map<string, Entry>();

const statusListeners = new Set<() => void>();

function setStatus(entry: Entry, status: RealtimeStatus): void {
  if (entry.status === status) return;
  entry.status = status;
  for (const listener of statusListeners) listener();
}

function subscribeStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

/** Состояние живого обновления канала `topic` (тот же topic, что у useRealtimeInvalidation). */
export function useRealtimeStatus(topic: string | undefined): RealtimeStatus {
  return useSyncExternalStore(
    subscribeStatus,
    () => (topic ? (channels.get(topic)?.status ?? 'none') : 'none'),
    () => 'none',
  );
}

function acquire(
  topic: string,
  watches: RealtimeWatch[],
  onChange: (keys: QueryKey[]) => void,
): () => void {
  let entry = channels.get(topic);
  if (!entry) {
    let channel = supabase.channel(topic);
    for (const w of watches) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: w.table, filter: w.filter },
        () => onChange(w.invalidate),
      );
    }
    const created: Entry = { channel, refs: 0, catchUp: null, status: 'connecting' };
    channel.subscribe((status) => {
      setStatus(created, status === 'SUBSCRIBED' ? 'live' : 'broken');
      if (status !== 'SUBSCRIBED') return;
      // Изменения, случившиеся до подписки или пока сокет переподключался (телефон уснул,
      // Telegram ушёл в фон), не придут. Плюс сервер начинает слать postgres_changes не сразу
      // после SUBSCRIBED: на локальном стеке событие, вставленное сразу после SUBSCRIBED,
      // не доставлялось (проверено 06.10.2026). Поэтому после каждой (пере)подписки — один
      // перезапрос с небольшой задержкой.
      if (created.catchUp) clearTimeout(created.catchUp);
      created.catchUp = setTimeout(() => {
        created.catchUp = null;
        onChange(watches.flatMap((w) => w.invalidate));
      }, CATCH_UP_DELAY_MS);
    });
    entry = created;
    channels.set(topic, created);
  }
  entry.refs += 1;
  const current = entry;
  return () => {
    current.refs -= 1;
    if (current.refs > 0) return;
    channels.delete(topic);
    if (current.catchUp) clearTimeout(current.catchUp);
    setStatus(current, 'none');
    void supabase.removeChannel(current.channel);
  };
}

/**
 * Подписка на изменения таблиц с инвалидацией запросов. `topic` — уникальное имя канала
 * (одинаковые watches ⇒ одинаковый topic). id = undefined — подписки нет.
 */
export function useRealtimeInvalidation(topic: string | undefined, watches: RealtimeWatch[]): void {
  const queryClient = useQueryClient();
  // watches однозначно определяются topic, а массив создаётся заново на каждый рендер —
  // читаем его через useEffectEvent, чтобы подписка пересоздавалась только при смене topic.
  const currentWatches = useEffectEvent(() => watches);
  useEffect(() => {
    if (!topic) return;
    return acquire(topic, currentWatches(), (keys) => {
      for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
    });
  }, [topic, queryClient]);
}
