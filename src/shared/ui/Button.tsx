import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'plain';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Показать спиннер и заблокировать повторное нажатие (идёт запрос). */
  loading?: boolean;
  /** На всю ширину контейнера. */
  block?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  block = false,
  icon,
  className,
  disabled,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      // type="button" по умолчанию: кнопка внутри формы не должна неожиданно её отправлять.
      type={type}
      className={cn(
        'ui-button',
        `ui-button--${variant}`,
        size !== 'md' && `ui-button--${size}`,
        block && 'ui-button--block',
        loading && 'ui-button--loading',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && (
        <span className="ui-button__spinner">
          <Spinner size={size === 'sm' ? 16 : 20} />
        </span>
      )}
      {icon}
      <span className={cn(loading && 'ui-button__label--hidden')}>{children}</span>
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Обязательная подпись: у кнопки без текста её читает только скринридер. */
  label: string;
  filled?: boolean;
  children: ReactNode;
}

export function IconButton({
  label,
  filled = false,
  className,
  children,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn('ui-icon-button', filled && 'ui-icon-button--filled', className)}
      {...rest}
    >
      {children}
    </button>
  );
}
