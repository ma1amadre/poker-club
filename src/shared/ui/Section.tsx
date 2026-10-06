import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface SectionProps {
  title?: ReactNode;
  /** Справа от заголовка: счётчик, ссылка «Все». */
  aside?: ReactNode;
  /** Пояснение под блоком. */
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/** Группа на странице: заголовок капсом, содержимое (обычно List или Card), пояснение. */
export function Section({ title, aside, footer, className, children }: SectionProps) {
  return (
    <section className={cn('ui-section', className)}>
      {(title || aside) && (
        <div className="ui-section__header">
          {title && <h2 className="ui-section__title">{title}</h2>}
          {aside && <span className="ui-section__aside">{aside}</span>}
        </div>
      )}
      {children}
      {footer && <div className="ui-section__footer">{footer}</div>}
    </section>
  );
}

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Внутренний отступ 16px; false — для вложенных списков и таблиц. */
  padded?: boolean;
}

/** Плашка на фоне секции. */
export function Card({ padded = true, className, children, ...rest }: CardProps) {
  return (
    <div className={cn('ui-card', padded && 'ui-card--padded', className)} {...rest}>
      {children}
    </div>
  );
}
