import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../lib/cn';
import { ChevronRightIcon } from './icons';

export interface ListProps {
  /** Без подложки — для списков внутри Card или Sheet. */
  plain?: boolean;
  className?: string;
  children?: ReactNode;
  'aria-label'?: string;
}

export function List({ plain, className, children, ...rest }: ListProps) {
  return (
    <ul className={cn('ui-list', plain && 'ui-list--plain', className)} {...rest}>
      {children}
    </ul>
  );
}

export interface ListItemProps {
  /** Слева: аватар, иконка, место. */
  before?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Справа: значение, бейдж, переключатель. */
  after?: ReactNode;
  /** Ссылка внутри приложения (маршрут HashRouter). */
  to?: string;
  onClick?: () => void;
  /** Стрелка «перейти»; по умолчанию — у ссылок. */
  chevron?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * Строка списка. Становится ссылкой (to), кнопкой (onClick) или просто строкой — так у каждой
 * интерактивной строки правильная семантика и тач-цель не меньше 44px.
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
      {(chevron ?? Boolean(to)) && <ChevronRightIcon className="ui-list-item__chevron" size={20} />}
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
  return (
    <li className={cn('ui-list-row', before !== undefined && 'ui-list-row--with-before')}>
      {inner}
    </li>
  );
}
