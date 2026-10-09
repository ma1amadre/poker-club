// Голосовой ввод карт в шторке олл-ина — чистая часть (тесты — voiceCards.test.ts): текст
// распознавания и его варианты → карты по порядку, что не разобралось, подписи для шторки. Слушает
// телефон (useVoiceCards.ts), карты в черновик кладёт тот же путь, что и касания (`placeCards` в
// showdownDraft.ts), а на табло они уходят только главной кнопкой шторки — банкир видит карты на
// местах и подтверждает.
//
// Разбор:
// - Слова без регистра и «ё»; цифры отдельно от букв («10ка» → «10», «ка»). Ранг — словом в любом
//   падеже («туз», «короля», «восьмёркой», «десять», «кароль») или цифрой 2–10; масть — существительным
//   («пик», «червей», «буби», «крестик») или прилагательным («пиковый», «червонная», «бубновой»).
// - Карта — соседние ранг и масть в любом порядке. Где пары можно составить по-разному, выигрывает
//   разбор с меньшей ценой (`parseVoiceCards`): одиночный ранг или масть дороже любой пары;
//   существительное масти естественно после ранга («туз пик»), прилагательное — перед ним («пиковый
//   туз»); пара через запятую или «и» дороже, чем через лишнее слово, а та — дороже пары рядом.
// - Незнакомое слово от пяти букв, которое отличается от слова словаря на одну букву, читается как оно
//   («валит» — валет), только если все такие слова словаря значат одно и то же (короче — не трогаем:
//   «при» не станет «три»), его нет среди обычных слов речи (NOT_CARD_WORDS: «короче», «семья»,
//   «Валера»…) и оно складывается в карту с соседним; одно — лишнее слово, без замечания.
// - «Нет», «вернее», «точнее», «отмена» — поправка: карта (или слово) прямо перед ней отменяется, в
//   замечаниях — что на что исправлено («туз пик, нет, туз треф» — туз треф).
// - Ранг без масти и масть без ранга — не карта; повтор карты в одной фразе — не карта, оба — в
//   замечаниях. После такого сбоя (кроме повтора подряд — оговорки) карты дальше не кладутся
//   (`sure`): неясно, сколько мест занимало потерянное, а сдвиг увёл бы карты к чужим рукам.
// - Из вариантов распознавания (`bestVoiceParse`) — тот, где больше карт до сбоя, затем — меньше
//   одиночных слов и повторов, затем — первый (самый уверенный). Карты, которые уже лежат, на выбор не
//   влияют; взят не первый вариант с другими картами — замечание с первым.
import type { CardCode, PlayerId } from '@domain/types.ts';
import { cardName, type SuitCode } from '../../shared/lib/poker/cards';
import { slotOrder, cardIn, sameSlot, type ShowdownDraft, type Slot } from './showdownDraft';

/** Пример фразы — в подсказке у кнопки и в тексте «ничего не разобрано». */
export const VOICE_EXAMPLE = 'туз пик, король червей';

// ---------- Словарь ----------

/** Склонения «-ка»: «десятка, десятки, десятке, десятку, десяткой…» и родительный множественного. */
function kaForms(stem: string, genitivePlural: string): string[] {
  return [
    ...['а', 'и', 'е', 'у', 'ой', 'ою', 'ам', 'ами', 'ах'].map((e) => stem + e),
    genitivePlural,
  ];
}

