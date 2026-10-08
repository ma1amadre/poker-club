import { DEFAULT_FORMAT } from '@domain/format.ts';
import { FIXED_TEXTS, levelTexts } from '@domain/voice.ts';
import { describe, expect, it } from 'vitest';
import {
  BOARD_FRESH_MS,
  checkInProgress,
  pregameChecks,
  pregamePlayerIds,
  pregameSummary,
  pregameVoicePlan,
  SLOW_SERVER_MS,
  voiceCheckFrom,
  type CheckItem,
  type CheckKey,
  type PregameInput,
} from './pregame';

const NOW = Date.parse('2026-10-09T11:50:00Z'); // пятница, 14:50 МСК

/** Всё в порядке: от этой точки каждый тест портит один пункт. */
const OK: PregameInput = {
  bankerName: 'Саша',
  isAdmin: false,
  server: { state: 'ok', rttMs: 180 },
  realtime: 'live',
  wake: 'held',
  board: { state: 'ready', seenAtMs: NOW - 15_000, voiceAtMs: NOW - 15_000 },
  voice: {
    state: 'ready',
    names: { unspeakable: [], unvoiced: [], total: 5 },
    missingPhrases: 0,
    totalPhrases: 40,
  },
  nowMs: NOW,
  gameDay: true,
  holdScreen: true,
};

/** Неразрывные пробелы → обычные: ожидания читаются как текст. */
const sp = (text: string | null | undefined) => (text ?? '').replace(/ /g, ' ');

function item(input: Partial<PregameInput>, key: CheckKey): CheckItem {
  const found = pregameChecks({ ...OK, ...input }).find((i) => i.key === key);
  if (!found) throw new Error(`нет пункта ${key}`);
  return found;
}

