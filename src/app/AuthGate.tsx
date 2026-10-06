import { lazy, Suspense, type ReactNode } from 'react';
import { useAuth } from '../shared/auth';
import { Button, PageSpinner } from '../shared/ui';
import { AuthErrorScreen, DeniedScreen, SplashScreen } from './screens';

// Экран выбора тестового игрока существует только в dev: в прод-сборке import.meta.env.DEV —
// литерал false, ветка с динамическим импортом вырезается, и чанк с dev-кодом не собирается.
const DevLoginPage = import.meta.env.DEV ? lazy(() => import('../shared/auth/DevLoginPage')) : null;

/** Пускает к приложению только после входа; иначе — загрузка, «нет доступа» или ошибка. */
export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();

  if (auth.status === 'loading') return <SplashScreen />;

  if (auth.status === 'denied') {
    if (DevLoginPage && auth.error?.kind === 'no_telegram') {
      return (
        <Suspense fallback={<PageSpinner />}>
          <DevLoginPage />
        </Suspense>
      );
    }
    return <DeniedScreen error={auth.error} onRetry={auth.retry} />;
  }

  if (auth.status === 'error') {
    return (
      <AuthErrorScreen
        error={auth.error}
        onRetry={auth.retry}
        extraActions={
          import.meta.env.DEV ? (
            <Button variant="plain" block onClick={() => void auth.signOut()}>
              Сменить тестового игрока
            </Button>
          ) : undefined
        }
      />
    );
  }

  return children;
}
