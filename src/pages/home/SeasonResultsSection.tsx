// «Итоги сезона» на главной: первые две недели нового квартала (SEASON_RESULTS_DAYS, то же окно, что у
// поста бота) — подиум прошлого сезона и «Твой сезон» одной строкой. Карточка целиком ведёт на экран
// итогов сезона. Считает домен (seasonRecap) по уже загруженной истории клуба.
import { seasonResultsWindow } from '@domain/seasonCalendar.ts';
import { playerSeason, seasonRecap } from '@domain/seasonRecap.ts';
import { useMemo } from 'react';
import type { ClubHistory, Player } from '../../shared/api';
import {
  formatSeason,
  joinNames,
  mySeasonLine,
  paths,
  podiumView,
  seasonAchievementsLine,
} from '../../shared/lib';
import { Card, Icon, SeasonPodium, Section } from '../../shared/ui';

export interface SeasonResultsSectionProps {
  history: ClubHistory;
  me: Player;
  playersById: ReadonlyMap<string, Player>;
  nowMs: number;
}

export function SeasonResultsSection({
  history,
  me,
  playersById,
  nowMs,
}: SeasonResultsSectionProps) {
  const key = seasonResultsWindow(nowMs)?.seasonKey ?? null;
  const recap = useMemo(
    () => (key ? seasonRecap(history.achievementInput, key) : null),
    [history.achievementInput, key],
  );
  if (!key || !recap || !recap.closed || recap.eveningIds.length === 0) return null;

  const name = (id: string) => playersById.get(id)?.display_name ?? 'Игрок';
  const mine = playerSeason(recap, me.id);
  const steps = podiumView(recap).map((step) => ({
    place: step.place,
    value: step.value,
    // Без ссылок на игроков: карточка сама ссылка, вложенных ссылок не бывает.
    people: step.playerIds.map((id) => ({
      id,
      name: name(id),
      photoUrl: playersById.get(id)?.photo_url,
      me: id === me.id,
    })),
  }));

  return (
    <Section title="Итоги сезона" aside={formatSeason(key)}>
      <Card to={paths.season(key)} variant="raised" className="home-season-results">
        <p className="m-eyebrow home-season-results__eyebrow">
          <Icon name="trophy" size={16} />
          {recap.champions.length > 1 ? 'Чемпионы сезона' : 'Чемпион сезона'}
        </p>
        <p className="m-h3 ui-name home-season-results__champion">
          {recap.champions.length > 0 ? joinNames(recap.champions.map(name)) : 'Без чемпиона'}
        </p>
        {steps.length > 0 && (
          <SeasonPodium steps={steps} compact label={`Подиум сезона «${formatSeason(key)}»`} />
        )}
        {mine && (
          <div className="home-season-results__mine">
            <p className="m-eyebrow">Твой сезон</p>
            <p className="m-small">{mySeasonLine(mine)}</p>
            {mine.achievements.length > 0 && (
              <p className="m-small">Ачивки: {seasonAchievementsLine(mine.achievements)}</p>
            )}
          </div>
        )}
        <span className="home-card-link">
          Все итоги сезона
          <Icon name="chevron-right" size={16} />
        </span>
      </Card>
    </Section>
  );
}