describe('pregameChecks', () => {
  it('всё в порядке — семь пунктов ok без подсказок, итог «Всё в порядке»', () => {
    const items = pregameChecks(OK);
    expect(items.map((i) => i.key)).toEqual([
      'banker',
      'server',
      'realtime',
      'wake',
      'board',
      'names',
      'phrases',
    ]);
    expect(items.every((i) => i.status === 'ok' && i.hint === null)).toBe(true);
    expect(pregameSummary(items)).toEqual({ status: 'ok', text: 'Всё в порядке' });
  });

  it('банкир не назначен: подсказка админу — где назначить, банкиру — к кому идти', () => {
    const forBanker = item({ bankerName: null }, 'banker');
    expect(forBanker.status).toBe('fail');
    expect(forBanker.hint).toBe('Попроси админа назначить банкира.');
    expect(item({ bankerName: null, isAdmin: true }, 'banker').hint).toContain(
      '«Админ» → «Вечера»',
    );
    expect(item({}, 'banker').detail).toBe('Пульт ведёт Саша.');
  });

  it('связь: проверяем → быстро ok, медленно warn, нет ответа fail', () => {
    expect(item({ server: { state: 'pending' } }, 'server').status).toBe('wait');
    expect(sp(item({}, 'server').detail)).toBe('Сервер отвечает за 180 мс.');
    expect(item({ server: { state: 'ok', rttMs: SLOW_SERVER_MS } }, 'server').status).toBe('ok');
    const slow = item({ server: { state: 'ok', rttMs: 2400 } }, 'server');
    expect(slow.status).toBe('warn');
    expect(sp(slow.detail)).toBe('Сервер ответил за 2,4 с — записи будут уходить с задержкой.');
    const failed = item({ server: { state: 'failed' } }, 'server');
    expect(failed.status).toBe('fail');
    expect(failed.hint).toContain('Проверь интернет');
  });

  it('живое обновление: live ok, подключение — ждём, обрыв и нет канала — fail', () => {
    expect(item({ realtime: 'connecting' }, 'realtime').status).toBe('wait');
    expect(item({ realtime: 'broken' }, 'realtime').status).toBe('fail');
    expect(item({ realtime: 'none' }, 'realtime').status).toBe('fail');
    expect(item({ realtime: 'broken' }, 'realtime').hint).toContain('Закрой приложение');
  });

  it('экран: удерживается — ok, ещё не ответил — ждём, отказ и нет API — подсказка про автоблокировку', () => {
    expect(item({ wake: 'released' }, 'wake').status).toBe('wait');
    for (const wake of ['denied', 'unsupported'] as const) {
      const w = item({ wake }, 'wake');
      expect(w.status).toBe('warn');
      expect(w.hint).toContain('Отключи автоблокировку');
    }
  });

  it('табло: не открывали — fail с советом открыть табло клуба', () => {
    const never = item({ board: { state: 'ready', seenAtMs: null, voiceAtMs: null } }, 'board');
    expect(never.status).toBe('fail');
    expect(never.title).toBe('Табло не открыто');
    expect(never.hint).toContain('«Табло клуба»');
  });

  it('табло: отметка старше минуты — не на связи, со временем последней отметки', () => {
    const at = NOW - BOARD_FRESH_MS - 1000;
    const stale = item({ board: { state: 'ready', seenAtMs: at, voiceAtMs: at } }, 'board');
    expect(stale.status).toBe('fail');
    expect(stale.title).toBe('Табло не на связи');
    expect(sp(stale.detail)).toBe('Последний раз отмечалось в 14:48.');
    // Ровно минута — ещё на связи.
    const edge = NOW - BOARD_FRESH_MS;
    expect(
      item({ board: { state: 'ready', seenAtMs: edge, voiceAtMs: edge } }, 'board').status,
    ).toBe('ok');
  });

  it('табло на связи, голос выключен или давно не включался — warn с советом нажать кнопку', () => {
    const off = item({ board: { state: 'ready', seenAtMs: NOW, voiceAtMs: null } }, 'board');
    expect(off.status).toBe('warn');
    expect(off.hint).toContain('«Включить голос»');
    const old = item(
      { board: { state: 'ready', seenAtMs: NOW, voiceAtMs: NOW - BOARD_FRESH_MS - 1 } },
      'board',
    );
    expect(old.status).toBe('warn');
  });

  it('до дня игры: табло клуба вечер ещё не показывает — ждём, а не сбой', () => {
    // Вторник: табло клуба на ТВ показывает «Следующая игра» и этот вечер не отмечает.
    for (const board of [
      { state: 'ready', seenAtMs: null, voiceAtMs: null },
      { state: 'ready', seenAtMs: NOW - BOARD_FRESH_MS - 1000, voiceAtMs: null },
      { state: 'pending' },
      { state: 'error' },
    ] as const) {
      const early = item({ gameDay: false, board }, 'board');
      expect(early.status).toBe('wait');
      expect(early.hint).toBeNull();
      expect(early.detail).toBe(
        'Табло клуба покажет этот вечер в день игры — тогда и проверим связь.',
      );
    }
    // Табло этого вечера открыто по его ссылке и на связи — проверка как обычно.
    expect(item({ gameDay: false }, 'board').status).toBe('ok');
    // Итог строки не красный и не «Проверяем…».
    const items = pregameChecks({
      ...OK,
      gameDay: false,
      board: { state: 'ready', seenAtMs: null, voiceAtMs: null },
    });
    expect(pregameSummary(items)).toEqual({ status: 'ok', text: 'Всё в порядке' });
  });

  it('крутилка — только у пунктов, которые проверяются сейчас', () => {
    expect(checkInProgress(item({ server: { state: 'pending' } }, 'server'))).toBe(true);
    expect(checkInProgress(item({ realtime: 'connecting' }, 'realtime'))).toBe(true);
    expect(checkInProgress(item({ gameDay: false, board: { state: 'pending' } }, 'board'))).toBe(
      false,
    );
    expect(checkInProgress(item({ holdScreen: false, wake: 'released' }, 'wake'))).toBe(false);
    expect(checkInProgress(item({}, 'banker'))).toBe(false);
  });

  it('экран до трёх часов не держим — пункт ждёт; «API нет» — сразу предупреждение', () => {
    const early = item({ holdScreen: false, wake: 'released' }, 'wake');
    expect(early.status).toBe('wait');
    expect(early.hint).toBeNull();
    expect(item({ holdScreen: false, wake: 'unsupported' }, 'wake').status).toBe('warn');
    expect(pregameSummary(pregameChecks({ ...OK, holdScreen: false, wake: 'released' }))).toEqual({
      status: 'ok',
      text: 'Всё в порядке',
    });
  });

  it('табло: ждём ответа и ошибка запроса', () => {
    expect(item({ board: { state: 'pending' } }, 'board').status).toBe('wait');
    expect(item({ board: { state: 'error' } }, 'board').status).toBe('warn');
  });

  it('имена: нечего проверять — ждём, все озвучены — ok', () => {
    const empty = item(
      {
        voice: {
          state: 'ready',
          names: { unspeakable: [], unvoiced: [], total: 0 },
          missingPhrases: 0,
          totalPhrases: 40,
        },
      },
      'names',
    );
    expect(empty.status).toBe('wait');
    expect(item({}, 'names').detail).toBe('Табло назовёт по имени всех 5.');
  });

  it('имена: латиница и неозвученные — warn, обе причины и обе подсказки; админу — как запустить озвучку', () => {
    const voice: PregameInput['voice'] = {
      state: 'ready',
      names: { unspeakable: ['Alex'], unvoiced: ['Петя', 'Вова'], total: 6 },
      missingPhrases: 0,
      totalPhrases: 40,
    };
    const names = item({ voice }, 'names');
    expect(names.status).toBe('warn');
    expect(sp(names.detail)).toBe(
      'Табло не прочитает имя: Alex. Ещё не озвучены: Петя и Вова. Нокауты и победу табло объявит без имени.',
    );
    expect(names.hint).toContain('«Имя на табло»');
    expect(names.hint).toContain('попроси админа');
    expect(item({ voice, isAdmin: true }, 'names').hint).toContain('Run workflow');
  });

  it('фразы: недостающие — warn с числом', () => {
    const phrases = item(
      {
        voice: {
          state: 'ready',
          names: { unspeakable: [], unvoiced: [], total: 5 },
          missingPhrases: 3,
          totalPhrases: 40,
        },
      },
      'phrases',
    );
    expect(phrases.status).toBe('warn');
    expect(phrases.detail).toBe('Нет 3 из 40 — эти объявления табло пропустит.');
  });

  it('голос: ждём и ошибка — оба пункта', () => {
    expect(item({ voice: { state: 'pending' } }, 'names').status).toBe('wait');
    expect(item({ voice: { state: 'pending' } }, 'phrases').status).toBe('wait');
    expect(item({ voice: { state: 'error' } }, 'names').status).toBe('warn');
    expect(item({ voice: { state: 'error' } }, 'phrases').status).toBe('warn');
  });
});

