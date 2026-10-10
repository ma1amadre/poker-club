import { lastEveningMoves, type PlaceMove } from '@domain/placeMoves.ts';
import { bestNForSeason, sameRank, seasonStandings, type StandingRow } from '@domain/season.ts';
import type { EveningSummary } from '@domain/summary.ts';
import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { gameNosById, scoringFromSettings } from '../../shared/api';
import {
  bestNRule,
  cn,
  countedSummary,
  formatDate,
  formatPoints,
  formatSeason,
  formatSeasonGenitive,
  gameSuffix,
  paths,
  placeLabel,
  scoringRuleOf,
  standingMeta,
} from '../../shared/lib';
import { Button, ButtonLink, Empty, Icon, List, Notice } from '../../shared/ui';
import type { RatingContext } from './context';
import { MovesNote, PlayerName, Rank, Score, SeasonSelect } from './parts';
import { markCountedEvenings, moveOf, standingPlaces } from './stats';

interface SeasonTabProps {
  ctx: RatingContext;
  seasons: readonly string[];
  season: string;
  onSeason: (season: string) => void;
}

/**
 * Таблица сезона: сумма лучших N вечеров (seasonStandings домена). Строка раскрывается —
 * видно, какие вечера игрока вошли в зачёт, и есть переход в карточку игрока.
 */
export function SeasonTab({ ctx, seasons, season, onSeason }: SeasonTabProps) {
  const { history } = ctx;
  const seasonSummaries = useMemo(
    () => history.summaries.filter((s) => s.seasonKey === season),
    [history.summaries, season],
  );
  const build = useMemo(
    () => (list: readonly EveningSummary[]) =>
      seasonStandings(list, {
        bestN: history.bestN,
        excluded: history.excluded,
        seasonKey: season,
        bestNBySeason: history.bestNBySeason,
      }),
    [season, history.bestN, history.excluded, history.bestNBySeason],
  );
  const rows = useMemo(() => build(seasonSummaries), [build, seasonSummaries]);
  const places = useMemo(() => standingPlaces(rows), [rows]);
  // Стрелки: сдвиг мест после последнего вечера сезона (lastEveningMoves домена, та же таблица).
  const moves = useMemo(
    () => lastEveningMoves(seasonSummaries, build, sameRank),
    [seasonSummaries, build],
  );
  const [openId, setOpenId] = useState<string | null>(null);
  // Правила — те, по которым посчитана эта таблица: снимки вечеров сезона и «лучшие N» сезона
  // (у закрытого — замороженное значение), а не обязательно текущие настройки.
  const scoring = scoringFromSettings(history.settings);
  const rule = scoringRuleOf(
    seasonSummaries.map((s) => s.scoring ?? scoring),
    scoring,
  );
  const bestN = bestNForSeason(season, history.bestN, history.bestNBySeason);
  // Завершённый сезон — финальная таблица и переход к его итогам.
  const closed = season < history.currentSeasonKey && rows.length > 0;
  const currentEmpty = !history.summaries.some((s) => s.seasonKey === history.currentSeasonKey);

  return (
    <div className="rt-panel">
      <SeasonSelect
        seasons={seasons}
        current={history.currentSeasonKey}
        value={season}
        onChange={(next) => {
          setOpenId(null);
          onSeason(next);
        }}
      />

      {closed && (
        <Notice
          tone="info"
          className="rt-final"
          title={`Финальная таблица ${formatSeasonGenitive(season)}`}
          action={
            <span className="rt-notice-actions">
              <ButtonLink to={paths.season(season)} size="sm" icon="trophy">
                Итоги сезона
              </ButtonLink>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setOpenId(null);
                  onSeason(history.currentSeasonKey);
                }}
              >
                Открыть текущий сезон
              </Button>
            </span>
          }
        >
          {currentEmpty
            ? 'В новом сезоне вечеров ещё не было — его таблица начнётся с первого.'
            : 'Подиум, деньги, «Оракул сезона» и рекорды сезона — на экране итогов.'}
        </Notice>
      )}

      {rows.length === 0 ? (
        <Empty
          icon="calendar"
          title={
            season === history.currentSeasonKey
              ? 'Сезон только начался'
              : `В сезоне «${formatSeason(season)}» вечеров не было`
          }
          description="Таблица заполнится после первого завершённого вечера сезона."
        />
      ) : (
        <List className="rt-rows" aria-label={`Таблица сезона «${formatSeason(season)}»`}>
          {rows.map((row, index) => (
            <SeasonRow
              key={row.playerId}
              ctx={ctx}
              row={row}
              place={places[index] ?? index + 1}
              move={moveOf(moves, row.playerId)}
              summaries={seasonSummaries}
              open={openId === row.playerId}
              onToggle={() => setOpenId((id) => (id === row.playerId ? null : row.playerId))}
            />
          ))}
        </List>
      )}

      <MovesNote moves={moves} summaryById={history.summaryById} />
      <p className="m-small">
        {rule}. {bestNRule(bestN)}. При равенстве выше тот, у кого больше побед, потом — нокаутов.
      </p>
    </div>
  );
}

interface SeasonRowProps {
  ctx: RatingContext;
  row: StandingRow;
  place: number;
  /** Сдвиг места после последнего вечера сезона (moveOf). */
  move: PlaceMove | null | undefined;
  summaries: readonly EveningSummary[];
  open: boolean;
  onToggle: () => void;
}

function SeasonRow({ ctx, row, place, move, summaries, open, onToggle }: SeasonRowProps) {
  const detailId = useId();
  const marks = useMemo(
    () => (open ? markCountedEvenings(summaries, row.playerId, row.counted) : []),
    [open, summaries, row.playerId, row.counted],
  );
  const gameNos = gameNosById(ctx.history.evenings);

  return (
    <li className={cn('rt-row', ctx.meId === row.playerId && 'rt-row--me')}>
      <button
        type="button"
        className="rt-row__btn"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={onToggle}
      >
        <Rank place={place} player={ctx.playersById.get(row.playerId)} move={move} />
        <span className="rt-row__body">
          <PlayerName ctx={ctx} id={row.playerId} />
          <span className="rt-meta">{standingMeta(row)}</span>
        </span>
        <Score value={row.total} />
        <Icon name="chevron-down" size={20} className="rt-row__chevron" />
      </button>

      <div id={detailId} className="rt-detail" hidden={!open}>
        {open && (
          <>
            <p className="m-small">{countedSummary(row.counted.length, row.played)}</p>
            <ul className="rt-evenings" aria-label="Вечера игрока в сезоне">
              {marks.map((mark) => (
                <li key={mark.eveningId}>
                  <Link
                    to={paths.evening(mark.eveningId)}
                    className={cn('rt-ev', mark.counted ? 'rt-ev--in' : 'rt-ev--out')}
                  >
                    <span className="rt-ev__date">
                      {formatDate(mark.date)}
                      {gameSuffix(gameNos.get(mark.eveningId))}
                    </span>
                    <span className="rt-ev__points m-mono">{formatPoints(mark.points)}</span>
                    <span className="rt-ev__place">{placeLabel(mark.place, mark.entrants)}</span>
                    <span className="rt-ev__mark">
                      {mark.counted ? (
                        <>
                          <Icon name="check" size={14} />в зачёте
                        </>
                      ) : (
                        'вне зачёта'
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <ButtonLink
              to={paths.player(row.playerId)}
              size="sm"
              variant="ghost"
              iconAfter="arrow-right"
              className="rt-detail__link"
            >
              Открыть карточку игрока
            </ButtonLink>
          </>
        )}
      </div>
    </li>
  );
}
