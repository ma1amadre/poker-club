// «Снять борд» в шторке олл-ина — чистая часть (тесты — boardPhoto.test.ts): ответ функции
// card-vision → карты в черновик тем же путём, что касания и голос (showdownDraft.ts), подписи для
// шторки. На табло карты уходят только главной кнопкой шторки — банкир видит их на местах и
// подтверждает.
//
// Как ложится:
// - Стол — набором: карта, которая уже на столе, остаётся где лежит («Уже на месте»), новые — в
//   свободные места стола по порядку фото (слева направо). Уже лежащее не перекладываем: карта стола с
//   фото лежит у игрока — «Уже лежит: …», и дальше стол не кладём (как у голоса: какое место она
//   занимала, неясно). Отмеченный стол с картой, которой на фото нет, — стол не трогаем вовсе.
// - Руки: чья рука, модель не знает. Рука, чьи обе карты уже у одного игрока, — «Уже на месте»;
//   одна карта уже у игрока, а его второе место пустое — дополняем; карта лежит где-то ещё — рука не
//   ложится (замечание). Остальные руки назначает банкир одним касанием имени (`assignHand`); если
//   таких рук столько же, сколько игроков без карт, они сразу разложены по порядку (`auto`) — банкир
//   проверяет и меняет касанием (назначить руку игроку, у которого другая рука с фото, — поменять их
//   местами).
// - «Отменить» (`undoBoardPhoto`) снимает всё, что положило это фото, если оно ещё на своих местах.
import { isCardCode } from '@domain/showdown.ts';
import type { CardCode, PlayerId } from '@domain/types.ts';
import { pluralWithNumber } from '../../shared/lib/format';
import { cardName } from '../../shared/lib/poker/cards';
import {
  cardIn,
  placeCard,
  sameSlot,
  slotOrder,
  unplaceCards,
  usedCards,
  type PlacedCard,
  type ShowdownDraft,
  type Slot,
} from './showdownDraft';
import { keptLines, slotOwner } from './voiceCards';

// ---------- Ответ функции ----------

/** Замечания функции к ответу модели (supabase/functions/_shared/cardVision.ts, VisionIssue). */
export type BoardPhotoIssue =
  | { kind: 'bad_card'; value: string }
  | { kind: 'duplicate'; card: CardCode }
  | { kind: 'odd_hand'; cards: CardCode[] }
  | { kind: 'board_extra'; cards: CardCode[] }
  | { kind: 'hands_extra'; count: number };

export interface BoardPhotoAnswer {
  hands: [CardCode, CardCode][];
  board: CardCode[];
  issues: BoardPhotoIssue[];
  /** Сколько думала модель, мс. */
  ms: number;
}

const cardsOrNull = (value: unknown): CardCode[] | null =>
  Array.isArray(value) && value.every(isCardCode) ? [...value] : null;

function readIssue(value: unknown): BoardPhotoIssue | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  switch (v.kind) {
    case 'bad_card':
      return typeof v.value === 'string' ? { kind: 'bad_card', value: v.value } : null;
    case 'duplicate':
      return isCardCode(v.card) ? { kind: 'duplicate', card: v.card } : null;
    case 'odd_hand':
    case 'board_extra': {
      const cards = cardsOrNull(v.cards);
      return cards ? { kind: v.kind, cards } : null;
    }
    case 'hands_extra':
      return typeof v.count === 'number' ? { kind: 'hands_extra', count: v.count } : null;
    default:
      return null;
  }
}

/**
 * Ответ функции → руки и стол. Не та форма (нет рук или стола, карта не в нотации домена, повтор
 * карты, стол длиннее пяти) — null: такой ответ в черновик не кладём. Незнакомые замечания
 * пропускаются.
 */
