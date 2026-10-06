import { lazy, Suspense, type ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '../shared/auth';
import { PageSpinner } from '../shared/ui';
import { AuthGate } from './AuthGate';
import { ErrorBoundary } from './ErrorBoundary';
import { Layout } from './Layout';
import { AdminOnlyDenied, NotFoundPage } from './screens';

// Страницы грузятся лениво: Telegram открывает Mini App на мобильном интернете, и первый экран
// не должен ждать код админки и табло.
const HomePage = lazy(() => import('../pages/home/HomePage'));
const EveningPage = lazy(() => import('../pages/evening/EveningPage'));
const SettlePage = lazy(() => import('../pages/evening/SettlePage'));
const VotePage = lazy(() => import('../pages/vote/VotePage'));
const BoardPage = lazy(() => import('../pages/board/BoardPage'));
const RatingPage = lazy(() => import('../pages/rating/RatingPage'));
const PlayerPage = lazy(() => import('../pages/player/PlayerPage'));
const HistoryPage = lazy(() => import('../pages/history/HistoryPage'));
const AdminPage = lazy(() => import('../pages/admin/AdminPage'));
const EveningEditPage = lazy(() => import('../pages/admin/EveningEditPage'));

function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  return isAdmin ? children : <AdminOnlyDenied />;
}

/**
 * Маршруты из контракта (ARCHITECTURE.md → «Фронт»). Табло /board/:token — публичное, вне
 * AuthProvider: на ТВ нет Telegram, и попытка входа там не нужна. Остальное — под AuthGate.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/board/:token"
        element={
          <ErrorBoundary>
            <Suspense fallback={<PageSpinner />}>
              <BoardPage />
            </Suspense>
          </ErrorBoundary>
        }
      />
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