const RANK_WORDS: Readonly<Record<string, readonly string[]>> = {
  A: ['туз', 'туза', 'тузу', 'тузом', 'тузе', 'тузы', 'тузов', 'тузам', 'тузами', 'тузах'],
  K: [
    'король',
    'короля',
    'королю',
    'королем',
    'короле',
    'короли',
    'королей',
    'королям',
    'королями',
    'королях',
    'кароль',
    'кароля',
    'каролю',
    'каролем',
    'кароле',
    'кароли',
    'каролей',
  ],
  Q: ['дама', 'дамы', 'даме', 'даму', 'дамой', 'дамою', 'дам', 'дамам', 'дамами', 'дамах'],
  J: [
    'валет',
    'валета',
    'валету',
    'валетом',
    'валете',
    'валеты',
    'валетов',
    'валетам',
    'валетами',
    'валетах',
  ],
  T: ['десять', 'десяти', 'десятью', '10', ...kaForms('десятк', 'десяток')],
  '9': ['девять', 'девяти', 'девятью', '9', ...kaForms('девятк', 'девяток')],
  '8': ['восемь', 'восьми', 'восемью', 'восьмью', '8', ...kaForms('восьмерк', 'восьмерок')],
  '7': ['семь', 'семи', 'семью', '7', ...kaForms('семерк', 'семерок')],
  '6': ['шесть', 'шести', 'шестью', '6', ...kaForms('шестерк', 'шестерок')],
  '5': ['пять', 'пяти', 'пятью', '5', ...kaForms('пятерк', 'пятерок')],
  '4': ['четыре', 'четырех', 'четырем', 'четырьмя', '4', ...kaForms('четверк', 'четверок')],
  '3': ['три', 'трех', 'трем', 'тремя', '3', ...kaForms('тройк', 'троек')],
  '2': ['два', 'двух', 'двум', 'двумя', '2', ...kaForms('двойк', 'двоек')],
};

/** Масти существительными — со «жаргоном»: буби, бубы, крести, крестик. */
const SUIT_NOUNS: Readonly<Record<SuitCode, readonly string[]>> = {
  s: ['пики', 'пик', 'пика', 'пику', 'пикой', 'пикою', 'пике', 'пикам', 'пиками', 'пиках', 'пиков'],
  h: [
    'черви',
    'червы',
    'червей',
    'червь',
    'черва',
    'черву',
    'червой',
    'червою',
    'черве',
    'червам',
    'червям',
    'червами',
    'червями',
    'червах',
    'червях',
  ],
  d: [
    'бубны',
    'бубен',
    'бубна',
    'бубну',
    'бубной',
    'бубною',
    'бубне',
    'бубнам',
    'бубнами',
    'бубнах',
    'буби',
    'бубы',
    'бубей',
    'бубу',
    'бубе',
    'бубам',
    'бубами',
    'бубах',
  ],
  c: [
    'трефы',
    'треф',
    'трефа',
    'трефу',
    'трефой',
    'трефою',
    'трефе',
    'трефам',
    'трефами',
    'трефах',
    'крести',
    'кресты',
    'крест',
    'креста',
    'кресту',
    'крестом',
    'кресте',
    'крестей',
    'крестов',
    'крестам',
    'крестям',
    'крестами',
    'крестями',
    'крестах',
    'крестях',
    'крестик',
    'крестики',
    'крестика',
    'крестику',
    'крестиком',
    'крестике',
    'крестиков',
    'крестикам',
    'крестиками',
    'крестиках',
  ],
};

/** Основы прилагательных масти: «пиковый туз», «червонная дама», «крестовая восьмёрка». */
const SUIT_ADJECTIVE_STEMS: Readonly<Record<SuitCode, readonly string[]>> = {
  s: ['пиков'],
  h: ['червов', 'червонн', 'червон'],
  d: ['бубнов', 'бубов'],
  c: ['трефов', 'крестов'],
};

const ADJECTIVE_ENDINGS = [
  'ый',
  'ий',
  'ой',
  'ая',
  'ое',
  'ую',
  'ого',
  'ому',
  'ом',
  'ые',
  'ых',
  'ым',
  'ыми',
];

/** Слова между картами: перед ними пара «ранг — масть» рвётся охотнее (как на запятой). */
const SEPARATOR_WORDS = new Set(['и', 'а', 'потом', 'затем', 'еще', 'дальше', 'плюс']);

