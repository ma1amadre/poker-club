// Черновик раздачи олл-ина в шторке банкира: кто вскрылся, карты рук и стола, какое место сейчас
// заполняется. Чистый модуль (тесты — showdownDraft.test.ts): шторка только рисует и зовёт его.
// В журнал уходит полное состояние (payload 'showdown'), черновик хранит и пустые места.
import { streetOf } from '@domain/showdown.ts';
import type { CardCode, PlayerId, ShowdownPayload, ShowdownState } from '@domain/types.ts';
import { joinNames } from '../../shared/lib/text';

/** Место карты: карта руки игрока (0 или 1) или карта стола (0–2 флоп, 3 тёрн, 4 ривер). */
export type Slot =
  { kind: 'hand'; playerId: PlayerId; index: 0 | 1 } | { kind: 'board'; index: number };

export interface ShowdownDraft {
  showdownId: string;
  /** Порядок рук на табло. */
  players: PlayerId[];
  hands: Readonly<Record<PlayerId, readonly [CardCode | null, CardCode | null]>>;
  /** Ровно пять мест стола. */
  board: readonly (CardCode | null)[];
}

const EMPTY_BOARD: readonly (CardCode | null)[] = [null, null, null, null, null];

export function emptyDraft(showdownId: string): ShowdownDraft {
  return { showdownId, players: [], hands: {}, board: EMPTY_BOARD };
}

/**
 * Черновик новой раздачи. В игре ровно двое (хедз-ап вечера) — вскрываться больше некому: оба
 * отмечены сразу, банкир начинает с их карт. Иначе — пусто, состав отмечает банкир.
 */
export function newShowdownDraft(showdownId: string, alive: readonly PlayerId[]): ShowdownDraft {
  const draft = emptyDraft(showdownId);
  return alive.length === 2 ? setPlayers(draft, alive) : draft;
}

/** Черновик из раздачи на табло — правка продолжает её (тот же id). */
export function draftFromShowdown(s: ShowdownState): ShowdownDraft {
  const hands: Record<PlayerId, readonly [CardCode | null, CardCode | null]> = {};
  for (const h of s.hands) hands[h.playerId] = [h.cards[0], h.cards[1]];
  return {
    showdownId: s.showdownId,
    players: s.hands.map((h) => h.playerId),
    hands,
    board: EMPTY_BOARD.map((_, i) => s.board[i] ?? null),
  };
}

/**
 * Состав раздачи: прежние — в прежнем порядке, новые — в конец; у убранных карты освобождаются.
 * `published` — раздача этого черновика на табло: вернули её участника (галочку сняли по ошибке) —
 * он встаёт на своё место в раздаче, и его карты с табло возвращаются, если их никто не занял.
 */
export function setPlayers(
  d: ShowdownDraft,
  ids: readonly PlayerId[],
  published: ShowdownState | null = null,
): ShowdownDraft {
  const keep = d.players.filter((id) => ids.includes(id));
  const added = ids.filter((id) => !d.players.includes(id));
  // Участники раздачи на табло — в её порядке, остальные — после, в порядке добавления.
  const placeOf = (id: PlayerId) => {
    const i = published?.hands.findIndex((h) => h.playerId === id) ?? -1;
    return i < 0 ? Number.POSITIVE_INFINITY : i;
  };
  const players = [...keep, ...added]
    .map((id, order) => ({ id, order }))
    .sort((a, b) => placeOf(a.id) - placeOf(b.id) || a.order - b.order)
    .map((x) => x.id);
  const hands: Record<PlayerId, readonly [CardCode | null, CardCode | null]> = {};
  for (const id of players) hands[id] = d.hands[id] ?? [null, null];
  let next: ShowdownDraft = { ...d, players, hands };
  for (const id of added) {
    const was = published?.hands.find((h) => h.playerId === id);
    if (!was) continue;
    const used = usedCards(next);
    if (was.cards.some((c) => used.has(c))) continue;
    next = { ...next, hands: { ...next.hands, [id]: [was.cards[0], was.cards[1]] } };
  }
  return next;
}

