import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '../shared/ui';
import { AppScreen } from './screens';

interface Props {
  children: ReactNode;
  /** Компактный вид внутри раскладки (навигация остаётся доступной). */
  inline?: boolean;
}

interface State {
  error: Error | null;
}

// После деплоя на GitHub Pages старые чанки удаляются, и ленивая страница в открытом приложении
// падает с такой ошибкой — лечится только перезагрузкой.
const CHUNK_ERROR_RE =
  /dynamically imported module|importing a module script failed|failed to fetch dynamically|loading chunk/i;

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('Ошибка интерфейса', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  private goHome = () => {
    window.location.hash = '#/';
    this.reset();
  };

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isChunkError = CHUNK_ERROR_RE.test(error.message);
    return (
      <AppScreen
        role="alert"
        error={!isChunkError}
        inline={this.props.inline}
        icon={isChunkError ? 'refresh-cw' : 'alert-triangle'}
        title={isChunkError ? 'Вышло обновление' : 'Экран не открылся'}
        text={
          isChunkError
            ? 'Приложение обновилось, пока было открыто. Перезагрузите его — данные не пропадут.'
            : 'Сбой в интерфейсе. Перезагрузите приложение или вернитесь на главную.'
        }
        details={import.meta.env.DEV ? error.message : undefined}
        actions={
          <>
            <Button
              variant="primary"
              icon="refresh-cw"
              block
              onClick={() => window.location.reload()}
            >
              Перезагрузить приложение
            </Button>
            {!isChunkError && (
              <Button variant="ghost" block onClick={this.goHome}>
                Вернуться на главную
              </Button>
            )}
          </>
        }
      />
    );
  }
}
