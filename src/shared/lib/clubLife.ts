// «Жизнь клуба»: подписи ачивок и рекордов, общие для ленты «В клубе», «Твоего вечера», вкладки
// «Рекорды» и карточки игрока. Ничего не считает — рекорды и ачивки считает домен.
import type { AchievementCode } from '@domain/achievements.ts';
import { RECORD_META, type RecordKind } from '@domain/records.ts';
import { formatDuration, formatRub, formatRubSigned, NBSP, plural } from './format';

/**
 * Короткое описание ачивки без рода: в ленте оно стоит рядом с чужим именем, а описания домена
 * («Угадал победителя…») — в мужском роде.
 */
export const ACHIEVEMENT_SHORT: Record<AchievementCode, string> = {
  first_blood: 'первый нокаут в истории клуба',
  hunter: '3 и больше нокаутов за вечер',
  comeback: 'победа после 2 и больше ребаев',
  rebuy_king: 'больше всех ребаев за сезон',
  iron_chair: 'ни одного пропущенного вечера за сезон',
  hat_trick: 'три победы подряд',
  sworn_enemy: '5 нокаутов одного и того же игрока',
  oracle: 'победитель угадан в трёх вечерах подряд',
  star: 'победа в номинации голосования',
  champion: '1-е место по итогам сезона',
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