export function readBoardPhotoAnswer(data: unknown): BoardPhotoAnswer | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  const board = cardsOrNull(d.board);
  if (!board || board.length > 5 || !Array.isArray(d.hands)) return null;
  const hands: [CardCode, CardCode][] = [];
  for (const raw of d.hands) {
    const cards = cardsOrNull(raw);
    const [a, b] = cards ?? [];
    if (!cards || cards.length !== 2 || !a || !b) return null;
    hands.push([a, b]);
  }
  const all = [...board, ...hands.flat()];
  if (new Set(all).size !== all.length) return null;
  const issues = Array.isArray(d.issues)
    ? d.issues.flatMap((i) => {
        const issue = readIssue(i);
        return issue ? [issue] : [];
      })
    : [];
  const ms = typeof d.ms === 'number' && Number.isFinite(d.ms) ? Math.max(0, d.ms) : 0;
  return { hands, board, issues, ms };
}

// ---------- Раскладка в черновик ----------

export interface PhotoHand {
  /** Рука, как на фото. */
  cards: readonly [CardCode, CardCode];
  /** Чья: назначил банкир или раскладка по порядку; null — ещё ничья. */
  owner: PlayerId | null;
  /** Что положило фото для этой руки (снимается «Отменить» и при переназначении). */
  placed: PlacedCard[];
}

export interface PhotoResult {
  ms: number;
  /** Что легло сразу: стол и карты рук, дополненные по уже лежащей. */
  placed: PlacedCard[];
  /** Руки, которые назначает банкир, — в порядке фото. */
  hands: PhotoHand[];
  /** Руки разложены по порядку сами — банкир проверяет, чья какая. */
  auto: boolean;
  /** Что не легло и почему, огрехи ответа — проверить (вибро «warning»). */
  notes: string[];
  /** Справка: названное фото уже лежит на своих местах. */
  info: string[];
  /** На фото не нашлось открытых карт. */
  empty: boolean;
}

const isHandSlot = (slot: Slot | undefined): slot is Extract<Slot, { kind: 'hand' }> =>
  slot?.kind === 'hand';

function handSlots(playerId: PlayerId): [Slot, Slot] {
  return [
    { kind: 'hand', playerId, index: 0 },
    { kind: 'hand', playerId, index: 1 },
  ];
}

const placesList = (
  cards: readonly { code: CardCode; slot: Slot }[],
  nameOf: (id: PlayerId) => string,
): string => cards.map((c) => `${cardName(c.code)} (${slotOwner(c.slot, nameOf)})`).join(', ');

const cardList = (cards: readonly CardCode[]): string => cards.map(cardName).join(', ');

/** Замечания функции строками: что в ответе модели выброшено или не сложилось. */
export function photoIssueLines(issues: readonly BoardPhotoIssue[]): string[] {
  const bad = issues.flatMap((i) => (i.kind === 'bad_card' ? [`«${i.value}»`] : []));
  const dup = issues.flatMap((i) => (i.kind === 'duplicate' ? [i.card] : []));
  const odd = issues.flatMap((i) => (i.kind === 'odd_hand' ? [cardList(i.cards)] : []));
  const lines: string[] = [];
  if (bad.length > 0) lines.push(`На фото не разобрано: ${bad.join(', ')}.`);
  if (dup.length > 0) lines.push(`Повтор на фото — взята одна: ${cardList(dup)}.`);
  if (odd.length > 0)
    lines.push(`Не сложилось в руку из двух карт: ${odd.join('; ')}. Отметь касанием.`);
  for (const i of issues) {
    if (i.kind === 'board_extra')
      lines.push(`На столе больше пяти карт — не легли: ${cardList(i.cards)}.`);
    if (i.kind === 'hands_extra') lines.push(`Рук на фото больше девяти — лишних: ${i.count}.`);
  }
  return lines;
}

/**
 * Что с фото уже лежало на своих местах: две-три карты — списком («Уже на месте: туз пик (флоп)»),
 * больше — числом (фото следующей улицы повторяет весь стол и руки — список был бы на полэкрана).
 */
export function photoKeptLines(
  kept: readonly { code: CardCode; slot: Slot }[],
  nameOf: (id: PlayerId) => string,
): string[] {
  if (kept.length <= 3) return keptLines(kept, nameOf);
  return [
    `Уже на месте: ${pluralWithNumber(kept.length, ['карта', 'карты', 'карт'])} — с фото сходится.`,
  ];
}

