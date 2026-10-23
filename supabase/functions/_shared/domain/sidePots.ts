// Калькулятор банков олл-ина: кто сколько внёс, основной и побочные банки, кто какой банк забирает,
// выплаты, итоговые стеки, кто вылетел и кто его выбил. Нокаут — очки сезона и ачивки, поэтому правило
// живёт в домене, рядом с riverBusts.ts (там то же правило «кто выбил» — без стеков). Суммы сейчас
// вводит пульт, позже их даст камера (подсчёт фишек); на рубли, места и очки функция сама не влияет —
// она только считает. Тесты — sidePots.test.ts.
//
// Правила:
// - Вклад участника вскрытия по умолчанию — min(его стек, T): все в олл-ине или уравняли, T — второй
//   по величине стек среди участников; излишек самого большого стека никто не уравнял, он остаётся у
//   владельца. Одно уточнение: если сбросивший поставил больше второго стека, эту ставку уравнял самый
//   большой стек (иначе сбросивший не сбросил бы), и T поднимается до неё, но не выше самого большого
//   стека. Без этого фишкам сбросившего не нашлось бы банка и выплаты разошлись бы с вкладами. Вклад
//   сбросившего больше самого большого стека так не уравнять — это отказ (ошибка в суммах).
// - Правило по умолчанию верно, только когда в олл-ине все, кроме самого большого стека. Короткий в
//   олл-ине, а двое больших прочекали побочный банк до ривера (или поставили в нём меньше второго
//   стека) — у них остались фишки, и min(стек, T) спишет с проигравшего лишнее и «выбьет» его. Для
//   этого вход committed: сколько каждый участник внёс на деле (целое 1..стек, для всех участников).
//   Проверка формы раздачи: на вскрытии торговля закончена, поэтому вклад меньше наибольшего бывает
//   только у того, кто в олл-ине (внёс весь стек); сбросивший не вносит больше наибольшего вклада.
//   Неуравненный излишек (самый большой вклад один и выше всех остальных) — банк с одним участником,
//   то есть возврат.
// - Банки — слоями по различным уровням вкладов участников, снизу вверх: основной, побочный 1, …
//   Участник банка — кто внёс до верха его слоя. Мёртвые деньги (блайнды, ставки, взнос бомб-пота
//   сбросивших) — по тем же слоям: вклад сбросившего покрывает слои снизу вверх; права на банк у
//   сбросившего нет. Банк с одним участником — возврат ему: это не выигрыш и не нокаут.
// - На ривере банк забирает сильнейшая рука среди его участников (riverRanking — оценщик домена);
//   равные руки делят банк поровну. Каждый банк делится отдельно — Poker TDA Rules 2026, версия 1.1
//   (21.09.2026), правило 23 «Side Pots».
// - Нечётные фишки — правило 21 «Awarding Odd Chips» той же редакции: сначала размен до наименьшего
//   номинала в игре (chipUnit), затем в играх с общими картами (21-A)
//   «the odd chip goes to the first seat left of the button» — первому из делящих по часовой от
//   баттона (места растут по часовой, seats.ts; сам баттон — последний). Несколько нечётных фишек
//   TDA прямо не разбирает: раздаём по одной по часовой, никому больше одной (так в Robert's Rules of
//   Poker). Мест или баттона нет, или кто-то из делящих без места — по порядку рук. Наименьший номинал
//   — обязательный вход: в домене номиналов фишек клуба нет, а после размена мелочи (color up) он
//   растёт по ходу турнира; молчаливая 1 дала бы доли, которые физически не выплатить. Места и
//   баттон — той раздачи (ShowdownState.seating, снимок при открытии), а не текущие: «Следующая
//   раздача» двигает баттон, пока олл-ин ещё на экране.
// - Кто выбил: вылетел тот, у кого итоговый стек 0. Выбил его тот, кто забрал банк с его последними
//   фишками — самый верхний банк, куда он вносил (правило клуба из riverBusts.ts); делёж этого банка —
//   нокаут каждому, кто из него что-то получил. Вылетевшие — от большего стека к меньшему (так ждёт
//   riverBustDrafts: выше в списке — место выше); равные стеки — в порядке рук.
// - До ривера банки и их участники уже известны, победителей и выплат ещё нет (возвраты — есть).
// - Записать вылеты в журнал — sidePotBustDrafts: как riverBustSuggestion, отсекает тех, кто уже вне
//   игры или уже вылетел в этой раздаче (вылет записывают и до ривера, после него бывает ребай).
import { riverRanking } from './allins.ts';
import type { EventDraft } from './replay.ts';
import { bustedInHand, riverBustDrafts } from './riverBusts.ts';
import { isTableSeat } from './seats.ts';
import { SHOWDOWN_BOARD_SIZES, SHOWDOWN_MAX_HANDS, SHOWDOWN_MIN_HANDS } from './showdown.ts';
import {
  TABLE_SEATS,
  type CardCode,
  type EveningEvent,
  type HandSeating,
  type PlayerId,
  type ShowdownHand,
  type ShowdownState,
} from './types.ts';

