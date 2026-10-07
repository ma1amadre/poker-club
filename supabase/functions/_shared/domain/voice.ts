// Голос табло: тексты объявлений, числа словами, имена для озвучки, хеши клипов и манифест фраз.
//
// Один источник текста на две стороны: табло (src/pages/board) ищет клип по хешу текста, а
// генератор озвучки (scripts/voice: manifest.mjs → generate.py, запуск — voice.yml в poker-club-ops)
// озвучивает те же тексты заранее и кладёт в public.voice_clips (миграция 016). Текст должен
// совпадать до символа — поэтому фразы собираются только здесь.
//
// Ограничения синтезатора (Silero v5_5_ru, проверено на модели): латиницу выбрасывает (имя
// «Erdni Omaev» просто пропадает), цифры не читает — числа здесь словами, имена — только
// кириллицей. Ударение ставит сам; вручную — «+» перед ударной гласной («Эрдн+и»).
// Без зависимостей и без Date.now(): модуль исполняют браузер (Vite), Node 24 (манифест, .ts без
// сборки — поэтому никакого TS-only синтаксиса) и vitest. Хеш — WebCrypto (crypto.subtle).
import type { BlindLevel, PlayerId } from './types.ts';

/** Голос клипов: модель Silero v5_5_ru, диктор xenia (CC BY-NC-SA 4.0). Часть хеша клипа. */
export const VOICE_ID = 'silero-v5_5-xenia';

/** Подпись на табло (атрибуция лицензии CC BY-NC-SA 4.0). */
export const VOICE_CREDIT = 'Голос: Silero (CC BY-NC-SA 4.0)';

// --- Числа словами --------------------------------------------------------------------------

const ONES_M = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const ONES_F = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const TEENS = [
  'десять',
  'одиннадцать',
  'двенадцать',
  'тринадцать',
  'четырнадцать',
  'пятнадцать',
  'шестнадцать',
  'семнадцать',
  'восемнадцать',
  'девятнадцать',
];
const TENS = [
  '',
  '',
  'двадцать',
  'тридцать',
  'сорок',
  'пятьдесят',
  'шестьдесят',
  'семьдесят',
  'восемьдесят',
  'девяносто',
];
const HUNDREDS = [
  '',
  'сто',
  'двести',
  'триста',
  'четыреста',
  'пятьсот',
  'шестьсот',
  'семьсот',
  'восемьсот',
  'девятьсот',
];

const SCALES: readonly {
  value: number;
  forms: readonly [string, string, string];
  feminine: boolean;
}[] = [
  { value: 1_000_000_000, forms: ['миллиард', 'миллиарда', 'миллиардов'], feminine: false },
  { value: 1_000_000, forms: ['миллион', 'миллиона', 'миллионов'], feminine: false },
  { value: 1_000, forms: ['тысяча', 'тысячи', 'тысяч'], feminine: true },
];

/** Наибольшее число, которое умеет numberWords (999 999 999 999). */
export const NUMBER_WORDS_MAX = 999_999_999_999;

function pluralForm(n: number, forms: readonly [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/** 0..999 словами; пустой список для 0. */
function triad(n: number, feminine: boolean): string[] {
  const words: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) words.push(HUNDREDS[hundreds] ?? '');
  if (rest >= 10 && rest < 20) {
    words.push(TEENS[rest - 10] ?? '');
  } else {
    const tens = Math.floor(rest / 10);
    const ones = rest % 10;
    if (tens > 0) words.push(TENS[tens] ?? '');
    if (ones > 0) words.push((feminine ? ONES_F : ONES_M)[ones] ?? '');
  }
  return words;
}

/**
 * Целое число словами по-русски, именительный падеж, мужской род: 5 → «пять», 1000 → «тысяча»,
 * 2500 → «две тысячи пятьсот», 21 000 → «двадцать одна тысяча». Отрицательные, дробные и больше
 * NUMBER_WORDS_MAX — RangeError (Silero цифры не читает, подставить их некуда).
 */
export function numberWords(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0 || n > NUMBER_WORDS_MAX) {
    throw new RangeError(
      `Число ${n} не прочитать словами: нужно целое от 0 до ${NUMBER_WORDS_MAX}`,
    );
  }
  if (n === 0) return 'ноль';
  const words: string[] = [];
  let rest = n;
  for (const scale of SCALES) {
    const count = Math.floor(rest / scale.value);
    rest %= scale.value;
    if (count === 0) continue;
    // «тысяча», «миллион» — без «одна»/«один»; «сто одна тысяча» — с ним.
    if (count === 1) words.push(scale.forms[0]);
    else words.push(...triad(count, scale.feminine), pluralForm(count, scale.forms));
  }
  words.push(...triad(rest, false));
  return words.join(' ');
}

