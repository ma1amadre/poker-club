import { DEFAULT_FORMAT } from '@domain/format.ts';
import { replayLog } from '@domain/replay.ts';
import { journal, MIN, type Journal } from '@domain/test-utils.ts';
import type { LevelTrigger, TournamentFormat } from '@domain/types.ts';
import { describe, expect, it } from 'vitest';
import {
  bigBlinds,
  blindsParts,
  boardClock,
  clubIdleView,
  entriesText,
  formatGameTime,
  lastKnockout,
  LEVEL_FLASH_MS,
  lastRebuyLevelIndex,
  levelPlan,
  NO_VOICE_GAPS,
  pausedForMs,
  pauseText,
  payoutPlan,
  rebuyLine,
  startingStackBb,
  startsInText,
  tableLine,
  voiceGapNotes,
} from './boardView';

const ten: LevelTrigger = { type: 'time', minutes: 10 };

/** Неразрывные пробелы подписей → обычные: ожидания читаются как текст. */
const sp = <T>(v: T): T => JSON.parse(JSON.stringify(v ?? null).replace(/ | /g, ' ')) as T;

/** 4 уровня по 10 минут, ребаи до конца 2-го. */
const FMT: TournamentFormat = {
  ...DEFAULT_FORMAT,
  rebuyUntilLevel: 2,
  levels: [
    { sb: 5, bb: 10, trigger: ten },
    { sb: 10, bb: 20, trigger: ten },
    { sb: 20, bb: 40, trigger: ten },
    { sb: 40, bb: 80, trigger: ten },
  ],
};

function at(j: Journal, format: TournamentFormat = FMT, nowMs = j.now()) {
  return replayLog(format, j.events, nowMs);
}

describe('табло: строка входов и время игры', () => {
  it('«6 входов + 1 ребай»: ребай не входит в число входов', () => {
    const j = journal().join('a', 'b', 'c', 'd', 'e', 'f');
    j.start();
    expect(sp(entriesText(at(j).state))).toBe('6 входов');
    j.wait(1).bust('f', ['a']);
    j.rebuy('f');
    expect(sp(entriesText(at(j).state))).toBe('6 входов + 1 ребай');
    j.wait(1).bust('f', ['b']);
    j.rebuy('f', 2); // кратный ребай — всё равно один ребай штукой
    expect(sp(entriesText(at(j).state))).toBe('6 входов + 2 ребая');
  });

  it('время игры — часы и минуты', () => {
    expect(formatGameTime(0)).toBe('0:00');
    expect(formatGameTime(45 * MIN + 59_000)).toBe('0:45');
    expect(formatGameTime(134 * MIN)).toBe('2:14');
    expect(formatGameTime(-5)).toBe('0:00');
  });

  it('нижняя строка: средний стек в BB и время без пауз; до старта — нет', () => {
    const j = journal().join('a', 'b', 'c', 'd');
    expect(sp(tableLine(at(j).state))).toBeNull();
    j.start();
    j.wait(5).pause();
    j.wait(15); // пауза в игровое время не идёт
    // 4 × 500 фишек на 4 живых, BB 10 → 50 BB.
    expect(sp(tableLine(at(j).state))).toBe('Средний стек 50 BB · игра идёт 0:05');
    j.resume();
    j.wait(10).bust('d', ['a']); // 2-й уровень, BB 20: 2000 / 3 / 20 = 33,3 → 33
    expect(sp(tableLine(at(j).state))).toBe('Средний стек 33 BB · игра идёт 0:15');
    j.wait(20); // 4-й уровень, BB 80: 8,3
    expect(sp(tableLine(at(j).state))).toBe('Средний стек 8,3 BB · игра идёт 0:35');
  });
});

describe('табло: последний нокаут', () => {
  const names: Record<string, string> = { a: 'Саша', b: 'Дима', c: 'Миша' };
  const nameOf = (id: string) => names[id] ?? 'Игрок';

  it('жертва и выбившие — без рода; отменённый не в счёт', () => {
    const j = journal().join('a', 'b', 'c');
    j.start();
    expect(lastKnockout(at(j).applied, nameOf)).toBeNull();
    j.wait(1).bust('c', ['a']);
    expect(lastKnockout(at(j).applied, nameOf)).toEqual({ victim: 'Миша', by: 'выбивает Саша' });
    j.rebuy('c');
    const split = j.bust('c', ['a', 'b']);
    expect(sp(lastKnockout(at(j).applied, nameOf))).toEqual({
      victim: 'Миша',
      by: 'выбивают Саша и Дима',
    });
    j.voidEvent(split);
    j.bust('b', []);
    expect(lastKnockout(at(j).applied, nameOf)).toEqual({
      victim: 'Дима',
      by: 'кто выбил — не указано',
    });
  });
});

