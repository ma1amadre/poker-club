// Черновик формата турнира для редактора админки: строки полей ввода ↔ TournamentFormat,
// операции над уровнями, раскладка ошибок validateFormat по полям и предпросмотр расписания.
// Чистые функции без React. Годность формата решает домен (validateFormat), здесь — только разбор
// ввода.
import { DEFAULT_FORMAT, validateFormat } from '@domain/format.ts';
import type { BlindLevel, LevelTrigger, TournamentFormat } from '@domain/types.ts';
// Только чистое форматирование (Intl), без React: модуль тестируется в node.
import { formatNumber, formatRub, NBSP, plural, pluralWithNumber } from '../../shared/lib/format';
import { intToInput, decimalToInput, parseDecimalInput, parseIntInput } from './lib';
import { capitalize } from '../../shared/lib/text';

export type TriggerType = LevelTrigger['type'];

export const TRIGGER_META: Record<
  TriggerType,
  { title: string; amountLabel: string; defaultAmount: string }
> = {
  time: { title: 'По времени', amountLabel: 'Минут', defaultAmount: '40' },
  eliminations: { title: 'После вылетов', amountLabel: 'Вылетов', defaultAmount: '1' },
  hands: { title: 'После раздач', amountLabel: 'Раздач', defaultAmount: '5' },
};

export const TRIGGER_TYPES: readonly TriggerType[] = ['time', 'eliminations', 'hands'];

/** Название формата в БД: formats.name — от 1 до 80 символов (001_schema.sql). */
export const FORMAT_NAME_MAX = 80;

export interface LevelDraft {
  /** Ключ строки для React: уровни переставляются, индекс ключом не годится. */
  key: string;
  sb: string;
  bb: string;
  /** Пусто — без анте. */
  ante: string;
  trigger: TriggerType;
  /** Минуты, вылеты или раздачи — по trigger. */
  amount: string;
}

export interface FormatDraft {
  name: string;
  buyIn: string;
  chips: string;
  rebuyUntil: string;
  /** Пусто — без лимита. */
  rebuyLimit: string;
  /** Доли призовых в процентах, по местам. */
  payouts: string[];
  levels: LevelDraft[];
}

let levelSeq = 0;
const nextKey = () => `lv${++levelSeq}`;

function levelToDraft(level: BlindLevel): LevelDraft {
  // Формат пришёл из jsonb: триггер мог быть недописан.
  const t = level?.trigger as Partial<{ type: string; minutes: number; count: number }> | undefined;
  const type: TriggerType =
    t?.type === 'eliminations' || t?.type === 'hands' || t?.type === 'time' ? t.type : 'time';
  const amount = t?.type === 'time' ? t.minutes : t?.count;
  return {
    key: nextKey(),
    sb: intToInput(level?.sb),
    bb: intToInput(level?.bb),
    ante: level?.ante ? intToInput(level.ante) : '',
    trigger: type,
    amount: intToInput(amount),
  };
}

/**
 * Формат из БД → поля формы. Формат — jsonb, поэтому разбор терпит дыры в нём. bountyRub старых
 * форматов (баунти убрано 07.10.2026) в форму не попадает — и при сохранении из формата уходит.
 */
export function draftFromFormat(format: TournamentFormat): FormatDraft {
  return {
    name: typeof format?.name === 'string' ? format.name : '',
    buyIn: intToInput(format?.buyInRub),
    chips: intToInput(format?.startingChips),
    rebuyUntil: intToInput(format?.rebuyUntilLevel),
    rebuyLimit: intToInput(format?.rebuyLimit),
    payouts: Array.isArray(format?.payoutPct) ? format.payoutPct.map(decimalToInput) : [],
    levels: Array.isArray(format?.levels) ? format.levels.map(levelToDraft) : [],
  };
}

