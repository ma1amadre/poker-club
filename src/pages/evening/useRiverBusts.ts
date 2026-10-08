// Олл-ин после ривера: «Записать вылет: X, выбивает Y». Кто проиграл раздачу — по картам
// (riverBusts.ts), вылетел ли он — решает банкир: стеков пульт не знает (подтверждение, отметки).
// Один проигравший — кнопка с вопросом прямо на пульте и в шторке олл-ина; несколько — в шторке
// олл-ина: отметить вылетевших и порядок по фишкам перед раздачей (у кого больше — место выше),
// запись — одним действием (add_events) в правильном порядке мест.
import { canApplySequence } from '@domain/replay.ts';
import { visibleShowdown } from '@domain/showdown.ts';
import type { PlayerId } from '@domain/types.ts';
import { useState } from 'react';
import { capitalize, joinNames } from '../../shared/lib';
import { bustRebuyDrafts } from './lib';
import {
  keepChipOrder,
  moveUp,
  riverBustDrafts,
  riverBustQuestion,
  riverBustSuggestion,
  riverKillersText,
  type RiverBustSuggestion,
} from './riverBusts';
import type { EveningActions } from './useEveningActions';
import type { EveningModel } from './useEveningModel';

export interface RiverBusts {
  /** Что предложить после ривера (раздача на табло, проигравшие в игре) или null. */
  suggestion: RiverBustSuggestion | null;
  /**
   * Записать вылеты (byChips — от большего стека к меньшему). ask — с вопросом (кнопка на пульте);
   * в шторке олл-ина вопроса нет: отметки и порядок там и есть подтверждение, а окно поверх шторки
   * «Материя» не допускает. Запись или null: отказ, «Не записывать», ошибка.
   */
  record: (byChips: readonly PlayerId[], ask: boolean) => Promise<unknown>;
}

export function useRiverBusts(
  model: EveningModel,
  actions: EveningActions,
  onRebuy?: (playerId: PlayerId) => void,
): RiverBusts {
  const { state, nowMs, nameOf, evening, events, applied } = model;
  const showdown = visibleShowdown(state.showdown, nowMs);
  // Уже вылетевших в этой раздаче (вылет, затем ребай из тоста) второй раз не предлагаем.
  const suggestion = showdown
    ? riverBustSuggestion(showdown, (id) => Boolean(state.players[id]?.alive), applied)
    : null;

  const record = async (byChips: readonly PlayerId[], ask: boolean) => {
    if (!suggestion || byChips.length === 0) return null;
    const killers = suggestion.killers;
    if (ask) {
      const question = riverBustQuestion(byChips.map(nameOf), killers.map(nameOf));
      const ok = await actions.confirm({ ...question, cancelText: 'Не записывать' });
      if (!ok) return null;
    }
    const detail = `${capitalize(riverKillersText(killers.map(nameOf)))}.`;
    const [only] = byChips;
    if (byChips.length === 1 && only) {
      // Пока игрок может докупиться, в тосте — «Ребай» (как после вылета из шторки игрока).
      const rebuyAfter =
        canApplySequence(
          evening.format,
          events,
          bustRebuyDrafts(evening.format, { playerId: only, by: [] }, 1, false),
          nowMs,
        ) === null;
      return actions.send(
        'bust',
        { playerId: only, by: [...killers] },
        {
          success: `Вылет записан: ${nameOf(only)}`,
          detail,
          undo: true,
          action:
            onRebuy && rebuyAfter ? { label: 'Ребай', onClick: () => onRebuy(only) } : undefined,
        },
      );
    }
    return actions.sendAll(riverBustDrafts(byChips, killers), {
      success: `Вылеты записаны: ${joinNames(byChips.map(nameOf))}`,
      detail,
      undo: true,
    });
  };

  return { suggestion, record };
}

/** Выбор в шторке олл-ина: кто вылетел (по умолчанию все проигравшие) и порядок по фишкам. */
export function useRiverChoice(suggestion: RiverBustSuggestion | null) {
  // null — банкир ещё не трогал отметки: отмечены все проигравшие (в том числе новые по Realtime).
  const [picked, setPicked] = useState<PlayerId[] | null>(null);
  const [order, setOrder] = useState<PlayerId[]>([]);
  const victims = suggestion?.victims ?? [];
  const chosen = (picked ?? victims).filter((id) => victims.includes(id));
  const byChips = keepChipOrder(order, chosen);
  return {
    victims,
    byChips,
    pick: (ids: PlayerId[]) => setPicked(ids),
    raise: (id: PlayerId) => setOrder(moveUp(byChips, id)),
  };
}

export type RiverChoice = ReturnType<typeof useRiverChoice>;
