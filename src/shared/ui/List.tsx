import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../lib/cn';
import { Icon } from './Icon';

export interface ListProps {
  /** Без рамки и подложки — для списков внутри Card или Sheet. */
  plain?: boolean;
  className?: string;
  children?: ReactNode;
  'aria-label'?: string;
}

/**
 * Однородный список (игроки, вечера, события журнала) — по «Материи» это строки с разделителем
 * line, а не карточки. По умолчанию — одна панель surface с рамкой line, как у DataTable.
 */
export function List({ plain, className, children, ...rest }: ListProps) {
  return (
    <ul className={cn('ui-list', plain && 'ui-list--plain', className)} {...rest}>
      {children}
    </ul>
  );
}

export interface ListItemProps {
  /** Слева: Avatar, Icon, место. */
  before?: ReactNode;
  title: ReactNode;
  /** Вторая строка m-small: «2 ребая · вылетел на 4-м уровне». */
  subtitle?: ReactNode;
  /** Справа: Amount, Badge, Switch, число (m-mono). */
  after?: ReactNode;
  /** Маршрут приложения (HashRouter) — строка становится ссылкой. */
  to?: string;
  onClick?: () => void;
  /** Шеврон «перейти»; по умолчанию — у ссылок. */
  chevron?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * Строка списка. Становится ссылкой (to), кнопкой (onClick) или просто строкой — у каждой
 * интерактивной строки правильная семантика и тач-цель не ниже 48 px. Наведение — surface-sunken,
 * как у строки таблицы «Материи».
 */
export function ListItem({
  before,
  title,
  subtitle,
  after,
  to,
  onClick,
  chevron,
  disabled,
  className,
}: ListItemProps) {
  const interactive = Boolean(to || onClick) && !disabled;
  const classes = cn(
    'ui-list-item',
    interactive && 'ui-list-item--interactive',
    disabled && 'ui-list-item--disabled',
    className,
  );
  const content = (
    <>
      {before !== undefined && <span className="ui-list-item__before">{before}</span>}
      <span className="ui-list-item__body">
        <span className="ui-list-item__title">{title}</span>
        {subtitle && <span className="ui-list-item__subtitle">{subtitle}</span>}
      </span>
      {after !== undefined && <span className="ui-list-item__after">{after}</span>}
      {(chevron ?? Boolean(to)) && (
        <Icon name="chevron-right" size={20} className="ui-list-item__chevron" />
      )}
    </>
  );

  let inner: ReactNode;
  if (to && !disabled) {
    inner = (
      <Link to={to} className={classes}>
        {content}
      </Link>
    );
  } else if (onClick) {
    inner = (
      <button type="button" className={classes} onClick={onClick} disabled={disabled}>
        {content}
      </button>
    );
  } else {
    inner = <div className={classes}>{content}</div>;
  }
  return <li className="ui-list-row">{inner}</li>;
}
