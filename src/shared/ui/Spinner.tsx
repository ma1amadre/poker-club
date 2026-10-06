import { Skeleton } from './materia';

export interface PageSkeletonProps {
  /** Подпись для скринридера; по умолчанию «Загрузка экрана». */
  label?: string;
}

/**
 * Загрузка экрана: по «Материи» на месте контента — Skeleton его формы (заголовок, строки списка),
 * а не спиннер посреди пустоты. Появляется с задержкой: если экран открылся быстрее, мигания нет
 * («меньше секунды — ничего не показывайте»).
 */
export function PageSkeleton({ label = 'Загрузка экрана' }: PageSkeletonProps) {
  return (
    <div className="ui-page ui-page-skeleton" role="status" aria-busy="true" aria-label={label}>
      <Skeleton width="55%" height={32} />
      <div className="ui-page-skeleton__rows">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="ui-page-skeleton__row">
            <Skeleton circle width={40} height={40} />
            <div className="ui-page-skeleton__text">
              <Skeleton width="60%" height={12} />
              <Skeleton width="35%" height={10} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Старое имя: загрузка экрана теперь — скелетон, см. PageSkeleton. */
export const PageSpinner = PageSkeleton;
