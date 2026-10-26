import { DEFAULT_FORMAT } from '@domain/format.ts';
import { replayLog } from '@domain/replay.ts';
import { journal, MIN, type Journal } from '@domain/test-utils.ts';
import { describe, expect, it } from 'vitest';
import type { TournamentFormat } from '@domain/types.ts';
import {
  closedAtRiver,
  detectMoments,
  dropStale,
  enqueue,
  FRESH_MOMENT_MS,
  stayedAfterRiver,
  stillValid,
  withoutLevel,
  type Moment,
  type MomentFrame,
} from './moments';

const F = DEFAULT_FORMAT;

/** Кадр табло на момент nowMs (как раз в секунду на ТВ). */
function step(
  j: Journal,
  prev: MomentFrame | null,
  opts: { nowMs?: number; allIn?: boolean; format?: TournamentFormat } = {},
) {
  const nowMs = opts.nowMs ?? j.now();
  const live = j.events.filter((e) => !e.voided);
  const { state, applied } = replayLog(opts.format ?? F, live, nowMs);
  return detectMoments(prev, { events: live, applied, state, nowMs, allIn: opts.allIn ?? false });
}

function game(): Journal {
  const j = journal().join('a', 'b', 'c', 'd');
  j.start();
  return j;
}

describe('моменты табло: первый кадр и уровень', () => {
  it('первый кадр — точка отсчёта: история вечера не разыгрывается', () => {
    const j = game();
    j.wait(50).bust('d', ['a']);
    expect(step(j, null).moments).toEqual([]);
  });

  it('уровень вырос по часам — заставка «с прежнего на новый»; дальше — не повторяется', () => {
    const j = game();
    let f = step(j, null).frame;
    j.wait(39);
    f = step(j, f).frame;
    j.wait(2);
    const r = step(j, f);
    expect(r.moments).toEqual([{ kind: 'level', from: 0, to: 1, at: j.now() }]);
    j.wait(1 / 60);
    expect(step(j, r.frame).moments).toEqual([]);
  });

  it('«Следующий уровень» банкира — тоже заставка; назад (level_prev) — без неё, а следующий подъём — снова с ней', () => {
    const j = game();
    let f = step(j, null).frame;
    j.wait(1);
    j.next();
    let r = step(j, f);
    expect(r.moments).toEqual([{ kind: 'level', from: 0, to: 1, at: j.now() }]);
    f = r.frame;
    j.wait(1);
    j.prev();
    r = step(j, f);
    expect(r.moments).toEqual([]);
    f = r.frame;
    j.wait(1);
    j.next();
    expect(step(j, f).moments).toEqual([{ kind: 'level', from: 0, to: 1, at: j.now() }]);
  });

  it('во время олл-ина смена уровня заставкой не идёт и потом не догоняет', () => {
    const j = game();
    let f = step(j, null).frame;
    j.wait(1);
    j.next();
    const r = step(j, f, { allIn: true });
    expect(r.moments).toEqual([]);
    f = r.frame;
    j.wait(1 / 60);
    expect(step(j, f).moments).toEqual([]);
  });
});

describe('моменты табло: нокаут', () => {
  it('новый окончательный вылет — нокаут с выбившими', () => {
    const j = game();
    const f = step(j, null).frame;
    j.wait(5);
    const id = j.bust('d', ['a', 'b']);
    expect(step(j, f).moments).toEqual([
      { kind: 'ko', eventId: id, victim: 'd', by: ['a', 'b'], at: j.now() },
    ]);
  });

  it('уровень «по вылетам» вырос из-за этого вылета — сначала нокаут (причина), потом заставка уровня', () => {
    const byBusts: TournamentFormat = {
      ...F,
      levels: F.levels.map((l, i) =>
        i === 0 ? { ...l, trigger: { type: 'eliminations', count: 1 } } : l,
      ),
    };
    const j = game();
    const f = step(j, null, { format: byBusts }).frame;
    j.wait(5);
    j.bust('d', ['a']);
    expect(step(j, f, { format: byBusts }).moments.map((m) => m.kind)).toEqual(['ko', 'level']);
  });

  it('вылет и ребай одной пачкой опроса — без заставки (игрок в игре)', () => {
    const j = game();
    const f = step(j, null).frame;
    j.wait(5);
    j.bust('d', ['a']);
    j.rebuy('d');
    expect(step(j, f).moments).toEqual([]);
  });

  it('несвежий вылет (табло долго было без связи) — без заставки', () => {
    const j = game();
    const f = step(j, null).frame;
    j.wait(5);
    j.bust('d', ['a']);
    expect(step(j, f, { nowMs: j.now() + FRESH_MOMENT_MS + MIN }).moments).toEqual([]);
  });

  it('нокаут во время олл-ина — в очереди (покажется на столе после возврата)', () => {
    const j = game();
    const f = step(j, null).frame;
    j.wait(5);
    j.bust('d', ['a']);
    expect(step(j, f, { allIn: true }).moments).toHaveLength(1);
  });
});

