import { useEffect, useState, type ReactNode } from 'react';
import { DENIED_TITLES, type AuthError, type AuthErrorKind, type DeniedKind } from '../shared/auth';
import { cn, paths, SIGN_IN_SLOW_MS } from '../shared/lib';
import { closeApp, isInTelegram } from '../shared/telegram';
import { Button, ButtonLink, Empty, Icon, Page, Spinner, type IconName } from '../shared/ui';

interface ScreenProps {
  icon: IconName;
  title: ReactNode;
  text?: ReactNode;
  details?: string;
  actions?: ReactNode;
  error?: boolean;
  inline?: boolean;
  role?: 'alert' | 'status';
}

/**
 * Экран вне раскладки (вход, отказ, сбой) — анатомия EmptyState «Материи» с заголовком h1:
 * значок → m-h2 → m-body (ink-muted) → действия. Одна primary на экран.
 */
export function AppScreen({
  icon,
  title,
  text,
  details,
  actions,
  error,
  inline,
  role,
}: ScreenProps) {
  return (
    <div
      className={cn('app-screen', error && 'app-screen--error', inline && 'app-screen--inline')}
      role={role}
    >
      <div className="app-screen__body">
        <span className="app-screen__icon">
          <Icon name={icon} size={24} />
        </span>
        <h1 className="m-h2 app-screen__title">{title}</h1>
        {text && <p className="m-body app-screen__text">{text}</p>}
        {details && <pre className="m-mono app-screen__details">{details}</pre>}
        {actions && <div className="app-screen__actions">{actions}</div>}
      </div>
    </div>
  );
}

/**
 * Пока идёт вход (обычно 1–3 с): название клуба и спиннер — на фоне ground, без белой вспышки.
 * Вход дольше SIGN_IN_SLOW_MS — «Связь медленная» и «Повторить вход» (попытку целиком ограничивает
 * SIGN_IN_TIMEOUT_MS, дальше экран ошибки). Повтор монтирует заставку заново (key в AuthGate).
 */
export function SplashScreen({ onRetry }: { onRetry?: () => void }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SIGN_IN_SLOW_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="app-screen" aria-busy="true">
      <div className="app-screen__body">
        <p className="m-eyebrow">Покерный клуб</p>
        <div className="app-splash">
          <Spinner size={20} label="Входим в клуб" />
          <p className="m-body app-screen__text">Входим в клуб</p>
        </div>
        {slow && onRetry && (
          <div className="app-screen__actions" role="status">
            <p className="m-small app-screen__text">
              Связь медленная — вход идёт дольше обычного. Можно подождать или начать заново.
            </p>
            <Button icon="refresh-cw" block onClick={onRetry}>
              Повторить вход
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// Заголовок — DENIED_TITLES, текст под ним — сообщение tg-auth (что делать, shared/auth/denied.ts);
// свой текст — только у «не из Telegram», где функции не было.
const DENIED: Record<DeniedKind, { icon: IconName; title: string; text?: string }> = {
  no_telegram: {
    icon: 'send',
    title: DENIED_TITLES.no_telegram,
    text: 'Вход работает только через Telegram: открой приложение кнопкой в группе клуба или по ссылке-приглашению.',
  },
  signature: { icon: 'shield', title: DENIED_TITLES.signature },
  not_member: { icon: 'user', title: DENIED_TITLES.not_member },
  no_group: { icon: 'bell', title: DENIED_TITLES.no_group },
  invite: { icon: 'user-x', title: DENIED_TITLES.invite },
  inactive: { icon: 'user', title: DENIED_TITLES.inactive },
};

/**
 * Нет доступа: не из Telegram, подпись не сошлась, не участник группы, группа не подключена,
 * приглашение не сработало, профиль отключён.
 */
export function DeniedScreen({ error, onRetry }: { error: AuthError | null; onRetry: () => void }) {
  const kind = error?.kind ?? 'not_member';
  const screen = DENIED[kind as keyof typeof DENIED] ?? DENIED.not_member;
  const canClose = isInTelegram();
  return (
    <AppScreen
      role="alert"
      icon={screen.icon}
      title={screen.title}
      text={screen.text ?? error?.message ?? 'Доступ к клубу закрыт. Обратись к админу клуба.'}
      actions={
        <>
          {/* Подпись могла не сойтись из-за устаревшего initData — повтор иногда помогает. */}
          {kind === 'signature' && (
            <Button variant="primary" block onClick={onRetry}>
              Повторить вход
            </Button>
          )}
          {canClose && (
            <Button variant={kind === 'signature' ? 'ghost' : 'secondary'} block onClick={closeApp}>
              Закрыть приложение
            </Button>
          )}
        </>
      }
    />
  );
}

const ERROR_TITLES: Partial<Record<AuthErrorKind, string>> = {
  network: 'Нет связи с сервером',
  timeout: 'Связь слишком медленная',
  config: 'Приложение не настроено',
  server: 'Не удалось войти',
};

/** Сбой входа (сеть, сервер, конфигурация): что случилось и «Повторить вход». */
export function AuthErrorScreen({
  error,
  onRetry,
  extraActions,
}: {
  error: AuthError | null;
  onRetry: () => void;
  extraActions?: ReactNode;
}) {
  const kind = error?.kind ?? 'server';
  return (
    <AppScreen
      role="alert"
      error
      icon={kind === 'network' || kind === 'timeout' ? 'globe' : 'alert-triangle'}
      title={ERROR_TITLES[kind] ?? 'Не удалось войти'}
      text={error?.message ?? 'Повтори вход через минуту.'}
      details={error?.details}
      actions={
        <>
          {kind !== 'config' && (
            <Button variant="primary" icon="refresh-cw" block onClick={onRetry}>
              Повторить вход
            </Button>
          )}
          {extraActions}
        </>
      }
    />
  );
}

export function NotFoundPage() {
  return (
    <Page title="Страница не найдена" back>
      <Empty
        kind="no-results"
        title="Такой страницы нет"
        description="Ссылка устарела или вечер удалён."
        action={
          <ButtonLink to={paths.home} icon="arrow-left">
            Вернуться на главную
          </ButtonLink>
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
        icon="shield"
        title="Раздел только для админа клуба"
        description="Если нужно что-то изменить в расписании или составе, напиши админу."
      />
    </Page>
  );
}