type Meaning =
  { kind: 'rank'; rank: string } | { kind: 'suit'; suit: SuitCode; adjective: boolean };

const meaningKey = (m: Meaning): string => (m.kind === 'rank' ? `r${m.rank}` : `s${m.suit}`);

/** Слова, попавшие в словарь с разными значениями (должно быть пусто — проверяет тест). */
const CONFLICTS: string[] = [];

function buildLexicon(): Map<string, Meaning> {
  const lexicon = new Map<string, Meaning>();
  const add = (word: string, meaning: Meaning) => {
    const was = lexicon.get(word);
    if (!was) lexicon.set(word, meaning);
    else if (meaningKey(was) !== meaningKey(meaning)) CONFLICTS.push(word);
  };
  for (const [rank, words] of Object.entries(RANK_WORDS))
    for (const word of words) add(word, { kind: 'rank', rank });
  for (const suit of Object.keys(SUIT_NOUNS) as SuitCode[])
    for (const word of SUIT_NOUNS[suit]) add(word, { kind: 'suit', suit, adjective: false });
  for (const suit of Object.keys(SUIT_ADJECTIVE_STEMS) as SuitCode[])
    for (const stem of SUIT_ADJECTIVE_STEMS[suit])
      for (const ending of ADJECTIVE_ENDINGS)
        add(stem + ending, { kind: 'suit', suit, adjective: true });
  return lexicon;
}

const LEXICON = buildLexicon();

/** Все слова словаря — для тестов. */
export function lexiconWords(): string[] {
  return [...LEXICON.keys()];
}

/** Слова с двумя значениями (ранг и масть, две масти) — для теста: должно быть пусто. */
export function lexiconConflicts(): string[] {
  return [...CONFLICTS];
}

/** Нечёткое совпадение — только для слов не короче этого. */
export const FUZZY_MIN_LENGTH = 5;

/**
 * Обычные слова речи на одну букву от слов словаря — нечётко не читаются, всегда лишние: «короче» —
 * не «короле», «семья» — не «семью», «Валера» — не «валета», «пятеро» — не «пятёрок».
 */
const NOT_CARD_WORDS = new Set([
  'короче',
  'семья',
  'семье',
  'семьи',
  'семечки',
  'домой',
  'дамка',
  'дамки',
  'дамку',
  'валера',
  'валеры',
  'валере',
  'валеру',
  'валерой',
  'четверо',
  'пятеро',
  'шестеро',
  'семеро',
  'восьмеро',
  'двойной',
  'тройной',
]);

/** Расстояние Левенштейна не больше 1 (замена, вставка или удаление одной буквы). */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (l.length - s.length > 1) return false;
  let i = 0;
  while (i < s.length && s[i] === l[i]) i += 1;
  // Замена: хвосты после первой разницы совпадают; вставка — хвост короткого с i равен хвосту длинного с i+1.
  return s.length === l.length ? s.slice(i + 1) === l.slice(i + 1) : s.slice(i) === l.slice(i + 1);
}

/** Значение слова: точное, иначе нечёткое без путаницы (fuzzy), иначе null (лишнее слово). */
function lookup(word: string): { meaning: Meaning; fuzzy: boolean } | null {
  const exact = LEXICON.get(word);
  if (exact) return { meaning: exact, fuzzy: false };
  if (word.length < FUZZY_MIN_LENGTH || /\d/.test(word) || NOT_CARD_WORDS.has(word)) return null;
  let found: Meaning | null = null;
  for (const [entry, meaning] of LEXICON) {
    if (Math.abs(entry.length - word.length) > 1 || !withinOneEdit(entry, word)) continue;
    // Рядом слова с разными значениями — путаница: слово не трогаем.
    if (found && meaningKey(found) !== meaningKey(meaning)) return null;
    // Существительное масти важнее прилагательного: «пикова» — скорее «пиков», чем «пиковая».
    if (!found || (found.kind === 'suit' && found.adjective && meaning.kind === 'suit'))
      found = meaning;
  }
  return found ? { meaning: found, fuzzy: true } : null;
}