export interface SidePotInput {
  /** Участники вскрытия, в порядке рук (state.showdown.hands): 2..9 рук по две карты. */
  hands: readonly ShowdownHand[];
  /** Стол: 0, 3, 4 или 5 карт; победители банков — только на ривере. */
  board: readonly CardCode[];
  /** Стек каждого участника на начало раздачи — целое ≥ 1, турнирные фишки. */
  stacks: Readonly<Record<PlayerId, number>>;
  /**
   * Сколько каждый участник внёс в банк на деле — целое 1..стек, для каждого участника. Нет — по
   * правилу min(стек, T) (в олл-ине все, кроме самого большого стека). Нужен, когда у кого-то из
   * больших стеков остались фишки: прочекали побочный банк или поставили в нём меньше второго стека.
   */
  committed?: Readonly<Record<PlayerId, number>>;
  /** Мёртвые деньги: фишки каждого сбросившего или не участвующего во вскрытии — целое ≥ 0. */
  dead?: readonly number[];
  /**
   * Места и баттон той раздачи — state.showdown.seating (снимок при открытии; ...state.showdown
   * передаёт его сам). Нет — нечётные фишки по порядку рук.
   */
  seating?: HandSeating;
  /**
   * Наименьший номинал фишки в игре сейчас (TDA 21: размен нечётных фишек до него) — целое ≥ 1.
   * Обязателен: номиналов клуба домен не знает, а 1 даёт доли, которые фишками не выплатить.
   */
  chipUnit: number;
}

export interface SidePot {
  /** Верх слоя: вклад участника до этого уровня, фишки. Основной банк — первый. */
  level: number;
  /** Фишек в банке: вклады участников и мёртвые деньги этого слоя. */
  amount: number;
  /** Из них мёртвые деньги. */
  dead: number;
  /** Кто разыгрывает банк — внёс до верха слоя; в порядке рук. */
  eligible: PlayerId[];
  /** Участник один — банк возвращается ему (не выигрыш и не нокаут). */
  returned: boolean;
  /**
   * Кто забирает банк: сильнейшая рука среди участников (делёж — несколько), в порядке рук. Возврат —
   * пусто (банк не выигран); до ривера — null.
   */
  winners: PlayerId[] | null;
  /** Кому сколько из банка; до ривера — null (у возврата — сразу: всё участнику). */
  shares: Record<PlayerId, number> | null;
  /** Кому досталась нечётная фишка (по одной, по порядку выдачи); поровну или без дележа — пусто. */
  oddChipTo: PlayerId[];
}

export interface SidePotsResult {
  /** Сколько фишек забирает из банков каждый участник (0 — ничего), ключи — все участники. */
  payouts: Record<PlayerId, number>;
  /** Стек после раздачи: стек − вклад + выплаты. */
  finalStacks: Record<PlayerId, number>;
  /** Итоговый стек 0 — вылетели; от большего стека до раздачи к меньшему (равные — по рукам). */
  busted: PlayerId[];
  /** Вылетевший → кто выбил: забравшие самый верхний банк, куда он вносил (делёж — каждый). */
  knockouts: Record<PlayerId, PlayerId[]>;
}

export interface SidePots {
  /** Вклад каждого участника: committed или min(стек, T), см. правила. */
  contributions: Record<PlayerId, number>;
  /** Всего мёртвых денег. */
  dead: number;
  /** Всего в банках: вклады и мёртвые деньги. */
  total: number;
  /** Банки снизу вверх: основной, побочный 1, … */
  pots: SidePot[];
  /** Итог на ривере; до ривера — null. */
  result: SidePotsResult | null;
}

export type SidePotsRead =
  { ok: true; value: SidePots } | { ok: false; error: string; playerId?: PlayerId };

const isWhole = (v: unknown, min: number): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min;

/**
 * Порядок выдачи нечётных фишек среди делящих (TDA 21-A): по часовой от баттона — первым место
 * сразу после баттона, сам баттон последним. Баттона нет или кто-то без места — порядок как есть
 * (порядок рук).
 */
