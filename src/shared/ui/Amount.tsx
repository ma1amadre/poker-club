import { formatRub, formatRubSigned } from '../lib/format';
import { cn } from '../lib/cn';
import { Icon } from './Icon';

export interface AmountProps {
  /** Сумма в рублях: + выигрыш / получить, − долг / заплатить. */
  value: number;
  /** Знак «+» у положительных (по умолчанию). «−» у отрицательных есть всегда. */
  signed?: boolean;
  /** Иконка тренда рядом со знаком — для итогов, где важно считать направление взглядом. */
  icon?: boolean;
  className?: string;
}

/**
 * Деньги со знаком: «+1 500 ₽» positive, «−300 ₽» critical, «0 ₽» обычным цветом. Табличные цифры
 * (m-mono). Цвет не единственный носитель смысла: знак есть всегда, по желанию — иконка.
 */
export function Amount({ value, signed = true, icon = false, className }: AmountProps) {
  const rounded = Math.round(value);
  const tone = rounded > 0 ? 'positive' : rounded < 0 ? 'critical' : 'neutral';
  return (
    <span className={cn('m-mono', 'ui-amount', `ui-amount--${tone}`, className)}>
      {icon && tone !== 'neutral' && (
        <Icon name={tone === 'positive' ? 'trending-up' : 'trending-down'} size={14} />
      )}
      {signed ? formatRubSigned(rounded) : formatRub(rounded)}
    </span>
  );
}