// ---------- Разбор фразы ----------

export type VoiceIssue =
  /** Ранг без масти: «туз». */
  | { kind: 'no-suit'; word: string }
  /** Масть без ранга: «червей». */
  | { kind: 'no-rank'; word: string }
  /** Карта названа второй раз в той же фразе. */
  | { kind: 'repeat'; card: CardCode }
  /** Поправка словом «нет» (вернее, точнее, отмена): отменена карта или слово перед ним; to — что сказано после. */
  | { kind: 'corrected'; from: { card: CardCode } | { word: string }; to: CardCode | null }
  /** Взят не первый вариант распознавания (`bestVoiceParse`), карты в нём другие: text — первый. */
  | { kind: 'alternative'; text: string };

export interface VoiceParse {
  /** Разобранный текст как пришёл от распознавания. */
  text: string;
  /** Карты по порядку, без повторов и отменённых поправкой. */
  cards: CardCode[];
  /**
   * Сколько первых карт можно класть подряд. Дальше — после сбоя: ранга или масти без пары
   * (потерянное слово) или повтора не подряд, — место каждой следующей карты неясно, их не кладём.
   */
  sure: number;
  issues: VoiceIssue[];
}

/** Что разделяет слово и предыдущее значимое: ничего, лишние слова, запятая или «и». */
type Gap = 'none' | 'filler' | 'separator';

const GAP_RANK: Readonly<Record<Gap, number>> = { none: 0, filler: 1, separator: 2 };
const widerGap = (a: Gap, b: Gap): Gap => (GAP_RANK[a] >= GAP_RANK[b] ? a : b);

interface Item {
  word: string;
  meaning: Meaning;
  gap: Gap;
  /** Слово прочитано нечётко («валит»): картой — только в паре с соседним, одно — лишнее. */
  fuzzy: boolean;
}

/** Кусок фразы до слова-поправки (или до конца). */
interface Segment {
  items: Item[];
  /** Кусок кончился поправкой: последнее в нём отменяется. */
  corrected: boolean;
}

const TOKEN_RE = /(\d+)|([a-zа-я]+)|([,.;:!?\n])/g;

/** Слова-поправки: карта (или слово) прямо перед ними отменяется — «туз пик, нет, туз треф». */
const CORRECTION_WORDS = new Set(['нет', 'вернее', 'точнее', 'отмена']);

function segmentsOf(text: string): Segment[] {
  const normalized = text.toLowerCase().replaceAll('ё', 'е');
  const segments: Segment[] = [];
  let items: Item[] = [];
  let gap: Gap = 'none';
  for (const match of normalized.matchAll(TOKEN_RE)) {
    const word = match[1] ?? match[2];
    if (word && CORRECTION_WORDS.has(word)) {
      segments.push({ items, corrected: true });
      items = [];
      gap = 'none';
      continue;
    }
    if (!word || SEPARATOR_WORDS.has(word)) {
      gap = 'separator';
      continue;
    }
    const found = lookup(word);
    if (!found) {
      if (gap === 'none') gap = 'filler';
      continue;
    }
    items.push({ word, ...found, gap: items.length === 0 ? 'none' : gap });
    gap = 'none';
  }
  segments.push({ items, corrected: false });
  return segments;
}

/** Одиночный ранг или масть — дороже любой пары. */
const ORPHAN_COST = 10;
/** Нечёткое слово лишним — дешевле одиночного, но дороже пары с ним рядом. */
const FUZZY_SKIP_COST = 3;
const GAP_COST: Readonly<Record<Gap, number>> = { none: 0, filler: 1, separator: 4 };

