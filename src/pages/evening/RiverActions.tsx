// Вопрос пульта после ривера (useRiverBusts): стеков приложение не знает, поэтому без подталкивания к
// вылету (решение клуба 10.10.2026) — «X проигрывает раздачу. Фишек хватило?» и две равные кнопки:
// «Вылет» (одно нажатие: вылет, кто выбил — по картам, раздача закрывается) и «Остаётся за столом»
// (раздача закрывается без вылета, табло её убирает). Проигравших несколько — «Отметить вылет»
// (шторка олл-ина: отметить, кому не хватило фишек, кто выбил, места по фишкам) и «Все остаются за
// столом». «Вылет и ребай» — один проигравший, который может докупиться: шторка с уже отмеченным
// «Сразу ребай», там же кратность и «Оплачено сразу».
import type { PlayerId } from '@domain/types.ts';
import { Button } from '../../shared/ui';
import { RIVER_ANSWER, riverQuestion } from './riverBusts';
import type { EveningActions } from './useEveningActions';
import type { EveningModel } from './useEveningModel';
import type { RiverBusts } from './useRiverBusts';

export function RiverActions({
  model,
  actions,
  river,
  onSheet,
}: {
  model: EveningModel;
  actions: EveningActions;
  river: RiverBusts;
  /** Открыть шторку олл-ина на этой раздаче; rebuy — у кого «Сразу ребай» уже отмечен. */
  onSheet: (rebuy: PlayerId[]) => void;
}) {
  const { suggestion, defaultPlan } = river;
  if (!suggestion || !defaultPlan) return null;
  const { nameOf } = model;
  const [only] = suggestion.victims;
  const single = suggestion.victims.length === 1 ? only : undefined;
  const question = riverQuestion(
    suggestion.victims.map(nameOf),
    single ? (defaultPlan.killers[single] ?? []).map(nameOf) : [],
  );
  const rebuyable = single !== undefined && river.canRebuyAfter(defaultPlan, single);
  return (
    <div className="ev-river-ask" role="group" aria-label="После ривера">
      <p className="m-body ev-river-ask__text">{question.text}</p>
      <p className="m-small ev-river-ask__hint">{question.hint}</p>
      <div className="ev-river-ask__row">
        <Button
          block
          icon="user-x"
          disabled={actions.busy}
          onClick={() => (single ? void river.record(defaultPlan) : onSheet([]))}
        >
          {single ? RIVER_ANSWER.bust : RIVER_ANSWER.mark}
        </Button>
        <Button
          block
          icon="check"
          disabled={actions.busy}
          onClick={() => void river.stay(defaultPlan.showdownId, suggestion.victims)}
        >
          {single ? RIVER_ANSWER.stay : RIVER_ANSWER.stayAll}
        </Button>
      </div>
      {rebuyable && (
        <Button
          variant="ghost"
          block
          icon="refresh-cw"
          disabled={actions.busy}
          onClick={() => onSheet([single])}
        >
          Вылет и ребай
        </Button>
      )}
    </div>
  );
}
