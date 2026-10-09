// Олл-ин после ривера: кто проиграл раздачу, кто из проигравших вылетает и кто его выбил.
// Нокаут — очки сезона и ачивки («Охотник», «Немезида»), поэтому правило «кто выбил» живёт в домене,
// а пульт только показывает предложение и выбор (тесты — riverBusts.test.ts).
//
// Стеков приложение не знает. Известно другое: руки (счёт на ривере) и кто из проигравших вылетел,
// а кто остался в игре (это решает банкир отметками в шторке олл-ина). Отсюда правило:
// - Проигравший L вылетает, только если его стек покрывал кто-то с рукой сильнее: иначе L забирает
//   свою часть (побочный банк или возврат лишнего). Остался в игре — значит, все, у кого рука
//   сильнее, были короче него.
// - Последние фишки L лежат в банке уровня его стека, а его разыгрывают только те, кто L покрывал.
//   Выбил L тот, у кого среди покрывавших лучшая рука; равные руки — делёж этого банка, нокаут
//   каждому (действующее правило клуба). Сильнейшая рука раздачи короче L, а следующая его
//   покрывает — выбил следующий: это и есть побочный банк.
// - Какие порядки стеков возможны при таком исходе, перебираем по подмножествам «кто короче»
//   (2^n состояний, рук не больше 9): для каждого вылетевшего — какие группы равных рук могли его
//   выбить. Одна группа — однозначно; несколько — выбирает банкир, по умолчанию лучшая рука.
// - Лучшая рука раздачи может выбить любого вылетевшего (его стек мог быть самым коротким), поэтому
//   вариант по умолчанию есть всегда. Вылетели все проигравшие — лучшая рука покрывала каждого,
//   выбор не нужен; на двоих и при одном проигравшем выбивает лучшая рука, как и раньше.
import { riverRanking } from './allins.ts';
import type { EventDraft } from './replay.ts';
import type { CardCode, EveningEvent, PlayerId, ShowdownHand } from './types.ts';

/** Руки и стол раздачи (ShowdownState или её часть). */
export interface RiverHand {
  hands: readonly ShowdownHand[];
  board: readonly CardCode[];
}

export interface RiverOutcome {
  /** Лучшая рука (несколько — делёж банка), в порядке рук раздачи. */
  winners: PlayerId[];
  /** Остальные участники раздачи, в порядке рук. */
  losers: PlayerId[];
}

/** Итог раздачи на ривере (стол — 5 карт); до ривера или при сломанных картах — null. */
export function riverOutcome(showdown: RiverHand): RiverOutcome | null {
  const ranking = riverRanking(showdown.hands, showdown.board);
  const winners = ranking?.[0];
  if (!winners) return null;
  const losers = showdown.hands.map((h) => h.playerId).filter((id) => !winners.includes(id));
  return { winners, losers };
}

/**
 * Кто уже вылетел в этой раздаче: принятые вылеты после её открытия (openedEventId — первая версия
 * раздачи). Вылет записывают и до ривера, а после вылета бывает ребай — игрок снова «в игре», но
 * второй раз в той же раздаче он не вылетает.
 */
export function bustedInHand(
  applied: readonly Pick<EveningEvent, 'id' | 'type' | 'payload'>[],
  openedEventId: number,
): Set<PlayerId> {
  const out = new Set<PlayerId>();
  for (const e of applied) {
    if (e.type !== 'bust' || e.id <= openedEventId) continue;
    const id = (e.payload as { playerId?: unknown }).playerId;
    if (typeof id === 'string') out.add(id);
  }
  return out;
}

export interface RiverBustSuggestion {
  /** Проигравшие раздачу, которые сейчас в игре и в ней ещё не вылетали, — кандидаты на вылет. */
  victims: PlayerId[];
  /** Лучшая рука раздачи, кто в игре, — выбивает по умолчанию (делёж — нокаут каждому). */
  killers: PlayerId[];
  /** Проигравшие, которые уже вне игры или уже вылетели в этой раздаче: для них стек уже «не хватил». */
  out: PlayerId[];
}

/**
 * Что предложить банкиру после ривера (applied — принятые события журнала, replayLog; без него —
 * только «в игре»). null — ривера нет, делёж на всех или все проигравшие уже вне игры или уже
 * вылетали в этой раздаче (вылет записали руками или с пульта, а потом был ребай).
 */
export function riverBustSuggestion(
  showdown: RiverHand & { openedEventId?: number },
  isAlive: (id: PlayerId) => boolean,
  applied: readonly Pick<EveningEvent, 'id' | 'type' | 'payload'>[] = [],
): RiverBustSuggestion | null {
  const outcome = riverOutcome(showdown);
  if (!outcome) return null;
  const busted =
    showdown.openedEventId === undefined
      ? new Set<PlayerId>()
      : bustedInHand(applied, showdown.openedEventId);
  const victims = outcome.losers.filter((id) => isAlive(id) && !busted.has(id));
  if (victims.length === 0) return null;
  return {
    victims,
    killers: outcome.winners.filter(isAlive),
    out: outcome.losers.filter((id) => !victims.includes(id)),
  };
}

/**
 * Есть ли порядок стеков (все разные, от меньшего к большему), при котором у каждого игрока i
 * все из below[i] короче него, а если needAbove[i] не пуст — хотя бы один из needAbove[i] длиннее.
 * Маски — по номерам рук. Обход снизу: «кто уже поставлен» — подмножество, ставить i можно, если
 * все обязательные «короче» уже стоят, а из needAbove ещё кто-то не поставлен. Равные стеки не
 * нужны: «покрывает» при равенстве — то же, что чуть больше (сильнейшую руку ставим выше).
 */
