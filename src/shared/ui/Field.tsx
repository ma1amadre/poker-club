import { useId, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Icon } from './Icon';

export interface FieldGroupProps {
  /** Подпись над группой (legend) — всегда видна. */
  label: ReactNode;
  hint?: ReactNode;
  /** Что не так и как исправить: «Выбери хотя бы одного игрока». */
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * Подпись, подсказка и ошибка вокруг составного контрола (PlayerPicker, ряд кнопок) — в анатомии
 * Field «Материи». Для обычного ввода — Field, для выбора из списка — Select.
 */
export function FieldGroup({ label, hint, error, className, children }: FieldGroupProps) {
  const id = useId();
  const message = error || hint;
  const messageId = message ? `${id}-msg` : undefined;
  return (
    <fieldset
      className={cn('m-field', 'ui-fieldgroup', Boolean(error) && 'm-field--error', className)}
      aria-describedby={messageId}
      aria-invalid={error ? true : undefined}
    >
      <legend className="m-field-label">{label}</legend>
      {children}
      {message && (
        <p id={messageId} className="m-field-msg" role={error ? 'alert' : undefined}>
          {error && <Icon name="alert-circle" size={14} />}
          <span>{message}</span>
        </p>
      )}
    </fieldset>
  );
}