/** Цена пары слов как одной карты (gap — что между ними); не ранг с мастью — null. */
function pairCost(first: Item, second: Item, gap: Gap): number | null {
  const between = GAP_COST[gap];
  if (first.meaning.kind === 'rank' && second.meaning.kind === 'suit')
    return between + (second.meaning.adjective ? 1 : 0); // «туз пик» — 0, «туз пиковый» — 1
  if (first.meaning.kind === 'suit' && second.meaning.kind === 'rank')
    return between + (first.meaning.adjective ? 0 : 2); // «пиковый туз» — 0, «пики туз» — 2
  return null;
}

type OrphanIssue = Extract<VoiceIssue, { kind: 'no-suit' | 'no-rank' }>;

type Unit = { kind: 'card'; card: CardCode } | { kind: 'orphan'; issue: OrphanIssue };

type Step = 'orphan' | 'skip' | 'pair' | 'pair-over';

/** Кусок → карты и одиночные слова, разбором наименьшей цены (см. шапку). */
function unitsOf(items: readonly Item[]): Unit[] {
  const n = items.length;
  const best: number[] = Array.from({ length: n + 3 }, () => 0);
  const steps: Step[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (!item) continue;
    // Одно нечёткое слово — лишнее, без замечания; одно точное — одиночный ранг или масть.
    let cost = (item.fuzzy ? FUZZY_SKIP_COST : ORPHAN_COST) + (best[i + 1] ?? 0);
    let step: Step = item.fuzzy ? 'skip' : 'orphan';
    const next = items[i + 1];
    const pair = next ? pairCost(item, next, next.gap) : null;
    if (pair !== null && pair + (best[i + 2] ?? 0) <= cost) {
      cost = pair + (best[i + 2] ?? 0);
      step = 'pair';
    }
    // Пара через нечёткое слово между ними: «восемь <короче> крести».
    const after = items[i + 2];
    if (next?.fuzzy && after) {
      const over = pairCost(item, after, widerGap(widerGap(next.gap, after.gap), 'filler'));
      if (over !== null && FUZZY_SKIP_COST + over + (best[i + 3] ?? 0) < cost) {
        cost = FUZZY_SKIP_COST + over + (best[i + 3] ?? 0);
        step = 'pair-over';
      }
    }
    best[i] = cost;
    steps[i] = step;
  }
  const units: Unit[] = [];
  const card = (a: Item, b: Item): Unit | null => {
    const rank = a.meaning.kind === 'rank' ? a.meaning : b.meaning;
    const suit = a.meaning.kind === 'suit' ? a.meaning : b.meaning;
    return rank.kind === 'rank' && suit.kind === 'suit'
      ? { kind: 'card', card: rank.rank + suit.suit }
      : null;
  };
  for (let i = 0; i < n;) {
    const item = items[i];
    if (!item) break;
    const step = steps[i];
    const partner = items[step === 'pair' ? i + 1 : i + 2];
    const unit = (step === 'pair' || step === 'pair-over') && partner ? card(item, partner) : null;
    if (unit) {
      units.push(unit);
      i += step === 'pair' ? 2 : 3;
      continue;
    }
    if (step === 'orphan') {
      units.push({
        kind: 'orphan',
        issue:
          item.meaning.kind === 'rank'
            ? { kind: 'no-suit', word: item.word }
            : { kind: 'no-rank', word: item.word },
      });
    }
    i += 1;
  }
  return units;
}