/** Новый формат начинается с клубного: правок обычно меньше, чем ввода с нуля. Название — пустое. */
export function newFormatDraft(): FormatDraft {
  return { ...draftFromFormat(DEFAULT_FORMAT), name: '' };
}

const intOrNaN = (value: string): number => parseIntInput(value) ?? Number.NaN;

/** Поля формы → формат. Нечисло становится NaN — его отметит validateFormat. */
export function formatFromDraft(draft: FormatDraft): TournamentFormat {
  return {
    name: draft.name.trim(),
    buyInRub: intOrNaN(draft.buyIn),
    startingChips: intOrNaN(draft.chips),
    rebuyUntilLevel: intOrNaN(draft.rebuyUntil),
    rebuyLimit: parseIntInput(draft.rebuyLimit),
    payoutPct: draft.payouts.map((p) => parseDecimalInput(p) ?? Number.NaN),
    levels: draft.levels.map((l) => {
      const amount = intOrNaN(l.amount);
      const trigger: LevelTrigger =
        l.trigger === 'time'
          ? { type: 'time', minutes: amount }
          : { type: l.trigger, count: amount };
      const level: BlindLevel = { sb: intOrNaN(l.sb), bb: intOrNaN(l.bb), trigger };
      const ante = parseIntInput(l.ante);
      // Анте 0 — то же, что без анте; в jsonb его не пишем.
      if (ante !== null && ante !== 0) level.ante = ante;
      return level;
    }),
  };
}