function stackOrderExists(
  n: number,
  below: readonly number[],
  needAbove: readonly number[],
): boolean {
  const full = (1 << n) - 1;
  const seen = new Uint8Array(1 << n);
  const stack = [0];
  seen[0] = 1;
  while (stack.length > 0) {
    const placed = stack.pop() as number;
    if (placed === full) return true;
    for (let i = 0; i < n; i += 1) {
      const bit = 1 << i;
      if (placed & bit) continue;
      const mustBelow = below[i] ?? 0;
      if ((mustBelow & placed) !== mustBelow) continue;
      const cover = needAbove[i] ?? 0;
      if (cover !== 0 && (cover & ~placed & ~bit) === 0) continue;
      const next = placed | bit;
      if (seen[next]) continue;
      seen[next] = 1;
      stack.push(next);
    }
  }
  return false;
}

/**
 * Кто мог выбить каждого вылетевшего проигравшего: группы равных рук (лучшая первой), которые при
 * каком-то порядке стеков забирают его последние фишки. busted — проигравшие, кто вылетел (те, кто
 * уже был вне игры, — тоже); остальные проигравшие остались в игре. Победителей в busted не
 * бывает — их там пропускаем. До ривера и при сломанных картах — null.
 */
export function riverKillerGroups(
  showdown: RiverHand,
  busted: readonly PlayerId[],
): Map<PlayerId, PlayerId[][]> | null {
  const ranking = riverRanking(showdown.hands, showdown.board);
  if (!ranking) return null;
  const n = showdown.hands.length;
  const index = new Map(showdown.hands.map((h, i) => [h.playerId, i]));
  const groupOf = new Map<PlayerId, number>();
  ranking.forEach((group, g) => group.forEach((id) => groupOf.set(id, g)));
  const maskOf = (ids: readonly PlayerId[]) =>
    ids.reduce((m, id) => m | (1 << (index.get(id) as number)), 0);
  // Все, у кого рука сильнее группы g.
  const strongerThan = ranking.map((_, g) => maskOf(ranking.slice(0, g).flat()));

  const out = new Set(busted.filter((id) => (groupOf.get(id) ?? 0) > 0));
  const below = new Array<number>(n).fill(0);
  const needAbove = new Array<number>(n).fill(0);
  for (const [i, h] of showdown.hands.entries()) {
    const g = groupOf.get(h.playerId) as number;
    if (g === 0) continue;
    // Вылетел — его покрывал кто-то сильнее; остался в игре — все сильнее были короче.
    if (out.has(h.playerId)) needAbove[i] = strongerThan[g] as number;
    else below[i] = strongerThan[g] as number;
  }

  const result = new Map<PlayerId, PlayerId[][]>();
  for (const [i, h] of showdown.hands.entries()) {
    if (!out.has(h.playerId)) continue;
    const victimGroup = groupOf.get(h.playerId) as number;
    const options: PlayerId[][] = [];
    for (let g = 0; g < victimGroup; g += 1) {
      // Гипотеза «выбила группа g»: все сильнее неё короче вылетевшего, кто-то из неё — длиннее.
      const b = [...below];
      const a = [...needAbove];
      b[i] = strongerThan[g] as number;
      a[i] = maskOf(ranking[g] as PlayerId[]);
      if (stackOrderExists(n, b, a)) options.push([...(ranking[g] as PlayerId[])]);
    }
    result.set(h.playerId, options);
  }
  return result;
}

/**
 * Кто выбил каждого отмеченного вылетевшего (chosen — подмножество victims): варианты — группы равных
 * рук, кто в игре, лучшая первой (первый вариант — по умолчанию). Один вариант — однозначно,
 * несколько — возможен побочный банк. Неотмеченные проигравшие считаются оставшимися в игре: это и
 * говорит, у кого стек был больше. Выбить некому (все сильнее уже вне игры) — один пустой вариант.
 */
export function riverBustKillers(
  showdown: RiverHand,
  suggestion: Pick<RiverBustSuggestion, 'killers' | 'out'>,
  chosen: readonly PlayerId[],
  isAlive: (id: PlayerId) => boolean,
): Record<PlayerId, PlayerId[][]> {
  const groups = riverKillerGroups(showdown, [...suggestion.out, ...chosen]);
  const result: Record<PlayerId, PlayerId[][]> = {};
  for (const victim of chosen) {
    const options = (groups?.get(victim) ?? [suggestion.killers])
      .map((group) => group.filter(isAlive))
      .filter((group) => group.length > 0);
    result[victim] = options.length > 0 ? options : [[]];
  }
  return result;
}

/**
 * Вылеты одной раздачи одним действием. byChips — вылетевшие от большего стека к меньшему (выше
 * в списке — место выше); записи идут от меньшего к большему: последний записанный вылет получает
 * место выше остальных (места — в порядке, обратном окончательным вылетам). killersOf — кто выбил
 * каждого (делёж — нокаут каждому, пусто — никому).
 */
export function riverBustDrafts(
  byChips: readonly PlayerId[],
  killersOf: Readonly<Record<PlayerId, readonly PlayerId[]>>,
): EventDraft[] {
  return [...byChips].reverse().map((playerId) => ({
    type: 'bust' as const,
    payload: { playerId, by: [...(killersOf[playerId] ?? [])] },
  }));
}
