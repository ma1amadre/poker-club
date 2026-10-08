// «Сюжет вечера» строками с иконками (экран итога). Тексты — storyLine (shared/lib/stories): о людях
// в настоящем времени и без рода, о себе — на «ты».
import type { StoryItem, StoryKind } from '@domain/story.ts';
import { storyLine } from '../../shared/lib';
import { Icon, type IconName } from '../../shared/ui';
import type { NameOf } from './lib';

const STORY_ICON: Record<StoryKind, IconName> = {
  swing: 'zap',
  revenge: 'shield',
  record: 'trophy',
  season_leader: 'crown',
  phoenix: 'trending-up',
  comeback: 'rotate-ccw',
};

export function StoryFacts({
  items,
  nameOf,
  meId,
}: {
  items: readonly StoryItem[];
  nameOf: NameOf;
  meId?: string | null;
}) {
  return (
    <ul className="ev-factlist" aria-label="Сюжет вечера">
      {items.map((item, i) => (
        <li key={`${item.kind}:${i}`}>
          <Icon name={STORY_ICON[item.kind]} size={16} />
          <span>{storyLine(item, nameOf, meId)}</span>
        </li>
      ))}
    </ul>
  );
}
