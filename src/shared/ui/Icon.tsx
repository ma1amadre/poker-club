import { createElement } from 'react';
import { cn } from '../lib/cn';
import { EXTRA, isExtra, type IconName, type Shape } from './icons';
import { MateriaIcon } from './materia';

export type { ExtraIconName, IconName } from './icons';

// Анатомия та же, что у Icon «Материи»: сетка 24, контур currentColor, скруглённые концы, класс
// m-icon — толщину задаёт регистр (--m-icon-stroke). Имена: MateriaIconName + ExtraIconName.

export interface IconProps {
  name: IconName;
  /** 16 — в тексте и кнопках, 20 — в списках и навигации, 24 — максимум. */
  size?: number;
  /** Только для иконки без подписи рядом: тогда она объявляется скринридеру. */
  label?: string;
  className?: string;
}

/** Контурная иконка, цвет — currentColor. Без label скрыта от скринридеров. */
export function Icon({ name, size = 16, label, className }: IconProps) {
  if (!isExtra(name))
    return <MateriaIcon name={name} size={size} label={label} className={className} />;
  const shapes: readonly Shape[] = EXTRA[name];
  return (
    <svg
      className={cn('m-icon', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {shapes.map(([tag, attrs], index) => createElement(tag, { key: index, ...attrs }))}
    </svg>
  );
}
