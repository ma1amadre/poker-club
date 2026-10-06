import { moneyStandings } from '@domain/season.ts';
import { useMemo } from 'react';
import { eveningsCount, formatSeason, paths } from '../../shared/lib';
import { Amount, Empty, List, ListItem, Segmented } from '../../shared/ui';
import type { RatingContext } from './context';
import { PlayerName, Rank, SeasonSelect } from './parts';
import { moneyPlaces } from './stats';
import type { MoneyPeriod } from './useRatingParams';

interface MoneyTabProps {
  ctx: RatingContext;
  seasons: readonly string[];
  season: string;
  onSeason: (season: string) => void;
  period: MoneyPeriod;
  onPeriod: (period: MoneyPeriod) => void;
}

const PERIODS = [
  { value: 'season', label: 'Сезон' },
  { value: 'all', label: 'Всё время' },
] as const;

/** Денежный профит (moneyStandings домена): нетто за сезон или за всё время, знак + цвет + иконка. */
export function MoneyTab({ ctx, seasons, season, onSeason, period, onPeriod }: MoneyTabProps) {
  const { history } = ctx;
  const rows = useMemo(
    () =>
      moneyStandings(history.summaries, {
        excluded: history.excluded,
        seasonKey: period === 'season' ? season : undefined,
      }),
    [history.summaries, history.excluded, period, season],
  );
  const places = useMemo(() => moneyPlaces(rows), [rows]);

  return (
    <div className="rt-panel">
      <Segmented label="Период" options={PERIODS} value={period} onChange={onPeriod} block />
      {period === 'season' && (
        <SeasonSelect
          seasons={seasons}
          current={history.currentSeasonKey}
          value={season}
          onChange={onSeason}
        />
      )}

      {rows.length === 0 ? (
        <Empty
          icon="credit-card"
          title="Сезон только начался"
          description="Нетто появится после первого завершённого вечера сезона."
        />
      ) : (
        <List
          aria-label={
            period === 'season' ? `Нетто за сезон «${formatSeason(season)}»` : 'Нетто за всё время'
          }
        >
          {rows.map((row, index) => (
            <ListItem
              key={row.playerId}
              to={paths.player(row.playerId)}
              before={
                <Rank
                  place={places[index] ?? index + 1}
                  player={ctx.playersById.get(row.playerId)}
                />
              }
              title={<PlayerName ctx={ctx} id={row.playerId} />}
              subtitle={eveningsCount(row.played)}
              after={<Amount value={row.netRub} icon className="rt-money" />}
            />
          ))}
        </List>
      )}

      <p className="m-small">
        Нетто — призовые и головы минус входы и ребаи. Плюс — игрок в выигрыше, минус — в проигрыше.
        Гости в таблицу не входят.
      </p>
    </div>
  );
}