/** Первое пустое место стола. */
function emptyBoardSlot(d: ShowdownDraft): Slot | null {
  const index = d.board.findIndex((c) => c === null);
  return index < 0 ? null : { kind: 'board', index };
}

/** Положить руку игроку: на его пустые места — карты, которых у него ещё нет. */
function putHand(
  d: ShowdownDraft,
  cards: readonly [CardCode, CardCode],
  playerId: PlayerId,
): { draft: ShowdownDraft; placed: PlacedCard[] } {
  let draft = d;
  const placed: PlacedCard[] = [];
  const slots = handSlots(playerId);
  const missing = cards.filter((code) => !slots.some((s) => cardIn(draft, s) === code));
  for (const slot of slots) {
    if (cardIn(draft, slot) !== null) continue;
    const code = missing.shift();
    if (!code) break;
    placed.push({ slot, code, prev: null });
    draft = placeCard(draft, slot, code);
  }
  return { draft, placed };
}

const handEmpty = (d: ShowdownDraft, playerId: PlayerId): boolean =>
  handSlots(playerId).every((s) => cardIn(d, s) === null);

/**
 * Ответ функции → черновик и итог фото (см. шапку): стол — в свободные места стола, руки — уже на
 * месте, дополненные, ничьи (их назначает банкир) или не легшие; ничьих столько же, сколько игроков
 * без карт, — разложены по порядку.
 */
export function applyBoardPhoto(
  draft: ShowdownDraft,
  answer: BoardPhotoAnswer,
  nameOf: (id: PlayerId) => string,
): { draft: ShowdownDraft; result: PhotoResult } {
  let d = draft;
  const placed: PlacedCard[] = [];
  const kept: { code: CardCode; slot: Slot }[] = [];
  const notes = photoIssueLines(answer.issues);

  // Стол.
  const marked = d.board.filter((c): c is CardCode => c !== null);
  const strangers = marked.filter((c) => !answer.board.includes(c));
  if (answer.board.length > 0 && strangers.length > 0) {
    notes.push(
      `Стол не сходится с фото — на фото нет ${strangers.length === 1 ? 'карты' : 'карт'}: ${cardList(strangers)}. Стол не тронут — поправь касанием.`,
    );
  } else {
    const overflow: CardCode[] = [];
    for (let i = 0; i < answer.board.length; i += 1) {
      const code = answer.board[i];
      if (!code) continue;
      const holder = usedCards(d).get(code);
      if (holder?.kind === 'board') {
        kept.push({ code, slot: holder });
        continue;
      }
      if (holder) {
        const held = answer.board.slice(i + 1);
        notes.push(`Уже лежит: ${placesList([{ code, slot: holder }], nameOf)}.`);
        if (held.length > 0)
          notes.push(`Дальше на стол не легли: ${cardList(held)} — поправь стол касанием.`);
        break;
      }
      const slot = emptyBoardSlot(d);
      if (!slot) {
        overflow.push(code);
        continue;
      }
      placed.push({ slot, code, prev: null });
      d = placeCard(d, slot, code);
    }
    if (overflow.length > 0)
      notes.push(`Свободных мест на столе не хватило: ${cardList(overflow)}.`);
  }

  // Руки.
  const hands: PhotoHand[] = [];
  for (const cards of answer.hands) {
    const used = usedCards(d);
    const [a, b] = cards;
    const at = [used.get(a), used.get(b)] as const;
    if (!at[0] && !at[1]) {
      hands.push({ cards, owner: null, placed: [] });
      continue;
    }
    const [sa, sb] = at;
    if (isHandSlot(sa) && isHandSlot(sb) && sa.playerId === sb.playerId) {
      kept.push({ code: a, slot: sa }, { code: b, slot: sb });
      continue;
    }
    // Одна карта уже у игрока, вторая свободна, и его второе место пустое — дополняем.
    const known = sa && !sb ? sa : sb && !sa ? sb : undefined;
    if (isHandSlot(known)) {
      const other: Slot = {
        kind: 'hand',
        playerId: known.playerId,
        index: known.index === 0 ? 1 : 0,
      };
      const code = known === sa ? b : a;
      if (cardIn(d, other) === null) {
        kept.push({ code: known === sa ? a : b, slot: known });
        placed.push({ slot: other, code, prev: null });
        d = placeCard(d, other, code);
        continue;
      }
    }
    const taken = [...(sa ? [{ code: a, slot: sa }] : []), ...(sb ? [{ code: b, slot: sb }] : [])];
    notes.push(
      `Не легла рука «${cardName(a)}, ${cardName(b)}»: уже лежит ${placesList(taken, nameOf)}.`,
    );
  }

  // Ничьих рук столько же, сколько игроков без карт, — по порядку.
  const empty = d.players.filter((id) => handEmpty(d, id));
  let auto = false;
  if (hands.length > 0 && hands.length === empty.length) {
    hands.forEach((hand, i) => {
      const playerId = empty[i];
      if (!playerId) return;
      const put = putHand(d, hand.cards, playerId);
      d = put.draft;
      hands[i] = { ...hand, owner: playerId, placed: put.placed };
    });
    auto = hands.length > 1;
  }

  return {
    draft: d,
    result: {
      ms: answer.ms,
      placed,
      hands,
      auto,
      notes,
      info: photoKeptLines(kept, nameOf),
      empty: answer.board.length === 0 && answer.hands.length === 0,
    },
  };
}