/** Тот же формат по смыслу (ключи строк уровней не в счёт) — для «есть несохранённые правки». */
export function sameDraft(a: FormatDraft, b: FormatDraft): boolean {
  const strip = (d: FormatDraft) => ({
    ...d,
    name: d.name.trim(),
    levels: d.levels.map(({ key: _key, ...rest }) => rest),
  });
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

// --- Проверка: ошибки ввода + validateFormat, разложенные по полям ---------------------------

export type FormatField = 'name' | 'buyIn' | 'chips' | 'rebuyUntil' | 'rebuyLimit' | 'payouts';

export type LevelField = 'sb' | 'bb' | 'ante' | 'trigger' | 'amount';

export interface LevelProblem {
  fields: LevelField[];
  messages: string[];
}

export interface FormatProblems {
  fields: Partial<Record<FormatField, string>>;
  /** Индексы долей призовых, которые не разобрались как число. */
  payoutItems: number[];
  /** По индексу уровня. */
  levels: Record<number, LevelProblem>;
  /** Ошибки, которые не привязать к полю. */
  other: string[];
  count: number;
}

// Префиксы сообщений validateFormat (domain/format.ts) → поле формы. Тест в formatDraft.test.ts
// проходит по каждому сообщению домена: если текст там поменяется, тест это поймает.
const FIELD_PREFIXES: readonly (readonly [string, FormatField])[] = [
  ['Не задано название', 'name'],
  ['Вход ', 'buyIn'],
  ['Стартовый стек', 'chips'],
  ['Уровень закрытия ребаев', 'rebuyUntil'],
  ['Лимит ребаев', 'rebuyLimit'],
  ['Нужно хотя бы одно призовое', 'payouts'],
  ['Доли призовых', 'payouts'],
  ['Сумма долей призовых', 'payouts'],
];

// Сообщения домена с техническими словами — в язык формы.
const FRIENDLY: Readonly<Record<string, string>> = {
  'Не задано название формата': 'Введи название формата.',
  'Лимит ребаев — целое число не меньше 0 или null (без лимита)':
    'Лимит — целое число от 0. Оставь поле пустым, если без лимита.',
  'Уровень закрытия ребаев должен быть целым числом не меньше 0':
    'Номер уровня — целое число от 0; 0 — без ребаев и позднего входа.',
};

const LEVEL_RE = /^Уровень (\d+): (.+)$/;

const percentFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

/** Сообщение домена — словами формы: без «null», с числом по правилам набора. */
function friendly(message: string, draft: FormatDraft): string {
  if (message.startsWith('Сумма долей призовых')) {
    const sum = payoutSum(draft.payouts);
    if (sum !== null)
      return `Доли мест в сумме дают ${percentFormat.format(sum)}${NBSP}%, а нужно ровно 100${NBSP}%.`;
  }
  return FRIENDLY[message] ?? message;
}

function levelFieldsOf(text: string): LevelField[] {
  if (text.startsWith('малый блайнд больше')) return ['sb', 'bb'];
  if (text.startsWith('малый')) return ['sb'];
  if (text.startsWith('большой')) return ['bb'];
  if (text.startsWith('анте')) return ['ante'];
  if (text.startsWith('длительность') || text.startsWith('число для триггера')) return ['amount'];
  if (text.includes('триггер')) return ['trigger'];
  return [];
}

export function checkDraft(draft: FormatDraft): {
  format: TournamentFormat;
  problems: FormatProblems;
  ok: boolean;
} {
  const format = formatFromDraft(draft);
  const fields: FormatProblems['fields'] = {};
  const payoutItems: number[] = [];
  const levels: FormatProblems['levels'] = {};
  const other: string[] = [];

  const levelProblem = (index: number): LevelProblem => {
    const existing = levels[index];
    if (existing) return existing;
    const created: LevelProblem = { fields: [], messages: [] };
    levels[index] = created;
    return created;
  };

  // 1. Ввод: пустые и нечисловые поля — своими словами, у самого поля.
  const requiredInt = (field: FormatField, value: string) => {
    const n = parseIntInput(value);
    if (n === null) fields[field] = 'Заполни поле.';
    else if (Number.isNaN(n)) fields[field] = 'Введи целое число.';
  };
  if (Array.from(draft.name.trim()).length > FORMAT_NAME_MAX)
    fields.name = `Название длиннее ${FORMAT_NAME_MAX} символов. Сократи его.`;
  requiredInt('buyIn', draft.buyIn);
  requiredInt('chips', draft.chips);
  requiredInt('rebuyUntil', draft.rebuyUntil);
  if (Number.isNaN(parseIntInput(draft.rebuyLimit)))
    fields.rebuyLimit = 'Введи целое число или оставь поле пустым.';
  draft.payouts.forEach((p, i) => {
    const n = parseDecimalInput(p);
    if (n === null || Number.isNaN(n)) payoutItems.push(i);
  });
  if (payoutItems.length > 0) fields.payouts = 'Доля места — число процентов, например 70.';
  draft.levels.forEach((l, i) => {
    const bad: LevelField[] = [];
    for (const f of ['sb', 'bb', 'amount'] as const) {
      const n = parseIntInput(l[f]);
      if (n === null || Number.isNaN(n)) bad.push(f);
    }
    if (Number.isNaN(parseIntInput(l.ante))) bad.push('ante');
    if (bad.length > 0) {
      const p = levelProblem(i);
      p.fields.push(...bad);
      p.messages.push('Блайнды, анте и число для смены уровня — целые числа.');
    }
  });

  // 2. Домен: окончательный ответ, годен ли формат. Сообщения про уже отмеченные поля пропускаем.
  for (const message of validateFormat(format)) {
    const lv = LEVEL_RE.exec(message);
    if (lv) {
      const index = Number(lv[1]) - 1;
      const text = lv[2] ?? '';
      const targets = levelFieldsOf(text);
      const p = levelProblem(index);
      if (targets.length > 0 && targets.every((t) => p.fields.includes(t))) continue;
      for (const t of targets) if (!p.fields.includes(t)) p.fields.push(t);
      p.messages.push(capitalize(text));
      continue;
    }
    const field = FIELD_PREFIXES.find(([prefix]) => message.startsWith(prefix))?.[1];
    if (field) {
      fields[field] ??= friendly(message, draft);
    } else {
      other.push(friendly(message, draft));
    }
  }

  const count =
    Object.keys(fields).length +
    Object.values(levels).reduce((n, l) => n + l.messages.length, 0) +
    other.length;
  return { format, problems: { fields, payoutItems, levels, other, count }, ok: count === 0 };
}

/** Сумма долей призовых, если все доли — числа; иначе null. */
export function payoutSum(payouts: readonly string[]): number | null {
  let sum = 0;
  for (const p of payouts) {
    const n = parseDecimalInput(p);
    if (n === null || Number.isNaN(n)) return null;
    sum += n;
  }
  // Убираем хвосты двоичной арифметики: 33,3 + 33,3 + 33,4 = 100, а не 99,99999999999999.
  return Math.round(sum * 1e6) / 1e6;
}

// --- Операции над уровнями -------------------------------------------------------------------

function doubled(value: string): string {
  const n = parseIntInput(value);
  return n === null || Number.isNaN(n) ? value : String(n * 2);
}

/** Уровень с блайндами и анте ×2 от образца; триггер — тот же. */
function doubledLevel(from: LevelDraft): LevelDraft {
  return {
    ...from,
    key: nextKey(),
    sb: doubled(from.sb),
    bb: doubled(from.bb),
    ante: from.ante === '' ? '' : doubled(from.ante),
  };
}

/** Новый уровень в конец: блайнды предыдущего ×2, триггер тот же; если уровней нет — 5/10, 40 мин. */
export function appendLevel(levels: readonly LevelDraft[]): LevelDraft[] {
  const last = levels[levels.length - 1];
  return [
    ...levels,
    last
      ? doubledLevel(last)
      : { key: nextKey(), sb: '5', bb: '10', ante: '', trigger: 'time', amount: '40' },
  ];
}

/** Блайнды уровня index = предыдущий ×2 (триггер уровня не трогаем). У первого уровня — без изменений. */
export function doublePrevious(levels: readonly LevelDraft[], index: number): LevelDraft[] {
  const prev = levels[index - 1];
  const cur = levels[index];
  if (!prev || !cur) return [...levels];
  const d = doubledLevel(prev);
  return levels.map((l, i) => (i === index ? { ...cur, sb: d.sb, bb: d.bb, ante: d.ante } : l));
}

/** Сдвинуть уровень на delta позиций (−1 — выше, +1 — ниже); за край не уводит. */
export function moveLevel(
  levels: readonly LevelDraft[],
  index: number,
  delta: number,
): LevelDraft[] {
  const target = index + delta;
  if (index < 0 || index >= levels.length || target < 0 || target >= levels.length)
    return [...levels];
  const next = [...levels];
  const [item] = next.splice(index, 1);
  if (item) next.splice(target, 0, item);
  return next;
}

export function removeLevel(levels: readonly LevelDraft[], index: number): LevelDraft[] {
  return levels.filter((_, i) => i !== index);
}

/** Смена триггера: число прежнего триггера к новому не подходит (40 минут ≠ 40 вылетов). */
export function changeTrigger(level: LevelDraft, trigger: TriggerType): LevelDraft {
  if (level.trigger === trigger) return level;
  return { ...level, trigger, amount: TRIGGER_META[trigger].defaultAmount };
}

// --- Предпросмотр ----------------------------------------------------------------------------

export type RebuyClose =
  /** rebuyUntilLevel = 0: вход и ребаи закрываются со стартом таймера. */
  | { kind: 'none' }
  /** Номер уровня не меньше числа уровней: ребаи открыты до конца турнира. */
  | { kind: 'open' }
  /** Ребаи закрываются после уровня level — в minutes игрового времени (без пауз). */
  | { kind: 'at'; level: number; minutes: number }
  /** Ребаи закрываются после уровня level, но время зависит от вылетов или раздач. */
  | { kind: 'after'; level: number };

export interface FormatPreview {
  /** Минута игрового времени, с которой начинается уровень; null — раньше есть не-временной уровень. */
  levelStarts: (number | null)[];
  /** Сумма длительностей уровней по времени, мин. */
  timeMinutes: number;
  timeLevels: number;
  /** Уровни с триггером «вылеты» или «раздачи». */
  otherLevels: number;
  /** Все уровни по времени одной длины — эта длина. */
  uniformMinutes: number | null;
  rebuys: RebuyClose | null;
  /** Стартовый стек в больших блайндах первого уровня. */
  startingBb: number | null;
}

const positiveInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0;

function minutesOf(level: BlindLevel | undefined): number | null {
  const t = level?.trigger;
  return t?.type === 'time' && positiveInt(t.minutes) ? t.minutes : null;
}

/**
 * Расписание по формату. Правила — как у replay: уровень по времени сменяется сам, после
 * последнего блайнды не растут, ребаи открыты, пока номер уровня ≤ rebuyUntilLevel.
 * Терпит недописанный формат: что посчитать нельзя — null.
 */
export function previewFormat(format: TournamentFormat): FormatPreview {
  const levels = Array.isArray(format.levels) ? format.levels : [];
  let acc: number | null = 0;
  const levelStarts = levels.map((level) => {
    const start = acc;
    const m = minutesOf(level);
    acc = acc !== null && m !== null ? acc + m : null;
    return start;
  });
  const minutes = levels.map(minutesOf).filter((m): m is number => m !== null);
  const timeMinutes = minutes.reduce((a, b) => a + b, 0);
  const otherLevels = levels.filter((l) => l?.trigger?.type !== 'time').length;
  const uniformMinutes =
    minutes.length > 0 && minutes.every((m) => m === minutes[0]) ? (minutes[0] ?? null) : null;

  let rebuys: RebuyClose | null = null;
  const until = format.rebuyUntilLevel;
  if (Number.isInteger(until) && until >= 0 && levels.length > 0) {
    if (until === 0) rebuys = { kind: 'none' };
    else if (until >= levels.length) rebuys = { kind: 'open' };
    else {
      const end = levelStarts[until];
      rebuys =
        end !== null && end !== undefined
          ? { kind: 'at', level: until, minutes: end }
          : { kind: 'after', level: until };
    }
  }

  const firstBb = levels[0]?.bb;
  const startingBb =
    positiveInt(format.startingChips) && positiveInt(firstBb)
      ? format.startingChips / firstBb
      : null;

  return {
    levelStarts,
    timeMinutes,
    timeLevels: minutes.length,
    otherLevels,
    uniformMinutes,
    rebuys,
    startingBb,
  };
}

/** Игровое время «ч:мм»: 200 → «3:20», 45 → «0:45». */
export function formatGameClock(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function rebuyPhrase(format: TournamentFormat): string {
  const until = format.rebuyUntilLevel;
  if (until <= 0 || format.rebuyLimit === 0) return 'без ребаев';
  const limit =
    format.rebuyLimit === null ? '' : `, не больше ${format.rebuyLimit}${NBSP}на${NBSP}игрока`;
  if (until >= format.levels.length) return `ребаи до конца${limit}`;
  return `ребаи до ${until}-го уровня${limit}`;
}

/** Одна строка о формате: «500 ₽ · 500 фишек · 8 уровней по 40 мин · ребаи до 5-го уровня». */
export function formatSummary(format: TournamentFormat): string {
  const levels = Array.isArray(format.levels) ? format.levels : [];
  const p = previewFormat(format);
  const count = pluralWithNumber(levels.length, ['уровень', 'уровня', 'уровней']);
  return [
    formatRub(format.buyInRub),
    `${formatNumber(format.startingChips)}${NBSP}${plural(format.startingChips, ['фишка', 'фишки', 'фишек'])}`,
    p.uniformMinutes !== null && p.otherLevels === 0
      ? `${count} по ${p.uniformMinutes}${NBSP}мин`
      : count,
    rebuyPhrase(format),
  ].join(' · ');
}
