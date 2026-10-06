// Общие куски экранов админки: доступ только админу, заглушка загрузки списка.
import type { ReactNode } from 'react';
import { useAuth } from '../../shared/auth';
import { Empty, Page, Skeleton } from '../../shared/ui';

/**
 * Экраны админки — только админу. Маршрут уже закрыт AdminOnly в routes.tsx, это вторая линия
 * (RLS — третья): страница не должна показать форму, даже если её смонтируют без обёртки.
 */
export function AdminGuard({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  if (isAdmin) return children;
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

/** Загрузка списка: форма будущих строк (Skeleton «Материи»), а не спиннер посреди пустоты. */
export function ListSkeleton({ rows = 4, label }: { rows?: number; label: string }) {
  return (
    <div className="adm-skeleton" role="status" aria-busy="true" aria-label={label}>
      <Skeleton width="40%" height={20} />
      <div className="adm-skeleton__list">
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="adm-skeleton__row">
            <Skeleton circle width={40} height={40} />
            <div className="adm-skeleton__text">
              <Skeleton width="55%" height={12} />
              <Skeleton width="35%" height={10} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
