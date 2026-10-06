import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { HashRouter } from 'react-router-dom';
import { ToastProvider, useToast } from '../shared/ui';
import { ErrorBoundary } from './ErrorBoundary';
import { queryClient, setMutationErrorHandler } from './queryClient';
import { AppRoutes } from './routes';
import { useThemeSync } from './useTheme';

/** Ошибки всех мутаций — тостом (см. queryClient.ts). */
function GlobalMutationErrors() {
  const toast = useToast();
  useEffect(() => {
    setMutationErrorHandler((error) => toast.error(error));
    return () => setMutationErrorHandler(null);
  }, [toast]);
  return null;
}

export function App() {
  useThemeSync();
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <GlobalMutationErrors />
          {/* HashRouter: GitHub Pages не умеет отдавать index.html на произвольный путь. */}
          <HashRouter>
            <AppRoutes />
          </HashRouter>
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
