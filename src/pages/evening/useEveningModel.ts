// Данные экрана вечера в одном месте: вечер, журнал (с Realtime), справочник игроков,
// состояние из replay на текущую секунду и права текущего игрока.
import { replayLog } from '@domain/replay.ts';
import type { EveningEvent, EveningState, PlayerId } from '@domain/types.ts';
import { useCallback, useMemo } from 'react';
import {
  useEvening,
  useEveningEvents,
  usePlayersById,
  type Evening,
  type EveningEventRecord,
  type Player,
} from '../../shared/api';
import { useAuth } from '../../shared/auth';
import { useNow } from '../../shared/lib';
import { feedContext, type FeedContext, type NameOf } from './lib';

export interface EveningModel {
  evening: Evening;
  events: EveningEventRecord[];
  state: EveningState;
  /** Принятые replay события (без отменённых и ошибочных) в порядке журнала. */
  applied: EveningEvent[];
  /** id события → текст ошибки, если replay его не принял. */
  errorsById: Map<number, string>;
  /** Лента: исправленные записи с правкой в силе и правки со ссылкой на запись (миграция 022). */
  feed: FeedContext;
  playersById: Map<string, Player>;
  nameOf: NameOf;
  nowMs: number;
  /** Банкир этого вечера или админ: может вести журнал. */
  canControl: boolean;
  isAdmin: boolean;
  isBanker: boolean;
  /** Фоновый перезапрос не удался: на экране последние загруженные данные. */
  stale: boolean;
  /** Когда данные экрана в последний раз пришли с сервера (мс, часы устройства). */
  updatedAt: number;
  /** Перезапросить вечер и журнал. */
  retry: () => void;
}

export type EveningModelResult =
  | { status: 'loading' }
  | { status: 'error'; error: unknown; retry: () => void }
  | { status: 'not_found' }
  | { status: 'ready'; model: EveningModel };

export function useEveningModel(id: string | undefined): EveningModelResult {
  const eveningQuery = useEvening(id);
  const eventsQuery = useEveningEvents(id);
  const playersById = usePlayersById();
  const { player, isAdmin } = useAuth();

  const evening = eveningQuery.data;
  const live = evening?.status === 'live';
  // Секундный тик нужен только живому вечеру; после finish таймер стоит.
  const nowMs = useNow(live ? 1000 : 60_000);

  const nameOf = useCallback<NameOf>(
    (pid: PlayerId) => playersById.get(pid)?.display_name ?? 'Игрок',
    [playersById],
  );

  const events = eventsQuery.data;
  const replayed = useMemo(() => {
    if (!evening || !events) return null;
    return replayLog(evening.format, events, nowMs);
  }, [evening, events, nowMs]);

  const errorsById = useMemo(
    () => new Map((replayed?.state.errors ?? []).map((e) => [e.eventId, e.message])),
    [replayed],
  );

  const feed = useMemo(
    () => feedContext(events ?? [], replayed ?? { applied: [], amended: new Map() }),
    [events, replayed],
  );

  const retry = () => {
    void eveningQuery.refetch();
    void eventsQuery.refetch();
  };
  // Экран ошибки — только когда показать нечего. Неудачный фоновый перезапрос (сеть «моргнула»
  // после Realtime или возврата в Mini App) не должен сносить пульт банкира с открытой шторкой:
  // данные в кеше есть, экран показывает их с пометкой «нет связи». data === null — «не найден».
  const eveningFailed = eveningQuery.isError && eveningQuery.data === undefined;
  const eventsFailed = eventsQuery.isError && eventsQuery.data === undefined;
  if (eveningFailed || eventsFailed) {
    return { status: 'error', error: eveningQuery.error ?? eventsQuery.error, retry };
  }
  if (eveningQuery.isPending || (evening && eventsQuery.isPending)) return { status: 'loading' };
  if (!evening) return { status: 'not_found' };
  if (!events || !replayed) return { status: 'loading' };

  const isBanker = Boolean(player && evening.banker_id === player.id);
  return {
    status: 'ready',
    model: {
      evening,
      events,
      state: replayed.state,
      applied: replayed.applied,
      errorsById,
      feed,
      playersById,
      nameOf,
      nowMs,
      canControl: isAdmin || isBanker,
      isAdmin,
      isBanker,
      stale: eveningQuery.isRefetchError || eventsQuery.isRefetchError,
      updatedAt: Math.min(eveningQuery.dataUpdatedAt, eventsQuery.dataUpdatedAt),
      retry,
    },
  };
}
