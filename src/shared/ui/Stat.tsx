import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'accent' | 'success' | 'danger';
  className?: string;
}

/** Показатель: «Фонд 4 000 ₽», «В игре 4», «KO 3». */
export function Stat({ label, value, hint, tone = 'default', className }: StatProps) {
  return (
    <div className={cn('ui-stat', tone !== 'default' && `ui-stat--${tone}`, className)}>
      <span className="ui-stat__label">{label}</span>
      <span className="ui-stat__value">{value}</span>
      {hint && <span className="ui-stat__hint">{hint}</span>}
    </div>
  );
}

/** Сетка показателей: столбцы подстраиваются под ширину (2–4 в ряд на 320–480px). */
export function Stats({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('ui-stats', className)}>{children}</div>;
}
