// Олл-ин после ривера: «Записать вылет: X, выбивает Y». Кто проиграл и кто кого выбил (побочные
// банки) — домен (riverBusts.ts домена), вылетел ли проигравший — решает банкир: стеков пульт не
// знает (вопрос, отметки). Один проигравший — кнопка с вопросом прямо на пульте; несколько, выбор
// выбившего или «Вылет и ребай» — шторка олл-ина: отметить вылетевших, кто выбил, порядок по фишкам
// перед раздачей (у кого больше — место выше) и ребаи. Запись — одним действием (add_events) в
// правильном порядке мест, следом — «Закрыть раздачу» отдельным запросом (SendOptions.then).
// Предложение на пульте держится дольше табло (оно прячет раздачу через 2 минуты после ривера), но
// не бессрочно (riverSuggestionLive): до RIVER_BUST_HOLD_MS после ривера и пока раздачу не закрыли,
// не начали новую, а журнал не принял вылет любого игрока, сыгранную раздачу или смену уровня.
// «Не записывать» в вопросе убирает его с пульта на этом устройстве (sessionStorage, до правки
// раздачи); шторка олл-ина, открытая на раздаче, его всё равно покажет.
import { canApplySequence } from '@domain/replay.ts';
import {
  riverBustDrafts,
  riverBustKillers,
  type RiverBustSuggestion,
  type RiverHand,
} from '@domain/riverBusts.ts';
import type { PlayerId, ShowdownState } from '@domain/types.ts';
import { useState } from 'react';
import { safeSessionStorage } from '../../shared/lib';
import { finishDueAfter, LAST_ONE_NOTE, rebuyDrafts } from './lib';
import {
  keepChipOrder,
  killerKey,
  moveUp,
  pultRiverSuggestion,
  readRiverDeclined,
  riverBustQuestion,
  riverPlanDrafts,
  riverToast,
  writeRiverDeclined,
  type RiverPlan,
} from './riverBusts';
import type { EveningActions, SendOptions } from './useEveningActions';
import type { EveningModel } from './useEveningModel';

export interface RiverBusts {
  /** Раздача после ривера, по которой пульт предлагает вылет (на табло или уже спрятанная). */
  showdown: ShowdownState | null;
  /** Предложение для пульта или null (нет, или банкир ответил «Не записывать»). */
  suggestion: RiverBustSuggestion | null;
  /**
   * По умолчанию: вылетели все проигравшие — тогда лучшая рука покрывала каждого и выбила всех
   * (домен). Ребаев нет.
   */
  defaultPlan: RiverPlan | null;
  /** Докупится ли игрок сразу после вылетов плана: ребаи открыты, лимит не кончился. */
  canRebuyAfter: (plan: Pick<RiverPlan, 'byChips' | 'killers'>, playerId: PlayerId) => boolean;
  /**
   * Записать вылеты (и ребаи) и закрыть раздачу. ask — с вопросом (кнопка на пульте, один вылет);
   * в шторке олл-ина вопроса нет: отметки там и есть подтверждение, а окно поверх шторки «Материя»
   * не допускает. true — записано.
   */
  record: (plan: RiverPlan, ask: boolean) => Promise<boolean>;
}

export interface RiverBustsHandlers {
  /** «Ребай» в тосте после одного вылета, пока игрок может докупиться. */
  onRebuy?: (playerId: PlayerId) => void;
  /** «Завершить вечер» в тосте, если после вылетов остался один, а ребаи закрыты. */
  onFinish?: () => void;
}