// --- Текст и хеш клипа ----------------------------------------------------------------------

/**
 * Текст так, как его хранит voice_clips и хеширует клип: NFC, любые пробелы — один обычный
 * пробел, без пробелов по краям. Ту же форму проверяет constraint voice_clips_text_normalized.
 */
export function normalizeSpeech(text: string): string {
  return text.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Хеш клипа: SHA-256 (hex, 64 символа) от UTF-8 строки `${voice}\n${normalizeSpeech(text)}`.
 * Тот же расчёт в БД — constraint voice_clips_hash_matches (sha256(convert_to(voice || E'\n' ||
 * text, 'UTF8'))). Нужен crypto.subtle: в браузере — только в безопасном контексте (https,
 * localhost).
 */
export async function clipHash(text: string, voice: string = VOICE_ID): Promise<string> {
  const data = new TextEncoder().encode(`${voice}\n${normalizeSpeech(text)}`);
  return hex(await crypto.subtle.digest('SHA-256', data));
}

// --- Имена для озвучки ----------------------------------------------------------------------

/** Предел players.spoken_name (с плюсами ударений), как constraint players_spoken_name_shape. */
export const SPOKEN_NAME_MAX = 50;

const LETTER_RE = /[А-Яа-яЁё]/u;
/** Имя для озвучки: кириллица, пробел, дефис, апостроф и «+» ударения. */
const SPOKEN_CHARS_RE = /^[А-Яа-яЁё+' -]+$/u;
/** Отображаемое имя, которое голос прочитает как есть: то же без «+». */
const PLAIN_CHARS_RE = /^[А-Яа-яЁё' -]+$/u;
/** «+» не перед гласной (или в конце) — Silero такое ударение не поймёт. */
const BAD_STRESS_RE = /\+(?![аеёиоуыэюяАЕЁИОУЫЭЮЯ])/u;

/**
 * Имя для озвучки так, как его сохранит сервер (set_my_spoken_name, форма админки): NFC,
 * типографские апострофы → «'», пробелы схлопнуты и обрезаны. Пустая строка — поля нет.
 */
export function normalizeSpokenName(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[’ʼ‘`]/gu, "'")
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Что не так с именем для озвучки (на «ты»: тексты показывает Mini App) или null. Пустое — не
 * ошибка: поле очищают, и табло берёт отображаемое имя. Те же правила — в БД (constraint и RPC).
 */
export function spokenNameError(raw: string): string | null {
  const name = normalizeSpokenName(raw);
  if (name === '') return null;
  if (Array.from(name).length > SPOKEN_NAME_MAX)
    return `Имя для озвучки длиннее ${SPOKEN_NAME_MAX} символов. Сократи его.`;
  if (/[A-Za-z]/u.test(name))
    return 'Латиницу голос не читает. Напиши имя русскими буквами, как оно звучит.';
  if (/\d/u.test(name)) return 'Цифры голос не читает. Напиши их словами.';
  if (!SPOKEN_CHARS_RE.test(name))
    return 'Можно только русские буквы, пробел, дефис, апостроф и знак + перед ударной гласной.';
  if (!LETTER_RE.test(name)) return 'Напиши имя русскими буквами.';
  if (BAD_STRESS_RE.test(name)) return 'Знак + ставится прямо перед ударной гласной: Эрдн+и.';
  return null;
}

/** Игрок глазами голоса: players.display_name и players.spoken_name (миграция 016). */
export interface SpeakablePlayer {
  display_name: string;
  spoken_name?: string | null;
}

/**
 * Как голос называет игрока: spoken_name, если задано; иначе отображаемое имя, если оно целиком
 * кириллическое (буквы, пробел, дефис, апостроф); иначе null — фразы звучат без имени.
 */
export function speakableName(player: SpeakablePlayer): string | null {
  const own = normalizeSpokenName(player.spoken_name ?? '');
  if (own !== '') return spokenNameError(own) === null ? own : null;
  const shown = normalizeSpokenName(player.display_name);
  return shown !== '' &&
    PLAIN_CHARS_RE.test(shown) &&
    LETTER_RE.test(shown) &&
    Array.from(shown).length <= SPOKEN_NAME_MAX
    ? shown
    : null;
}

// --- Фразы ----------------------------------------------------------------------------------

/** Фразы без переменных. */
export const PHRASES = {
  minute: 'Минута до повышения блайндов.',
  rebuysClosed: 'Ребаи закрыты.',
  pause: 'Пауза.',
  resume: 'Продолжаем.',
  /** Нокаут, когда ни жертву, ни выбивших голос назвать не может. */
  knockout: 'Нокаут!',
  /** Финал, когда имя победителя голос назвать не может. */
  gameOver: 'Игра окончена!',
} as const;

/**
 * Куски для сборки фразы, у которой нет целого клипа (сплит из двух и больше выбивших, имя,
 * для которого целую фразу ещё не озвучили). Имена — отдельными клипами (текст = имя).
 */
export const SEGMENTS = {
  victim: 'Нокаут! Вылетает',
  by: 'Выбил',
  byMany: 'Выбили',
  and: 'и',
  winner: 'Победитель вечера —',
} as const;

/** «пять — десять» и «, анте пять», если анте есть. */
export function blindsWords(level: BlindLevel): string {
  const ante = level.ante ?? 0;
  const base = `${numberWords(level.sb)} — ${numberWords(level.bb)}`;
  return ante > 0 ? `${base}, анте ${numberWords(ante)}` : base;
}

/** Старт таймера: «Поехали! Блайнды пять — десять.» */
export function startPhrase(level: BlindLevel): string {
  return `Поехали! Блайнды ${blindsWords(level)}.`;
}

/** Новый уровень: «Новый уровень. Блайнды десять — двадцать.» (+ «, анте …»). */
export function levelPhrase(level: BlindLevel): string {
  return `Новый уровень. Блайнды ${blindsWords(level)}.`;
}

function joinSpoken(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`;
}

/**
 * Нокаут: «Нокаут! Вылетает Эрдни. Выбил Саша.» / «… Выбили Саша и Дима.» / без выбивших —
 * «Нокаут! Вылетает Эрдни.»; без жертвы — «Нокаут! Выбил Саша.»; без всех — «Нокаут!».
 */
export function knockoutPhrase(victim: string | null, killers: readonly string[]): string {
  const parts: string[] = [PHRASES.knockout];
  if (victim) parts.push(`Вылетает ${victim}.`);
  if (killers.length > 0)
    parts.push(`${killers.length === 1 ? SEGMENTS.by : SEGMENTS.byMany} ${joinSpoken(killers)}.`);
  return parts.join(' ');
}

/** Та же фраза кусками: начало, имена отдельно, «и» перед последним выбившим. */
export function knockoutSegments(victim: string | null, killers: readonly string[]): string[] {
  const out: string[] = victim ? [SEGMENTS.victim, victim] : [PHRASES.knockout];
  if (killers.length > 0) {
    out.push(killers.length === 1 ? SEGMENTS.by : SEGMENTS.byMany);
    killers.forEach((name, i) => {
      if (i > 0 && i === killers.length - 1) out.push(SEGMENTS.and);
      out.push(name);
    });
  }
  return out;
}

/** Финал: «Победитель вечера — Женя!»; без имени — «Игра окончена!». */
export function winnerPhrase(name: string | null): string {
  return name ? `${SEGMENTS.winner} ${name}!` : PHRASES.gameOver;
}

// --- Объявления табло -----------------------------------------------------------------------

/** Что табло объявляет голосом (детектор — src/pages/board/announcer.ts). */
export type Announcement =
  | { kind: 'start'; level: BlindLevel }
  | { kind: 'level'; level: BlindLevel }
  | { kind: 'minute' }
  | { kind: 'rebuys_closed' }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'knockout'; victim: PlayerId; by: PlayerId[] }
  | { kind: 'winner'; winner: PlayerId | null };

/** Имя игрока для голоса или null (см. speakableName). */
export type SpokenNameOf = (id: PlayerId) => string | null;

/** Текст уровня или null, если число не прочитать (кривой формат не должен ронять табло). */
function safe(build: () => string): string | null {
  try {
    return build();
  } catch {
    return null;
  }
}

function pushVariant(out: string[][], clips: string[]): void {
  const key = clips.join('\u0000');
  if (!out.some((v) => v.join('\u0000') === key)) out.push(clips);
}

/**
 * Варианты озвучки объявления — от самого полного к запасным; вариант = клипы подряд. Табло
 * играет первый вариант, все клипы которого у него есть: целая фраза, затем она же кусками,
 * затем фразы с меньшим числом имён (имя, которое ещё не озвучено, просто пропадает), в конце —
 * фраза без имён. Пустой список — сказать нечего.
 */
export function announcementVariants(a: Announcement, nameOf: SpokenNameOf): string[][] {
  const out: string[][] = [];
  switch (a.kind) {
    case 'start': {
      const text = safe(() => startPhrase(a.level));
      if (text) out.push([text]);
      return out;
    }
    case 'level': {
      const text = safe(() => levelPhrase(a.level));
      if (text) out.push([text]);
      return out;
    }
    case 'minute':
      return [[PHRASES.minute]];
    case 'rebuys_closed':
      return [[PHRASES.rebuysClosed]];
    case 'pause':
      return [[PHRASES.pause]];
    case 'resume':
      return [[PHRASES.resume]];
    case 'knockout': {
      const victim = nameOf(a.victim);
      const ids = [...new Set(a.by)].filter((id) => id !== a.victim);
      const named = ids.map(nameOf);
      // Выбивших называем всех или никого: «Выбил Саша», когда выбивали двое, — неправда.
      const killers = named.every((n): n is string => n !== null) ? named : [];
      const tiers: [string | null, string[]][] = [[victim, killers]];
      if (victim && killers.length > 0) tiers.push([victim, []]);
      if (victim && killers.length > 0) tiers.push([null, killers]);
      tiers.push([null, []]);
      for (const [v, k] of tiers) {
        pushVariant(out, [knockoutPhrase(v, k)]);
        pushVariant(out, knockoutSegments(v, k));
      }
      return out;
    }
    case 'winner': {
      const name = a.winner ? nameOf(a.winner) : null;
      if (name) {
        pushVariant(out, [winnerPhrase(name)]);
        pushVariant(out, [SEGMENTS.winner, name]);
      }
      pushVariant(out, [PHRASES.gameOver]);
      return out;
    }
  }
}

// --- Какие фразы нужны ----------------------------------------------------------------------

/** Фразы без имён и уровней: всегда в манифесте и в предзагрузке табло. */
export const FIXED_TEXTS: readonly string[] = [
  ...Object.values(PHRASES),
  ...Object.values(SEGMENTS),
];

/** Уровни из формата (jsonb — доверять типам нельзя): только с читаемыми целыми числами. */
export function speakableLevels(format: unknown): BlindLevel[] {
  if (typeof format !== 'object' || format === null) return [];
  const levels = (format as { levels?: unknown }).levels;
  if (!Array.isArray(levels)) return [];
  const ok = (v: unknown) =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= NUMBER_WORDS_MAX;
  const out: BlindLevel[] = [];
  for (const raw of levels as unknown[]) {
    if (typeof raw !== 'object' || raw === null) break;
    const lv = raw as Record<string, unknown>;
    // Сломанный уровень обрывает список: номера следующих уровней уже не совпали бы с replay.
    if (!ok(lv.sb) || !ok(lv.bb) || (lv.ante !== undefined && !ok(lv.ante))) break;
    out.push(raw as BlindLevel);
  }
  return out;
}

/** Фразы уровней формата: старт (уровень 1) и «Новый уровень» для уровней со 2-го. */
export function levelTexts(format: unknown): string[] {
  const levels = speakableLevels(format);
  const first = levels[0];
  if (!first) return [];
  return [startPhrase(first), ...levels.slice(1).map(levelPhrase)];
}

/** Фразы одного игрока: имя куском, вылет без выбивших, нокаут без жертвы, победитель. */
export function playerTexts(name: string): string[] {
  return [name, knockoutPhrase(name, []), knockoutPhrase(null, [name]), winnerPhrase(name)];
}

/** Целые фразы нокаутов для всех упорядоченных пар разных имён (жертва, выбивший). */
export function pairTexts(names: readonly string[]): string[] {
  const unique = [...new Set(names)];
  const out: string[] = [];
  for (const victim of unique)
    for (const killer of unique) if (killer !== victim) out.push(knockoutPhrase(victim, [killer]));
  return out;
}

function uniqueTexts(texts: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of texts) {
    const n = normalizeSpeech(t);
    if (n !== '' && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/** Всё, что табло может сказать на вечере с этим форматом и этими игроками (имена голоса). */
export function eveningVoiceTexts(format: unknown, names: readonly (string | null)[]): string[] {
  const spoken = [...new Set(names.filter((n): n is string => n !== null))];
  return uniqueTexts([
    ...FIXED_TEXTS,
    ...levelTexts(format),
    ...spoken.flatMap(playerTexts),
    ...pairTexts(spoken),
  ]);
}

// --- Манифест для генератора ----------------------------------------------------------------

/** Игрок во входе манифеста — строка private.voice_manifest_input() (миграция 016). */
export interface VoiceManifestPlayer extends SpeakablePlayer {
  id: string;
  is_active?: boolean;
  /** Дата последнего вечера с его входом (ISO) или null: кому достанутся пары нокаутов. */
  last_played_at?: string | null;
}

/** Вход манифеста: результат `select private.voice_manifest_input()`. */
export interface VoiceManifestInput {
  players: VoiceManifestPlayer[];
  /** Конфиги форматов (formats.config неархивных) и снимки evenings.format (announced/live). */
  formats: unknown[];
}

export interface VoiceClipSpec {
  voice: string;
  /** clipHash(text, voice) — первичный ключ voice_clips вместе с voice. */
  hash: string;
  /** Нормализованный текст: ровно его озвучивать и хранить в voice_clips.text. */
  text: string;
}

export interface VoiceManifestOptions {
  /** Целые фразы нокаутов — только для стольких недавних игроков (пар n·(n−1)). */
  pairPlayers?: number;
  /** Предел числа фраз всего: лишнее отбрасывается с пометкой в notes. */
  maxTexts?: number;
  voice?: string;
}

/** 16 игроков — 240 пар; клубу из 4–6 человек с гостями этого с запасом. */
export const MANIFEST_PAIR_PLAYERS = 16;
export const MANIFEST_MAX_TEXTS = 1000;

/** Тексты манифеста и пометки о том, что урезано (генератор пишет их в лог). */
export function voiceManifestTexts(
  input: VoiceManifestInput,
  options: VoiceManifestOptions = {},
): { texts: string[]; notes: string[] } {
  const pairPlayers = options.pairPlayers ?? MANIFEST_PAIR_PLAYERS;
  const maxTexts = options.maxTexts ?? MANIFEST_MAX_TEXTS;
  const notes: string[] = [];

  const formats = Array.isArray(input.formats) ? input.formats : [];
  const levelPhrases: string[] = [];
  formats.forEach((format, i) => {
    const declared = (format as { levels?: unknown } | null)?.levels;
    const total = Array.isArray(declared) ? declared.length : 0;
    const usable = speakableLevels(format).length;
    if (usable < total)
      notes.push(
        `формат №${i + 1}: озвучены ${usable} из ${total} уровней — дальше числа не прочитать`,
      );
    levelPhrases.push(...levelTexts(format));
  });

  // Недавние игроки — первыми: им достаются целые фразы пар, если игроков больше предела.
  const players = (Array.isArray(input.players) ? input.players : [])
    .filter((p) => p.is_active !== false)
    .map((p) => ({ name: speakableName(p), last: p.last_played_at ?? '' }))
    .filter((p): p is { name: string; last: string } => p.name !== null)
    .sort((a, b) =>
      a.last === b.last ? a.name.localeCompare(b.name, 'ru') : a.last < b.last ? 1 : -1,
    );
  const names = [...new Set(players.map((p) => p.name))];
  const paired = names.slice(0, Math.max(0, pairPlayers));
  if (paired.length < names.length)
    notes.push(
      `целые фразы нокаутов — для ${paired.length} недавних игроков из ${names.length}; остальным нокауты собираются кусками`,
    );

  const texts = uniqueTexts([
    ...FIXED_TEXTS,
    ...levelPhrases,
    ...names.flatMap(playerTexts),
    ...pairTexts(paired),
  ]);
  if (texts.length > maxTexts) {
    notes.push(
      `фраз ${texts.length}, предел ${maxTexts}: последние ${texts.length - maxTexts} отброшены`,
    );
    texts.length = maxTexts;
  }
  return { texts, notes };
}

/** Манифест: что должно лежать в voice_clips. Генератор озвучивает только отсутствующие хеши. */
export async function voiceManifest(
  input: VoiceManifestInput,
  options: VoiceManifestOptions = {},
): Promise<{ clips: VoiceClipSpec[]; notes: string[] }> {
  const voice = options.voice ?? VOICE_ID;
  const { texts, notes } = voiceManifestTexts(input, options);
  const clips = await Promise.all(
    texts.map(async (text) => ({ voice, hash: await clipHash(text, voice), text })),
  );
  return { clips, notes };
}
