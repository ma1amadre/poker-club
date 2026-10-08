// «На кону» перед вечером — на экране вечера (раздел) и в карточке анонса на главной (тот же список):
// кто в шаге от ачивки или рекорда и расклад сезона (useEveningStakes). Тексты — stakeLine /
// seasonStakeLines (shared/lib/stories): о людях без рода, о себе — на «ты».
import type { EveningStakes, StakeKind } from '@domain/stakes.ts';
import { seasonStakeLines, stakeLine } from '../../shared/lib';
import { Icon, type IconName } from '../../shared/ui';
import { STAKES_SHOWN } from './useEveningStakes';
import './stakes.css';

const STAKE_ICON: Record<StakeKind, IconName> = {
  win_step: 'trophy',
  enemy_step: 'shield',
  first_blood: 'zap',
  king_step: 'crosshair',
  revenge_step: 'shield',
  star_step: 'star',
  pool_record: 'coins',
  oracle_step: 'eye',
};

/** Список «На кону»: шаги (до STAKES_SHOWN) и строки сезона. */
export function StakesList({
  stakes,
  nameOf,
  meId,
}: {
  stakes: EveningStakes;
  nameOf: (id: string) => string;
  meId?: string | null;
}) {
  const season = stakes.season ? seasonStakeLines(stakes.season, nameOf, meId) : [];
  return (
    <ul className="ev-stakes" aria-label="На кону">
      {stakes.items.slice(0, STAKES_SHOWN).map((item, i) => (
        <li key={`${item.kind}:${i}`}>
          <Icon name={STAKE_ICON[item.kind]} size={16} />
          <span>{stakeLine(item, nameOf, meId)}</span>
        </li>
      ))}
      {season.map((line) => (
        <li key={line}>
          <Icon name="crown" size={16} />
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}
