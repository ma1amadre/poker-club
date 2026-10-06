import { NavLink } from 'react-router-dom';
import { cn } from '../lib/cn';
import { haptic } from '../telegram';
import { Icon, type IconName } from './Icon';

export interface BottomNavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Активна только на точном совпадении пути (для «/»). */
  end?: boolean;
}

export interface BottomNavProps {
  items: readonly BottomNavItem[];
  /** Подпись навигации для скринридера. */
  label?: string;
}

/**
 * Нижняя навигация приложения — в «Материи» её нет (NavBar — верхняя навигация сайта). Собрана из
 * токенов: surface с линией line сверху, слой z-sticky, иконки 20 px. Активный раздел — accent у
 * иконки, ink у подписи и полоса 2 px сверху (как подчёркивание Tabs): не только цветом.
 */
export function BottomNav({ items, label = 'Разделы' }: BottomNavProps) {
  return (
    <nav className="ui-bottomnav" aria-label={label}>
      <div className="ui-bottomnav__inner">
        {items.map(({ to, label: text, icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => cn('ui-bottomnav__link', isActive && 'is-on')}
            onClick={() => haptic.selection()}
          >
            <Icon name={icon} size={20} />
            <span>{text}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
