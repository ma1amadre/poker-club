import type { AchievementCode } from '@domain/achievements.ts';
import { formatDate, formatSeason } from '../../shared/lib';
import { Accordion, Icon, List, ListItem, Progress, Section, type IconName } from '../../shared/ui';
import { groupProgress, SEASONAL_CODES, type ProgressView } from './progress';
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

export interface AchievementsProps {
  views: readonly AchievementView[];
  /** Прогресс до неполученных и гонка сезона (achievementProgress → progressView). */
  progress: readonly ProgressView[];
  seasonKey: string;
}

/**
 * Ачивки игрока: полученные — со счётчиком и датой последней; гонка текущего сезона за сезонные;
 * «на подходе» — неполученные с начатым счётчиком («4 из 5», полоса Progress, подсказка);
 * остальные — под раскрытием, с условием. Неполученная без прогресса (например, «Первая кровь»
 * после первого нокаута клуба) — с пометкой, что её уже не получить.
 */
export function Achievements({ views, progress, seasonKey }: AchievementsProps) {
  const earned = views.filter((v) => v.count > 0);
  const groups = groupProgress(progress);
  const inProgress = new Set(progress.map((p) => p.code));
  const gone = views.filter(
    (v) => v.count === 0 && !SEASONAL_CODES.has(v.code) && !inProgress.has(v.code),
  );
  const restCount = groups.rest.length + gone.length;

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
        <p className="m-small">Ачивок пока нет. Ниже — что ближе всего.</p>
      )}

      {groups.close.length > 0 && (
        <div className="pl-ach__group">
          <h3 className="m-eyebrow pl-ach__heading">На подходе</h3>
          <ProgressList items={groups.close} label="Ачивки на подходе" />
        </div>
      )}

      {groups.season.length > 0 && (
        <div className="pl-ach__group">
          <h3 className="m-eyebrow pl-ach__heading">Сезон «{formatSeason(seasonKey)}»</h3>
          <ProgressList items={groups.season} label="Сезонные ачивки: положение сейчас" />
        </div>
      )}

      {restCount > 0 && (
        <Accordion
          headingLevel="h3"
          items={[
            {
              id: 'locked',
              title: `Ещё не получены · ${restCount}`,
              content: (
                <List plain aria-label="Ещё не полученные ачивки" className="pl-ach--locked">
                  {groups.rest.map((item) => (
                    <ProgressRow key={item.code} item={item} />
                  ))}
                  {gone.map((view) => (
                    <ListItem
                      key={view.code}
                      before={<Icon name={ICONS[view.code]} size={20} className="pl-ach__icon" />}
                      title={<span className="pl-ach__locked-title">{view.title}</span>}
                      subtitle={view.description}
                      after={<span className="pl-ach__none">уже не получить</span>}
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

function ProgressList({ items, label }: { items: readonly ProgressView[]; label: string }) {
  return (
    <List aria-label={label}>
      {items.map((item) => (
        <ProgressRow key={item.code} item={item} />
      ))}
    </List>
  );
}

/**
 * Строка прогресса: иконка, название и счётчик (полоса Progress «Материи» с подписью — она же
 * подпись progressbar для скринридера), под ними подсказка. Без полосы — значение справа.
 */
function ProgressRow({ item }: { item: ProgressView }) {
  const icon = <Icon name={ICONS[item.code]} size={20} className="pl-ach__icon" />;
  if (!item.bar) {
    return (
      <ListItem
        className={item.muted ? 'pl-prog--muted' : undefined}
        before={icon}
        title={item.title}
        subtitle={item.hint}
        after={item.aside ? <span className="pl-prog__aside">{item.aside}</span> : undefined}
      />
    );
  }
  return (
    <li className="ui-list-row">
      <div className="ui-list-item pl-prog">
        <span className="ui-list-item__before">{icon}</span>
        <div className="pl-prog__body">
          <Progress
            className="pl-prog__bar"
            label={item.title}
            value={item.bar.value}
            max={item.bar.max}
            showValue
            valueText={item.bar.text}
          />
          <p className="pl-prog__hint">{item.hint}</p>
        </div>
      </div>
    </li>
  );
}
