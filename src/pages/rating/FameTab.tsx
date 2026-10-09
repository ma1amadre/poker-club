import { hallOfFame, type HallOfFameEntry } from '@domain/season.ts';
import { closedSeasonRecaps, type SeasonRecap } from '@domain/seasonRecap.ts';
import { useMemo } from 'react';
import {
  formatPointsWithUnit,
  formatSeason,
  formatSeasonGenitive,
  joinNames,
  paths,
  podiumView,
  seasonLaureates,
  seasonMetaLine,
} from '../../shared/lib';
import { Avatar, ButtonLink, Card, Empty, Icon, SeasonPodium } from '../../shared/ui';
import { playerName, type RatingContext } from './context';

/**
 * Зал славы: переходящий трофей — у чемпиона последнего завершённого сезона (hallOfFame домена), ниже —
 * каждый завершённый сезон, новые сверху: подиум 1–3 и лауреаты (Оракул, деньги, охотник, сезонные
 * ачивки) — seasonRecap домена, те же, что на экране итогов сезона.
 */
export function FameTab({ ctx }: { ctx: RatingContext }) {
  const { history } = ctx;
  const hall = useMemo(
    () =>
      hallOfFame(history.summaries, {
        bestN: history.bestN,
        excluded: history.excluded,
        currentSeasonKey: history.currentSeasonKey,
        bestNBySeason: history.bestNBySeason,
      }),
    [
      history.summaries,
      history.bestN,
      history.excluded,
      history.currentSeasonKey,
      history.bestNBySeason,
    ],
  );
  const seasons = useMemo(
    () => closedSeasonRecaps(history.achievementInput),
    [history.achievementInput],
  );

  if (seasons.length === 0) {
    return (
      <div className="rt-panel">
        <Empty
          icon="calendar"
          title="Первого чемпиона ещё нет"
          description={`Чемпион определится, когда закончится ${formatSeason(history.currentSeasonKey)}: в зал славы попадают подиум и лауреаты сезона.`}
        />
      </div>
    );
  }

  const [holder] = hall;
  return (
    <div className="rt-panel">
      {holder && <TrophyCard ctx={ctx} entry={holder} />}
      {seasons.map((recap) => (
        <SeasonCard key={recap.seasonKey} ctx={ctx} recap={recap} />
      ))}
      <p className="m-small">
        Чемпион сезона — 1-е место таблицы сезона. Значок чемпиона держится до конца следующего
        сезона, трофей переходит к новому чемпиону.
      </p>
    </div>
  );
}

function TrophyCard({ ctx, entry }: { ctx: RatingContext; entry: HallOfFameEntry }) {
  const single = entry.champions.length === 1 ? entry.champions[0] : undefined;
  const names = entry.champions.map((id) => playerName(ctx, id)).join(', ');
  return (
    <Card variant={single ? 'raised' : 'outline'} to={single ? paths.player(single) : undefined}>
      <div className="rt-trophy">
        <span className="rt-trophy__avatars">
          {entry.champions.slice(0, 3).map((id) => {
            const player = ctx.playersById.get(id);
            return (
              <Avatar
                key={id}
                name={player?.display_name ?? '?'}
                photoUrl={player?.photo_url}
                size="xl"
              />
            );
          })}
        </span>
        <div className="rt-trophy__text">
          <p className="m-eyebrow rt-trophy__eyebrow">
            <Icon name="trophy" size={16} />
            Переходящий трофей
          </p>
          <p className="m-h3 ui-name rt-trophy__name">{names}</p>
          <p className="m-small">
            Чемпион {formatSeasonGenitive(entry.seasonKey)} · {formatPointsWithUnit(entry.total)}
          </p>
        </div>
      </div>
    </Card>
  );
}

/** Завершённый сезон: подиум, лауреаты строкой и переход к итогам. */
function SeasonCard({ ctx, recap }: { ctx: RatingContext; recap: SeasonRecap }) {
  const steps = podiumView(recap).map((step) => ({
    place: step.place,
    value: step.value,
    people: step.playerIds.map((id) => ({
      id,
      name: playerName(ctx, id),
      photoUrl: ctx.playersById.get(id)?.photo_url,
      to: paths.player(id),
    })),
  }));
  const laureates = seasonLaureates(recap);
  return (
    <Card className="rt-season">
      <div className="rt-season__head">
        <div>
          <p className="m-h3 rt-season__title">{formatSeason(recap.seasonKey)}</p>
          <p className="m-small">{seasonMetaLine(recap)}</p>
        </div>
        <ButtonLink
          to={paths.season(recap.seasonKey)}
          size="sm"
          variant="ghost"
          iconAfter="arrow-right"
        >
          Итоги
        </ButtonLink>
      </div>
      {steps.length > 0 ? (
        <SeasonPodium
          steps={steps}
          compact
          label={`Подиум сезона «${formatSeason(recap.seasonKey)}»`}
        />
      ) : (
        <p className="m-small">Очков в сезоне никто не набрал — подиума нет.</p>
      )}
      {laureates.length > 0 && (
        <ul className="rt-laureates" aria-label="Лауреаты сезона">
          {laureates.map((l) => (
            <li key={l.id} className="m-small">
              <span className="rt-laureates__title">{l.title}</span> —{' '}
              {joinNames(l.playerIds.map((id) => playerName(ctx, id)))}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
