// Состояние экрана рейтинга в адресе (HashRouter: #/rating?tab=money&season=2026-Q3): после
// перехода в карточку игрока «Назад» возвращает ту же вкладку и тот же сезон, ссылкой можно
// поделиться.
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export const RATING_TABS = ['season', 'money', 'alltime', 'oracle', 'records', 'fame'] as const;
export type RatingTab = (typeof RATING_TABS)[number];

export type MoneyPeriod = 'season' | 'all';

function parseTab(value: string | null): RatingTab {
  return (RATING_TABS as readonly string[]).includes(value ?? '') ? (value as RatingTab) : 'season';
}

export interface RatingParams {
  tab: RatingTab;
  /** Выбранный сезон; если в адресе нет или его нет среди вариантов — fallback. */
  season: string;
  period: MoneyPeriod;
  set: (patch: Partial<{ tab: RatingTab; season: string; period: MoneyPeriod }>) => void;
}

/**
 * Вкладка, сезон и период денег из адреса. allowedSeasons — сезоны, которые есть в выборе:
 * чужой или устаревший ключ из ссылки молча заменяется на fallbackSeason (текущий сезон).
 */
export function useRatingParams(
  allowedSeasons: readonly string[],
  fallbackSeason: string,
): RatingParams {
  const [params, setParams] = useSearchParams();
  const rawSeason = params.get('season');
  const season = rawSeason && allowedSeasons.includes(rawSeason) ? rawSeason : fallbackSeason;

  const set = useCallback<RatingParams['set']>(
    (patch) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (patch.tab) next.set('tab', patch.tab);
          if (patch.season) next.set('season', patch.season);
          if (patch.period) next.set('period', patch.period);
          return next;
        },
        // replace: переключение вкладок не копит историю — «Назад» уводит с экрана, а не по вкладкам.
        { replace: true },
      );
    },
    [setParams],
  );

  return {
    tab: parseTab(params.get('tab')),
    season,
    period: params.get('period') === 'all' ? 'all' : 'season',
    set,
  };
}
