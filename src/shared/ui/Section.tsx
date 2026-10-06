import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { MateriaCard, type MateriaCardProps } from './materia';

export interface SectionProps {
  title?: ReactNode;
  /** Справа от заголовка: счётчик, ссылка «Все». */
  aside?: ReactNode;
  /** Пояснение под блоком (m-small). */
  footer?: ReactNode;
  /** Уровень заголовка; по умолчанию h2 (h1 — заголовок экрана в Page). */
  headingLevel?: 'h2' | 'h3';
  className?: string;
  children?: ReactNode;
}

/**
 * Группа на экране: заголовок m-h3, содержимое (List, Card, Stats), пояснение m-small.
 * Между группами — space-6 (задаёт Page).
 */
export function Section({
  title,
  aside,
  footer,
  headingLevel: Heading = 'h2',
  className,
  children,
}: SectionProps) {
  return (
    <section className={cn('ui-section', className)}>
      {(title || aside) && (
        <div className="ui-section__head">
          {title && <Heading className="m-h3 ui-section__title">{title}</Heading>}
          {aside && <span className="m-small ui-section__aside">{aside}</span>}
        </div>
      )}
      {children}
      {footer && <p className="m-small ui-section__footer">{footer}</p>}
    </section>
  );
}

export interface CardProps extends MateriaCardProps {
  /** false — без внутренних отступов: для List plain и таблиц внутри карточки. */
  padded?: boolean;
  /** Маршрут приложения — вся карточка становится ссылкой (подъём на 2 px при наведении). */
  to?: string;
}

/**
 * Card «Материи»: отдельный объект (вечер, игрок, итог). Однородный список — не карточки, а List.
 * variant: outline (по умолчанию), raised — кликабельная или на сложном фоне, sunken — справка.
 * Внутри одна иерархия: m-eyebrow → m-h3 → m-small.
 */
export function Card({ padded = true, to, href, className, ...rest }: CardProps) {
  return (
    <MateriaCard
      {...rest}
      // HashRouter: ссылка на маршрут — «#/путь», переход без перезагрузки.
      href={to ? `#${to}` : href}
      className={cn(!padded && 'ui-card--flush', className)}
    />
  );
}
