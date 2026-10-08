// Маршруты приложения (HashRouter) — строим ссылки отсюда, а не склейкой строк по страницам.

export const paths = {
  home: '/',
  evening: (id: string) => `/evening/${id}`,
  settle: (id: string) => `/evening/${id}/settle`,
  vote: (id: string) => `/evening/${id}/vote`,
  board: (token: string) => `/board/${token}`,
  /** Табло клуба — постоянная ссылка для ТВ (миграция 023). */
  clubBoard: (code: string) => `/tv/${code}`,
  rating: '/rating',
  /** Вкладки рейтинга (useRatingParams): рекорды клуба и зал славы. */
  ratingRecords: '/rating?tab=records',
  ratingFame: '/rating?tab=fame',
  player: (id: string) => `/player/${id}`,
  /** Итоги сезона: '2026-Q4' (seasonKey домена). */
  season: (key: string) => `/season/${key}`,
  history: '/history',
  historyMoments: '/history?tab=moments',
  admin: '/admin',
  adminEveningNew: '/admin/evening/new',
  adminEvening: (id: string) => `/admin/evening/${id}`,
} as const;

/**
 * Абсолютная ссылка на табло для QR и ТВ: тот же адрес приложения, маршрут в hash.
 * Берём текущий origin + pathname — так ссылка верна и локально, и на GitHub Pages (/poker-club/).
 */
export function boardUrl(token: string): string {
  return appUrl(paths.board(token));
}

/** Код табло клуба: как check settings.club_board_token (миграция 023) — 12 знаков hex. */
export const CLUB_BOARD_CODE_RE = /^[0-9a-f]{12}$/;

/** Абсолютная ссылка на табло клуба: её открывают на ТВ один раз и сохраняют в закладки. */
export function clubBoardUrl(code: string): string {
  return appUrl(paths.clubBoard(code));
}

function appUrl(route: string): string {
  return `${window.location.origin}${window.location.pathname}#${route}`;
}

/** Прямая ссылка на Mini App с параметром запуска: t.me/<bot>?startapp=e_<id>. */
export function miniAppLink(botUsername: string, startParam?: string): string {
  const bot = botUsername.replace(/^@/, '');
  const base = `https://t.me/${bot}`;
  return startParam ? `${base}?startapp=${encodeURIComponent(startParam)}` : base;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ключ сезона в ссылке: '2026-Q4', как seasonKey домена. */
export const SEASON_KEY_RE = /^\d{4}-Q[1-4]$/;

/**
 * Параметр запуска → маршрут: `e_<id>` → вечер, `v_<id>` → голосование, `r` → рейтинг,
 * `s_2026-Q4` → итоги сезона (кнопка поста «Итоги сезона»). id проверяется как uuid, сезон — как ключ:
 * параметр приходит из ссылки и не должен складываться в произвольный путь.
 */
export function startParamRoute(param: string | null | undefined): string | null {
  if (!param) return null;
  if (param === 'r') return paths.rating;
  const season = /^s_(.+)$/.exec(param)?.[1];
  if (season !== undefined) return SEASON_KEY_RE.test(season) ? paths.season(season) : null;
  const match = /^([ev])_(.+)$/.exec(param);
  if (!match) return null;
  const [, kind, id] = match;
  if (!id || !UUID_RE.test(id)) return null;
  return kind === 'e' ? paths.evening(id) : paths.vote(id);
}
