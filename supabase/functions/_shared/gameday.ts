// Пост в день игры (миграция 014): за settings.gameday_hours_before часов до начала объявленного
// вечера бот пишет в группу, кто идёт, кто под вопросом, кто не идёт и кто ещё не ответил.
// Чистые функции без БД — их проверяет vitest (gameday.test.ts), применяет cron-tick, текст поста —
// gamedayPost в messages.ts.

const HOUR_MS = 60 * 60 * 1000;

/** Значение по умолчанию settings.gameday_hours_before (миграция 014). */
export const GAMEDAY_HOURS_DEFAULT = 5;
/** Верх settings.gameday_hours_before — как check в БД. */
export const GAMEDAY_HOURS_MAX = 48;

export interface GamedayEveningLike {
  scheduled_at: string;
  status: string;
  announce_posted_at: string | null;
  gameday_posted_at: string | null;
}

/**
 * Что делать с вечером на этом тике:
 * - none           — не время (не в окне, уже прошёл, не в анонсе) или пост уже ушёл;
 * - wait_announce  — окно открыто, но анонс ещё не уходил: сначала уйдёт он (шаг анонсов);
 * - fresh_announce — анонс ушёл уже внутри окна: отметить gameday_posted_at без поста;
 * - post           — написать в группу.
 */
export type GamedayDecision = 'none' | 'wait_announce' | 'fresh_announce' | 'post';

/** Часы из settings; кривое значение (БД его не пропустит) — по умолчанию. */
export function gamedayHours(value: unknown): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= GAMEDAY_HOURS_MAX ? n : GAMEDAY_HOURS_DEFAULT;
}

/**
 * Окно дня игры — [начало − N ч, начало). Пост — один раз на вечер, только у status = 'announced'.
 *
 * Анонс и пост дня игры не должны прийти подряд. Анонс несёт то же время и место и зовёт отметиться,
 * поэтому, если он ушёл уже внутри окна (вечер создан поздно, группу подключили поздно, анонс за
 * меньшее число часов, чем пост дня игры), пост дня игры не нужен — его отмечают без отправки
 * (fresh_announce). Если анонс ещё не уходил, ждём его (wait_announce): cron-tick постит анонсы
 * раньше этого шага, и в тот же тик этот вечер увидит уже свежий анонс — в один тик группа получит
 * только его. Посты о правке вечера (перенос, место, возврат отменённого) свежестью не считаются:
 * списка ответов в них нет, а announce_posted_at они не трогают. Поэтому, если такой пост ушёл уже
 * внутри окна, пост дня игры придёт следом (ближайшим тиком, а если notify не дошёл и пост о правке
 * отправила подстраховка cron-tick, — в тот же тик). Чтобы считать их свежими, понадобится время
 * последнего поста о правке: announce_snapshot хранит только содержимое.
 */
export function decideGamedayPost(
  evening: GamedayEveningLike,
  hoursBefore: number,
  nowMs: number,
): GamedayDecision {
  if (evening.status !== 'announced' || evening.gameday_posted_at !== null) return 'none';
  const startMs = Date.parse(evening.scheduled_at);
  if (!Number.isFinite(startMs) || startMs <= nowMs) return 'none';
  const windowStartMs = startMs - gamedayHours(hoursBefore) * HOUR_MS;
  if (nowMs < windowStartMs) return 'none';
  if (evening.announce_posted_at === null) return 'wait_announce';
  const announcedMs = Date.parse(evening.announce_posted_at);
  if (Number.isFinite(announcedMs) && announcedMs >= windowStartMs) return 'fresh_announce';
  return 'post';
}

// ---------------------------------------------------------------------------
// Кто идёт и кто не ответил
// ---------------------------------------------------------------------------

export interface GamedayPlayerRow {
  id: string;
  display_name: string;
  username: string | null;
  /** bigint: PostgREST отдаёт числом, но не полагаемся. */
  tg_id: number | string | null;
  is_active: boolean;
  is_guest: boolean;
}