/**
 * Кого шторка предлагает в «Кто вскрывается» (в порядке входа в турнир): кто в игре, участники
 * раздачи на табло (`published`, тот же id) и те, кто уже отмечен в черновике. Вылетевший участник
 * открытой раздачи остаётся в списке, даже если с него сняли галочку, — вернуть его можно, домен
 * такую правку принимает (replay: прежние руки той же раздачи).
 */
export function showdownCandidates(
  joinOrder: readonly PlayerId[],
  isAlive: (id: PlayerId) => boolean,
  draft: ShowdownDraft,
  published: ShowdownState | null,
): PlayerId[] {
  const inShowdown = new Set<PlayerId>([
    ...draft.players,
    ...(published?.hands.map((h) => h.playerId) ?? []),
  ]);
  return joinOrder.filter((id) => isAlive(id) || inShowdown.has(id));
}

export function sameSlot(a: Slot | null, b: Slot | null): boolean {
  if (!a || !b || a.kind !== b.kind || a.index !== b.index) return false;
  return a.kind === 'board' || (b.kind === 'hand' && a.playerId === b.playerId);
}

/** Места по порядку заполнения: руки по очереди, затем флоп, тёрн, ривер. */
export function slotOrder(d: ShowdownDraft): Slot[] {
  const hands = d.players.flatMap((playerId): Slot[] => [
    { kind: 'hand', playerId, index: 0 },
    { kind: 'hand', playerId, index: 1 },
  ]);
  const board = EMPTY_BOARD.map((_, index): Slot => ({ kind: 'board', index }));
  return [...hands, ...board];
}

export function cardIn(d: ShowdownDraft, slot: Slot): CardCode | null {
  return slot.kind === 'hand'
    ? (d.hands[slot.playerId]?.[slot.index] ?? null)
    : (d.board[slot.index] ?? null);
}

function withCard(d: ShowdownDraft, slot: Slot, code: CardCode | null): ShowdownDraft {
  if (slot.kind === 'board') {
    return { ...d, board: d.board.map((c, i) => (i === slot.index ? code : c)) };
  }
  const prev = d.hands[slot.playerId] ?? [null, null];
  const pair: [CardCode | null, CardCode | null] = [prev[0], prev[1]];
  pair[slot.index] = code;
  return { ...d, hands: { ...d.hands, [slot.playerId]: pair } };
}

/** Где лежит каждая отмеченная карта. */
export function usedCards(d: ShowdownDraft): Map<CardCode, Slot> {
  const used = new Map<CardCode, Slot>();
  for (const slot of slotOrder(d)) {
    const code = cardIn(d, slot);
    if (code) used.set(code, slot);
  }
  return used;
}

/** Положить карту на место. Если карта уже лежит в другом месте, оттуда она уходит. */
export function placeCard(d: ShowdownDraft, slot: Slot, code: CardCode): ShowdownDraft {
  const elsewhere = usedCards(d).get(code);
  const cleared = elsewhere && !sameSlot(elsewhere, slot) ? withCard(d, elsewhere, null) : d;
  return withCard(cleared, slot, code);
}

export function clearSlot(d: ShowdownDraft, slot: Slot): ShowdownDraft {
  return withCard(d, slot, null);
}

/** Следующее пустое место после `from` (по кругу), без `from` — первое пустое; null — всё заполнено. */
export function nextEmptySlot(d: ShowdownDraft, from: Slot | null): Slot | null {
  const order = slotOrder(d);
  const start = from ? order.findIndex((s) => sameSlot(s, from)) + 1 : 0;
  for (let k = 0; k < order.length; k += 1) {
    const slot = order[(start + k) % order.length];
    if (slot && cardIn(d, slot) === null) return slot;
  }
  return null;
}

/** Карта, положенная `placeCards`, и что лежало на её месте до неё (замена на подсвеченном месте). */
export interface PlacedCard {
  slot: Slot;
  code: CardCode;
  prev: CardCode | null;
}

export interface PlaceCardsResult {
  draft: ShowdownDraft;
  /** Что легло и куда — по порядку. */
  placed: PlacedCard[];
  /**
   * Названные карты, которые уже лежат на своих местах: на очередном месте фразы (подсвеченном или
   * следующем) или подряд прямо перед подсвеченным — банкир повторил фразу, оборванную паузой.
   * Остаются, место идёт дальше.
   */
  kept: { code: CardCode; slot: Slot }[];
  /** Карта уже лежит в другом месте (касанием её тоже не выбрать: в колоде она недоступна) — не трогаем. */
  taken: { code: CardCode; slot: Slot }[];
  /** Карты после той, что лежит в другом месте: где кончилась её очередь — неясно, не кладём. */
  held: CardCode[];
  /** Свободные места кончились. */
  overflow: CardCode[];
  /** Подсвеченное место после раскладки: следующее пустое за последней картой фразы. */
  active: Slot | null;
}

