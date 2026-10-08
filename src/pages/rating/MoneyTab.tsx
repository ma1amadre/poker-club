import { lastEveningMoves } from '@domain/placeMoves.ts';
import { moneyStandings, type StandingRow } from '@domain/season.ts';
import type { EveningSummary } from '@domain/summary.ts';
import { useMemo } from 'react';
import { eveningsCount, formatSeason, paths } from '../../shared/lib';
import { Amount, Empty, List, ListItem, Segmented } from '../../shared/ui';
import type { RatingContext } from './context';
import { MovesNote, PlayerName, Rank, SeasonSelect } from './parts';
import { meRowClass, moneyPlaces, moveOf } from './stats';
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

/** Делят место в денежной таблице: равное нетто (как moneyPlaces). */
const sameNet = (a: StandingRow, b: StandingRow): boolean => a.netRub === b.netRub;

/** Денежный профит (moneyStandings домена): нетто за сезон или за всё время, знак + цвет + иконка. */
export function MoneyTab({ ctx, seasons, season, onSeason, period, onPeriod }: MoneyTabProps) {
  const { history } = ctx;
  // Итоги таблицы: сезон или всё время; та же таблица без последнего вечера даёт стрелки сдвига.
  const list = useMemo(
    () =>
      period === 'season'
        ? history.summaries.filter((s) => s.seasonKey === season)
        : history.summaries,
    [history.summaries, period, season],
  );
  const rows = useMemo(
    () => moneyStandings(list, { excluded: history.excluded }),
    [list, history.excluded],
  );
  const places = useMemo(() => moneyPlaces(rows), [rows]);
  const moves = useMemo(
    () =>
      lastEveningMoves(
        list,
        (s: readonly EveningSummary[]) => moneyStandings(s, { excluded: history.excluded }),
        sameNet,
      ),
    [list, history.excluded],
  );

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
              className={meRowClass(ctx.meId, row.playerId)}
              before={
                <Rank
                  place={places[index] ?? index + 1}
                  player={ctx.playersById.get(row.playerId)}
                  move={moveOf(moves, row.playerId)}
                />
              }
              title={<PlayerName ctx={ctx} id={row.playerId} />}
              subtitle={eveningsCount(row.played)}
              after={<Amount value={row.netRub} icon className="rt-money" />}
            />
          ))}
        </List>
      )}

      <MovesNote moves={moves} summaryById={history.summaryById} />
      <p className="m-small">
        Нетто — призовые минус входы и ребаи. Плюс — игрок в выигрыше, минус — в проигрыше. Гости в
        таблицу не входят.
      </p>
    </div>
  );
}