describe('моменты табло: очередь', () => {
  it('смены уровня подряд склеиваются в одну заставку; нокаут один раз', () => {
    const ko: Moment = { kind: 'ko', eventId: 7, victim: 'd', by: [], at: 5 };
    const q = enqueue(
      [{ kind: 'level', from: 2, to: 3, at: 1 }],
      [ko, { kind: 'level', from: 3, to: 4, at: 6 }, ko],
    );
    expect(q).toEqual([{ kind: 'level', from: 2, to: 4, at: 6 }, ko]);
  });

  it('олл-ин начался — заставка уровня из очереди снимается, нокауты ждут возврата к столу', () => {
    const ko: Moment = { kind: 'ko', eventId: 7, victim: 'd', by: [], at: 5 };
    expect(withoutLevel([{ kind: 'level', from: 2, to: 3, at: 1 }, ko])).toEqual([ko]);
  });

  it('вкладка снова видна — несвежее из очереди выбрасывается, свежее остаётся', () => {
    const now = 10 * 60_000;
    const old: Moment = { kind: 'ko', eventId: 1, victim: 'c', by: [], at: now - 8 * 60_000 };
    const lvl: Moment = { kind: 'level', from: 2, to: 3, at: now - FRESH_MOMENT_MS - 1 };
    const fresh: Moment = { kind: 'ko', eventId: 2, victim: 'd', by: [], at: now - 30_000 };
    expect(dropStale([old, lvl, fresh], now)).toEqual([fresh]);
  });

  it('перед показом: нокаут после ребая или отмены — уже не в силе; уровень назад — тоже', () => {
    const j = game();
    j.wait(5);
    const id = j.bust('d', ['a']);
    const ko: Moment = { kind: 'ko', eventId: id, victim: 'd', by: ['a'], at: j.now() };
    expect(stillValid(ko, replayLog(F, j.events, j.now()).state)).toBe(true);
    j.rebuy('d');
    expect(stillValid(ko, replayLog(F, j.events, j.now()).state)).toBe(false);
    const level: Moment = { kind: 'level', from: 0, to: 1, at: j.now() };
    expect(stillValid(level, replayLog(F, j.events, j.now()).state)).toBe(false);
    j.next();
    expect(stillValid(level, replayLog(F, j.events, j.now()).state)).toBe(true);
  });
});

describe('моменты табло: развязка олл-ина', () => {
  const SD = '5d000000-0000-4000-8000-000000000001';
  const RIVER = ['Ks', '7d', '2c', '5h', 'Qc'] as const;

  function hand(j: Journal, board: readonly string[]) {
    j.showdown(
      SD,
      [
        ['a', 'As', 'Kh'],
        ['b', 'Qh', 'Qd'],
      ],
      [...board],
    );
  }

  it('раздачу закрыл ответ банкира на ривере — экран олл-ина задерживается на развязку', () => {
    const j = game();
    hand(j, RIVER);
    j.bust('b', ['a']);
    j.closeShowdown(SD);
    const { state, applied } = replayLog(F, j.events, j.now());
    expect(state.showdown).toBeNull();
    expect(closedAtRiver({ showdownId: SD, board: RIVER }, applied)).toBe(true);
  });

  it('ривер спрятало время (ответа нет), закрыли до ривера или закрыли другую раздачу — сразу к столу', () => {
    const j = game();
    hand(j, RIVER);
    const { applied } = replayLog(F, j.events, j.now() + 10 * MIN);
    expect(closedAtRiver({ showdownId: SD, board: RIVER }, applied)).toBe(false);
    const k = game();
    hand(k, RIVER.slice(0, 3));
    k.closeShowdown(SD);
    const before = replayLog(F, k.events, k.now()).applied;
    expect(closedAtRiver({ showdownId: SD, board: RIVER.slice(0, 3) }, before)).toBe(false);
    expect(closedAtRiver({ showdownId: 'other', board: RIVER }, before)).toBe(false);
  });

  it('«остаётся в игре» — проигравшие в игре и не вылетевшие в раздаче; вылетел и докупился — тоже остаётся', () => {
    const alive = new Set(['b', 'c']);
    const stayed = stayedAfterRiver(['b', 'c', 'd'], new Set(['d']), (id) => alive.has(id));
    expect([...stayed]).toEqual(['b', 'c']);
    expect([...stayedAfterRiver(['d'], new Set(['d']), () => false)]).toEqual([]);
  });
});

