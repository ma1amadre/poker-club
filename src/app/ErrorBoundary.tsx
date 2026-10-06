import { Component, type ErrorInfo, type ReactNode } from 'react';
import { cn } from '../shared/lib';
import { AlertIcon, Button } from '../shared/ui';

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
      <div
        className={cn('app-screen', 'app-screen--error', this.props.inline && 'app-screen--inline')}
        role="alert"
      >
        <AlertIcon className="app-screen__icon" size={48} />
        <h1 className="app-screen__title">
          {isChunkError ? 'Вышло обновление' : 'Что-то пошло не так'}
        </h1>
        <p className="app-screen__text">
          {isChunkError
            ? 'Приложение обновилось, пока было открыто. Перезагрузите его.'
            : 'Экран не смог отрисоваться. Попробуйте ещё раз или вернитесь на главную.'}
        </p>
        {import.meta.env.DEV && <pre className="app-screen__details">{error.message}</pre>}
        <div className="app-screen__actions">
          <Button size="lg" block onClick={() => window.location.reload()}>
            Перезагрузить
          </Button>
          {!isChunkError && (
            <Button variant="plain" block onClick={this.goHome}>
              На главную
            </Button>
          )}
        </div>
      </div>
    );
  }
}