/** Место следующей карты фразы после `from`: первое по кругу пустое или то, где она уже лежит. */
function nextPlaceFor(
  d: ShowdownDraft,
  from: Slot,
  code: CardCode,
): { slot: Slot; kept: boolean } | null {
  const order = slotOrder(d);
  const at = order.findIndex((s) => sameSlot(s, from));
  for (let k = 1; k < order.length; k += 1) {
    const slot = order[(at + k) % order.length];
    const card = slot ? cardIn(d, slot) : undefined;
    if (slot && (card === null || card === code)) return { slot, kept: card === code };
  }
  return null;
}

/**
 * Сколько первых карт фразы — повтор уже выложенного: они лежат подряд на местах прямо перед
 * подсвеченным (так их положила прошлая фраза, оборванная паузой). Иначе 0.
 */
function repeatedHead(d: ShowdownDraft, target: Slot | null, codes: readonly CardCode[]): number {
  if (!target) return 0;
  const used = usedCards(d);
  let count = 0;
  for (const code of codes) {
    const holder = used.get(code);
    if (!holder || sameSlot(holder, target)) break;
    count += 1;
  }
  const order = slotOrder(d);
  const at = order.findIndex((s) => sameSlot(s, target));
  if (count === 0 || at < count) return 0;
  return codes
    .slice(0, count)
    .every((code, j) => sameSlot(used.get(code) ?? null, order[at - count + j] ?? null))
    ? count
    : 0;
}

/**
 * Несколько карт подряд — так же, как касаниями: первая — на подсвеченное место (на нём другая карта —
 * заменяет её, как касание), каждая следующая — в следующее пустое. Карта, которая уже лежит на
 * очередном месте фразы, остаётся (`kept`), место идёт дальше; первые карты, лежащие подряд прямо
 * перед подсвеченным местом, — повтор (`kept`). Карту, которая лежит в другом месте, не
 * перекладываем (`taken`) — и дальше не кладём (`held`): какое место она занимала в очереди, неясно,
 * а сдвиг увёл бы следующие карты к чужим рукам. Мест не хватило — `overflow`. Голосовой ввод.
 */
export function placeCards(
  d: ShowdownDraft,
  active: Slot | null,
  codes: readonly CardCode[],
): PlaceCardsResult {
  const target = active ?? nextEmptySlot(d, null);
  const head = repeatedHead(d, target, codes);
  const used = usedCards(d);
  let draft = d;
  const placed: PlacedCard[] = [];
  const kept: { code: CardCode; slot: Slot }[] = codes.slice(0, head).flatMap((code) => {
    const slot = used.get(code);
    return slot ? [{ code, slot }] : [];
  });
  const taken: { code: CardCode; slot: Slot }[] = [];
  let held: CardCode[] = [];
  const overflow: CardCode[] = [];
  // Последнее место этой фразы: от него ищется место следующей карты.
  let last: Slot | null = null;
  for (let i = head; i < codes.length; i += 1) {
    const code = codes[i];
    if (!code) continue;
    const next: { slot: Slot; kept: boolean } | null = last
      ? nextPlaceFor(draft, last, code)
      : target && { slot: target, kept: cardIn(draft, target) === code };
    if (next?.kept) {
      kept.push({ code, slot: next.slot });
      last = next.slot;
      continue;
    }
    const holder = usedCards(draft).get(code);
    if (holder) {
      taken.push({ code, slot: holder });
      held = codes.slice(i + 1);
      break;
    }
    if (!next) {
      overflow.push(code);
      continue;
    }
    placed.push({ slot: next.slot, code, prev: cardIn(draft, next.slot) });
    draft = withCard(draft, next.slot, code);
    last = next.slot;
  }
  return {
    draft,
    placed,
    kept,
    taken,
    held,
    overflow,
    active: last ? nextEmptySlot(draft, last) : active,
  };
}

