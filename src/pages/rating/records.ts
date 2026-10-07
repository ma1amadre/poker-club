// Подписи вкладки «Рекорды»: пояснение к ещё не установленному рекорду. Значение рекорда —
// общий recordValueParts (shared/lib/clubLife), сами рекорды считает домен (recordsTable).
import { RECORD_META, type RecordKind } from '@domain/records.ts';

/** Пояснение к ещё не установленному рекорду. */
export function recordEmptyText(kind: RecordKind): string {
  if (kind === 'win_streak') return `Серия считается с ${RECORD_META.win_streak.min} побед подряд`;
  if (kind === 'most_kos') return 'Нокаутов в клубе ещё не было';
  return 'Рекорда пока нет';
}
