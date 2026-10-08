import {
  ACHIEVEMENT_LEVEL_RULE,
  ACHIEVEMENT_META,
  achievementLevelText,
  isLeveled,
  levelMark,
  type AchievementCode,
} from '@domain/achievements.ts';
import { capitalize, formatDate, formatSeason, keepNumbersTogether } from '../../shared/lib';
import { Accordion, Icon, List, ListItem, Progress, Section, type IconName } from '../../shared/ui';
import { groupProgress, SEASONAL_CODES, type ProgressView } from './progress';
import type { AchievementView } from './stats';

/** Иконка ачивки — контурная Lucide из набора кита, цвет текста (не accent). */
const ACHIEVEMENT_ICONS: Record<AchievementCode, IconName> = {
  first_blood: 'flag',
  hunter: 'user-x',
  comeback: 'rotate-ccw',
  phoenix: 'trending-up',
  clean_win: 'check-circle',
  rebuy_king: 'coins',
  iron_chair: 'calendar',
  hat_trick: 'trophy',
  sworn_enemy: 'zap',
  revenge: 'shield',
  king_hunt: 'crosshair',
  oracle: 'eye',
  star: 'star',
  champion: 'crown',
};

function earnedWhen(view: AchievementView): string | null {
  if (view.lastDate) return formatDate(view.lastDate);
  if (view.lastSeasonKey) return formatSeason(view.lastSeasonKey);
  return null;
}

/** Что даёт уровень игрока: «4 нокаута за вечер»; без уровней — описание ачивки. */
function earnedText(view: AchievementView): string {
  if (isLeveled(view.code) && view.level > 0) {
    const text = achievementLevelText(view.code, view.level);
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  return view.description;
}

/** «II из III» — уровень игрока из всех; у ачивок без уровней — null. */
function levelOf(view: AchievementView): string | null {
  return view.levels > 1 && view.level > 0
    ? `${levelMark(view.level)} из ${levelMark(view.levels)}`
    : null;
}

export interface AchievementsProps {
  views: readonly AchievementView[];
  /** Прогресс до неполученных и следующих уровней, гонка сезона (achievementProgress → progressView). */
  progress: readonly ProgressView[];
  seasonKey: string;
}

/**
 * Ачивки игрока: полученные — с уровнем («Охотник II»), счётчиком и датой последней; гонка текущего
 * сезона за сезонные; «на подходе» — неполученные и следующие уровни с начатым счётчиком («4 из 5»,
 * полоса Progress, подсказка); остальные — под раскрытием, с условием. Неполученная без прогресса
 * (например, «Первая кровь» после первого нокаута клуба) — с пометкой, что её уже не получить.
 * Ниже — каталог всех ачивок с уровнями: у новичка без ачивок он раскрыт.
 */
export function Achievements({ views, progress, seasonKey }: AchievementsProps) {
  const earned = views.filter((v) => v.count > 0);
  const groups = groupProgress(progress);
  const inProgress = new Set(progress.map((p) => p.code));
  const gone = views.filter(
    (v) => v.count === 0 && !SEASONAL_CODES.has(v.code) && !inProgress.has(v.code),
  );
  const restCount = groups.rest.length + gone.length;
  const newcomer = earned.length === 0;

  const accordion = [
    ...(restCount > 0
      ? [
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
                    before={
                      <Icon
                        name={ACHIEVEMENT_ICONS[view.code]}
                        size={20}
                        className="pl-ach__icon"
                      />
                    }
                    title={<span className="pl-ach__locked-title">{view.title}</span>}
                    subtitle={view.description}
                    after={<span className="pl-ach__none">уже не получить</span>}
                  />
                ))}
              </List>
            ),
          },
        ]
      : []),
    {
      id: 'catalog',
      title: `Все ачивки и уровни · ${views.length}`,
      content: <Catalog views={views} />,
    },
  ];

  return (
    <Section title="Ачивки" aside={`${earned.length} из ${views.length}`}>
      {earned.length > 0 ? (
        <List aria-label="Полученные ачивки">
          {earned.map((view) => {
            const when = earnedWhen(view);
            const level = levelOf(view);
            return (
              <ListItem
                key={view.code}
                before={
                  <Icon name={ACHIEVEMENT_ICONS[view.code]} size={20} className="pl-ach__icon" />
                }
                title={view.title}
                subtitle={keepNumbersTogether(
                  [earnedText(view), level && `уровень ${level}`, when].filter(Boolean).join(' · '),
                )}
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
        <p className="m-small">
          Ачивок пока нет. Ниже — что ближе всего и все ачивки клуба с уровнями.
        </p>
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

      <Accordion
        headingLevel="h3"
        multiple
        defaultOpen={newcomer ? ['catalog'] : []}
        items={accordion}
      />
    </Section>
  );
}

/**
 * Каталог: все ачивки клуба по порядку, у уровневых — правило (за что считается уровень: у «Звезды
 * вечера» — за что звезда) и что даёт каждый уровень («I — 3 нокаута за вечер»). Справа — свой
 * результат: уровень («II из III») или сколько раз получена.
 */
function Catalog({ views }: { views: readonly AchievementView[] }) {
  return (
    <List plain aria-label="Все ачивки клуба" className="pl-ach__catalog">
      {views.map((view) => {
        const code = view.code;
        const levels = isLeveled(code)
          ? [
              capitalize(ACHIEVEMENT_LEVEL_RULE[code]),
              ...Array.from({ length: view.levels }, (_, i) => i + 1).map(
                (l) => `${levelMark(l)} — ${achievementLevelText(code, l)}`,
              ),
            ]
          : [];
        const level = levelOf(view);
        return (
          <ListItem
            key={code}
            before={<Icon name={ACHIEVEMENT_ICONS[code]} size={20} className="pl-ach__icon" />}
            title={ACHIEVEMENT_META[code].title}
            subtitle={
              levels.length > 0 ? (
                <span className="pl-ach__levels">
                  {levels.map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </span>
              ) : (
                ACHIEVEMENT_META[code].description
              )
            }
            after={
              level ? (
                <span className="pl-prog__aside">{level}</span>
              ) : view.count > 0 ? (
                <span className="m-mono pl-ach__count">
                  <span className="sr-only">Получена раз: </span>×{view.count}
                </span>
              ) : undefined
            }
          />
        );
      })}
    </List>
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
  const icon = <Icon name={ACHIEVEMENT_ICONS[item.code]} size={20} className="pl-ach__icon" />;
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
