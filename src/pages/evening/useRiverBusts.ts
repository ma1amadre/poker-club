// Олл-ин после ривера. Кто проиграл и кто кого выбил (побочные банки) — домен (riverBusts.ts домена),
// вылетел ли проигравший — решает банкир: стеков пульт не знает, а стек проигравшего может быть
// больше олл-ина соперника (решение клуба 10.10.2026). Поэтому на пульте — нейтральный вопрос
// «X проигрывает раздачу. Фишек хватило?» и две равные кнопки: «Вылет» (одно нажатие, кто выбил — по
// картам) и «Остаётся за столом» (закрывает раздачу, табло её убирает). Проигравших несколько —
// «Отметить вылет» (шторка олл-ина, отметок заранее нет: банкир отмечает, кому не хватило фишек) и
// «Все остаются за столом». «Вылет и ребай» — шторка с отмеченным «Сразу ребай» и выбором суммы.
// Запись — одним действием (add_events) в правильном порядке мест, следом — «Закрыть раздачу»
// отдельным запросом (SendOptions.then).
// Вопрос на пульте держится дольше табло (оно прячет раздачу через 2 минуты после ривера), но не
// бессрочно (riverSuggestionLive): до RIVER_BUST_HOLD_MS после ривера и пока раздачу не закрыли, не
// начали новую, а журнал не принял вылет любого игрока, сыгранную раздачу или смену уровня.
import { canApplySequence } from '@domain/replay.ts';
import {
  riverBustDrafts,
  riverBustKillers,
  type RiverBustSuggestion,
  type RiverHand,
} from '@domain/riverBusts.ts';
import type { PlayerId, ShowdownState } from '@domain/types.ts';
import { useState } from 'react';
import { finishDueAfter, LAST_ONE_NOTE, rebuyDrafts } from './lib';
import {
  keepChipOrder,
  killerKey,
  moveUp,
  pultRiverSuggestion,
  riverPlanDrafts,
  riverStayToast,
  riverToast,
  type RiverPlan,
} from './riverBusts';
import type { EveningActions, SendOptions } from './useEveningActions';
import type { EveningModel } from './useEveningModel';

export interface RiverBusts {
  /** Раздача после ривера, по которой пульт спрашивает о вылете (на табло или уже спрятанная). */
  showdown: ShowdownState | null;
  /** Вопрос для пульта или null (раздачу закрыли, ушли дальше, срок вышел). */
  suggestion: RiverBustSuggestion | null;
  /**
   * Вылетели все проигравшие — тогда лучшая рука покрывала каждого и выбила всех (домен). Ребаев нет.
   * Для одного проигравшего это и есть ответ «Вылет».
   */
  defaultPlan: RiverPlan | null;
  /** Докупится ли игрок сразу после вылетов плана: ребаи открыты, лимит не кончился. */
  canRebuyAfter: (plan: Pick<RiverPlan, 'byChips' | 'killers'>, playerId: PlayerId) => boolean;
  /** Записать вылеты (и ребаи) и закрыть раздачу. true — записано. */
  record: (plan: RiverPlan) => Promise<boolean>;
  /**
   * «Остаётся за столом» / «Все остаются за столом»: закрыть раздачу без вылетов — вопрос пропадает
   * на всех устройствах, табло возвращается к таймеру. true — закрыта.
   */
  stay: (showdownId: string, victims: readonly PlayerId[]) => Promise<boolean>;
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
  const isAlive = (id: PlayerId) => Boolean(state.players[id]?.alive);
  // Не visibleShowdown: раздача остаётся в состоянии и после того, как табло её спрятало, — но
  // вопрос по ней на пульте ограничен сроком и тем, что игра ушла дальше.
  const hand = state.showdown;
  const suggestion = pultRiverSuggestion(hand, isAlive, applied, nowMs);
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
          rebuyRub: format.buyInRub,
          paid: false,
        }
      : null;

  // Сумма ребая в правилах приёма не участвует — проверяем на входе формата.
  const canRebuyAfter = (plan: Pick<RiverPlan, 'byChips' | 'killers'>, playerId: PlayerId) =>
    canApplySequence(
      format,
      events,
      [
        ...riverBustDrafts(plan.byChips, plan.killers),
        ...rebuyDrafts(format, playerId, format.buyInRub, false),
      ],
      nowMs,
    ) === null;

  const record = async (plan: RiverPlan) => {
    const [only] = plan.byChips;
    if (!only) return false;
    const drafts = riverPlanDrafts(format, plan);
    const { success, detail } = riverToast(plan, nameOf, format);
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

  const stay = async (showdownId: string, victims: readonly PlayerId[]) => {
    const { success, detail } = riverStayToast(victims.map(nameOf));
    const result = await actions.send(
      'showdown_close',
      { showdownId },
      { success, detail, undo: true },
    );
    return result !== null;
  };

  return { showdown, suggestion, defaultPlan, canRebuyAfter, record, stay };
}

/**
 * Выбор в шторке олл-ина после ривера: кто вылетел (отметок заранее нет — банкир отмечает, кому не
 * хватило фишек; initialRebuys — «Вылет и ребай» с пульта: этот игрок уже отмечен и докупается), кто
 * кого выбил (варианты — домен; неотмеченные «остались в игре» и открывают побочный банк), порядок
 * по фишкам, ребаи сразу — сумма одна на всех, кто докупается (по умолчанию — вход формата, null —
 * в поле «Другая сумма» ошибка), — и «Оплачено сразу» для них.
 */
export function useRiverChoice(
  showdown: RiverHand | null,
  suggestion: RiverBustSuggestion | null,
  isAlive: (id: PlayerId) => boolean,
  initialRebuys: readonly PlayerId[] = [],
  buyInRub = 0,
) {
  const [picked, setPicked] = useState<PlayerId[]>(() => [...initialRebuys]);
  const [order, setOrder] = useState<PlayerId[]>([]);
  // Выбор «кто выбил» по вылетевшему — ключ варианта; пропал из вариантов — снова по умолчанию.
  const [killerPick, setKillerPick] = useState<Record<PlayerId, string>>({});
  const [rebuyPick, setRebuyPick] = useState<PlayerId[]>(() => [...initialRebuys]);
  const [rebuyRub, setRebuyRub] = useState<number | null>(buyInRub);
  const [paid, setPaid] = useState(false);
  const victims = suggestion?.victims ?? [];
  const chosen = picked.filter((id) => victims.includes(id));
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
    rebuyRub,
    paid,
    pick: (ids: PlayerId[]) => setPicked(ids),
    raise: (id: PlayerId) => setOrder(moveUp(byChips, id)),
    pickKiller: (victim: PlayerId, key: string) =>
      setKillerPick((prev) => ({ ...prev, [victim]: key })),
    toggleRebuy: (id: PlayerId, on: boolean) =>
      setRebuyPick((prev) => [...prev.filter((x) => x !== id), ...(on ? [id] : [])]),
    setRebuyRub,
    setPaid,
  };
}

export type RiverChoice = ReturnType<typeof useRiverChoice>;
