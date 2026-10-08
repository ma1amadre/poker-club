import { lastEveningMoves } from '@domain/placeMoves.ts';
import { PREDICTION_POINTS } from '@domain/predictions.ts';
import { oracleStandings, type OracleRow } from '@domain/season.ts';
import type { EveningSummary } from '@domain/summary.ts';
import { useMemo } from 'react';
import { formatPointsWithUnit, formatSeason, NBSP, paths, plural } from '../../shared/lib';
import { Empty, List, ListItem } from '../../shared/ui';
import type { RatingContext } from './context';
import { MovesNote, PlayerName, Rank, Score, SeasonSelect } from './parts';
import { meRowClass, moveOf, oraclePlaces, seasonPredictionScores } from './stats';

interface OracleTabProps {
  ctx: RatingContext;
  seasons: readonly string[];
  season: string;
  onSeason: (season: string) => void;
}

/** Делят место в «Оракуле»: равные очки и угаданные победители (как oraclePlaces). */
const sameOracle = (a: OracleRow, b: OracleRow): boolean =>
  a.total === b.total && a.winnerHits === b.winnerHits;

function predictionsMeta(row: { predictions: number; winnerHits: number; firstOutHits: number }) {
  const count = `${row.predictions}${NBSP}${plural(row.predictions, ['прогноз', 'прогноза', 'прогнозов'])}`;
  return `${count} · угадано победителей: ${row.winnerHits}, первых вылетов: ${row.firstOutHits}`;
}

/** «Оракул сезона» (oracleStandings домена): очки прогнозов, участвуют и те, кто не играл. */
export function OracleTab({ ctx, seasons, season, onSeason }: OracleTabProps) {
  const { history } = ctx;
  const scores = useMemo(
    () =>
      seasonPredictionScores(
        history.predictionScores,
        (id) => history.summaryById.get(id)?.seasonKey,
        season,
        history.excluded,
      ),
    [history.predictionScores, history.summaryById, history.excluded, season],
  );
  const rows = useMemo(() => oracleStandings(scores), [scores]);
  const places = useMemo(() => oraclePlaces(rows), [rows]);
  // Стрелки: та же таблица по прогнозам вечеров сезона без последнего вечера.
  const moves = useMemo(() => {
    const evenings = history.summaries.filter((s) => s.seasonKey === season);
    const build = (list: readonly EveningSummary[]) => {
      const ids = new Set(list.map((s) => s.eveningId));
      return oracleStandings(scores.filter((p) => ids.has(p.eveningId)));
    };
    return lastEveningMoves(evenings, build, sameOracle);
  }, [history.summaries, season, scores]);

  return (
    <div className="rt-panel">
      <SeasonSelect
        seasons={seasons}
        current={history.currentSeasonKey}
        value={season}
        onChange={onSeason}
      />

      {rows.length === 0 ? (
        <Empty
          icon="eye"
          title="Прогнозов в этом сезоне ещё не было"
          description="Прогноз на победителя и первый вылет делают на главной, в карточке ближайшего вечера, до старта таймера."
        />
      ) : (
        <List aria-label={`Оракул сезона «${formatSeason(season)}»`}>
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
              subtitle={<span className="rt-meta">{predictionsMeta(row)}</span>}
              after={<Score value={row.total} />}
            />
          ))}
        </List>
      )}

      <MovesNote moves={moves} summaryById={history.summaryById} />
      <p className="m-small">
        Угаданный победитель — {formatPointsWithUnit(PREDICTION_POINTS.winner)}, первый вылет —{' '}
        {formatPointsWithUnit(PREDICTION_POINTS.firstOut)}. Прогнозы закрываются при старте таймера,
        делать их могут и те, кто не играет.
      </p>
    </div>
  );
}
