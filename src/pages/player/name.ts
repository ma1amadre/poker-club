// Проверка имени перед set_my_name: те же правила, что у RPC (1–40 символов, пробелы схлопываются).

import { NAME_MAX, normalizeName } from '../../shared/lib/text';

/** Текст ошибки (что не так и как исправить) или null, если имя подходит. */
export function nameError(raw: string, current?: string): string | null {
  const name = normalizeName(raw);
  if (name.length === 0) return 'Имя пустое. Введи хотя бы один символ.';
  if (Array.from(name).length > NAME_MAX) return `Имя длиннее ${NAME_MAX} символов. Сократи его.`;
  if (current !== undefined && name === normalizeName(current))
    return 'Это имя уже стоит. Введи другое или закрой окно.';
  return null;
}
