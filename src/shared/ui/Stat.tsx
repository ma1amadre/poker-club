import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { MateriaStat, type MateriaStatProps } from './materia';

export interface StatProps extends MateriaStatProps {
  /** Старое имя note — подпись под числом. */
  hint?: ReactNode;
}

/**
 * Stat «Материи»: подпись, число (табличные цифры), единица, изменение. value — уже
 * отформатированная строка («4 000», «12,5»), единица — в unit («₽», «очков»). Цвет delta
 * считается от good, а не от знака; знак и иконка тренда есть всегда — цвет не единственный носитель.
 */
export function Stat({ hint, note, ...rest }: StatProps) {
  return <MateriaStat {...rest} note={note ?? hint} />;
}

/** Сетка показателей: 2–4 в ряд на 320–560 px; на узком экране числа на ступень мельче. */
export function Stats({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('ui-stats', className)}>{children}</div>;
}
