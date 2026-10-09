// Кнопки пульта после ривера (useRiverBusts): «Записать вылет: X» — один проигравший — с вопросом
// прямо здесь, несколько — шторка олл-ина (отметки, кто выбил, места по фишкам); «Вылет и ребай» —
// один проигравший, который может докупиться, — шторка с уже отмеченным «Сразу ребай» (там же
// «Оплачено сразу»). Запись закрывает раздачу.
import type { PlayerId } from '@domain/types.ts';
import { Button } from '../../shared/ui';
import { riverBustLabel } from './riverBusts';
import type { EveningActions } from './useEveningActions';
import type { EveningModel } from './useEveningModel';
import type { RiverBusts } from './useRiverBusts';

export function RiverActions({
  model,
  actions,
  river,
  primary,
  onSheet,
}: {
  model: EveningModel;
  actions: EveningActions;
  river: RiverBusts;
  /** Главное действие экрана (иначе — «Завершить вечер» главнее). */
  primary: boolean;
  /** Открыть шторку олл-ина на этой раздаче; rebuy — у кого «Сразу ребай» уже отмечен. */
  onSheet: (rebuy: PlayerId[]) => void;
}) {
  const { suggestion, defaultPlan } = river;
  if (!suggestion || !defaultPlan) return null;
  const [only] = suggestion.victims;
  const single = suggestion.victims.length === 1 ? only : undefined;
  const rebuyable = single !== undefined && river.canRebuyAfter(defaultPlan, single);
  return (
    <>
      <Button
        variant={primary ? 'primary' : 'secondary'}
        block
        icon="user-x"
        disabled={actions.busy}
        onClick={() => (single ? void river.record(defaultPlan, true) : onSheet([]))}
      >
        {riverBustLabel(suggestion.victims.map(model.nameOf))}
      </Button>
      {rebuyable && (
        <Button block icon="refresh-cw" disabled={actions.busy} onClick={() => onSheet([single])}>
          Вылет и ребай
        </Button>
      )}
    </>
  );
}