export function useRiverBusts(
  model: EveningModel,
  actions: EveningActions,
  { onRebuy, onFinish }: RiverBustsHandlers = {},
): RiverBusts {
  const { state, nowMs, nameOf, evening, events, applied } = model;
  const format = evening.format;
  // Версия раздачи, по которой банкир ответил «Не записывать»: правка карт — новый вопрос. Помнит
  // sessionStorage — переход на карточку игрока и перезагрузка WebView ответ не теряют.
  const [declined, setDeclined] = useState<number | null>(() =>
    readRiverDeclined(safeSessionStorage(), evening.id),
  );
  const decline = (eventId: number) => {
    setDeclined(eventId);
    writeRiverDeclined(safeSessionStorage(), evening.id, eventId);
  };
  const isAlive = (id: PlayerId) => Boolean(state.players[id]?.alive);
  // Не visibleShowdown: раздача остаётся в состоянии и после того, как табло её спрятало, — но
  // предложение по ней на пульте ограничено сроком и тем, что игра ушла дальше.
  const hand = state.showdown;
  const suggestion = pultRiverSuggestion(hand, isAlive, applied, nowMs, declined);
  const showdown = suggestion ? hand : null;

  const defaultPlan: RiverPlan | null =
    suggestion && showdown
      ? {
          showdownId: showdown.showdownId,
          byChips: suggestion.victims,
          killers: Object.fromEntries(
            Object.entries(riverBustKillers(showdown, suggestion, suggestion.victims, isAlive)).map(
              ([id, options]) => [id, options[0] ?? []],
            ),
          ),
          rebuys: [],
          paid: false,
        }
      : null;

  const canRebuyAfter = (plan: Pick<RiverPlan, 'byChips' | 'killers'>, playerId: PlayerId) =>
    canApplySequence(
      format,
      events,
      [...riverBustDrafts(plan.byChips, plan.killers), ...rebuyDrafts(format, playerId, 1, false)],
      nowMs,
    ) === null;

  const record = async (plan: RiverPlan, ask: boolean) => {
    const [only] = plan.byChips;
    if (!only) return false;
    if (ask) {
      const question = riverBustQuestion(nameOf(only), (plan.killers[only] ?? []).map(nameOf));
      const ok = await actions.confirm({ ...question, cancelText: 'Не записывать' });
      if (!ok) {
        if (hand?.showdownId === plan.showdownId) decline(hand.eventId);
        return false;
      }
    }
    const drafts = riverPlanDrafts(format, plan);
    const { success, detail } = riverToast(plan, nameOf);
    // У тоста одна кнопка (одним глаголом): один вылет без ребая — «Ребай», пока можно докупиться;
    // остался один при закрытых ребаях — «Завершить» (вопрос «Завершить вечер?» — прежний); иначе —
    // «Отменить».
    const lone = plan.byChips.length === 1 && plan.rebuys.length === 0 ? only : null;
    const rebuyOffer = onRebuy && lone && canRebuyAfter(plan, lone) ? lone : null;
    const finishDue =
      rebuyOffer === null &&
      onFinish !== undefined &&
      finishDueAfter(format, events, drafts, nowMs);
    const action =
      onRebuy && rebuyOffer
        ? { label: 'Ребай', onClick: () => onRebuy(rebuyOffer) }
        : onFinish && finishDue
          ? { label: 'Завершить', onClick: () => onFinish() }
          : undefined;
    const options: SendOptions = {
      success,
      detail: finishDue ? `${detail} ${LAST_ONE_NOTE}` : detail,
      undo: true,
      action,
      then: {
        type: 'showdown_close',
        payload: { showdownId: plan.showdownId },
        done: 'Раздача закрыта.',
        failed: 'Раздачу закрыть не вышло — табло спрячет её само.',
      },
    };
    const [first] = drafts;
    const result =
      drafts.length === 1 && first
        ? await actions.send(first.type, first.payload, options)
        : await actions.sendAll(drafts, options);
    return result !== null;
  };

  return { showdown, suggestion, defaultPlan, canRebuyAfter, record };
}

/**
 * Выбор в шторке олл-ина после ривера: кто вылетел (по умолчанию все проигравшие), кто кого выбил
 * (варианты — домен; снятая отметка «остался в игре» и открывает побочный банк), порядок по фишкам,
 * ребаи сразу (initialRebuys — «Вылет и ребай» с пульта) и «Оплачено сразу» для них.
 */
export function useRiverChoice(
  showdown: RiverHand | null,
  suggestion: RiverBustSuggestion | null,
  isAlive: (id: PlayerId) => boolean,
  initialRebuys: readonly PlayerId[] = [],
) {
  // null — банкир ещё не трогал отметки: отмечены все проигравшие (в том числе новые по Realtime).
  const [picked, setPicked] = useState<PlayerId[] | null>(null);
  const [order, setOrder] = useState<PlayerId[]>([]);
  // Выбор «кто выбил» по вылетевшему — ключ варианта; пропал из вариантов — снова по умолчанию.
  const [killerPick, setKillerPick] = useState<Record<PlayerId, string>>({});
  const [rebuyPick, setRebuyPick] = useState<PlayerId[]>(() => [...initialRebuys]);
  const [paid, setPaid] = useState(false);
  const victims = suggestion?.victims ?? [];
  const chosen = (picked ?? victims).filter((id) => victims.includes(id));
  const byChips = keepChipOrder(order, chosen);
  const options =
    showdown && suggestion ? riverBustKillers(showdown, suggestion, chosen, isAlive) : {};
  const killers: Record<PlayerId, PlayerId[]> = {};
  for (const id of chosen) {
    const variants = options[id] ?? [[]];
    killers[id] = variants.find((g) => killerKey(g) === killerPick[id]) ?? variants[0] ?? [];
  }
  return {
    victims,
    byChips,
    /** Варианты «кто выбил» по каждому отмеченному: больше одного — возможен побочный банк. */
    options,
    killers,
    rebuys: byChips.filter((id) => rebuyPick.includes(id)),
    paid,
    pick: (ids: PlayerId[]) => setPicked(ids),
    raise: (id: PlayerId) => setOrder(moveUp(byChips, id)),
    pickKiller: (victim: PlayerId, key: string) =>
      setKillerPick((prev) => ({ ...prev, [victim]: key })),
    toggleRebuy: (id: PlayerId, on: boolean) =>
      setRebuyPick((prev) => [...prev.filter((x) => x !== id), ...(on ? [id] : [])]),
    setPaid,
  };
}

export type RiverChoice = ReturnType<typeof useRiverChoice>;