/**
 * Снять карты одного `placeCards`: только те, что ещё лежат на своих местах (поправленные касанием
 * не трогаем, убранного игрока — тоже); на место замены возвращается прежняя карта, если её никто не
 * занял.
 */
export function unplaceCards(d: ShowdownDraft, placed: readonly PlacedCard[]): ShowdownDraft {
  let draft = d;
  for (const p of [...placed].reverse()) {
    const exists = slotOrder(draft).some((s) => sameSlot(s, p.slot));
    if (!exists || cardIn(draft, p.slot) !== p.code) continue;
    const back = p.prev && !usedCards(draft).has(p.prev) ? p.prev : null;
    draft = withCard(draft, p.slot, back);
  }
  return draft;
}

export type DraftCheck = { ok: true; payload: ShowdownPayload } | { ok: false; reason: string };

/** Можно ли отправить черновик и что именно уйдёт; иначе — что сделать, на «ты». */
export function checkDraft(d: ShowdownDraft, nameOf: (id: PlayerId) => string): DraftCheck {
  if (d.players.length < 2) return { ok: false, reason: 'Выбери хотя бы двух игроков.' };
  const missing = d.players.filter((id) => {
    const h = d.hands[id];
    return !h || h[0] === null || h[1] === null;
  });
  if (missing.length > 0)
    return { ok: false, reason: `Отметь карты: ${joinNames(missing.map(nameOf))}.` };
  const filled = d.board.map((c) => c !== null);
  const count = filled.indexOf(false) === -1 ? filled.length : filled.indexOf(false);
  if (filled.slice(count).some(Boolean))
    return { ok: false, reason: 'Карты стола — по порядку: флоп, тёрн, ривер.' };
  if (count === 1 || count === 2) return { ok: false, reason: 'Отметь все три карты флопа.' };
  return {
    ok: true,
    payload: {
      showdownId: d.showdownId,
      hands: d.players.map((playerId) => {
        const h = d.hands[playerId] ?? [null, null];
        return { playerId, cards: [h[0] ?? '', h[1] ?? ''] };
      }),
      board: d.board.slice(0, count).map((c) => c ?? ''),
    },
  };
}

export function samePayload(a: ShowdownPayload, b: ShowdownPayload | null): boolean {
  if (!b || a.showdownId !== b.showdownId) return false;
  const key = (p: ShowdownPayload) =>
    JSON.stringify([p.hands.map((h) => [h.playerId, h.cards]), p.board]);
  return key(a) === key(b);
}

const OPEN_STREET: Readonly<Record<'flop' | 'turn' | 'river', string>> = {
  flop: 'Открыть флоп',
  turn: 'Открыть тёрн',
  river: 'Открыть ривер',
};

/** Что открывать после стола из `size` карт. */
function nextStreetLabel(size: number): string {
  if (size === 0) return OPEN_STREET.flop;
  if (size === 3) return OPEN_STREET.turn;
  if (size === 4) return OPEN_STREET.river;
  return 'Сохранить правку';
}

/**
 * Главная кнопка шторки. Раздачи на табло ещё нет — «Показать на табло»; стол вырос — какую улицу
 * открываем; другая правка — «Сохранить правку»; ничего не изменилось — следующая улица (кнопка
 * при этом неактивна).
 */
export function sendLabel(
  payload: ShowdownPayload | null,
  published: ShowdownState | null,
): string {
  if (!published) return 'Показать на табло';
  const was = published.board.length;
  if (payload && payload.board.length > was) {
    const street = streetOf(payload.board.length);
    return street === 'preflop' ? 'Сохранить правку' : OPEN_STREET[street];
  }
  if (payload && !samePayload(payload, published)) return 'Сохранить правку';
  return nextStreetLabel(was);
}

/** Тост после записи: «Флоп открыт», «Руки показаны», «Правка записана». */
export function successText(payload: ShowdownPayload, published: ShowdownState | null): string {
  if (!published) return 'Руки показаны на табло';
  if (payload.board.length > published.board.length) {
    const street = streetOf(payload.board.length);
    if (street === 'flop') return 'Флоп открыт';
    if (street === 'turn') return 'Тёрн открыт';
    return 'Ривер открыт';
  }
  return 'Правка записана';
}