export function oddChipOrder(ids: readonly PlayerId[], seating?: HandSeating): PlayerId[] {
  const button = seating?.buttonSeat;
  if (!seating || !isTableSeat(button)) return [...ids];
  const seats = ids.map((id) => seating.seats[id]);
  if (!seats.every(isTableSeat)) return [...ids];
  const after = (seat: number) => (seat - button - 1 + TABLE_SEATS) % TABLE_SEATS;
  return ids
    .map((id, i) => ({ id, i, d: after(seats[i] as number) }))
    .sort((x, y) => x.d - y.d || x.i - y.i)
    .map((x) => x.id);
}

/**
 * Делёж банка поровну между order (порядок выдачи нечётных фишек): каждому — поровну целыми
 * номиналами unit, лишние номиналы — по одному первым в order; остаток меньше номинала (суммы не
 * кратны номиналу) — первому. Сумма долей всегда равна amount.
 */
export function splitPot(
  amount: number,
  order: readonly PlayerId[],
  unit = 1,
): { shares: Record<PlayerId, number>; oddChipTo: PlayerId[] } {
  const k = order.length;
  const units = Math.floor(amount / unit);
  const base = Math.floor(units / k);
  const extra = units - base * k;
  const rest = amount - units * unit;
  const shares: Record<PlayerId, number> = {};
  const oddChipTo: PlayerId[] = [];
  order.forEach((id, i) => {
    const odd = (i < extra ? unit : 0) + (i === 0 ? rest : 0);
    shares[id] = base * unit + odd;
    if (odd > 0) oddChipTo.push(id);
  });
  return { shares, oddChipTo };
}

