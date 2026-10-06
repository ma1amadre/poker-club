import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export interface BadgeProps {
  tone?: Tone;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Короткая метка статуса: «Банкир», «Должен 500 ₽», «Гость», «Идёт игра». */
export function Badge({ tone = 'neutral', icon, className, children }: BadgeProps) {
  return (
    <span className={cn('ui-badge', `ui-badge--${tone}`, className)}>
      {icon}
      {children}
    </span>
  );
}