/** Фраза → карты по порядку и замечания. Пары — разбором наименьшей цены (см. шапку). */
export function parseVoiceCards(text: string): VoiceParse {
  const units: Unit[] = [];
  // Поправки: что отменено и сколько единиц было перед ним (следующая за ними — «на что»).
  const corrections: { from: Unit; at: number }[] = [];
  for (const segment of segmentsOf(text)) {
    units.push(...unitsOf(segment.items));
    if (!segment.corrected) continue;
    const from = units.pop();
    if (from) corrections.push({ from, at: units.length });
  }
  const cards: CardCode[] = [];
  const issues: VoiceIssue[] = [];
  let sure: number | null = null;
  let previous: CardCode | null = null;
  for (const unit of units) {
    if (unit.kind === 'orphan') {
      issues.push(unit.issue);
      sure ??= cards.length;
      previous = null;
    } else if (cards.includes(unit.card)) {
      issues.push({ kind: 'repeat', card: unit.card });
      // Повтор подряд («туз пик, туз пик») — оговорка; не подряд — какая-то из карт услышана не так.
      if (unit.card !== previous) sure ??= cards.length;
    } else {
      cards.push(unit.card);
      previous = unit.card;
    }
  }
  for (const { from, at } of corrections) {
    const next = units[at];
    issues.push({
      kind: 'corrected',
      from: from.kind === 'card' ? { card: from.card } : { word: from.issue.word },
      to: next?.kind === 'card' ? next.card : null,
    });
  }
  return { text, cards, sure: sure ?? cards.length, issues };
}

/** Замечания, по которым один вариант распознавания хуже другого: одиночные слова и повторы. */
const flaws = (parse: VoiceParse): number =>
  parse.issues.filter((i) => i.kind === 'no-suit' || i.kind === 'no-rank' || i.kind === 'repeat')
    .length;

/**
 * Лучший из вариантов распознавания: больше карт, которые можно класть подряд (`sure`), затем меньше
 * одиночных слов и повторов, затем — раньше в списке (первый — самый уверенный). Карты, которые уже
 * лежат в раздаче, на выбор не влияют: банкир мог повторить фразу, оборванную паузой, — и тогда
 * менее уверенный вариант молча подменил бы карту. Взят не первый вариант, и карты в нём другие, —
 * замечание «alternative» с первым. Пусто или одни пробелы — null.
 */
export function bestVoiceParse(texts: readonly string[]): VoiceParse | null {
  let first: VoiceParse | null = null;
  let best: VoiceParse | null = null;
  for (const text of texts) {
    if (!text.trim()) continue;
    const parse = parseVoiceCards(text);
    first ??= parse;
    if (!best || parse.sure > best.sure || (parse.sure === best.sure && flaws(parse) < flaws(best)))
      best = parse;
  }
  if (!best || !first || best === first || best.cards.join() === first.cards.join()) return best;
  return { ...best, issues: [...best.issues, { kind: 'alternative', text: first.text }] };
}

/**
 * Тексты-варианты из результатов распознавания: k-й вариант — k-е альтернативы всех кусков фразы
 * подряд (у куска без k-й — его первая). Пустые и повторы выкидываются, порядок — как у вариантов.
 */
export function speechTexts(segments: readonly (readonly string[])[]): string[] {
  const width = Math.max(0, ...segments.map((s) => s.length));
  const texts: string[] = [];
  for (let k = 0; k < width; k += 1) {
    const text = segments
      .map((s) => (s[k] ?? s[0] ?? '').trim())
      .filter(Boolean)
      .join(' ');
    if (text && !texts.includes(text)) texts.push(text);
  }
  return texts;
}

// ---------- Подписи ----------

/** Чьё место: имя игрока, «флоп», «тёрн», «ривер». */
export function slotOwner(slot: Slot, nameOf: (id: PlayerId) => string): string {
  if (slot.kind === 'hand') return nameOf(slot.playerId);
  return slot.index < 3 ? 'флоп' : slot.index === 3 ? 'тёрн' : 'ривер';
}

const ownerKey = (slot: Slot): string =>
  slot.kind === 'hand' ? `h:${slot.playerId}` : `b:${slot.index < 3 ? 0 : slot.index}`;

/**
 * Куда лягут названные карты — по очереди, как при касаниях: подсвеченное место (на нём карта —
 * «замена»), затем следующие пустые по кругу. Подряд идущие места одного владельца — одним словом:
 * «Женя → Саша → флоп → …» (не больше `limit` шагов). Мест нет — null.
 */