export interface GamedayRsvpRow {
  player_id: string;
  status: string;
  updated_at: string;
}

/** Игрок в посте: имя, а для упоминания — username или tg id (если есть и годятся). */
export interface GamedayPlayer {
  id: string;
  name: string;
  /** Без «@»; только допустимое имя пользователя Telegram. */
  username: string | null;
  /** Положительное целое строкой — для ссылки tg://user?id=. */
  tgId: string | null;
}

export interface GamedayRoster {
  yes: GamedayPlayer[];
  maybe: GamedayPlayer[];
  no: GamedayPlayer[];
  /** Активные постоянные игроки без ответа на этот вечер — их пост упоминает. */
  pending: GamedayPlayer[];
}

// Имя пользователя Telegram: латиница, цифры и «_», с буквы; 4 символа бывают у коллекционных имён.
const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

function toGamedayPlayer(p: GamedayPlayerRow): GamedayPlayer {
  const username = (p.username ?? '').trim().replace(/^@/, '');
  const tg = p.tg_id === null ? '' : String(p.tg_id).trim();
  return {
    id: p.id,
    name: p.display_name,
    username: USERNAME_RE.test(username) ? username : null,
    tgId: /^[1-9]\d{0,19}$/.test(tg) ? tg : null,
  };
}

/** Ключ сортировки по имени без локали (ICU в рантайме функций не гарантирован): регистр и «ё». */
const nameKey = (name: string): string => name.trim().toLowerCase().replace(/ё/g, 'е');

function byName(a: GamedayPlayer, b: GamedayPlayer): number {
  const x = nameKey(a.name);
  const y = nameKey(b.name);
  if (x !== y) return x < y ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Списки поста — по тем же правилам, что «Ближайший вечер» на главной Mini App (groupRsvps в
 * src/pages/home/lib.ts; совпадение проверяет gameday.test.ts), чтобы пост и приложение не
 * расходились в том, кто идёт. Ответившие — все, у кого есть строка в rsvps, в порядке ответа (кто
 * раньше, тот выше), в том числе игрок, которого админ выключил уже после ответа. «Ещё не
 * ответили» — активные постоянные игроки (не гости: гость войти не может и на анонс не отвечает)
 * без строки в rsvps на этот вечер, по имени.
 */
export function gamedayRoster(
  players: readonly GamedayPlayerRow[],
  rsvps: readonly GamedayRsvpRow[],
): GamedayRoster {
  const byId = new Map(players.map((p) => [p.id, p]));
  const answered = new Set(rsvps.map((r) => r.player_id));
  const roster: GamedayRoster = { yes: [], maybe: [], no: [], pending: [] };

  const ordered = [...rsvps].sort((a, b) => {
    const d = Date.parse(a.updated_at) - Date.parse(b.updated_at);
    if (Number.isFinite(d) && d !== 0) return d;
    return a.player_id < b.player_id ? -1 : a.player_id > b.player_id ? 1 : 0;
  });
  for (const r of ordered) {
    const p = byId.get(r.player_id);
    if (!p) continue;
    if (r.status === 'yes' || r.status === 'maybe' || r.status === 'no') {
      roster[r.status].push(toGamedayPlayer(p));
    }
  }

  roster.pending = players
    .filter((p) => p.is_active && !p.is_guest && !answered.has(p.id))
    .map(toGamedayPlayer)
    .sort(byName);
  return roster;
}

// ---------------------------------------------------------------------------
// Прогнозы
// ---------------------------------------------------------------------------

export interface GamedayPredictionRow {
  winner_id: string | null;
  first_out_id: string | null;
}

/**
 * Сколько прогнозов сделано — для строки «Прогнозы закрываются со стартом — сделано N». Строка, где
 * оба поля пусты, — прогноз снят: не считается (как в «Прогнозах вечера» на экране итога).
 */
export function predictionsMade(rows: readonly GamedayPredictionRow[]): number {
  return rows.filter((r) => r.winner_id !== null || r.first_out_id !== null).length;
}
