// Подписи, общие для экранов: склонения, места, правило подсчёта очков, имена, мелкий набор.
// Голос «Материи»: десятичная запятая, неразрывный пробел между числом и словом, тире с пробелами.
import type { ScoringConfig } from '@domain/scoring.ts';
import { CLUB_TZ, formatNumber, formatPoints, NBSP, plural } from './format';

/** Слово к очкам: 1 очко, 2 очка, 5 очков; дробные — «4,5 очка» (родительный ед. ч.). */
export function pointsWord(points: number): string {
  if (!Number.isInteger(points)) return 'очка';
  return plural(points, ['очко', 'очка', 'очков']);
}

/** «7 очков», «4,5 очка», «−1 очко». */
export function formatPointsWithUnit(points: number): string {
  return `${formatPoints(points)}${NBSP}${pointsWord(points)}`;
}

/** «12 вечеров». */
export function eveningsCount(n: number): string {
  return `${n}${NBSP}${plural(n, ['вечер', 'вечера', 'вечеров'])}`;
}

/** «2 победы». */
export function winsCount(n: number): string {
  return `${n}${NBSP}${plural(n, ['победа', 'победы', 'побед'])}`;
}

/** «3 нокаута». */
export function kosCount(n: number): string {
  return `${n}${NBSP}${plural(n, ['нокаут', 'нокаута', 'нокаутов'])}`;
}

/** «5 игроков». */
export function playersCount(n: number): string {
  return `${n}${NBSP}${plural(n, ['игрок', 'игрока', 'игроков'])}`;
}

/** «1-е место из 5»; без места — «место не определено». */
export function placeLabel(place: number | null, entrants: number): string {
  if (place === null) return 'место не определено';
  return `${place}-е место из${NBSP}${entrants}`;
}

/** Строка сыгранного: «6 вечеров · 2 победы · 4 нокаута». */
export function standingMeta(row: { played: number; wins: number; kos: number }): string {
  return [eveningsCount(row.played), winsCount(row.wins), kosCount(row.kos)].join(' · ');
}

/**
 * Правило подсчёта одной строкой — из настроек клуба, а не из головы:
 * «Очки за вечер: +1 за каждого, кто вылетел раньше, +0,5 за нокаут, +1 за победу».
 */
export function scoringRule(cfg: ScoringConfig): string {
  return (
    `Очки за вечер: +1 за каждого, кто вылетел раньше, ` +
    `+${formatPoints(cfg.koPoints)} за нокаут, +${formatPoints(cfg.winBonus)} за победу`
  );
}

/**
 * Правило очков для набора вечеров (таблица сезона, всё время). У каждого вечера свой снимок правил
 * (evenings.scoring): если он у всех один — точная формулировка по нему, если разные — общая.
 * Вечеров нет — по текущим настройкам `current`: по ним посчитают следующие вечера.
 */
export function scoringRuleOf(rules: readonly ScoringConfig[], current: ScoringConfig): string {
  const [first] = rules;
  if (!first) return scoringRule(current);
  const same = rules.every((r) => r.koPoints === first.koPoints && r.winBonus === first.winBonus);
  return same
    ? scoringRule(first)
    : 'Очки за вечер: +1 за каждого, кто вылетел раньше, плюс очки за нокауты и победу — ' +
        'по правилам, которые действовали, когда вечер завершился';
}

/** «В зачёт сезона идут лучшие 10 вечеров игрока». */
export function bestNRule(bestN: number): string {
  return `В зачёт сезона идут лучшие ${bestN} ${plural(bestN, ['вечер', 'вечера', 'вечеров'])} игрока`;
}

/** Что из сыгранного в зачёте: «В зачёте все 3 вечера» или «В зачёте лучшие 10 из 12». */
export function countedSummary(counted: number, played: number): string {
  if (played === 0) return 'Вечеров в сезоне ещё не было';
  if (counted >= played) {
    return played === 1 ? 'Единственный вечер в зачёте' : `В зачёте все ${eveningsCount(played)}`;
  }
  return `В зачёте лучшие ${counted} из${NBSP}${played}`;
}

const shortDate = new Intl.DateTimeFormat('ru-RU', {
  timeZone: CLUB_TZ,
  day: 'numeric',
  month: 'short',
});

/** «1 окт.» по Москве — подписи оси графика и плотных строк. */
export function formatShortDate(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return shortDate.format(date);
}

// --- Мелкий набор ----------------------------------------------------------------------------

/**
 * «· игра 2» — после даты у второй и следующих игр одного дня (evenings.game_no, миграция 026): там,
 * где вечер отличают только по дате (шапка экрана, история, лента, табло). У игры 1 — пусто.
 */
export function gameSuffix(gameNo: number | null | undefined): string {
  return typeof gameNo === 'number' && gameNo > 1 ? ` · игра${NBSP}${gameNo}` : '';
}

/** Заглавная только в начале: «четверг, 8 октября» → «Четверг, 8 октября». */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Число не отрывается от следующего слова: «8 октября», «3 очка» — через неразрывный пробел. */
export function keepNumbersTogether(text: string): string {
  return text.replace(/(\d) (?=\p{L})/gu, '$1 ');
}

/** Знак перед числом для метрик без цвета: «+260», «−300», «0» (минус типографский). */
export function signedNumber(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${formatNumber(rounded)}` : formatNumber(rounded);
}

/** Имена через запятую с «и» перед последним: «Дима», «Дима и Женя», «Дима, Женя и Саша». */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`;
}

// --- Имена игроков ---------------------------------------------------------------------------

/** Предел имени: 1–40 символов, как у set_my_name и add_guest. */
export const NAME_MAX = 40;

/** Имя так, как его сохранит сервер (set_my_name, add_guest): пробелы схлопнуты и обрезаны. */
export function normalizeName(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Имя для сравнения: регистр, «ё»/«е», лишние пробелы и пометка в скобках в конце («Вова (гость)»)
 * не важны. Пусто — сравнивать не с чем. Подсказка «такой гость уже есть» за столом и порядок дублей
 * в слиянии гостей (админка «Игроки»).
 */
export function nameMatchKey(name: string): string {
  return normalizeName(name)
    .replace(/\s*\([^()]*\)$/, '')
    .toLowerCase()
    .replace(/ё/g, 'е');
}

// --- Болельщик (players.is_spectator, миграция 024) ---------------------------------------------

/** Что значит «болельщик» — одна строка на вопрос на главной, свою карточку и админку. */
export const SPECTATOR_NOTE =
  'Болельщик видит всё и делает прогнозы, но в «Без ответа» его нет и бот не зовёт его на каждую игру.';

/** Флаг перекрывается на вечер (spectatesEvening домена) — о себе, на «ты». */
export const SPECTATOR_EVENING_NOTE_SELF =
  'Ответишь «Иду» или сядешь за стол — в этот вечер ты в игре.';

/** То же о другом игроке (админка). */
export const SPECTATOR_EVENING_NOTE = 'Ответит «Иду» или сядет за стол — в этот вечер он игрок.';

/** Подсказка под «Твой ответ» у болельщика без ответа: отвечать не обязательно. */
export const SPECTATOR_RSVP_HINT =
  'Ты болельщик — отвечать не обязательно. Соберёшься сыграть — отметь «Иду».';

/**
 * Тост болельщику после «Иду»: на этот вечер он игрок (флаг сам не меняется), а играть постоянно —
 * одной кнопкой (set_my_spectator(false)).
 */
export const SPECTATOR_YES_TOAST = {
  title: 'На этот вечер ты в игре',
  detail: 'В другие вечера ты по-прежнему болельщик.',
  action: 'Стать игроком',
} as const;
