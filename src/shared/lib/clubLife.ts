// «Жизнь клуба»: подписи ачивок и рекордов, общие для ленты «В клубе», «Твоего вечера», вкладки
// «Рекорды» и карточки игрока. Ничего не считает — рекорды и ачивки считает домен.
import {
  achievementLevelText,
  achievementTitle,
  isLeveled,
  type AchievementCode,
} from '@domain/achievements.ts';
import { RECORD_META, type RecordKind } from '@domain/records.ts';
import { formatDuration, formatRub, formatRubSigned, NBSP, plural } from './format';

/**
 * Короткое описание ачивки без рода и со строчной — для строк ленты и «Твоего вечера» рядом с чужим
 * именем. У уровневых — общее правило; что дал конкретный уровень — achievementShort.
 */
export const ACHIEVEMENT_SHORT: Record<AchievementCode, string> = {
  first_blood: 'первый нокаут в истории клуба',
  hunter: 'нокауты за вечер: 3, 4 и 5',
  comeback: 'победа после 2 и больше ребаев',
  phoenix: 'первый вылет вечера — и всё равно победа',
  clean_win: 'победа без единого ребая',
  rebuy_king: 'больше всех ребаев за сезон',
  iron_chair: 'ни одного пропущенного игрового дня за сезон',
  hat_trick: 'три победы подряд',
  sworn_enemy: 'нокауты одного и того же игрока: 5, 10 и 15',
  revenge: 'нокаут своей Немезиды',
  king_hunt: 'нокаут действующего чемпиона сезона',
  oracle: 'победитель угадан в трёх вечерах подряд',
  star: 'единоличная победа в номинации голосования',
  champion: '1-е место по итогам сезона',
};

/** Выдача ачивки — что нужно подписям: код, уровень выдачи и впервые ли он взят. */
export interface AchievementGrant {
  code: AchievementCode;
  level: number;
  first: boolean;
}

/**
 * Что дала выдача ачивки: у уровневых — правило её уровня («4 нокаута за вечер»), у остальных —
 * ACHIEVEMENT_SHORT. «Звезду вечера» дают за каждую звезду, а уровень растёт по их числу: порог
 * («от 5 звёзд вечера») — только когда уровень взят впервые от II, иначе — за что звезда.
 */
export function achievementShort(a: AchievementGrant): string {
  if (a.code === 'star' && !isNewLevel(a)) return ACHIEVEMENT_SHORT.star;
  return isLeveled(a.code) && a.level >= 1
    ? achievementLevelText(a.code, a.level)
    : ACHIEVEMENT_SHORT[a.code];
}

/** Пометка «новый уровень» — только уровни от II, взятые впервые (уровень I — и так новая ачивка). */
export function isNewLevel(a: AchievementGrant): boolean {
  return isLeveled(a.code) && a.first && a.level >= 2;
}

/**
 * Пометка момента голосования, давшего «Звезду вечера»: «звезда вечера»; уровень от II, взятый
 * впервые, — «новый уровень «Звезда вечера II»».
 */
export function starNote(star: { level: number; first: boolean }): string {
  return isNewLevel({ code: 'star', ...star })
    ? `новый уровень «${achievementTitle('star', star.level)}»`
    : 'звезда вечера';
}

/** О ком ачивка (targetId): «Немезида — Дима». */
export const ACHIEVEMENT_TARGET_ROLE: Partial<Record<AchievementCode, string>> = {
  sworn_enemy: 'соперник',
  revenge: 'Немезида',
  king_hunt: 'чемпион',
};

/** «Крупнейший выигрыш…» → «крупнейший выигрыш…». */
export function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

export interface RecordValueParts {
  /** Число: «+2 300 ₽», «4», «3 ч 20 мин». */
  value: string;
  /** Слово после числа: «нокаута», «победы подряд»; null — единица уже в числе. */
  unit: string | null;
}

/**
 * Значение рекорда по его виду — один форматтер на все экраны. Выигрыш — нетто игрока за вечер:
 * со знаком, как нетто во всём приложении; фонд — без знака; длина игры — часы и минуты.
 */
export function recordValueParts(kind: RecordKind, value: number): RecordValueParts {
  switch (kind) {
    case 'biggest_win':
      return { value: formatRubSigned(value), unit: null };
    case 'biggest_pool':
      return { value: formatRub(value), unit: null };
    case 'longest_game':
      return { value: formatDuration(value), unit: null };
    case 'most_kos':
      return { value: String(value), unit: plural(value, ['нокаут', 'нокаута', 'нокаутов']) };
    case 'win_streak':
      return {
        value: String(value),
        unit: `${plural(value, ['победа', 'победы', 'побед'])} подряд`,
      };
  }
}

/** Значение рекорда одной строкой: «+2 300 ₽», «4 нокаута», «3 победы подряд», «4 ч 10 мин». */
export function recordValueText(kind: RecordKind, value: number): string {
  const { value: number, unit } = recordValueParts(kind, value);
  return unit ? `${number}${NBSP}${unit}` : number;
}

/** Название рекорда со строчной — для «Новый рекорд: крупнейший выигрыш за вечер». */
export function recordTitleLower(kind: RecordKind): string {
  return lowerFirst(RECORD_META[kind].title);
}
