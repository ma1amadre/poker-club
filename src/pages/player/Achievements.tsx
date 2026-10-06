import type { AchievementCode } from '@domain/achievements.ts';
import { formatDate, formatSeason } from '../../shared/lib';
import { Accordion, Icon, List, ListItem, Section, type IconName } from '../../shared/ui';
import type { AchievementView } from './stats';

/** Иконка ачивки — контурная Lucide из набора кита, цвет текста (не accent). */
const ICONS: Record<AchievementCode, IconName> = {
  first_blood: 'flag',
  hunter: 'user-x',
  comeback: 'rotate-ccw',
  rebuy_king: 'coins',
  iron_chair: 'calendar',
  hat_trick: 'trophy',
  sworn_enemy: 'zap',
  oracle: 'eye',
  star: 'star',
  champion: 'crown',
};

function earnedWhen(view: AchievementView): string | null {
  if (view.lastDate) return formatDate(view.lastDate);
  if (view.lastSeasonKey) return formatSeason(view.lastSeasonKey);
  return null;
}

/**
 * Ачивки игрока (computeAchievements домена → achievementsForPlayer): полученные — со счётчиком
 * и датой последней, неполученные — приглушённо и с условием, под раскрытием.
 */
export function Achievements({ views }: { views: readonly AchievementView[] }) {
  const earned = views.filter((v) => v.count > 0);
  const locked = views.filter((v) => v.count === 0);

  return (
    <Section title="Ачивки" aside={`${earned.length} из ${views.length}`}>
      {earned.length > 0 ? (
        <List aria-label="Полученные ачивки">
          {earned.map((view) => {
            const when = earnedWhen(view);
            return (
              <ListItem
                key={view.code}
                before={<Icon name={ICONS[view.code]} size={20} className="pl-ach__icon" />}
                title={view.title}
                subtitle={when ? `${view.description} · ${when}` : view.description}
                after={
                  <span className="m-mono pl-ach__count">
                    <span className="sr-only">Получена раз: </span>×{view.count}
                  </span>
                }
              />
            );
          })}
        </List>
      ) : (
        <p className="m-small">Ачивок пока нет. Условия каждой — ниже.</p>
      )}

      {locked.length > 0 && (
        <Accordion
          headingLevel="h3"
          items={[
            {
              id: 'locked',
              title: `Ещё не получены · ${locked.length}`,
              content: (
                <List plain aria-label="Ещё не полученные ачивки" className="pl-ach--locked">
                  {locked.map((view) => (
                    <ListItem
                      key={view.code}
                      before={<Icon name={ICONS[view.code]} size={20} className="pl-ach__icon" />}
                      title={<span className="pl-ach__locked-title">{view.title}</span>}
                      subtitle={view.description}
                      after={<span className="pl-ach__none">ещё нет</span>}
                    />
                  ))}
                </List>
              ),
            },
          ]}
        />
      )}
    </Section>
  );
}
