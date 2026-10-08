// «Сюжет вечера» и «Олл-ины вечера» на экране итога: раздачи — из принятых событий живого журнала,
// «победы с N %» — useAllInSwings (воркер шансов, тот же кеш, что у списка раздач), сюжет — доменный
// eveningStory. Итог вечера сводится из того же журнала, что на экране (а не берётся из истории
// клуба: история на чужом устройстве после правки админом может отставать), и подменяет собой
// этот вечер в истории — месть, рекорды и лидер сезона считаются по экрану.
import { allInsFromApplied, type AllIn } from '@domain/allins.ts';
import { eveningStory, type StoryItem } from '@domain/story.ts';
import { summarize, type EveningSummary } from '@domain/summary.ts';
import { useMemo } from 'react';
import {
  isTrainingEvening,
  scoringFromSettings,
  type ClubHistory,
  type Settings,
} from '../../shared/api';
import { useAllInSwings } from '../../shared/lib/poker';
import type { EveningModel } from './useEveningModel';

export interface EveningStoryState {
  allIns: AllIn[];
  /** Строки сюжета; пусто — рассказывать нечего (или ещё считается). */
  items: StoryItem[];
  /** Шансы олл-инов или история клуба ещё грузятся — сюжет может измениться. */
  pending: boolean;
}

export function useEveningStory(
  model: Pick<EveningModel, 'evening' | 'events' | 'applied' | 'state'>,
  history: { data: ClubHistory | undefined; isPending: boolean },
  settings: Settings | null | undefined,
): EveningStoryState {
  const { evening, events, applied, state } = model;
  const allIns = useMemo(() => allInsFromApplied(applied), [applied]);
  const { swings, pending: oddsPending } = useAllInSwings(allIns);

  const summary = useMemo<EveningSummary | null>(() => {
    if (!state.finished) return null;
    try {
      return summarize(
        evening.id,
        evening.scheduled_at,
        evening.format,
        events,
        scoringFromSettings(settings),
        evening.scoring,
      );
    } catch {
      return null;
    }
  }, [state.finished, evening, events, settings]);

  // Тренировка в историю клуба не входит: её сюжет — только из её журнала, как на табло.
  const training = isTrainingEvening(evening);
  const club = history.data;
  const items = useMemo(() => {
    if (!summary) return [];
    return eveningStory({
      summary,
      allIns,
      swings,
      excluded: club?.excluded ?? new Set(),
      club:
        club && !training
          ? {
              summaries: [
                ...club.summaries.filter((s) => s.eveningId !== summary.eveningId),
                summary,
              ],
              excluded: club.excluded,
              bestN: club.bestN,
              bestNBySeason: club.bestNBySeason,
            }
          : undefined,
    });
  }, [summary, allIns, swings, club, training]);

  return { allIns, items, pending: oddsPending || (!training && history.isPending) };
}