/** Банки олл-ина и их итог на ривере; отказ — неверный ввод (текст для экрана, без рода). */
export function sidePots(input: SidePotInput): SidePotsRead {
  const { hands, board } = input;
  const dead = input.dead ?? [];
  const unit = input.chipUnit;
  if (hands.length < SHOWDOWN_MIN_HANDS || hands.length > SHOWDOWN_MAX_HANDS)
    return {
      ok: false,
      error: `Банки: участников вскрытия — от ${SHOWDOWN_MIN_HANDS} до ${SHOWDOWN_MAX_HANDS}`,
    };
  const ids = hands.map((h) => h.playerId);
  if (new Set(ids).size !== ids.length) return { ok: false, error: 'Банки: игрок указан дважды' };
  if (!SHOWDOWN_BOARD_SIZES.includes(board.length))
    return { ok: false, error: 'Банки: на столе 0, 3, 4 или 5 карт' };
  for (const id of ids) {
    if (!isWhole(input.stacks[id], 1))
      return { ok: false, error: 'Банки: стек — целое число фишек от 1', playerId: id };
  }
  if (!dead.every((d) => isWhole(d, 0)))
    return { ok: false, error: 'Банки: фишки сбросивших — целые числа от 0' };
  if (!isWhole(unit, 1))
    return { ok: false, error: 'Банки: наименьший номинал — целое число фишек от 1' };

  const stackOf = (id: PlayerId) => input.stacks[id] as number;
  const maxDead = Math.max(0, ...dead);
  const contributions: Record<PlayerId, number> = {};
  const given = (id: PlayerId) => contributions[id] as number;
  const { committed } = input;
  if (committed) {
    for (const id of ids) {
      const c = committed[id];
      if (!isWhole(c, 1) || c > stackOf(id))
        return { ok: false, error: 'Банки: вклад — целое число фишек от 1 до стека', playerId: id };
      contributions[id] = c;
    }
    if (maxDead > Math.max(...ids.map(given)))
      return {
        ok: false,
        error: 'Банки: у сбросившего фишек больше, чем вклад любого участника — проверь суммы',
      };
  } else {
    const sorted = ids.map(stackOf).sort((a, b) => b - a);
    const biggest = sorted[0] as number;
    if (maxDead > biggest)
      return {
        ok: false,
        error:
          'Банки: у сбросившего фишек больше, чем стек самого большого участника — проверь суммы',
      };
    const top = Math.min(biggest, Math.max(sorted[1] as number, maxDead));
    for (const id of ids) contributions[id] = Math.min(stackOf(id), top);
  }
  // На вскрытии торговля закончена: у кого фишки остались, тот уравнял наибольший вклад. По правилу
  // min(стек, T) это верно всегда, а committed с вкладом «меньше наибольшего, и не весь стек» — ошибка.
  const most = Math.max(...ids.map(given));
  const short = ids.find((id) => given(id) < most && given(id) < stackOf(id));
  if (short !== undefined)
    return {
      ok: false,
      error: 'Банки: вклад меньше наибольшего бывает только в олл-ине (весь стек) — проверь суммы',
      playerId: short,
    };

  let ranking: PlayerId[][] | null = null;
  if (board.length === 5) {
    ranking = riverRanking(hands, board);
    if (!ranking) return { ok: false, error: 'Банки: карты раздачи не читаются' };
  }

  const levels = [...new Set(ids.map(given))].sort((a, b) => a - b);
  const pots: SidePot[] = [];
  let prev = 0;
  for (const level of levels) {
    const layer = (x: number) => Math.min(x, level) - Math.min(x, prev);
    const deadHere = dead.reduce((s, d) => s + layer(d), 0);
    const amount = ids.reduce((s, id) => s + layer(given(id)), 0) + deadHere;
    const eligible = ids.filter((id) => given(id) >= level);
    prev = level;
    if (eligible.length === 1) {
      const only = eligible[0] as PlayerId;
      pots.push({
        level,
        amount,
        dead: deadHere,
        eligible,
        returned: true,
        winners: [],
        shares: { [only]: amount },
        oddChipTo: [],
      });
      continue;
    }
    const best = ranking
      ?.map((group) => group.filter((id) => eligible.includes(id)))
      .find((group) => group.length > 0);
    const split = best ? splitPot(amount, oddChipOrder(best, input.seating), unit) : null;
    pots.push({
      level,
      amount,
      dead: deadHere,
      eligible,
      returned: false,
      winners: best ?? null,
      shares: split?.shares ?? null,
      oddChipTo: split?.oddChipTo ?? [],
    });
  }

  const deadTotal = dead.reduce((s, d) => s + d, 0);
  const total = ids.reduce((s, id) => s + given(id), 0) + deadTotal;
  if (!ranking)
    return { ok: true, value: { contributions, dead: deadTotal, total, pots, result: null } };

  const payouts: Record<PlayerId, number> = {};
  const finalStacks: Record<PlayerId, number> = {};
  for (const id of ids) {
    payouts[id] = pots.reduce((s, p) => s + (p.shares?.[id] ?? 0), 0);
    finalStacks[id] = stackOf(id) - given(id) + (payouts[id] as number);
  }
  const busted = ids
    .map((id, i) => ({ id, i }))
    .filter(({ id }) => finalStacks[id] === 0)
    .sort((x, y) => stackOf(y.id) - stackOf(x.id) || x.i - y.i)
    .map(({ id }) => id);
  const knockouts: Record<PlayerId, PlayerId[]> = {};
  for (const victim of busted) {
    // Верхний банк вылетевшего разыгран (его покрыл кто-то с рукой сильнее). Нокаут — тем, кто из
    // этого банка что-то забрал: при суммах, не кратных номиналу, доля в дележе бывает нулевой.
    const last = pots.findLast((p) => p.eligible.includes(victim));
    knockouts[victim] = (last?.winners ?? []).filter(
      (id) => id !== victim && (last?.shares?.[id] ?? 0) > 0,
    );
  }
  return {
    ok: true,
    value: {
      contributions,
      dead: deadTotal,
      total,
      pots,
      result: { payouts, finalStacks, busted, knockouts },
    },
  };
}

/**
 * Вылеты из итога калькулятора — записи журнала одним действием (riverBustDrafts). busted калькулятора
 * журнала не знает, поэтому здесь те же отсечки, что в riverBustSuggestion: вылетает только тот, кто
 * сейчас в игре и в этой раздаче ещё не вылетал (вылет записывают и до ривера, а после него бывает
 * ребай — второй раз в той же раздаче игрок не вылетает; без ребая replay отклонил бы пакет целиком);
 * выбившие — кто в игре. showdown — state.showdown той раздачи, applied — принятые события
 * (ReplayLog.applied), isAlive — PlayerState.alive.
 */
export function sidePotBustDrafts(
  result: Pick<SidePotsResult, 'busted' | 'knockouts'>,
  showdown: Pick<ShowdownState, 'openedEventId'>,
  isAlive: (id: PlayerId) => boolean,
  applied: readonly Pick<EveningEvent, 'id' | 'type' | 'payload'>[],
): EventDraft[] {
  const already = bustedInHand(applied, showdown.openedEventId);
  const victims = result.busted.filter((id) => isAlive(id) && !already.has(id));
  const killers: Record<PlayerId, PlayerId[]> = {};
  for (const id of victims) killers[id] = (result.knockouts[id] ?? []).filter(isAlive);
  return riverBustDrafts(victims, killers);
}