describe('табло: часы', () => {
  it('пауза: сколько стоим — от последней принятой паузы', () => {
    const j = journal().join('a', 'b');
    j.start();
    j.wait(5);
    const { state, applied } = at(j);
    expect(pausedForMs(state, applied, j.now())).toBeNull();
    j.pause();
    j.wait(6);
    const paused = at(j);
    expect(pausedForMs(paused.state, paused.applied, j.now())).toBe(6 * MIN);
    expect(sp(pauseText(6 * MIN))).toBe('стоим 6 мин');
    expect(sp(pauseText(65 * MIN))).toBe('стоим 1 ч 5 мин');
    expect(sp(pauseText(20_000))).toBe('стоим меньше минуты');
    expect(boardClock(paused.state)).toMatchObject({ paused: true, finalMinute: false });
  });

  it('последняя минута уровня по времени — сигнал; на паузе и на последнем уровне — нет', () => {
    const j = journal().join('a', 'b');
    j.start();
    j.wait(8);
    expect(boardClock(at(j).state).finalMinute).toBe(false);
    j.wait(1); // осталось ровно 60 с
    expect(boardClock(at(j).state).finalMinute).toBe(true);
    j.pause();
    expect(boardClock(at(j).state).finalMinute).toBe(false);
    j.resume();
    j.next();
    j.next();
    j.next(); // 4-й уровень — последний
    j.wait(9.5);
    const last = boardClock(at(j).state);
    expect(last).toMatchObject({ lastLevel: true, finalMinute: false });
  });

  it('вспышка: первые секунды нового уровня, при идущих часах', () => {
    const j = journal().join('a', 'b');
    j.start();
    expect(boardClock(at(j).state).fresh).toBe(true); // старт — тоже смена уровня
    const t = j.now();
    expect(boardClock(at(j, FMT, t + LEVEL_FLASH_MS).state).fresh).toBe(false);
    // Уровень по времени: 10:00 — снова вспышка.
    expect(boardClock(at(j, FMT, t + 10 * MIN + 1000).state).fresh).toBe(true);
    j.wait(3).next();
    expect(boardClock(at(j).state).fresh).toBe(true);
    j.pause();
    expect(boardClock(at(j).state).fresh).toBe(false);
  });

  it('до старта сигналов нет', () => {
    const j = journal().join('a', 'b');
    expect(boardClock(at(j).state)).toEqual({
      paused: false,
      lastLevel: false,
      finalMinute: false,
      fresh: false,
    });
  });
});

describe('табло: строка ребаев', () => {
  it('последний уровень ребаев — акцент и остаток', () => {
    const j = journal().join('a', 'b');
    j.start();
    j.wait(3);
    expect(sp(rebuyLine(FMT, at(j).state))).toEqual({
      text: 'Ребаи открыты до конца 2-го уровня — ещё 17 мин',
      emphasis: false,
    });
    j.wait(8); // 11:00 — 2-й уровень
    expect(sp(rebuyLine(FMT, at(j).state))).toEqual({
      text: 'Последний уровень ребаев — ещё 9 мин',
      emphasis: true,
    });
    j.wait(10);
    expect(sp(rebuyLine(FMT, at(j).state))).toEqual({
      text: 'Ребаи и поздняя регистрация закрыты',
      emphasis: false,
    });
  });

  it('до закрытия меньше пяти минут ещё на предыдущем уровне — тоже акцент', () => {
    const short: TournamentFormat = {
      ...FMT,
      levels: [
        FMT.levels[0]!,
        { sb: 10, bb: 20, trigger: { type: 'time', minutes: 3 } },
        FMT.levels[2]!,
      ],
    };
    const j = journal().join('a', 'b');
    j.start();
    j.wait(8.5); // до закрытия (13:00) 4,5 мин
    expect(sp(rebuyLine(short, at(j, short).state))).toEqual({
      text: 'Ребаи открыты до конца 2-го уровня — ещё 4 мин',
      emphasis: true,
    });
  });

  it('ребаи на всю игру или закрыты со старта — без «последнего уровня»', () => {
    expect(lastRebuyLevelIndex(FMT)).toBe(1);
    expect(lastRebuyLevelIndex({ ...FMT, rebuyUntilLevel: 4 })).toBeNull();
    expect(lastRebuyLevelIndex({ ...FMT, rebuyUntilLevel: 0 })).toBeNull();
    expect(lastRebuyLevelIndex(DEFAULT_FORMAT)).toBe(4);
    const j = journal().join('a', 'b');
    j.start();
    j.wait(35);
    const whole: TournamentFormat = { ...FMT, rebuyUntilLevel: 4 };
    expect(sp(rebuyLine(whole, at(j, whole).state))).toEqual({
      text: 'Ребаи открыты всю игру',
      emphasis: false,
    });
  });
});

