// Админка «Клуб» → «Приглашения» (миграция 029): чистые подписи и группировка — их проверяет invites.test.ts.
import { INVITE_TTL_DAYS } from '@domain/invite.ts';
import type { PlayerInvite, PlayerInviteStatus } from '../../shared/api';
import { formatDate, formatTime, NBSP, pluralWithNumber } from '../../shared/lib';

type DateInput = string | number | Date;

const DAYS = ['день', 'дня', 'дней'] as const;

const ms = (value: DateInput): number =>
  value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);

/** «1 ноября, 15:30» (для другого года — с годом), время МСК. */
export function inviteMoment(iso: string, now: DateInput): string {
  return `${formatDate(iso, now)}, ${formatTime(iso)}`;
}

/** Под ссылкой в шторке: кому и сколько действует. */
export function inviteTermNote(expiresAt: string, now: DateInput): string {
  return `Одному человеку, действует ${pluralWithNumber(INVITE_TTL_DAYS, DAYS)}${NBSP}— до ${inviteMoment(expiresAt, now)}.`;
}

/** Текст под ссылкой в сообщении (Telegram ставит ссылку первой строкой, текст — следом). */
export function inviteShareText(expiresAt: string, now: DateInput): string {
  return `Приглашение в покерный клуб: открой ссылку — приложение клуба откроется прямо в Telegram. Ссылка личная и сработает один раз, до ${inviteMoment(expiresAt, now)}.`;
}

/**
 * «Поделиться»: окно выбора чата Telegram с готовым сообщением. Формат —
 * https://core.telegram.org/api/links, «Share links»: t.me/share/url?url=<url>&text=<text>, url
 * обязателен и urlencoded, text — по желанию (сверено 25.10.2026).
 */
export function inviteShareUrl(link: string, expiresAt: string, now: DateInput): string {
  const text = inviteShareText(expiresAt, now);
  return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
}

/**
 * Статус на сейчас: сервер считает его на момент запроса, а список висит на экране — действующее
 * приглашение с прошедшим сроком показываем истёкшим, не дожидаясь перечитывания.
 */
export function inviteStatusAt(invite: PlayerInvite, now: DateInput): PlayerInviteStatus {
  if (invite.status === 'active' && ms(invite.expiresAt) <= ms(now)) return 'expired';
  return invite.status;
}

export interface InviteGroups {
  /** Ещё работают — с «Отозвать»; ближе к концу срока — выше. */
  active: PlayerInvite[];
  /** По ним вошли — свежие выше. */
  used: PlayerInvite[];
  /** Истекли или отозваны — свежие выше. */
  closed: PlayerInvite[];
}

const time = (iso: string | null): number => (iso ? Date.parse(iso) : 0);

export function groupInvites(invites: readonly PlayerInvite[], now: DateInput): InviteGroups {
  const withStatus = invites.map((i) => ({ ...i, status: inviteStatusAt(i, now) }));
  const active = withStatus.filter((i) => i.status === 'active');
  const used = withStatus.filter((i) => i.status === 'used');
  const closed = withStatus.filter((i) => i.status === 'expired' || i.status === 'revoked');
  active.sort((a, b) => time(a.expiresAt) - time(b.expiresAt) || a.id.localeCompare(b.id));
  used.sort((a, b) => time(b.usedAt) - time(a.usedAt) || a.id.localeCompare(b.id));
  const closedAt = (i: PlayerInvite) => time(i.status === 'revoked' ? i.revokedAt : i.expiresAt);
  closed.sort((a, b) => closedAt(b) - closedAt(a) || a.id.localeCompare(b.id));
  return { active, used, closed };
}

/** Строка списка: заголовок и подпись. О людях — без рода. */
export function inviteRow(
  invite: PlayerInvite,
  now: DateInput,
): { title: string; subtitle: string } {
  const created = `Создана ${inviteMoment(invite.createdAt, now)}`;
  switch (inviteStatusAt(invite, now)) {
    case 'active':
      return { title: `До ${inviteMoment(invite.expiresAt, now)}`, subtitle: created };
    case 'used':
      return {
        title: invite.usedByName ?? 'Профиль удалён',
        subtitle: invite.usedAt ? `Вход по ссылке ${inviteMoment(invite.usedAt, now)}` : created,
      };
    case 'revoked':
      return {
        title: invite.revokedAt ? `Отозвана ${inviteMoment(invite.revokedAt, now)}` : 'Отозвана',
        subtitle: created,
      };
    default:
      return { title: `Истекла ${inviteMoment(invite.expiresAt, now)}`, subtitle: created };
  }
}
