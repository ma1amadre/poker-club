// Текст ошибки для логов и алертов. Отдельный модуль без зависимостей: его импортирует и admin.ts
// (supabase-js через npm:), и alerts.ts, который гоняет vitest под Node, где npm:-импорт не грузится.

/** Сообщение ошибки для логов: у PostgrestError/AuthError нет stack, но есть message и code. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === 'object' && error !== null) {
    const e = error as { message?: unknown; code?: unknown };
    return `${String(e.code ?? '')} ${String(e.message ?? JSON.stringify(error))}`.trim();
  }
  return String(error);
}