/** Рука после ручных правок черновика: только то, что ещё лежит; хозяин — пока его карта на месте. */
function syncHand(d: ShowdownDraft, hand: PhotoHand): PhotoHand {
  const slots = slotOrder(d);
  const placed = hand.placed.filter(
    (p) => slots.some((s) => sameSlot(s, p.slot)) && cardIn(d, p.slot) === p.code,
  );
  const owner = hand.owner;
  if (!owner || !d.players.includes(owner)) return { ...hand, owner: null, placed: [] };
  const holds = handSlots(owner).some((s) => {
    const c = cardIn(d, s);
    return c !== null && hand.cards.includes(c);
  });
  return holds ? { ...hand, placed } : { ...hand, owner: null, placed: [] };
}

/** Итог фото, сверенный с черновиком (банкир мог поправить карты касанием или сменить состав). */
export function syncBoardPhoto(d: ShowdownDraft, result: PhotoResult): PhotoResult {
  return { ...result, hands: result.hands.map((h) => syncHand(d, h)) };
}

/** Черновик без руки index и без другой руки с фото, которая сейчас у игрока playerId. */
function withoutPhotoHands(
  d: ShowdownDraft,
  hands: readonly PhotoHand[],
  index: number,
  playerId: PlayerId,
): ShowdownDraft {
  const own = hands[index]?.placed ?? [];
  const other = hands.find((h, j) => j !== index && h.owner === playerId)?.placed ?? [];
  return unplaceCards(unplaceCards(d, own), other);
}

/**
 * Можно ли отдать руку index игроку: он в раздаче; его места пусты или в них карты этой руки (или
 * другой руки с фото — их поменяем); карт руки нет больше нигде.
 */
export function canAssignHand(
  d: ShowdownDraft,
  result: PhotoResult,
  index: number,
  playerId: PlayerId,
): boolean {
  const hands = syncBoardPhoto(d, result).hands;
  const hand = hands[index];
  if (!hand || !d.players.includes(playerId)) return false;
  if (hand.owner === playerId) return true;
  const clear = withoutPhotoHands(d, hands, index, playerId);
  const used = usedCards(clear);
  const elsewhere = hand.cards.some((code) => {
    const slot = used.get(code);
    return slot !== undefined && !(isHandSlot(slot) && slot.playerId === playerId);
  });
  if (elsewhere) return false;
  return handSlots(playerId).every((s) => {
    const c = cardIn(clear, s);
    return c === null || hand.cards.includes(c);
  });
}

/**
 * Касание имени на руке: отдать руку игроку (у него другая рука с фото — поменять их местами, если
 * прежний хозяин свободен), а касание её же хозяина — снять руку. Нельзя (`canAssignHand`) — null.
 */
