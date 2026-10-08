import { lazy, Suspense, type ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '../shared/auth';
import { PageSkeleton } from '../shared/ui';
import { AuthGate } from './AuthGate';
import { ErrorBoundary } from './ErrorBoundary';
import { Layout } from './Layout';
import { AdminOnlyDenied, NotFoundPage } from './screens';
import { ThemeScope } from './useTheme';

// Страницы грузятся лениво: Telegram открывает Mini App на мобильном интернете, и первый экран
// не должен ждать код админки и табло.
const HomePage = lazy(() => import('../pages/home/HomePage'));
const EveningPage = lazy(() => import('../pages/evening/EveningPage'));
const SettlePage = lazy(() => import('../pages/evening/SettlePage'));
const VotePage = lazy(() => import('../pages/vote/VotePage'));
const BoardPage = lazy(() => import('../pages/board/BoardPage'));
const ClubBoardPage = lazy(() => import('../pages/board/ClubBoardPage'));
const RatingPage = lazy(() => import('../pages/rating/RatingPage'));
const SeasonPage = lazy(() => import('../pages/season/SeasonPage'));
const PlayerPage = lazy(() => import('../pages/player/PlayerPage'));
const HistoryPage = lazy(() => import('../pages/history/HistoryPage'));
const AdminPage = lazy(() => import('../pages/admin/AdminPage'));
const EveningEditPage = lazy(() => import('../pages/admin/EveningEditPage'));

// Витрина кита — только в dev: в прод-сборке import.meta.env.DEV — литерал false, ветки с
// динамическим импортом вырезаются, и чанки витрины не собираются.
const KitPage = import.meta.env.DEV ? lazy(() => import('./dev/KitPage')) : null;
const KitYantarPage = import.meta.env.DEV ? lazy(() => import('./dev/KitYantarPage')) : null;

function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  return isAdmin ? children : <AdminOnlyDenied />;
}

/** Экран вне AuthProvider: своя граница ошибок и загрузка. */
function Standalone({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

/**
 * Маршруты из контракта (ARCHITECTURE.md → «Фронт»). Табло /board/:token и табло клуба /tv/:code —
 * публичные, вне AuthProvider: на ТВ нет Telegram, и попытка входа там не нужна. Регистр табло — Янтарь
 * (ThemeScope), при уходе с табло регистр возвращается к Кобальту. Остальное — под AuthGate.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/board/:token"
        element={
          <ThemeScope theme="yantar">
            <Standalone>
              <BoardPage />
            </Standalone>
          </ThemeScope>
        }
      />
      <Route
        path="/tv/:code"
        element={
          <ThemeScope theme="yantar">
            <Standalone>
              <ClubBoardPage />
            </Standalone>
          </ThemeScope>
        }
      />
      {KitPage && (
        <Route
          path="/dev/kit"
          element={
            <Standalone>
              <KitPage />
            </Standalone>
          }
        />
      )}
      {KitYantarPage && (
        <Route
          path="/dev/kit-yantar"
          element={
            <ThemeScope theme="yantar">
              <Standalone>
                <KitYantarPage />
              </Standalone>
            </ThemeScope>
          }
        />
      )}
      <Route
        element={
          <AuthProvider>
            <AuthGate>
              <Layout />
            </AuthGate>
          </AuthProvider>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="evening/:id" element={<EveningPage />} />
        <Route path="evening/:id/settle" element={<SettlePage />} />
        <Route path="evening/:id/vote" element={<VotePage />} />
        <Route path="rating" element={<RatingPage />} />
        <Route path="player/:id" element={<PlayerPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route
          path="admin"
          element={
            <AdminOnly>
              <AdminPage />
            </AdminOnly>
          }
        />
        <Route
          path="admin/evening/new"
          element={
            <AdminOnly>
        <Route path="season/:key" element={<SeasonPage />} />
              <EveningEditPage />
            </AdminOnly>
          }
        />
        <Route
          path="admin/evening/:id"
          element={
            <AdminOnly>
              <EveningEditPage />
            </AdminOnly>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