export function voiceQueue(
  d: ShowdownDraft,
  active: Slot | null,
  nameOf: (id: PlayerId) => string,
  limit = 3,
): string | null {
  const order = slotOrder(d);
  const at = active ? order.findIndex((s) => sameSlot(s, active)) : -1;
  const targets: { slot: Slot; replace: boolean }[] = [];
  if (active && at >= 0) targets.push({ slot: active, replace: cardIn(d, active) !== null });
  // Дальше — пустые по кругу после подсвеченного (без него — с первого места), как nextEmptySlot.
  for (let k = 1; k <= order.length; k += 1) {
    const slot = order[(at + k) % order.length];
    if (!slot || sameSlot(slot, active) || cardIn(d, slot) !== null) continue;
    targets.push({ slot, replace: false });
  }
  if (targets.length === 0) return null;
  const steps: string[] = [];
  let lastKey = '';
  for (const { slot, replace } of targets) {
    const key = ownerKey(slot);
    if (key === lastKey) continue;
    lastKey = key;
    steps.push(replace ? `${slotOwner(slot, nameOf)} (замена)` : slotOwner(slot, nameOf));
  }
  const shown = steps.slice(0, limit);
  return steps.length > limit ? `${shown.join(' → ')} → …` : shown.join(' → ');
}

/** Что легло, подряд по владельцам мест: [{ owner: 'Женя', cards: ['8c', '3d'] }, { owner: 'флоп', … }]. */
export function placedGroups(
  placed: readonly { slot: Slot; code: CardCode }[],
  nameOf: (id: PlayerId) => string,
): { owner: string; cards: CardCode[] }[] {
  const groups: { key: string; owner: string; cards: CardCode[] }[] = [];
  for (const { slot, code } of placed) {
    const key = ownerKey(slot);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.cards.push(code);
    else groups.push({ key, owner: slotOwner(slot, nameOf), cards: [code] });
  }
  return groups.map(({ owner, cards }) => ({ owner, cards }));
}

const quoted = (word: string): string => `«${word}»`;

/**
 * Замечания разбора строками: «Без масти: «туз».», «Без ранга: «червей».», «Повтор: туз пик.»,
 * «Исправлено: туз пик → туз треф.», «Первый вариант телефона был другим: «…».».
 */
export function voiceIssueLines(issues: readonly VoiceIssue[]): string[] {
  const noSuit = issues.flatMap((i) => (i.kind === 'no-suit' ? [quoted(i.word)] : []));
  const noRank = issues.flatMap((i) => (i.kind === 'no-rank' ? [quoted(i.word)] : []));
  const repeat = issues.flatMap((i) => (i.kind === 'repeat' ? [cardName(i.card)] : []));
  const corrected = issues.flatMap((i) => {
    if (i.kind !== 'corrected') return [];
    const from = 'card' in i.from ? cardName(i.from.card) : quoted(i.from.word);
    return [i.to ? `Исправлено: ${from} → ${cardName(i.to)}.` : `Отменено: ${from}.`];
  });
  const alternative = issues.flatMap((i) =>
    i.kind === 'alternative' ? [`Первый вариант телефона был другим: ${quoted(i.text)}.`] : [],
  );
  return [
    ...(noSuit.length > 0 ? [`Без масти: ${noSuit.join(', ')}.`] : []),
    ...(noRank.length > 0 ? [`Без ранга: ${noRank.join(', ')}.`] : []),
    ...(repeat.length > 0 ? [`Повтор: ${repeat.join(', ')}.`] : []),
    ...corrected,
    ...alternative,
  ];
}

const placesList = (
  cards: readonly { code: CardCode; slot: Slot }[],
  nameOf: (id: PlayerId) => string,
): string => cards.map((c) => `${cardName(c.code)} (${slotOwner(c.slot, nameOf)})`).join(', ');