describe('табло: экран ожидания', () => {
  const start = Date.parse('2026-10-09T12:00:00.000Z'); // 15:00 МСК

  it('отсчёт до старта: минуты вверх, прошло — null', () => {
    expect(sp(startsInText(start, start - 12 * MIN))).toBe('через 12 мин');
    expect(sp(startsInText(start, start - 12 * MIN + 1))).toBe('через 12 мин');
    expect(sp(startsInText(start, start - 30_000))).toBe('через 1 мин');
    expect(sp(startsInText(start, start - 80 * MIN))).toBe('через 1 ч 20 мин');
    expect(sp(startsInText(start, start))).toBeNull();
    expect(sp(startsInText(start, start + MIN))).toBeNull();
  });

  it('структура: часы уровней, последний уровень ребаев', () => {
    const plan = levelPlan(DEFAULT_FORMAT, start);
    expect(plan).toHaveLength(8);
    expect(plan.map((r) => (r.at === null ? null : (r.at - start) / MIN))).toEqual([
      0, 40, 80, 120, 160, 200, 240, 280,
    ]);
    expect(plan.filter((r) => r.lastRebuy).map((r) => r.n)).toEqual([5]);
    expect(plan[7]?.level).toEqual(DEFAULT_FORMAT.levels[7]);
  });

  it('после уровня не по времени часов нет', () => {
    const mixed: TournamentFormat = {
      ...FMT,
      levels: [
        FMT.levels[0]!,
        { sb: 10, bb: 20, trigger: { type: 'eliminations', count: 2 } },
        FMT.levels[2]!,
      ],
    };
    expect(levelPlan(mixed, start).map((r) => r.at)).toEqual([start, start + 10 * MIN, null]);
  });

  it('стартовый стек в BB', () => {
    expect(startingStackBb(DEFAULT_FORMAT)).toBe(50);
    expect(startingStackBb({ ...FMT, levels: [] })).toBeNull();
  });

  it('выплаты: доли всегда, суммы — когда игроков хватает на все места', () => {
    const j = journal();
    expect(payoutPlan(DEFAULT_FORMAT, at(j, DEFAULT_FORMAT).state)).toEqual([
      { place: 1, pct: 70, rub: null },
      { place: 2, pct: 30, rub: null },
    ]);
    j.join('a');
    expect(payoutPlan(DEFAULT_FORMAT, at(j, DEFAULT_FORMAT).state)[0]?.rub).toBeNull();
    j.join('b', 'c');
    j.joinStacks('d', 2); // фонд 2 500
    expect(payoutPlan(DEFAULT_FORMAT, at(j, DEFAULT_FORMAT).state)).toEqual([
      { place: 1, pct: 70, rub: 1750 },
      { place: 2, pct: 30, rub: 750 },
    ]);
  });
});

describe('табло: подвал голоса', () => {
  it('всё озвучено — подвала нет', () => {
    expect(sp(voiceGapNotes(NO_VOICE_GAPS))).toEqual([]);
  });

  it('не озвучены уровни или фразы — табло их пропустит (а не «скажет короче»)', () => {
    expect(sp(voiceGapNotes({ names: [], levels: 2, phrases: 0 }))).toEqual([
      'Часть объявлений этого вечера ещё не озвучена — их табло пропустит.',
      'Новые фразы и имена озвучиваются раз в сутки.',
    ]);
    expect(sp(voiceGapNotes({ names: [], levels: 0, phrases: 3 }))[0]).toMatch(/пропустит/);
  });

  it('не озвучены имена — объявит без имени, по именам', () => {
    expect(sp(voiceGapNotes({ names: ['Петя'], levels: 0, phrases: 0 }))[0]).toBe(
      'Имя Петя ещё не озвучено — нокауты и победу этого игрока табло объявит без имени.',
    );
    expect(sp(voiceGapNotes({ names: ['Петя', 'Вова', 'Женя'], levels: 1, phrases: 0 }))).toEqual([
      'Часть объявлений этого вечера ещё не озвучена — их табло пропустит.',
      'Имена Петя, Вова и Женя ещё не озвучены — нокауты и победы этих игроков табло объявит без имён.',
      'Новые фразы и имена озвучиваются раз в сутки.',
    ]);
  });
});

