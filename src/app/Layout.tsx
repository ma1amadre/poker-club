import { Suspense, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../shared/auth';
import { cn, paths } from '../shared/lib';
import { haptic } from '../shared/telegram';
import {
  HistoryIcon,
  HomeIcon,
  PageSpinner,
  SettingsIcon,
  TrophyIcon,
  type IconProps,
} from '../shared/ui';
import { ErrorBoundary } from './ErrorBoundary';
import { useStartParamRedirect } from './useStartParamRedirect';

interface Tab {
  to: string;
  label: string;
  Icon: ComponentType<IconProps>;
  adminOnly?: boolean;
}

const TABS: readonly Tab[] = [
  { to: paths.home, label: 'Главная', Icon: HomeIcon },
  { to: paths.rating, label: 'Рейтинг', Icon: TrophyIcon },
  { to: paths.history, label: 'История', Icon: HistoryIcon },
  { to: paths.admin, label: 'Админ', Icon: SettingsIcon, adminOnly: true },
];

// Навигация только на корневых экранах. На вложенных (вечер, расчёт, игрок) работает кнопка
// «Назад» Telegram, а место внизу нужно пульту банкира.
const TAB_ROOTS = new Set(TABS.map((tab) => tab.to));

function BottomNav({ isAdmin }: { isAdmin: boolean }) {
  return (
    <nav className="app-nav" aria-label="Разделы">
      <div className="app-nav__inner">
        {TABS.filter((tab) => !tab.adminOnly || isAdmin).map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === paths.home}
            className="app-nav__link"
            onClick={() => haptic.selection()}
          >
            <Icon size={24} />
            <span>{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

/** Раскладка экранов под входом: страница + нижняя навигация. */
export function Layout() {
  const { isAdmin } = useAuth();
  const location = useLocation();
  useStartParamRedirect();
  const showNav = TAB_ROOTS.has(location.pathname);

  return (
    <div className={cn('app-layout', showNav && 'ui-layout--nav')}>
      {/* key по пути: ошибка одного экрана сбрасывается переходом на другой. */}
      <ErrorBoundary key={location.pathname} inline>
        <Suspense fallback={<PageSpinner />}>
          <Outlet />
        </Suspense>
      </ErrorBoundary>
      {showNav && <BottomNav isAdmin={isAdmin} />}
    </div>
  );
}