export function assignHand(
  d: ShowdownDraft,
  result: PhotoResult,
  index: number,
  playerId: PlayerId,
): { draft: ShowdownDraft; result: PhotoResult } | null {
  const hands = syncBoardPhoto(d, result).hands;
  const hand = hands[index];
  if (!hand) return null;
  if (hand.owner === playerId) {
    hands[index] = { ...hand, owner: null, placed: [] };
    return { draft: unplaceCards(d, hand.placed), result: { ...result, hands, auto: false } };
  }
  if (!canAssignHand(d, { ...result, hands }, index, playerId)) return null;
  const was = hand.owner;
  const otherIndex = hands.findIndex((h, j) => j !== index && h.owner === playerId);
  let draft = withoutPhotoHands(d, hands, index, playerId);
  const put = putHand(draft, hand.cards, playerId);
  draft = put.draft;
  hands[index] = { ...hand, owner: playerId, placed: put.placed };
  const other = hands[otherIndex];
  if (other) {
    hands[otherIndex] = { ...other, owner: null, placed: [] };
    // Поменять местами: прежний хозяин этой руки получает ту, что была у игрока.
    if (was && handEmpty(draft, was)) {
      const swap = putHand(draft, other.cards, was);
      draft = swap.draft;
      hands[otherIndex] = { ...other, owner: was, placed: swap.placed };
    }
  }
  return { draft, result: { ...result, hands, auto: false } };
}

/** «Отменить»: снять всё, что положило фото и что ещё лежит на своих местах. */
export function undoBoardPhoto(d: ShowdownDraft, result: PhotoResult): ShowdownDraft {
  const hands = syncBoardPhoto(d, result).hands;
  return unplaceCards(d, [...result.placed, ...hands.flatMap((h) => h.placed)]);
}

/** Положило ли фото хоть что-то (есть что отменять). */
export function photoPlacedAny(result: PhotoResult): boolean {
  return result.placed.length > 0 || result.hands.some((h) => h.placed.length > 0);
}

/** Подсказка под руками с фото: назначить или проверить раскладку; нечего — null. */
export function photoHandsHint(result: PhotoResult): string | null {
  if (result.hands.length === 0) return null;
  if (result.hands.some((h) => h.owner === null)) return 'Нажми, чья рука, — карты лягут на места.';
  if (result.auto)
    return 'Руки разложены по порядку — проверь, чья какая: нажми имя, чтобы поменять.';
  return null;
}

/** Вибро-отклик итога: ничего не нашлось и не легло — error, есть замечания — warning, иначе success. */
export function photoHaptic(result: PhotoResult): 'success' | 'warning' | 'error' {
  const anything = photoPlacedAny(result) || result.hands.length > 0 || result.info.length > 0;
  if (!anything) return 'error';
  return result.notes.length > 0 ? 'warning' : 'success';
}

/** Время модели для подписи: «2,5 с». */
export function photoSeconds(ms: number): string {
  return `${(Math.round(ms / 100) / 10).toFixed(1).replace('.', ',')} с`;
}

/** Ничего на фото — что сказать. */
export const PHOTO_NOTHING_TEXT =
  'Открытых карт на фото не видно. Сними стол сверху, чтобы карты были в кадре, или отметь касанием.';

/** Подсказка до первого снимка на этом устройстве: что будет с фото. */
export const PHOTO_PRIVACY_TEXT =
  'Сфотографируй стол сверху — карты распознает Claude (Anthropic). У нас фото не сохраняется.';

/** Ключ localStorage: «Снять борд» на этом устройстве уже пробовали (подсказку не показываем). */
export const PHOTO_USED_KEY = 'poker-club:board-photo:used';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function readPhotoUsed(storage: StorageLike | null): boolean {
  try {
    return storage?.getItem(PHOTO_USED_KEY) === '1';
  } catch {
    return false;
  }
}

export function writePhotoUsed(storage: StorageLike | null): void {
  try {
    storage?.setItem(PHOTO_USED_KEY, '1');
  } catch {
    // Приватное окно или запрет хранилища — подсказка покажется ещё раз.
  }
}
