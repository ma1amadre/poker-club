import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Одно поле ввода: input / select / textarea. id и aria-describedby проставляются сами. */
  children: ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>;
}

/** Подпись, подсказка и ошибка для поля формы (админка, имя игрока, подпись к голосу). */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id: children.props.id ?? id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })
    : children;

  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={children.props.id ?? id}>
        {label}
      </label>
      {control}
      {hint && (
        <span id={hintId} className="ui-field__hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className="ui-field__error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
