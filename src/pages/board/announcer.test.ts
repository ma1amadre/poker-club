import { DEFAULT_FORMAT } from '@domain/format.ts';
import { replayLog } from '@domain/replay.ts';
import { journal, MIN, type Journal } from '@domain/test-utils.ts';
import type { BlindLevel, LevelTrigger, TournamentFormat } from '@domain/types.ts';
import type { Announcement } from '@domain/voice.ts';
import { describe, expect, it } from 'vitest';
import {
  detectAnnouncements,
  FRESH_EVENT_MS,
  voiceFrame,
  voiceStep,
  type VoiceFrame,
} from './announcer';

const L = (sb: number, bb: number, trigger: LevelTrigger, ante?: number): BlindLevel => ({
  sb,
  bb,
  trigger,
  ...(ante === undefined ? {} : { ante }),
});
const ten: LevelTrigger = { type: 'time', minutes: 10 };

/** 4 уровня по 10 минут, ребаи до конца 2-го. */
const FMT: TournamentFormat = {
  ...DEFAULT_FORMAT,
  rebuyUntilLevel: 2,
  levels: [L(5, 10, ten), L(10, 20, ten), L(20, 40, ten, 5), L(40, 80, ten)],
};

/** Кадр, как его строит табло: board_state отдаёт только неотменённые события. */
function frameAt(j: Journal, format: TournamentFormat = FMT, nowMs = j.now()): VoiceFrame {
  const events = j.events.filter((e) => !e.voided);
  return voiceFrame(format, events, replayLog(format, events, nowMs), nowMs);
}

const kinds = (list: Announcement[]) => list.map((a) => a.kind);

/**
 * Табло по секундам, как useBoardVoice: в кадре t — события, которые табло уже видит (at + lagMs
 * <= t; lagMs — опрос раз в 3 с и сеть), replay на t; память сказанного переходит из шага в шаг.
 * Все объявления за отрезок — подряд.
 */
function simulate(
  j: Journal,
  fromMs: number,
  toMs: number,
  format = FMT,
  lagMs = 0,
): Announcement[] {
  const all = j.events.filter((e) => !e.voided);
  const frame = (t: number) => {
    const events = all.filter((e) => Date.parse(e.at) + lagMs <= t);
    return voiceFrame(format, events, replayLog(format, events, t), t);
  };
  const out: Announcement[] = [];
  let prev = frame(fromMs);
  for (let t = fromMs + 1000; t <= toMs; t += 1000) {
    const { say, frame: next } = voiceStep(format, prev, frame(t));
    out.push(...say);
    prev = next;
  }
  return out;
}

/** Шаг: кадр до, действие, кадр после — что объявить. */
function step(j: Journal, act: () => void, format: TournamentFormat = FMT): Announcement[] {
  const prev = frameAt(j, format);
  act();
  return detectAnnouncements(format, prev, frameAt(j, format));
}

/** Цепочка шагов с памятью сказанного (кадр шага переходит в следующий), как у табло. */
function stepper(j: Journal, format: TournamentFormat = FMT) {
  let prev = frameAt(j, format);
  return (act: () => void): Announcement[] => {
    act();
    const { say, frame } = voiceStep(format, prev, frameAt(j, format));
    prev = frame;
    return say;
  };
}

/** Табло видит событие через 2,5 с после записи: опрос раз в 3 с плюс сеть. */
const POLL_LAG_MS = 2_500;

function seated(): Journal {
  return journal().join('a', 'b', 'c');
}

