import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../shared/auth';
import { cn, paths } from '../shared/lib';
import { useBackButton } from '../shared/telegram';
import { BottomNav, PageSkeleton, type BottomNavItem } from '../shared/ui';
import { ErrorBoundary } from './ErrorBoundary';
import { useStartParamRedirect } from './useStartParamRedirect';

const TABS: readonly (BottomNavItem & { adminOnly?: boolean })[] = [
  { to: paths.home, label: 'Главная', icon: 'home', end: true },
  { to: paths.rating, label: 'Рейтинг', icon: 'trophy' },
  { to: paths.history, label: 'История', icon: 'history' },
  { to: paths.admin, label: 'Админ', icon: 'sliders', adminOnly: true },
];

// Навигация только на корневых экранах. На вложенных (вечер, расчёт, игрок) работает кнопка
// «Назад» Telegram, а место внизу нужно пульту банкира.
const TAB_ROOTS = new Set(TABS.map((tab) => tab.to));

/** Раскладка экранов под входом: страница + нижняя навигация (раздел «Админ» — только админу). */
export function Layout() {
  const { isAdmin } = useAuth();
  const location = useLocation();
  useStartParamRedirect();
  // Редактор формата открывается поверх админки параметром ?format= — это вложенный экран.
  const nested = new URLSearchParams(location.search).has('format');
  const showNav = TAB_ROOTS.has(location.pathname) && !nested;
  // Базовый слой кнопки «Назад» на вложенных маршрутах — под Page с back (её запись ложится
  // сверху). Пока грузится ленивый чанк или данные (PageSkeleton без Page), кнопка не пропадает
  // и не мигает «Назад» → «Закрыть» → «Назад» при каждом переходе.
  useBackButton({ enabled: !showNav });

  return (
    <div className={cn('app-layout', showNav && 'ui-has-bottomnav')}>
      {/* key по пути: ошибка одного экрана сбрасывается переходом на другой. */}
      <ErrorBoundary key={location.pathname} inline>
        <Suspense fallback={<PageSkeleton />}>
          <Outlet />
        </Suspense>
      </ErrorBoundary>
      {showNav && <BottomNav items={TABS.filter((tab) => !tab.adminOnly || isAdmin)} />}
    </div>
  );
}
