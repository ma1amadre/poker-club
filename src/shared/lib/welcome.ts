// «Добро пожаловать» — три короткие карточки о том, как устроен клуб: вечер и деньги через банкира,
// очки сезона, прогноз и голосование. Числа — из настроек клуба (очки, «лучшие N») и формата по
// умолчанию (взнос, ребаи, доли призовых), правила — из домена; здесь только текст и память «уже
// показывали» в localStorage. localStorage — удобство: недоступен или бросает — шторка просто покажется
// ещё раз при следующем запуске. На «ты» и без рода.
import { PREDICTION_POINTS } from '@domain/predictions.ts';
import type { ScoringConfig } from '@domain/scoring.ts';
import type { TournamentFormat } from '@domain/types.ts';
import { STAR_MIN_VOTES, VOTE_CATEGORIES, VOTE_CATEGORY_META } from '@domain/votes.ts';
import { formatRub, NBSP } from './format';
import { bestNRule, formatPointsWithUnit, joinNames, scoringRule } from './text';

/** Ключ localStorage: шторку уже показывали на этом устройстве. */
export const WELCOME_STORAGE_KEY = 'poker-club:welcome-seen';

type ReadStorage = Pick<Storage, 'getItem'>;
type WriteStorage = Pick<Storage, 'setItem'>;

/** Хранилище окна или null: в приватном режиме и в некоторых WebView само обращение бросает. */
export function safeLocalStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Видел ли человек шторку на этом устройстве. Хранилища нет или оно бросает — «не видел». */
export function welcomeSeen(storage: ReadStorage | null): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(WELCOME_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Запомнить, что шторку показали; ошибка хранилища — молча (покажется ещё раз — не беда). */
export function markWelcomeSeen(storage: WriteStorage | null): void {
  if (!storage) return;
  try {
    storage.setItem(WELCOME_STORAGE_KEY, '1');
  } catch {
    // память «показывали» — только удобство
  }
}

// --- Открыть шторку из любого экрана («Как всё устроено» на своей карточке) --------------------

const listeners = new Set<() => void>();

/** Попросить шторку: её держит раскладка приложения (WelcomeHost), экран только зовёт. */
export function requestWelcome(): void {
  for (const listener of listeners) listener();
}

/** Подписка хозяина шторки на просьбы; возвращает отписку. */
export function onWelcomeRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// --- Текст карточек ------------------------------------------------------------------------------

export type WelcomeCardId = 'evening' | 'season' | 'predict';

export interface WelcomeCard {
  id: WelcomeCardId;
  title: string;
  lines: string[];
}

export interface WelcomeInput {
  /** Формат клуба по умолчанию; не задан — без сумм и долей. */
  format: Pick<
    TournamentFormat,
    'buyInRub' | 'payoutPct' | 'payoutStepRub' | 'rebuyUntilLevel' | 'rebuyLimit'
  > | null;
  /** Правила очков из настроек клуба (по ним посчитают следующие вечера). */
  scoring: ScoringConfig;
  /** «Лучшие N» текущего сезона. */
  bestN: number;
}

/** Места словами: «2-е» на узком экране рвалось по дефису («2-» / «е»). */
const PLACE_WORDS = [
  'первое',
  'второе',
  'третье',
  'четвёртое',
  'пятое',
  'шестое',
  'седьмое',
  'восьмое',
  'девятое',
  'десятое',
] as const;

/** «первое — 70 %, второе — 30 %»; дальше десятого — цифрами. */
function payoutText(pct: readonly number[]): string {
  return pct.map((p, i) => `${PLACE_WORDS[i] ?? `${i + 1}-е`}${NBSP}— ${p}${NBSP}%`).join(', ');
}

/**
 * Вход и ребаи формата: «Вход — 500 ₽, можно другой суммой; ребай — так же, до конца 5-го уровня»
 * (+ «, не больше 2 на игрока» при лимите). Сумма входа — любая (миграция 027), в формате — сумма
 * по умолчанию. Не «от 500 ₽»: меньше суммы формата — тоже можно.
 */
function entryText(format: NonNullable<WelcomeInput['format']>): string {
  const entry = `Вход${NBSP}— ${formatRub(format.buyInRub)}, можно другой суммой`;
  if (format.rebuyLimit === 0) return entry;
  const limit =
    format.rebuyLimit === null ? '' : `, не больше ${format.rebuyLimit} на${NBSP}игрока`;
  return `${entry}; ребай — так же, до конца ${format.rebuyUntilLevel}-го уровня${limit}`;
}

/** «Призовые — вниз до 100 ₽, остаток — первому месту»; шаг в рубль — без оговорки. */
function stepText(format: NonNullable<WelcomeInput['format']>): string {
  const step = format.payoutStepRub ?? 1;
  return step > 1 ? ` Призовые — вниз до ${formatRub(step)}, остаток — первому месту.` : '';
}

/** Три карточки шторки по порядку: вечер и деньги, очки сезона, прогноз и голосование. */
export function welcomeCards(input: WelcomeInput): WelcomeCard[] {
  const { format } = input;
  const evening: string[] = [
    'Вечер ведёт банкир: сажает за стол, отмечает вылеты и ребаи. Всё видно в приложении и на табло.',
  ];
  if (format) {
    evening.push(`${entryText(format)}.`);
    evening.push(
      format.payoutPct.length > 0
        ? `Весь взнос идёт в призовой фонд, его делят призовые места: ${payoutText(format.payoutPct)}.${stepText(format)}`
        : `Весь взнос идёт в призовой фонд, его делят призовые места.${stepText(format)}`,
    );
  } else {
    evening.push(
      'Весь взнос — вход и каждый ребай — идёт в призовой фонд, его делят призовые места.',
    );
  }
  evening.push(
    'Деньги идут через банкира: после игры экран «Расчёт» покажет, кто переводит банкиру и кому переводит банкир.',
  );

  const season = [
    'Сезон — квартал. Таблица сезона — во вкладке «Рейтинг».',
    `${scoringRule(input.scoring)}.`,
    `${bestNRule(input.bestN)}.`,
    'Первое место сезона — чемпион: итоги подводим в первый день нового квартала.',
  ];

  // «рука, блеф и бэд-бит вечера» — названия номинаций домена без общего «вечера».
  const categories = joinNames(
    VOTE_CATEGORIES.map((c) => VOTE_CATEGORY_META[c].title.replace(/ вечера$/, '').toLowerCase()),
  );
  const predict = [
    `До старта таймера сделай прогноз: угаданный победитель — ${formatPointsWithUnit(PREDICTION_POINTS.winner)}, первый вылет — ${formatPointsWithUnit(PREDICTION_POINTS.firstOut)}.`,
    'Очки прогнозов — отдельная таблица «Оракул», в очки сезона они не идут.',
    `После игры сутки идёт голосование: ${categories} вечера.`,
    `Единственный лидер номинации — от ${STAR_MIN_VOTES}${NBSP}голосов — получает «Звезду вечера».`,
  ];

  return [
    { id: 'evening', title: 'Вечер и деньги', lines: evening },
    { id: 'season', title: 'Очки сезона', lines: season },
    { id: 'predict', title: 'Прогноз и голосование', lines: predict },
  ];
}
