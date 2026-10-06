import { cn } from '../lib/cn';

export interface SpinnerProps {
  size?: number;
  className?: string;
  /** Подпись для скринридера; по умолчанию «Загрузка». */
  label?: string;
}

export function Spinner({ size = 20, className, label = 'Загрузка' }: SpinnerProps) {
  return (
    <svg
      className={cn('ui-spinner', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label={label}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Индикатор загрузки на весь экран страницы. */
export function PageSpinner({ label }: { label?: string }) {
  return (
    <div className="ui-page-spinner" aria-busy="true">
      <Spinner size={32} label={label} />
    </div>
  );
}