describe('моменты табло: бомб-пот (миграция 030)', () => {
  function seated(): Journal {
    const j = journal().join('a', 'b', 'c', 'd');
    j.seat('a', 1);
    j.seat('b', 3);
    j.seat('c', 5);
    j.seat('d', 8);
    j.button(3);
    j.start();
    j.wait(1);
    return j;
  }

  it('свежая запись bomb_pot — сцена; старше 10 с (табло было без связи) — без сцены, сразу бейдж', () => {
    const j = seated();
    let f = step(j, null).frame;
    const id = j.bombPot(3);
    const r = step(j, f, { nowMs: j.now() + 2000 });
    expect(r.moments).toMatchObject([{ kind: 'bomb', eventId: id, at: j.now() }]);
    expect(r.frame.bomb?.eventId).toBe(id);

    const k = seated();
    f = step(k, null).frame;
    k.bombPot(2);
    expect(step(k, f, { nowMs: k.now() + 11_000 }).moments).toEqual([]);
  });

  it('первый кадр посреди бомб-пота — точка отсчёта: сцены нет', () => {
    const j = seated();
    j.bombPot(4);
    expect(step(j, null).moments).toEqual([]);
  });

  it('«Кто забрал» и раздача одним действием — развязка с забравшим; «Не отмечать» — без забравших', () => {
    const j = seated();
    let f = step(j, null).frame;
    const id = j.bombPot(3);
    f = step(j, f).frame;
    j.wait(3);
    j.bombPotResult(id, ['d']);
    j.hand();
    const r = step(j, f);
    expect(r.moments).toMatchObject([{ kind: 'bomb_end', eventId: id, winners: ['d'] }]);
    expect(r.frame.bomb).toBeNull();

    const k = seated();
    f = step(k, null).frame;
    const id2 = k.bombPot(1);
    f = step(k, f).frame;
    k.hand();
    expect(step(k, f).moments).toMatchObject([{ kind: 'bomb_end', eventId: id2, winners: [] }]);
  });

  it('отмена — «ОТМЕНЁН»; переброс в той же раздаче — новая сцена', () => {
    const j = seated();
    let f = step(j, null).frame;
    const id = j.bombPot(4);
    f = step(j, f).frame;
    j.voidEvent(id);
    let r = step(j, f);
    expect(r.moments).toMatchObject([{ kind: 'bomb_cancel', eventId: id }]);
    f = r.frame;
    const id2 = j.bombPot(2, [4]);
    r = step(j, f);
    expect(r.moments).toMatchObject([{ kind: 'bomb', eventId: id2 }]);
  });

  it('финиш закрывает бомб-пот — без развязки: табло уходит в итог', () => {
    const j = seated();
    let f = step(j, null).frame;
    j.bombPot(3);
    f = step(j, f).frame;
    j.bust('a', ['b']);
    j.bust('c', ['b']);
    j.bust('d', ['b']);
    j.finish();
    expect(step(j, f).moments.some((m) => m.kind === 'bomb_end' || m.kind === 'bomb_cancel')).toBe(
      false,
    );
  });

  it('следующая раздача с новым бомб-потом — сперва развязка прежнего, потом новая сцена', () => {
    const j = seated();
    let f = step(j, null).frame;
    const id = j.bombPot(3);
    f = step(j, f).frame;
    j.hand();
    const id2 = j.bombPot(5);
    expect(
      step(j, f).moments.map((m) =>
        m.kind === 'bomb' || m.kind === 'bomb_end' ? `${m.kind}:${m.eventId}` : m.kind,
      ),
    ).toEqual([`bomb_end:${id}`, `bomb:${id2}`]);
  });

  it('очередь: отмена сцены, которая ещё ждёт, снимает её молча; повтор не задваивается', () => {
    const j = seated();
    const f = step(j, null).frame;
    const id = j.bombPot(3);
    const bomb = step(j, f).moments;
    const q = enqueue(enqueue([], bomb), bomb);
    expect(q).toHaveLength(1);
    const bp = bomb[0];
    if (!bp || bp.kind !== 'bomb') throw new Error('нет сцены');
    const cancel: Moment = { kind: 'bomb_cancel', eventId: id, bombPot: bp.bombPot, at: j.now() };
    expect(enqueue(q, [cancel])).toEqual([]);
  });

  it('очередь: сцена объявления — впереди ждущих нокаутов, заставка уровня снимается; после развязки прошлого', () => {
    const j = seated();
    const f = step(j, null).frame;
    const id = j.bombPot(3);
    const [bomb] = step(j, f).moments;
    if (!bomb || bomb.kind !== 'bomb') throw new Error('нет сцены');
    const ko = (eventId: number): Moment => ({ kind: 'ko', eventId, victim: 'a', by: [], at: 0 });
    const level: Moment = { kind: 'level', from: 0, to: 1, at: 0 };
    const kinds = (q: readonly Moment[]) =>
      q.map((m) => (m.kind === 'ko' ? `ko:${m.eventId}` : m.kind));
    // Нокауты и уровень ждут — сцена встаёт первой, уровень снят (часы в углу перелистнутся сами).
    expect(kinds(enqueue([ko(1), ko(2), level], [bomb]))).toEqual(['bomb', 'ko:1', 'ko:2']);
    // Тот же кадр: нокаут, уровень и новый бомб-пот — сцена первой, нокаут после неё.
    expect(kinds(enqueue([], [ko(1), level, bomb]))).toEqual(['bomb', 'ko:1']);
    // Развязка прошлого бомб-пота — раньше нового: сцена встаёт сразу за ней, впереди нокаута.
    const end: Moment = {
      kind: 'bomb_end',
      eventId: id - 1,
      bombPot: bomb.bombPot,
      winners: [],
      at: 0,
    };
    expect(kinds(enqueue([ko(1), end, ko(2)], [bomb]))).toEqual([
      'ko:1',
      'bomb_end',
      'bomb',
      'ko:2',
    ]);
    // Уровень, пришедший после сцены, ждёт за ней.
    expect(kinds(enqueue(enqueue([], [bomb]), [level]))).toEqual(['bomb', 'level']);
  });

  it('сцена в силе, пока бомб-пот открыт и запись не залежалась в очереди', () => {
    const j = seated();
    const f = step(j, null).frame;
    j.bombPot(3);
    const [m] = step(j, f).moments;
    if (!m) throw new Error('нет сцены');
    const s = replayLog(F, j.events, j.now()).state;
    expect(stillValid(m, s, j.now() + 5000)).toBe(true);
    expect(stillValid(m, s, j.now() + 31_000)).toBe(false);
    j.hand();
    expect(stillValid(m, replayLog(F, j.events, j.now()).state, j.now())).toBe(false);
  });
});

describe('моменты табло: бомб-пот, спрятанный временем', () => {
  it('раздачу закрыли через 20+ мин — табло бейдж уже спрятало, развязкой он не воскресает', () => {
    const j = journal().join('a', 'b');
    j.start();
    const f = step(j, null).frame;
    const id = j.bombPot(2);
    const f2 = step(j, f).frame;
    j.wait(25);
    j.bombPotResult(id, ['a']);
    j.hand();
    const [m] = step(j, f2).moments;
    if (!m) throw new Error('нет развязки');
    expect(m.kind).toBe('bomb_end');
    expect(stillValid(m, replayLog(F, j.events, j.now()).state, j.now())).toBe(false);
  });
});