describe('pregameSummary', () => {
  it('сбой важнее предупреждения, считаются оба', () => {
    const summary = pregameSummary(pregameChecks({ ...OK, bankerName: null, wake: 'denied' }));
    expect(summary.status).toBe('fail');
    expect(sp(summary.text)).toBe('2 пункта — посмотри');
  });

  it('одно предупреждение', () => {
    const summary = pregameSummary(pregameChecks({ ...OK, wake: 'denied' }));
    expect(summary.status).toBe('warn');
    expect(sp(summary.text)).toBe('1 пункт — посмотри');
  });

  it('пока что-то проверяется — «Проверяем…»; «некого проверять» итог не держит', () => {
    expect(pregameSummary(pregameChecks({ ...OK, server: { state: 'pending' } })).status).toBe(
      'wait',
    );
    const nobody = pregameChecks({
      ...OK,
      voice: {
        state: 'ready',
        names: { unspeakable: [], unvoiced: [], total: 0 },
        missingPhrases: 0,
        totalPhrases: 40,
      },
    });
    expect(pregameSummary(nobody)).toEqual({ status: 'ok', text: 'Всё в порядке' });
  });
});

describe('pregamePlayerIds', () => {
  const rsvps = [
    { player_id: 'a', status: 'yes' as const },
    { player_id: 'b', status: 'no' as const },
    { player_id: 'c', status: 'yes' as const },
    { player_id: 'd', status: 'maybe' as const },
  ];

  it('до старта — посаженные и ответившие «иду», без повторов', () => {
    expect(pregamePlayerIds({ joinOrder: ['c', 'x'] }, rsvps, false)).toEqual(['c', 'x', 'a']);
  });

  it('в игре — только те, кто садился за стол', () => {
    expect(pregamePlayerIds({ joinOrder: ['c', 'x'] }, rsvps, true)).toEqual(['c', 'x']);
  });
});

describe('pregameVoicePlan и voiceCheckFrom', () => {
  const players = [
    { id: 'a', display_name: 'Саша' },
    { id: 'b', display_name: 'Alex' },
    { id: 'c', display_name: 'Alex Petrov', spoken_name: 'Алекс' },
    { id: 'd', display_name: 'Петя' },
  ];

  it('имя — как скажет табло: своё имя для озвучки, кириллица из имени в клубе, иначе null', () => {
    const plan = pregameVoicePlan(DEFAULT_FORMAT, players);
    expect(plan.names.map((n) => n.text)).toEqual(['Саша', null, 'Алекс', 'Петя']);
  });

  it('фразы — уровни формата и фиксированные, без повторов', () => {
    const plan = pregameVoicePlan(DEFAULT_FORMAT, players);
    const expected = new Set([...levelTexts(DEFAULT_FORMAT), ...FIXED_TEXTS]);
    expect(new Set(plan.phrases)).toEqual(expected);
    expect(plan.phrases).toHaveLength(expected.size);
  });

  it('итог по найденным клипам: кто не прочитается, кто не озвучен, сколько фраз нет', () => {
    const plan = pregameVoicePlan(DEFAULT_FORMAT, players);
    const voiced = new Set(['Саша', 'Алекс', ...plan.phrases.slice(2)]);
    const check = voiceCheckFrom(plan, (t) => voiced.has(t));
    expect(check.names).toEqual({ unspeakable: ['Alex'], unvoiced: ['Петя'], total: 4 });
    expect(check.missingPhrases).toBe(2);
    expect(check.totalPhrases).toBe(plan.phrases.length);
  });
});
