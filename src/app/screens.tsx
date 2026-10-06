import type { ReactNode } from 'react';
import type { AuthError } from '../shared/auth';
import { paths } from '../shared/lib';
import { closeApp, isInTelegram } from '../shared/telegram';
import { AlertIcon, Button, ChipIcon, Empty, Page, Spinner } from '../shared/ui';

/** Пока идёт вход: тот же фон, что у Telegram-заглушки, — без белой вспышки. */
export function SplashScreen() {
  return (
    <div className="app-screen" aria-busy="true">
      <ChipIcon className="app-screen__icon" size={48} />
      <p className="app-screen__title">Покерный клуб</p>
      <Spinner className="app-splash__spinner" size={24} label="Вход" />
    </div>
  );
}

const DENIED_TITLES: Partial<Record<AuthError['kind'], string>> = {
  no_telegram: 'Откройте в Telegram',
  signature: 'Не удалось подтвердить вход',
  not_member: 'Только для участников клуба',
  inactive: 'Профиль отключён',
};

/** Нет доступа: не из Telegram, не участник группы, профиль отключён. */
export function DeniedScreen({ error, onRetry }: { error: AuthError | null; onRetry: () => void }) {
  const kind = error?.kind ?? 'not_member';
  return (
    <div className="app-screen" role="alert">
      <ChipIcon className="app-screen__icon" size={48} />
      <h1 className="app-screen__title">{DENIED_TITLES[kind] ?? 'Нет доступа'}</h1>
      <p className="app-screen__text">{error?.message ?? 'Доступ к клубу закрыт.'}</p>
      <div className="app-screen__actions">
        {/* Подпись могла не сойтись из-за устаревшего initData — повтор иногда помогает. */}
        {kind === 'signature' && (
          <Button size="lg" block onClick={onRetry}>
            Попробовать снова
          </Button>
        )}
        {isInTelegram() && (
          <Button variant={kind === 'signature' ? 'plain' : 'secondary'} block onClick={closeApp}>
            Закрыть
          </Button>
        )}
      </div>
    </div>
  );
}

/** Сбой входа (сеть, сервер, конфигурация) — с повтором. */
export function AuthErrorScreen({
  error,
  onRetry,
  extraActions,
}: {
  error: AuthError | null;
  onRetry: () => void;
  extraActions?: ReactNode;
}) {
  return (
    <div className="app-screen app-screen--error" role="alert">
      <AlertIcon className="app-screen__icon" size={48} />
      <h1 className="app-screen__title">
        {error?.kind === 'network'
          ? 'Нет связи'
          : error?.kind === 'config'
            ? 'Ошибка настройки'
            : 'Не удалось войти'}
      </h1>
      <p className="app-screen__text">{error?.message ?? 'Попробуйте ещё раз.'}</p>
      {error?.details && <pre className="app-screen__details">{error.details}</pre>}
      <div className="app-screen__actions">
        {error?.kind !== 'config' && (
          <Button size="lg" block onClick={onRetry}>
            Повторить
          </Button>
        )}
        {extraActions}
      </div>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <Page title="Не найдено" back>
      <Empty
        title="Такой страницы нет"
        description="Возможно, ссылка устарела или вечер удалён."
        action={
          <Button variant="secondary" onClick={() => (window.location.hash = `#${paths.home}`)}>
            На главную
          </Button>
        }
      />
    </Page>
  );
}

/** Заглушка для не-админа на админских маршрутах (RLS всё равно не даст ничего изменить). */
export function AdminOnlyDenied() {
  return (
    <Page title="Админка" back>
      <Empty
        title="Только для админа клуба"
        description="Этот раздел доступен админу. Обратитесь к нему, если нужно что-то поменять."
      />
    </Page>
  );
}