describe('блайнды крупно: перенос только после «/», анте отдельно, ширина для вписывания', () => {
  it('blindsParts: кусок до «/» включительно и остальное — внутри числа не рвём', () => {
    expect(sp(blindsParts('1 000/2 000 (2 000)'))).toEqual(['1 000/', '2 000 (2 000)']);
    expect(blindsParts('25/50')).toEqual(['25/', '50']);
    expect(blindsParts('блайнды не растут')).toEqual(['блайнды не растут']);
  });

  it('bigBlinds: анте не в главном числе; ширина растёт с числом знаков', () => {
    const plain = bigBlinds({ sb: 1000, bb: 2000 });
    expect(sp(plain)).toEqual({ text: '1 000/2 000', ante: null, em: 4.99 });
    const ante = bigBlinds({ sb: 1500, bb: 3000, ante: 3000 });
    expect(sp(ante)).toEqual({ text: '1 500/3 000', ante: '3 000', em: 4.99 });
    expect(bigBlinds({ sb: 100, bb: 200 }).em).toBe(3.43);
    expect(bigBlinds({ sb: 10000, bb: 20000 }).em).toBeGreaterThan(plain.em);
    // Анте 0 — то же, что без анте.
    expect(bigBlinds({ sb: 100, bb: 200, ante: 0 }).ante).toBeNull();
  });

  it('с запасом к замеру шрифта: цифра 0,504 em, неразрывный пробел 0,13, «/» 0,24', () => {
    // «1 000/2 000» в Sofia Sans Condensed 800 — 4,62 em: оценка не меньше, число влезает в колонку.
    const measured = 8 * 0.504 + 2 * 0.132 + 0.241;
    expect(bigBlinds({ sb: 1000, bb: 2000 }).em).toBeGreaterThan(measured);
  });
});

describe('clubIdleView — табло клуба между вечерами', () => {
  const NOW_MS = Date.parse('2026-10-06T12:00:00Z'); // вторник, 15:00 МСК
  const FRIDAY = { weekday: 5, time: '15:00' };

  it('объявленный вечер впереди — его дата и время, без «по расписанию»', () => {
    const view = sp(clubIdleView({ next_at: '2026-10-09T12:00:00Z', schedule: FRIDAY }, NOW_MS));
    expect(view).toEqual({
      eyebrow: 'Следующая игра',
      headline: 'Пятница, 9 октября',
      when: 'в 15:00',
      note: 'Табло само переключится на вечер в день игры — нажимать ничего не нужно.',
    });
  });

  it('анонса нет — ближайший день по расписанию клуба', () => {
    const view = sp(
      clubIdleView({ next_at: null, schedule: { weekday: 4, time: '19:00' } }, NOW_MS),
    );
    expect(view.eyebrow).toBe('Следующая игра по расписанию');
    expect(view.headline).toBe('Четверг, 8 октября');
    expect(view.when).toBe('в 19:00');
  });

  it('до игры меньше суток — «через …»', () => {
    const view = sp(clubIdleView({ next_at: '2026-10-06T16:00:00Z', schedule: FRIDAY }, NOW_MS));
    expect(view.when).toBe('в 19:00 · через 4 ч');
  });

  it('анонс в прошлом (забытый) не берём — берём расписание', () => {
    const view = clubIdleView({ next_at: '2026-10-01T12:00:00Z', schedule: FRIDAY }, NOW_MS);
    expect(view.eyebrow).toBe('Следующая игра по расписанию');
    expect(view.headline).toBe('Пятница, 9 октября');
  });

  it('ни анонса, ни годного расписания — без даты', () => {
    const view = clubIdleView({ next_at: null, schedule: { weekday: 9, time: 'утром' } }, NOW_MS);
    expect(view.when).toBeNull();
    expect(view.note).toBe('Вечер появится здесь сам, как только его объявят.');
  });
});
