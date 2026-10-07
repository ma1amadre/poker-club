// Данные «Твоего вечера»: доменный eveningRecap по истории клуба и что игрок назвал в прогнозе.
import { eveningRecap, type EveningRecap } from '@domain/recap.ts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { queryKeys, type ClubHistory, type EveningEventRecord } from '../../shared/api';
import { journalVersion } from './lib';
import type { PredictionPick } from './recap';

type Journal = readonly Pick<EveningEventRecord, 'id' | 'voided'>[];

/** Тот же ли журнал: последний id и число отменённых записей (как сверяет mark_settled). */
export function sameJournal(a: Journal, b: Journal): boolean {
  const va = journalVersion(a);
  const vb = journalVersion(b);
  return va.lastEventId === vb.lastEventId && va.voidedCount === vb.voidedCount;
}

/**
 * «Твой вечер» игрока по истории клуба; null — истории ещё нет, вечера в ней нет (не сведён или
 * кеш не обновился), игрок не играл и прогноза не делал, или история сведена не из того журнала,
 * что на экране.
 *
 * `live` — журнал вечера, который экран держит по Realtime (экран вечера). История клуба на чужом
 * устройстве по Realtime не обновляется: после правки закрытого вечера админом карточка говорила
 * бы о прежнем журнале («Кто тебя выбил — Дима»), а «Места» рядом — о новом. Поэтому при
 * расхождении карточки нет, а история перезапрашивается — карточка вернётся уже по новому журналу.
 */
export function useEveningRecap(
  history: ClubHistory | undefined,
  eveningId: string,
  meId: string | undefined,
  live?: Journal,
): { recap: EveningRecap; pick: PredictionPick | null } | null {
  const queryClient = useQueryClient();
  const outdated = Boolean(
    history && live && !sameJournal(history.eventsByEvening.get(eveningId) ?? [], live),
  );
  // Версия живого журнала: перезапрос — один раз на каждую его правку, без цикла.
  const liveVersion = live ? journalVersion(live) : null;
  const liveKey = liveVersion ? `${liveVersion.lastEventId}:${liveVersion.voidedCount}` : '';
  useEffect(() => {
    if (outdated) void queryClient.invalidateQueries({ queryKey: queryKeys.clubHistory });
  }, [outdated, liveKey, queryClient]);

  return useMemo(() => {
    if (!history || !meId || outdated) return null;
    const recap = eveningRecap(history.achievementInput, eveningId, meId);
    if (!recap || (!recap.played && !recap.prediction.made)) return null;
    const row = (history.predictionsByEvening.get(eveningId) ?? []).find(
      (p) => p.player_id === meId,
    );
    const pick = row ? { winnerId: row.winner_id, firstOutId: row.first_out_id } : null;
    return { recap, pick };
  }, [history, eveningId, meId, outdated]);
}