/**
 * Что не легло при раскладке: карта уже лежит в другом месте (у кого), карты после сбоя (`held`:
 * их место неясно) и те, кому не хватило мест.
 */
export function placementLines(
  taken: readonly { code: CardCode; slot: Slot }[],
  held: readonly CardCode[],
  overflow: readonly CardCode[],
  nameOf: (id: PlayerId) => string,
): string[] {
  const lines: string[] = [];
  if (taken.length > 0)
    lines.push(`${taken.length === 1 ? 'Уже лежит' : 'Уже лежат'}: ${placesList(taken, nameOf)}.`);
  if (held.length > 0) {
    const list = held.map(cardName).join(', ');
    lines.push(
      held.length === 1
        ? `Дальше не легла: ${list}. Повтори её вместе с картой перед ней.`
        : `Дальше не легли: ${list}. Повтори их вместе с картой перед ними.`,
    );
  }
  if (overflow.length > 0)
    lines.push(`Свободных мест не хватило: ${overflow.map(cardName).join(', ')}.`);
  return lines;
}

/** Названные карты, которые уже лежат на своих местах (`kept`): «Уже на месте: туз пик (Женя).». */
export function keptLines(
  kept: readonly { code: CardCode; slot: Slot }[],
  nameOf: (id: PlayerId) => string,
): string[] {
  return kept.length > 0 ? [`Уже на месте: ${placesList(kept, nameOf)}.`] : [];
}

/** Карт в тексте нет (метка «[ НЕ РАЗОБРАНО ]» рядом) — что сказать, с примером. */
export const VOICE_NOTHING_TEXT = `Скажи ранг и масть каждой карты, например: «${VOICE_EXAMPLE}».`;

const VOICE_ERRORS: Readonly<Record<string, string>> = {
  'not-allowed':
    'Нет доступа к микрофону или распознаванию речи. Разреши их Telegram в настройках телефона и нажми ещё раз.',
  'service-not-allowed':
    'Распознавание речи на телефоне выключено или недоступно в этом окне. Отметь карты касанием.',
  'no-speech': 'Речи не слышно. Нажми «Сказать карты» и говори ближе к телефону.',
  'audio-capture': 'Микрофон недоступен — возможно, его занял звонок или другое приложение.',
  network: 'Нет связи с распознаванием речи. Проверь интернет или отметь карты касанием.',
  aborted: 'Распознавание прервалось. Нажми «Сказать карты» ещё раз.',
  'language-not-supported': 'Русский язык распознавания на этом телефоне недоступен.',
  'start-failed': 'Распознавание не запустилось. Нажми ещё раз или отметь карты касанием.',
};

/** Код ошибки распознавания (SpeechRecognitionErrorEvent.error) → понятный текст на «ты». */
export function voiceErrorText(code: string): string {
  return (
    VOICE_ERRORS[code] ??
    `Распознавание не сработало${code ? ` (${code})` : ''}. Отметь карты касанием.`
  );
}

/** Подсказка до первого запуска: системные вопросы iPhone о доступе. */
export const VOICE_PERMISSION_TEXT =
  'В первый раз телефон спросит доступ к микрофону и распознаванию речи — разреши.';

/** Ключ localStorage: распознавание на этом устройстве уже запускалось (подсказку о доступе не показываем). */
export const VOICE_READY_KEY = 'poker-club:voice-cards:ready';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** Запускалось ли распознавание здесь; хранилища нет или оно бросает — «нет». */
export function readVoiceReady(storage: StorageLike | null): boolean {
  try {
    return storage?.getItem(VOICE_READY_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeVoiceReady(storage: StorageLike | null): void {
  try {
    storage?.setItem(VOICE_READY_KEY, '1');
  } catch {
    // Приватное окно или запрет хранилища — подсказка покажется ещё раз, не беда.
  }
}
