// Пост в день игры (миграция 014): когда писать, кто в каких списках, текст поста.
import { describe, expect, it } from 'vitest';
import {
  decideGamedayPost,
  gamedayHours,
  gamedayRoster,
  type GamedayEveningLike,
  type GamedayPlayerRow,
  type GamedayRoster,
  type GamedayRsvpRow,
} from './gameday.ts';
import {
  gamedayPost,
  mentionHtml,
  TELEGRAM_TEXT_LIMIT,
  visibleLength,
  type GamedayPostInput,
} from './messages.ts';
// Пост и главная Mini App должны одинаково считать, кто идёт (см. gamedayRoster).
import { groupRsvps } from '../../../src/pages/home/lib.ts';

const HOUR = 60 * 60 * 1000;
const THU = '2026-10-08T16:00:00.000Z'; // четверг, 19:00 МСК
const START = Date.parse(THU);

const evening = (over: Partial<GamedayEveningLike> = {}): GamedayEveningLike => ({
  scheduled_at: THU,
  status: 'announced',
  announce_posted_at: '2026-10-06T16:00:00.000Z', // за 48 ч
  gameday_posted_at: null,
  ...over,
});

describe('decideGamedayPost', () => {
  it('окно — последние N часов до начала, границы включительно с начала окна', () => {
    expect(decideGamedayPost(evening(), 5, START - 5 * HOUR - 1)).toBe('none');
    expect(decideGamedayPost(evening(), 5, START - 5 * HOUR)).toBe('post');
    expect(decideGamedayPost(evening(), 5, START - 1)).toBe('post');
    expect(decideGamedayPost(evening(), 5, START)).toBe('none');
    expect(decideGamedayPost(evening(), 5, START + HOUR)).toBe('none');
    expect(decideGamedayPost(evening(), 24, START - 20 * HOUR)).toBe('post');
  });

  it('только объявленный вечер и только один раз', () => {
    const now = START - 3 * HOUR;
    for (const status of ['live', 'finished', 'settled', 'cancelled']) {
      expect(decideGamedayPost(evening({ status }), 5, now)).toBe('none');
    }
    expect(
      decideGamedayPost(evening({ gameday_posted_at: '2026-10-08T11:00:00.000Z' }), 5, now),
    ).toBe('none');
  });

  it('анонс ещё не уходил — ждём его, а не шлём пост дня игры первым', () => {
    expect(decideGamedayPost(evening({ announce_posted_at: null }), 5, START - 3 * HOUR)).toBe(
      'wait_announce',
    );
  });

  it('анонс ушёл внутри окна (в том числе в этот же тик) — отметить без поста', () => {
    const now = START - 3 * HOUR;
    expect(
      decideGamedayPost(evening({ announce_posted_at: new Date(now).toISOString() }), 5, now),
    ).toBe('fresh_announce');
    expect(
      decideGamedayPost(
        evening({ announce_posted_at: new Date(START - 5 * HOUR).toISOString() }),
        5,
        now,
      ),
    ).toBe('fresh_announce');
    // Анонс за минуту до окна — уже не свежий: пост дня игры нужен.
    expect(
      decideGamedayPost(
        evening({ announce_posted_at: new Date(START - 5 * HOUR - 60_000).toISOString() }),
        5,
        now,
      ),
    ).toBe('post');
  });

  it('перенос на другой день после «свежего анонса» — в новый день пост уходит', () => {
    // Анонс за 5 ч (четверг, 14:00 МСК) погасил пост дня игры; вечер перенесли на пятницу 19:00,
    // триггер миграции 014 снял gameday_posted_at, announce_posted_at остался прежним.
    const moved = evening({
      scheduled_at: '2026-10-09T16:00:00.000Z',
      announce_posted_at: new Date(START - 5 * HOUR).toISOString(),
      gameday_posted_at: null,
    });
    expect(decideGamedayPost(moved, 5, Date.parse('2026-10-09T11:00:00.000Z'))).toBe('post');
  });

  it('кривое число часов — по умолчанию 5', () => {
    expect(gamedayHours(0)).toBe(5);
    expect(gamedayHours(49)).toBe(5);
    expect(gamedayHours('6')).toBe(6);
    expect(gamedayHours(null)).toBe(5);
    expect(decideGamedayPost(evening(), 0, START - 4 * HOUR)).toBe('post');
    expect(decideGamedayPost(evening(), 0, START - 6 * HOUR)).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// Списки
// ---------------------------------------------------------------------------

const player = (
  id: string,
  name: string,
  over: Partial<GamedayPlayerRow> = {},
): GamedayPlayerRow => ({
  id,
  display_name: name,
  username: null,
  tg_id: null,
  is_active: true,
  is_guest: false,
  ...over,
});

const PLAYERS: GamedayPlayerRow[] = [
  player('p1', 'Женя', { username: 'zhenya', tg_id: 1001 }),
  player('p2', 'Саша', { username: 'sasha', tg_id: 1002 }),
  player('p3', 'Дима', { username: 'dima_k', tg_id: 1003 }),
  player('p4', 'Лёша', { tg_id: 1004 }),
  player('p5', 'Миша', { tg_id: '1005' }),
  player('p6', 'Костя', { username: 'kostya_k', tg_id: 1006 }),
  player('g1', 'Вова (гость)', { is_guest: true }),
  player('x1', 'Ушедший', { is_active: false, tg_id: 1007 }),
];

const rsvp = (player_id: string, status: string, minute: number): GamedayRsvpRow => ({
  player_id,
  status,
  updated_at: new Date(Date.parse('2026-10-06T17:00:00Z') + minute * 60_000).toISOString(),
});

// 2 идут, 1 под вопросом, 1 не идёт, 2 не ответили (Костя — с username, Миша — без).
const RSVPS: GamedayRsvpRow[] = [
  rsvp('p2', 'yes', 5),
  rsvp('p1', 'yes', 1),
  rsvp('p3', 'maybe', 2),
  rsvp('p4', 'no', 3),
];

const ids = (roster: GamedayRoster) => ({
  yes: roster.yes.map((p) => p.id),
  maybe: roster.maybe.map((p) => p.id),
  no: roster.no.map((p) => p.id),
  pending: roster.pending.map((p) => p.id),
});

describe('gamedayRoster', () => {
  it('ответившие — в порядке ответа; не ответили — активные постоянные без строки rsvps, по имени', () => {
    expect(ids(gamedayRoster(PLAYERS, RSVPS))).toEqual({
      yes: ['p1', 'p2'],
      maybe: ['p3'],
      no: ['p4'],
      pending: ['p6', 'p5'], // Костя, Миша
    });
  });

  it('выключенный админом после ответа остаётся среди ответивших, в «не ответили» — нет', () => {
    const roster = gamedayRoster(PLAYERS, [...RSVPS, rsvp('x1', 'yes', 4)]);
    expect(ids(roster).yes).toEqual(['p1', 'x1', 'p2']);
    expect(ids(gamedayRoster(PLAYERS, RSVPS)).pending).not.toContain('x1');
  });

  it('списки — как «Ближайший вечер» на главной Mini App (groupRsvps)', () => {
    const all = [
      ...RSVPS,
      rsvp('x1', 'yes', 4), // выключен после ответа
      rsvp('g1', 'maybe', 6), // гостя отметил админ
      rsvp('gone', 'yes', 7), // строки игрока нет — пропускается
    ];
    const app = groupRsvps(
      PLAYERS.map((p) => ({ ...p, photo_url: null })),
      // Mini App получает ответы по updated_at (useRsvps), gamedayRoster сортирует сам.
      [...all]
        .sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at))
        .map((r) => ({ player_id: r.player_id, status: r.status as 'yes' | 'maybe' | 'no' })),
    );
    const post = ids(gamedayRoster(PLAYERS, all));
    const appIds = (list: readonly { id: string }[]) => list.map((p) => p.id);
    expect(post.yes).toEqual(appIds(app.yes));
    expect(post.maybe).toEqual(appIds(app.maybe));
    expect(post.no).toEqual(appIds(app.no));
    // Молчунов приложение сортирует через localeCompare, пост — без локали: сверяем состав.
    expect([...post.pending].sort()).toEqual(appIds(app.silent).sort());
  });

  it('гости и выключенные игроки в «не ответили» не попадают', () => {
    const pending = gamedayRoster(PLAYERS, []).pending.map((p) => p.id);
    expect(pending).not.toContain('g1');
    expect(pending).not.toContain('x1');
    expect(pending).toHaveLength(6);
  });

  it('username и tg id для упоминания — только годные', () => {
    const roster = gamedayRoster(
      [
        player('a', 'А', { username: '@good_name', tg_id: 1 }),
        player('b', 'Б', { username: 'bad name', tg_id: 'abc' }),
        player('c', 'В', { username: '', tg_id: 0 }),
      ],
      [],
    );
    expect(roster.pending.map((p) => [p.username, p.tgId])).toEqual([
      ['good_name', '1'],
      [null, null],
      [null, null],
    ]);
  });

  it('сортировка имён без локали: регистр и «ё» не мешают', () => {
    const roster = gamedayRoster(
      [player('1', 'ёжик'), player('2', 'Жора'), player('3', 'Ефим'), player('4', 'артём')],
      [],
    );
    expect(roster.pending.map((p) => p.name)).toEqual(['артём', 'ёжик', 'Ефим', 'Жора']);
  });
});

// ---------------------------------------------------------------------------
// Текст
// ---------------------------------------------------------------------------

const NOW = START - 5 * HOUR; // четверг, 14:00 МСК

const input = (over: Partial<GamedayPostInput> = {}): GamedayPostInput => ({
  eveningId: 'e1',
  scheduledAt: THU,
  location: 'У Жени',
  bankerName: 'Саша',
  roster: gamedayRoster(PLAYERS, RSVPS),
  botUsername: 'poker_club_bot',
  nowMs: NOW,
  ...over,
});

// Даты склеены неразрывным пробелом — для сравнения заменяем обычным.
const plain = (text: string) => text.replace(/ /g, ' ');

describe('mentionHtml', () => {
  it('username — «Имя (@username)», без него — ссылка по tg id, без tg id — имя', () => {
    expect(mentionHtml({ id: '1', name: 'Костя', username: 'kostya_k', tgId: '1006' })).toBe(
      'Костя (@kostya_k)',
    );
    expect(mentionHtml({ id: '1', name: 'Миша', username: null, tgId: '1005' })).toBe(
      '<a href="tg://user?id=1005">Миша</a>',
    );
    expect(mentionHtml({ id: '1', name: 'Петя', username: null, tgId: null })).toBe('Петя');
  });

  it('имя экранируется, «@username» вместо имени не повторяется', () => {
    expect(mentionHtml({ id: '1', name: '<b>Вася</b> & Co', username: null, tgId: '7' })).toBe(
      '<a href="tg://user?id=7">&lt;b&gt;Вася&lt;/b&gt; &amp; Co</a>',
    );
    expect(mentionHtml({ id: '1', name: '@Kostya_K', username: 'kostya_k', tgId: '1' })).toBe(
      '@kostya_k',
    );
  });
});

describe('gamedayPost', () => {
  it('2 идут, 1 под вопросом, 1 не идёт, 2 не ответили, банкира нет', () => {
    const post = gamedayPost(input({ bankerName: null }));
    expect(post.text).toBe(
      [
        '♠️ <b>Сегодня покер в 19:00</b>',
        'Место: У Жени',
        'Банкир пока не назначен',
        '',
        'Идут (2): Женя и Саша',
        'Под вопросом (1): Дима',
        'Не идут (1): Лёша',
        'Ещё не ответили (2): Костя (@kostya_k) и <a href="tg://user?id=1005">Миша</a>',
        '',
        'Кто ещё не ответил или под вопросом — отметьтесь, идёте ли.',
      ].join('\n'),
    );
    expect(post.buttons).toEqual([
      { text: '♣️ Иду / не иду', url: 'https://t.me/poker_club_bot?startapp=e_e1' },
    ]);
  });

  it('банкир и место есть — по имени; нет места — так и пишем', () => {
    const text = gamedayPost(input({ location: '  ' })).text;
    expect(text).toContain('\nМесто пока не назначено\n');
    expect(text).toContain('\nБанкир: Саша\n');
  });

  it('всё пользовательское экранируется', () => {
    const text = gamedayPost(
      input({
        location: 'У <Жени> & Ко',
        bankerName: '<i>Саша</i>',
        roster: gamedayRoster([player('a', 'А<б>', { username: 'a_user' })], [rsvp('a', 'yes', 1)]),
      }),
    ).text;
    expect(text).toContain('Место: У &lt;Жени&gt; &amp; Ко');
    expect(text).toContain('Банкир: &lt;i&gt;Саша&lt;/i&gt;');
    expect(text).toContain('Идут (1): А&lt;б&gt;');
  });

  it('пустые списки: «пока никто», без строк «под вопросом» и «не идут»; все ответили — строка про планы', () => {
    const empty = gamedayPost(
      input({ roster: { yes: [], maybe: [], no: [], pending: [] } }),
    ).text.split('\n');
    expect(empty).toContain('Идут: пока никто');
    expect(
      empty.some(
        (l) =>
          l.startsWith('Под вопросом') ||
          l.startsWith('Не идут') ||
          l.startsWith('Ещё не ответили'),
      ),
    ).toBe(false);
    expect(empty.at(-1)).toBe('Если планы поменялись, обновите ответ «иду / не иду».');

    const onlyPending = gamedayPost(
      input({
        roster: gamedayRoster(
          PLAYERS,
          RSVPS.filter((r) => r.status !== 'maybe'),
        ),
      }),
    ).text;
    expect(onlyPending.split('\n').at(-1)).toBe('Кто ещё не ответил — отметьтесь, идёте ли.');

    const answeredAll = gamedayRoster(
      PLAYERS.filter((p) => ['p1', 'p3'].includes(p.id)),
      RSVPS.filter((r) => ['p1', 'p3'].includes(r.player_id)),
    );
    expect(
      gamedayPost(input({ roster: answeredAll }))
        .text.split('\n')
        .at(-1),
    ).toBe('Кто под вопросом — отметьтесь, идёте ли.');
  });

  it('«сегодня» и «завтра» — по московскому календарю, дальше — с датой', () => {
    const late = '2026-10-08T22:30:00.000Z'; // пятница, 01:30 МСК
    expect(
      plain(gamedayPost(input({ scheduledAt: late, nowMs: Date.parse(late) - 5 * HOUR })).text),
    ).toMatch(/^♠️ <b>Завтра покер в 01:30<\/b>/);
    expect(
      plain(gamedayPost(input({ nowMs: START - 30 * HOUR })).text), // среда, 13:00 МСК
    ).toMatch(/^♠️ <b>Завтра покер в 19:00<\/b>/);
    expect(
      plain(gamedayPost(input({ nowMs: START - 47 * HOUR })).text), // вторник
    ).toMatch(/^♠️ <b>Покер в четверг, 8 октября, в 19:00<\/b>/);
  });

  it('без имени бота — без кнопки', () => {
    expect(gamedayPost(input({ botUsername: null })).buttons).toEqual([]);
  });
});

describe('gamedayPost: лимит Telegram на длину текста', () => {
  // Крупная группа: tg-auth заводит игрока на каждого участника, открывшего Mini App.
  const crowd = (n: number, name: (i: number) => string, prefix = 'c'): GamedayPlayerRow[] =>
    Array.from({ length: n }, (_, i) =>
      player(
        `${prefix}${String(i).padStart(4, '0')}`,
        name(i),
        i % 3 === 0 ? { tg_id: 10_000 + i } : { username: `alex_petrov_${i}`, tg_id: 10_000 + i },
      ),
    );
  const petrov = (i: number) => `Александр Петров${i}`;
  const yes8 = (players: GamedayPlayerRow[]) =>
    players.slice(0, 8).map((p, i) => rsvp(p.id, 'yes', i));

  it('visibleLength: без тегов, сущность — один символ', () => {
    expect(visibleLength('<b>А&amp;Б</b> <a href="tg://user?id=1">&lt;В&gt;</a>')).toBe(7);
    expect(TELEGRAM_TEXT_LIMIT).toBe(4096);
  });

  it('небольшой состав не режется', () => {
    const players = crowd(60, petrov);
    const text = gamedayPost(input({ roster: gamedayRoster(players, yes8(players)) })).text;
    expect(text).not.toContain('и ещё');
    expect(text).toContain('Ещё не ответили (52): ');
  });

  it('140 и 400 молчунов — пост влезает в 4096, хвост «и ещё N» без упоминаний, счётчик полный', () => {
    for (const n of [140, 400]) {
      const players = crowd(n, petrov);
      const roster = gamedayRoster(players, yes8(players));
      const text = gamedayPost(input({ roster })).text;
      expect(visibleLength(text)).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
      // «Идут» — короткий список, его не трогаем; режем самый длинный.
      expect(text).toContain(`Идут (8): ${joinAll(roster.yes)}`);
      const line = text.split('\n').find((l) => l.startsWith('Ещё не ответили')) ?? '';
      const m = /^Ещё не ответили \((\d+)\): (.+) и ещё (\d+)$/.exec(line);
      expect(m).not.toBeNull();
      const [, total, shownPart, rest] = m ?? [];
      expect(Number(total)).toBe(n - 8);
      const shown = (shownPart ?? '').split(', ');
      expect(shown.length + Number(rest)).toBe(n - 8);
      // Показаны первые по имени — ровно те упоминания, что строит mentionHtml.
      expect(shown).toEqual(roster.pending.slice(0, shown.length).map(mentionHtml));
      expect(text.split('\n').at(-1)).toBe('Кто ещё не ответил — отметьтесь, идёте ли.');
    }
  });

  it('имена по 128 символов — тоже влезает', () => {
    const players = crowd(200, (i) => `${'Я'.repeat(120)}${String(i).padStart(8, '0')}`);
    const text = gamedayPost(input({ roster: gamedayRoster(players, yes8(players)) })).text;
    expect(visibleLength(text)).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
    expect(text).toMatch(/\nЕщё не ответили \(192\): .+ и ещё \d+\n/);
  });

  it('длинные списки ответивших режутся по очереди — самый длинный первым', () => {
    const players = crowd(600, petrov);
    const rsvps = players.map((p, i) =>
      rsvp(p.id, i < 300 ? 'yes' : i < 310 ? 'maybe' : i < 550 ? 'no' : 'maybe', i),
    );
    const text = gamedayPost(input({ roster: gamedayRoster(players, rsvps) })).text;
    expect(visibleLength(text)).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
    const lines = text.split('\n');
    expect(lines.find((l) => l.startsWith('Идут'))).toMatch(/^Идут \(300\): .+ и ещё \d+$/);
    expect(lines.find((l) => l.startsWith('Не идут'))).toMatch(/^Не идут \(240\): .+ и ещё \d+$/);
    // 60 «под вопросом» короче обрезанных списков — остаются целиком.
    expect(lines.find((l) => l.startsWith('Под вопросом'))).toMatch(/^Под вопросом \(60\): [^]+$/);
    expect(lines.find((l) => l.startsWith('Под вопросом'))).not.toContain('и ещё');
    expect(lines.some((l) => l.startsWith('Ещё не ответили'))).toBe(false);
  });
});

const joinAll = (list: readonly { name: string }[]): string => {
  const names = list.map((p) => p.name);
  return names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`;
};
