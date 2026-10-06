import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../lib/cn';
import { Icon, type IconName } from './Icon';
import { Spinner } from './materia';

// Кнопка — анатомия Button «Материи» (классы m-btn, m-btn--{variant}, m-btn--{size}: «Без React
// компоненты собираются классами»). Свой JSX, а не <Button> из бандла, потому что клубу нужны
// loading, block, кнопка-ссылка роутера и иконки из расширенного набора Icon.
//
// Правила «Материи»: одна primary на экран, остальные — secondary или ghost; подпись — глагол +
// объект («Отметить вылет», «Записать ребай»), не «ОК». Высота: sm 32, md — высота контрола
// регистра (на тач-экранах 48, см. base.css), lg 48.

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface CommonProps {
  /** primary — главное действие экрана (одно!), secondary — по умолчанию, ghost — третьестепенное,
   *  danger — необратимое действие (контур и текст critical). */
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  /** Иконка после подписи; arrow-right — только когда действие ведёт дальше. */
  iconAfter?: IconName;
  /** На всю ширину контейнера (кнопки пульта, шторки). */
  block?: boolean;
}

function buttonClass(
  { variant = 'secondary', size = 'md', block }: CommonProps,
  extra?: string | false,
  className?: string,
): string {
  return cn(
    'm-btn',
    `m-btn--${variant === 'danger' ? 'secondary' : variant}`,
    `m-btn--${size}`,
    variant === 'danger' && 'ui-btn--danger',
    block && 'ui-btn--block',
    extra,
    className,
  );
}

function Content({ icon, iconAfter, size, children }: CommonProps & { children?: ReactNode }) {
  const iconSize = size === 'lg' ? 18 : 16;
  return (
    <>
      {icon && <Icon name={icon} size={iconSize} />}
      {children != null && children !== false && <span className="m-btn-label">{children}</span>}
      {iconAfter && <Icon name={iconAfter} size={iconSize} className="m-btn-after" />}
    </>
  );
}

export interface ButtonProps
  extends CommonProps, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  /** Идёт запрос: спиннер вместо подписи (ширина не прыгает), повторное нажатие заблокировано. */
  loading?: boolean;
  type?: 'button' | 'submit' | 'reset';
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant,
  size,
  icon,
  iconAfter,
  block,
  loading = false,
  className,
  disabled,
  children,
  // type="button" по умолчанию: кнопка внутри формы не должна неожиданно её отправлять.
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass({ variant, size, block }, loading && 'ui-btn--loading', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && (
        <span className="ui-btn__spinner" aria-hidden="true">
          <Spinner size={size === 'lg' ? 18 : 16} />
        </span>
      )}
      <Content icon={icon} iconAfter={iconAfter} size={size}>
        {children}
      </Content>
    </button>
  );
}

export interface ButtonLinkProps extends CommonProps {
  /** Маршрут приложения (HashRouter): paths.evening(id) и т. п. */
  to: string;
  replace?: boolean;
  className?: string;
  children?: ReactNode;
}

/** Переход на экран, оформленный кнопкой: «Открыть вечер», «Смотреть рейтинг». */
export function ButtonLink({
  to,
  replace,
  className,
  children,
  icon,
  iconAfter,
  ...common
}: ButtonLinkProps) {
  return (
    <Link to={to} replace={replace} className={buttonClass(common, false, className)}>
      <Content icon={icon} iconAfter={iconAfter} size={common.size}>
        {children}
      </Content>
    </Link>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  /** Обязательная подпись: у кнопки без текста её читает только скринридер (и title). */
  label: string;
  icon: IconName;
  variant?: Exclude<ButtonVariant, 'danger'>;
  size?: ButtonSize;
  type?: 'button' | 'submit' | 'reset';
  ref?: Ref<HTMLButtonElement>;
}

/** Квадратная кнопка-иконка «Материи» (m-btn--icon): «Назад», «Закрыть», «Ещё». По умолчанию ghost. */
export function IconButton({
  label,
  icon,
  variant = 'ghost',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn('m-btn', `m-btn--${variant}`, `m-btn--${size}`, 'm-btn--icon', className)}
      {...rest}
    >
      <Icon name={icon} size={size === 'sm' ? 16 : 20} />
    </button>
  );
}
