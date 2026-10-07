// Имя для озвучки на табло (players.spoken_name, миграция 016): подписи одни для карточки игрока
// и админки «Игроки». Правила имени и что именно скажет голос — домен (@domain/voice.ts).
import { normalizeSpokenName, speakableName, spokenNameError } from '@domain/voice.ts';

/** Подсказка под полем (решение пользователя — дословно). */
export const SPOKEN_NAME_HINT =
  'Как произносить имя на табло — кириллицей. Ударение — знак + перед гласной: Эрдн+и';

/** Как часто генератор озвучивает новые фразы (voice.yml в poker-club-ops: 08:43 МСК, утром до игры). */
export const SPOKEN_NAME_DELAY_NOTE =
  'Табло произнесёт новое имя после ближайшей озвучки — она идёт раз в сутки, утром.';

interface NamedPlayer {
  display_name: string;
  spoken_name?: string | null;
}

/** Голос называет игрока (своим именем для озвучки или кириллическим именем в клубе). */
export function isVoiced(player: NamedPlayer): boolean {
  return speakableName(player) !== null;
}

/**
 * Что скажет табло, если оставить поле пустым: имя в клубе, если голос его прочитает, иначе —
 * ничего. self — подпись для своей карточки (на «ты»), иначе — нейтральная.
 */
export function emptySpokenNameNote(displayName: string, self: boolean): string {
  const fallback = speakableName({ display_name: displayName });
  if (fallback) return `Пусто — табло скажет имя в клубе: «${fallback}».`;
  return self
    ? 'Пусто — табло не назовёт тебя по имени: голос читает только кириллицу.'
    : 'Пусто — табло не назовёт игрока по имени: голос читает только кириллицу.';
}

/** Ошибка поля (что не так и как исправить) или null. Пустое — можно: сброс. */
export function spokenNameFieldError(draft: string): string | null {
  return spokenNameError(draft);
}

/** Значение поля так, как его сохранит сервер; null — сброс (поле пустое). */
export function spokenNameValue(draft: string): string | null {
  const name = normalizeSpokenName(draft);
  return name === '' ? null : name;
}

/** Черновик отличается от сохранённого. */
export function spokenNameChanged(draft: string, saved: string | null | undefined): boolean {
  return spokenNameValue(draft) !== (saved ?? null);
}