describe('голос табло: что объявить', () => {
  it('история при открытии не зачитывается: первый кадр — точка отсчёта', () => {
    const j = seated();
    j.start();
    j.wait(3).bust('c', ['a']);
    const f = frameAt(j);
    expect(detectAnnouncements(FMT, f, f)).toEqual([]);
  });

  it('старт таймера — блайнды первого уровня', () => {
    const j = seated();
    expect(step(j, () => j.start())).toEqual([{ kind: 'start', level: FMT.levels[0] }]);
  });

  it('пауза и продолжение', () => {
    const j = seated();
    j.start();
    j.wait(2);
    expect(kinds(step(j, () => j.pause()))).toEqual(['pause']);
    j.wait(5);
    expect(kinds(step(j, () => j.resume()))).toEqual(['resume']);
  });

  it('нокаут с выбившими; сплит — все выбившие', () => {
    const j = seated();
    j.start();
    j.wait(1);
    expect(step(j, () => j.bust('c', ['a']))).toEqual([
      { kind: 'knockout', victim: 'c', by: ['a'] },
    ]);
    j.wait(1);
    expect(step(j, () => j.rebuy('c'))).toEqual([]);
    j.wait(1);
    expect(step(j, () => j.bust('c', ['a', 'b']))).toEqual([
      { kind: 'knockout', victim: 'c', by: ['a', 'b'] },
    ]);
  });

  it('финал: победитель, а служебная пауза перед finish молчит', () => {
    const j = seated();
    j.start();
    j.wait(1).bust('c', ['a']);
    j.wait(1).bust('b', ['a']);
    j.wait(1);
    // add_event при идущем таймере пишет timer_pause с тем же at, затем finish — одним запросом.
    const out = step(j, () => {
      j.pause();
      j.finish();
    });
    expect(out).toEqual([{ kind: 'winner', winner: 'a' }]);
  });

  it('новый уровень по таймеру — на границе уровня, один раз', () => {
    const j = seated();
    j.start();
    j.wait(10 - 1 / 60); // 9:59
    const before = frameAt(j);
    const at = frameAt(j, FMT, j.now() + 1000); // 10:00
    // 2-й уровень — последний с ребаями (rebuyUntilLevel: 2): об этом сразу за фразой уровня.
    expect(detectAnnouncements(FMT, before, at)).toEqual([
      { kind: 'level', level: FMT.levels[1] },
      { kind: 'rebuys_last_level' },
    ]);
    const after = frameAt(j, FMT, j.now() + 2000);
    expect(detectAnnouncements(FMT, at, after)).toEqual([]);
  });

  it('уровень вручную (level_next) — на своём месте среди событий', () => {
    const j = seated();
    j.start();
    j.wait(2);
    const out = step(j, () => {
      j.next();
      j.pause();
    });
    expect(kinds(out)).toEqual(['level', 'rebuys_last_level', 'pause']);
    expect(out[0]).toEqual({ kind: 'level', level: FMT.levels[1] });
  });

  it('level_prev не объявляется', () => {
    const j = seated();
    j.start();
    j.wait(2).next();
    j.wait(1);
    expect(step(j, () => j.prev())).toEqual([]);
  });

  it('закрытие ребаев — сразу после фразы уровня', () => {
    const j = seated();
    j.start();
    j.wait(1).next(); // уровень 2 — ребаи ещё открыты
    j.wait(1);
    const out = step(j, () => j.next()); // уровень 3
    expect(out).toEqual([{ kind: 'level', level: FMT.levels[2] }, { kind: 'rebuys_closed' }]);
  });

  it('ребаи закрыты со старта (до 0-го уровня) — после «Поехали»', () => {
    const j = seated();
    expect(kinds(step(j, () => j.start(), { ...FMT, rebuyUntilLevel: 0 }))).toEqual([
      'start',
      'rebuys_closed',
    ]);
  });

  it('finish при открытых ребаях — только победитель', () => {
    const j = seated();
    j.start();
    j.wait(1).bust('c', []);
    j.wait(1).bust('b', []);
    j.wait(1).pause();
    expect(kinds(step(j, () => j.finish()))).toEqual(['winner']);
  });

  it('уровень по вылетам: нокаут, затем новый уровень', () => {
    const fmt: TournamentFormat = {
      ...FMT,
      levels: [L(5, 10, { type: 'eliminations', count: 1 }), L(10, 20, ten)],
    };
    const j = seated();
    j.start();
    j.wait(1);
    expect(kinds(step(j, () => j.bust('c', ['a']), fmt))).toEqual(['knockout', 'level']);
  });

  describe('минута до повышения', () => {
    function warmed(): { j: Journal; at: (ms: number) => VoiceFrame } {
      const j = seated();
      j.start();
      j.wait(9); // осталось 60 с
      const base = j.now();
      return { j, at: (ms: number) => frameAt(j, FMT, base + ms) };
    }

    it('остаток пересёк 60 с — один раз', () => {
      const { at } = warmed();
      expect(detectAnnouncements(FMT, at(-1000), at(0))).toEqual([{ kind: 'minute' }]);
      expect(detectAnnouncements(FMT, at(0), at(1000))).toEqual([]);
      expect(detectAnnouncements(FMT, at(-2000), at(-1000))).toEqual([]);
    });

    it('пауза у порога: предупреждение одно, после продолжения', () => {
      const j = seated();
      const t0 = j.now();
      j.start();
      j.wait(9 - 1 / 60).pause(); // осталось 61 с
      j.wait(5).resume();
      const end = j.now() + 70_000;
      expect(kinds(simulate(j, t0 - 1000, end))).toEqual([
        'start',
        'pause',
        'resume',
        'minute',
        'level',
        'rebuys_last_level',
      ]);
    });

    it('запоздалый шаг (остаток уже меньше 45 с) — молчим', () => {
      const { at } = warmed();
      expect(detectAnnouncements(FMT, at(-5000), at(20_000))).toEqual([]);
    });

    it('на паузе, на последнем уровне и не по времени — не предупреждаем', () => {
      const paused = seated();
      paused.start();
      paused.wait(8).pause();
      paused.wait(5);
      const p0 = frameAt(paused);
      expect(detectAnnouncements(FMT, p0, frameAt(paused, FMT, paused.now() + 120_000))).toEqual(
        [],
      );

      const last = seated();
      last.start();
      last.wait(1).next();
      last.next();
      last.next(); // 4-й, последний уровень
      last.wait(9);
      const base = last.now();
      expect(
        detectAnnouncements(FMT, frameAt(last, FMT, base - 1000), frameAt(last, FMT, base)),
      ).toEqual([]);

      const hands: TournamentFormat = {
        ...FMT,
        levels: [L(5, 10, { type: 'hands', count: 5 }), L(10, 20, ten)],
      };
      const h = seated();
      h.start();
      h.wait(30);
      expect(
        detectAnnouncements(hands, frameAt(h, hands), frameAt(h, hands, h.now() + 1000)),
      ).toEqual([]);
    });
  });

  describe('отмена не объявляется', () => {
    it('отменённый нокаут просто пропадает из журнала', () => {
      const j = seated();
      j.start();
      j.wait(1);
      const bust = j.bust('c', ['a']);
      j.wait(1);
      expect(step(j, () => j.voidEvent(bust))).toEqual([]);
    });

    it('отмена level_next — уровень вниз, молчим; отмена level_prev — уровень вверх, тоже молчим', () => {
      const j = seated();
      j.start();
      j.wait(1);
      const next = j.next();
      j.wait(1);
      expect(step(j, () => j.voidEvent(next))).toEqual([]);

      const k = seated();
      k.start();
      k.wait(1).next();
      const prev = k.prev();
      k.wait(1);
      expect(step(k, () => k.voidEvent(prev))).toEqual([]);
    });

    it('отмена finish возвращает вечер — без объявлений', () => {
      const j = seated();
      j.start();
      j.wait(1).bust('c', ['a']);
      j.wait(1).bust('b', ['a']);
      j.wait(1);
      const pause = j.pause();
      const finish = j.finish();
      j.wait(1);
      expect(
        step(j, () => {
          j.voidEvent(finish);
          j.voidEvent(pause);
        }),
      ).toEqual([]);
    });

    it('событие, отклонённое раньше и принятое после отмены другого, — не новость', () => {
      const j = seated();
      j.start();
      j.wait(1);
      const first = j.bust('c', ['a']);
      j.bust('c', ['b']); // жертва уже вне игры — replay отклоняет
      j.wait(1);
      expect(step(j, () => j.voidEvent(first))).toEqual([]);
    });
  });

  describe('запоздавшая пауза не повторяет объявлений', () => {
    it('пауза за секунду до конца уровня: «Новый уровень» один раз', () => {
      const j = seated();
      const t0 = j.now();
      j.start();
      j.wait(10 - 1 / 60).pause(); // 9:59 — до конца уровня 1 с
      j.wait(1).resume(); // 10:59
      // Табло узнаёт о паузе в 10:01,5: replay успел перейти на 2-й уровень и откатился.
      expect(kinds(simulate(j, t0 - 1000, j.now() + 70_000, FMT, POLL_LAG_MS))).toEqual([
        'start',
        'minute',
        'level',
        'rebuys_last_level',
        'pause',
        'resume',
      ]);
    });

    it('пауза при остатке 61,5 с: «Минута до повышения» один раз', () => {
      const j = seated();
      const t0 = j.now();
      j.start();
      j.wait(8.975).pause(); // 8:58,5 — до конца уровня 61,5 с
      j.wait(1).resume();
      expect(kinds(simulate(j, t0 - 1000, j.now() + 70_000, FMT, POLL_LAG_MS))).toEqual([
        'start',
        'minute',
        'pause',
        'resume',
        'level',
        'rebuys_last_level',
      ]);
    });

    it('на границе закрытия ребаев: уровень и «Ребаи закрыты» — по разу', () => {
      const j = seated();
      j.start();
      j.wait(20 - 1 / 60).pause(); // 19:59, ребаи — до конца 2-го уровня
      const from = j.now() - 20_000;
      j.wait(1).resume();
      expect(kinds(simulate(j, from, j.now() + 10_000, FMT, POLL_LAG_MS))).toEqual([
        'level',
        'rebuys_closed',
        'pause',
        'resume',
      ]);
    });

    it('без задержки — как раньше: пауза у границы, уровень после продолжения', () => {
      const j = seated();
      const t0 = j.now();
      j.start();
      j.wait(10 - 1 / 60).pause();
      j.wait(1).resume();
      expect(kinds(simulate(j, t0 - 1000, j.now() + 70_000))).toEqual([
        'start',
        'minute',
        'pause',
        'resume',
        'level',
        'rebuys_last_level',
      ]);
    });
  });

  describe('настоящий откат — уровень объявляется снова', () => {
    it('level_prev, затем подъём', () => {
      const j = seated();
      j.start();
      const say = stepper(j);
      j.wait(1);
      expect(kinds(say(() => j.next()))).toEqual(['level', 'rebuys_last_level']);
      j.wait(1);
      expect(say(() => j.prev())).toEqual([]);
      j.wait(1);
      expect(say(() => j.next())).toEqual([
        { kind: 'level', level: FMT.levels[1] },
        { kind: 'rebuys_last_level' },
      ]);
    });

    it('отмена level_next, затем новый level_next; ребаи — тоже', () => {
      const j = seated();
      j.start();
      j.wait(1).next(); // уровень 2
      const say = stepper(j);
      j.wait(1);
      let third = 0;
      expect(kinds(say(() => void (third = j.next())))).toEqual(['level', 'rebuys_closed']);
      j.wait(1);
      expect(say(() => j.voidEvent(third))).toEqual([]);
      j.wait(1);
      expect(kinds(say(() => j.next()))).toEqual(['level', 'rebuys_closed']);
    });

    it('без отката тот же уровень второй раз не звучит', () => {
      // Кадр «из прошлого» (часы табло поправились назад) — уровень ниже уже сказанного.
      const j = seated();
      j.start();
      j.wait(10 - 1 / 60);
      const base = j.now();
      let prev = frameAt(j, FMT, base);
      const said: Announcement[] = [];
      for (const ms of [1000, 2000, -500, 3000]) {
        const r = voiceStep(FMT, prev, frameAt(j, FMT, base + ms));
        said.push(...r.say);
        prev = r.frame;
      }
      expect(kinds(said)).toEqual(['level', 'rebuys_last_level']);
    });
  });

  describe('окно ребаев: последний уровень и пять минут до закрытия', () => {
    it('ребаи только на 1-м уровне — сразу за «Поехали»', () => {
      const one: TournamentFormat = { ...FMT, rebuyUntilLevel: 1 };
      const j = seated();
      expect(kinds(step(j, () => j.start(), one))).toEqual(['start', 'rebuys_last_level']);
    });

    it('ребаи на всю игру — ни последнего уровня, ни пяти минут', () => {
      const whole: TournamentFormat = { ...FMT, rebuyUntilLevel: FMT.levels.length };
      const j = seated();
      const t0 = j.now();
      j.start();
      const out = kinds(simulate(j, t0 - 1000, t0 + 45 * MIN, whole));
      expect(out).not.toContain('rebuys_last_level');
      expect(out).not.toContain('rebuys_soon');
      expect(out).not.toContain('rebuys_closed');
    });

    it('ребаи закрыты со старта — ни последнего уровня, ни пяти минут', () => {
      const none: TournamentFormat = { ...FMT, rebuyUntilLevel: 0 };
      const j = seated();
      const t0 = j.now();
      j.start();
      expect(kinds(simulate(j, t0 - 1000, t0 + 25 * MIN, none))).toEqual([
        'start',
        'rebuys_closed',
        'minute',
        'level',
        'minute',
        'level',
      ]);
    });

    it('пять минут: порог пересечён на последнем уровне ребаев — один раз', () => {
      const j = seated();
      j.start();
      j.wait(15 - 1 / 60); // 14:59 — до закрытия ребаев (20:00) 5:01
      const base = j.now();
      const at = (ms: number) => frameAt(j, FMT, base + ms);
      expect(detectAnnouncements(FMT, at(0), at(1000))).toEqual([{ kind: 'rebuys_soon' }]);
      expect(detectAnnouncements(FMT, at(1000), at(2000))).toEqual([]);
      // Запоздалый шаг: до закрытия уже меньше 4:45 — молчим.
      expect(detectAnnouncements(FMT, at(0), at(20_000))).toEqual([]);
    });

    it('последний уровень ребаев короче пяти минут — предупреждение ещё на предыдущем', () => {
      const short: TournamentFormat = {
        ...FMT,
        levels: [L(5, 10, ten), L(10, 20, { type: 'time', minutes: 3 }), L(20, 40, ten)],
      };
      const j = seated();
      const t0 = j.now();
      j.start();
      // Ребаи закрываются в 13:00 — пять минут до этого на 1-м уровне, в 8:00.
      expect(kinds(simulate(j, t0 - 1000, t0 + 14 * MIN, short))).toEqual([
        'start',
        'rebuys_soon', // 8:00
        'minute', // 9:00
        'level', // 10:00
        'rebuys_last_level',
        'minute', // 12:00
        'level', // 13:00
        'rebuys_closed',
      ]);
    });

    it('на паузе молчим; запоздавшая пауза у порога не повторяет предупреждения', () => {
      const j = seated();
      const t0 = j.now();
      j.start();
      j.wait(15 - 1 / 60).pause(); // 14:59 — до закрытия 5:01
      j.wait(1).resume();
      const out = kinds(simulate(j, t0 - 1000, j.now() + 30_000, FMT, POLL_LAG_MS));
      expect(out.filter((k) => k === 'rebuys_soon')).toHaveLength(1);
      expect(out.slice(-3)).toEqual(['rebuys_soon', 'pause', 'resume']);
    });

    it('уровни не по времени — срок не посчитать, пяти минут нет', () => {
      const hands: TournamentFormat = {
        ...FMT,
        levels: [
          L(5, 10, { type: 'hands', count: 3 }),
          L(10, 20, { type: 'hands', count: 3 }),
          L(20, 40, ten),
        ],
      };
      const j = seated();
      const t0 = j.now();
      j.start();
      j.wait(1).hand();
      j.hand();
      j.hand(); // 2-й уровень — последний с ребаями
      const out = kinds(simulate(j, t0 - 1000, j.now() + 30 * MIN, hands));
      expect(out).toEqual(['start', 'level', 'rebuys_last_level']);
    });

    it('табло открыли, когда до закрытия меньше пяти минут, — не догоняем', () => {
      const j = seated();
      const t0 = j.now();
      j.start();
      const out = kinds(simulate(j, t0 + 16 * MIN, t0 + 21 * MIN));
      expect(out).toEqual(['minute', 'level', 'rebuys_closed']);
    });

    it('отмена level_next и новый подъём — последний уровень ребаев снова', () => {
      const j = seated();
      j.start();
      const say = stepper(j);
      j.wait(1);
      let second = 0;
      expect(kinds(say(() => void (second = j.next())))).toEqual(['level', 'rebuys_last_level']);
      j.wait(1);
      expect(say(() => j.voidEvent(second))).toEqual([]);
      j.wait(1);
      expect(kinds(say(() => j.next()))).toEqual(['level', 'rebuys_last_level']);
    });
  });

  it('вечер целиком по секундам: каждое объявление ровно один раз и по порядку', () => {
    const j = seated();
    const t0 = j.now();
    j.start();
    j.wait(4).bust('c', ['a']);
    j.wait(1).rebuy('c');
    j.wait(12).bust('c', ['a', 'b']); // уровень 2 (10:00), вылет на 17:00
    j.wait(5).pause(); // 22:00, уровень 3 с 20:00 — ребаи закрылись
    j.wait(10).resume();
    j.wait(3).bust('b', ['a']);
    j.wait(1);
    j.pause();
    j.finish();
    const out = simulate(j, t0 - 1000, j.now() + 5000);
    expect(kinds(out)).toEqual([
      'start',
      'knockout',
      'minute', // 9:00
      'level', // 10:00
      'rebuys_last_level', // 2-й уровень — последний с ребаями
      'rebuys_soon', // 15:00 — до закрытия ребаев (20:00) пять минут
      'knockout',
      'minute', // 19:00
      'level', // 20:00
      'rebuys_closed',
      'pause',
      'resume',
      'knockout',
      'winner',
    ]);
    expect(out.at(-1)).toEqual({ kind: 'winner', winner: 'a' });
  });

  describe('пауза на N минут (022)', () => {
    it('«Перерыв N минут» вместо «Пауза»; правка записи и поправка времени молчат', () => {
      const j = seated();
      j.start();
      j.wait(2);
      const bust = j.bust('c', ['a']);
      j.wait(1);
      expect(step(j, () => j.amend(bust, { by: ['b'] }))).toEqual([]);
      expect(step(j, () => j.adjust(60))).toEqual([]);
      expect(step(j, () => j.pauseFor(10))).toEqual([{ kind: 'break', minutes: 10 }]);
    });

    it('минута до конца перерыва — один раз; по истечении голос молчит', () => {
      const j = seated();
      const t0 = j.now();
      j.start();
      j.wait(2).pauseFor(5);
      const pausedAt = j.now();
      j.wait(9).resume();
      const out = simulate(j, t0 - 1000, j.now() + 2000);
      expect(kinds(out)).toEqual(['start', 'break', 'break_minute', 'resume']);
      // 4:00 перерыва — ровно «минута до конца»: проверим, что не раньше.
      const early = simulate(j, pausedAt, pausedAt + 3.9 * MIN);
      expect(kinds(early)).toEqual([]);
    });

    it('пауза без срока — без минуты; табло, открытое за 40 с до конца перерыва, не догоняет', () => {
      const j = seated();
      const t0 = j.now();
      j.start();
      j.wait(2).pause();
      j.wait(20).resume();
      expect(kinds(simulate(j, t0 - 1000, j.now()))).toEqual(['start', 'pause', 'resume']);
      const k = seated();
      k.start();
      k.wait(1).pauseFor(2);
      const opened = k.now() + 80_000;
      expect(kinds(simulate(k, opened, opened + 60_000))).toEqual([]);
    });
  });

  describe('поправка времени ±1 мин через порог (ревью 08.10.2026)', () => {
    it('«−1 мин» за 1:30 до конца уровня — «Минута до повышения» сразу', () => {
      const j = seated();
      const t0 = j.now();
      j.start();
      j.wait(8.5).adjust(-60); // осталось 1:30 → 0:30
      for (const lag of [0, POLL_LAG_MS]) {
        expect(kinds(simulate(j, t0 - 1000, t0 + 9.5 * MIN, FMT, lag)), `lag ${lag}`).toEqual([
          'start',
          'minute',
          'level', // 9:00 — уровень короче на минуту
          'rebuys_last_level',
        ]);
      }
    });

    it('«−1 мин» за 5:30 до закрытия ребаев — «Пять минут до закрытия» сразу', () => {
      const j = seated();
      const t0 = j.now();
      j.start();
      j.wait(14.5).adjust(-60); // 2-й уровень, до закрытия 5:30 → 4:30
      expect(kinds(simulate(j, t0 - 1000, t0 + 20 * MIN))).toEqual([
        'start',
        'minute', // 9:00
        'level', // 10:00
        'rebuys_last_level',
        'rebuys_soon', // 14:30 — сразу после поправки
        'minute', // 18:00
        'level', // 19:00
        'rebuys_closed',
      ]);
    });

    it('«−1 мин» на паузе через порог — предупреждение после «Продолжаем»', () => {
      const j = seated();
      const t0 = j.now();
      j.start();
      j.wait(8.5).pause(); // осталось 1:30
      j.wait(1).adjust(-60); // на паузе: 0:30
      j.wait(2).resume();
      expect(kinds(simulate(j, t0 - 1000, j.now() + 40_000))).toEqual([
        'start',
        'pause',
        'resume',
        'minute',
        'level',
        'rebuys_last_level',
      ]);
      // Ребаи так же: на паузе до закрытия стало меньше пяти минут — после продолжения.
      const k = seated();
      const k0 = k.now();
      k.start();
      k.wait(14.5).pause(); // до закрытия 5:30
      k.wait(1).adjust(-60);
      k.wait(1).resume();
      const out = kinds(simulate(k, k0 - 1000, k.now() + 5000));
      expect(out.slice(-3)).toEqual(['pause', 'resume', 'rebuys_soon']);
    });

    it('«+1 мин» после сказанной минуты — минута ещё раз, когда часы снова дойдут', () => {
      const j = seated();
      const t0 = j.now();
      j.start();
      j.wait(9 + 10 / 60).adjust(60); // 9:10: осталось 0:50 → 1:50
      expect(kinds(simulate(j, t0 - 1000, t0 + 11 * MIN))).toEqual([
        'start',
        'minute', // 9:00
        'minute', // 10:00 — снова минута до конца
        'level', // 11:00
        'rebuys_last_level',
      ]);
    });

    it('«−1 мин», после которой до края 15 с и меньше, — сразу уровень, без минуты', () => {
      const j = seated();
      const t0 = j.now();
      j.start();
      j.wait(8 + 55 / 60).adjust(-60); // осталось 1:05 → 0:05
      expect(kinds(simulate(j, t0 - 1000, t0 + 9.5 * MIN))).toEqual([
        'start',
        'level',
        'rebuys_last_level',
      ]);
    });
  });

  it('старые события после долгого обрыва связи не зачитываются', () => {
    const j = seated();
    j.start();
    const prev = frameAt(j);
    j.wait(1).bust('c', ['a']);
    j.wait(FRESH_EVENT_MS / MIN + 1);
    j.bust('b', ['a']);
    expect(detectAnnouncements(FMT, prev, frameAt(j))).toEqual([
      { kind: 'knockout', victim: 'b', by: ['a'] },
    ]);
  });
});
