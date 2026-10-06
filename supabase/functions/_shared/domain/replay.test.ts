import { describe, expect, it } from 'vitest';
import { DEFAULT_FORMAT, validateFormat } from './format.ts';
import { canApply, replay, replayLog } from './replay.ts';
import { journal, MIN } from './test-utils.ts';
import type { BlindLevel, TournamentFormat } from './types.ts';

const F = DEFAULT_FORMAT;
const errorsOf = (s: { errors: { eventId: number; message: string }[] }) =>
  s.errors.map((e) => e.message);

describe('формат', () => {
  it('клубный формат валиден и совпадает с концепцией', () => {
    expect(validateFormat(F)).toEqual([]);
    expect(F.levels.map((l) => `${l.sb}/${l.bb}`)).toEqual([
      '5/10',
      '10/20',
      '15/30',
      '20/40',
      '25/50',
      '50/100',
      '75/150',
      '100/200',
    ]);
    expect(F.levels.every((l) => l.trigger.type === 'time' && l.trigger.minutes === 40)).toBe(true);
    expect([F.buyInRub, F.startingChips, F.bountyRub, F.rebuyUntilLevel, F.rebuyLimit]).toEqual([
      500,
      500,
      100,
      5,
      null,
    ]);
    expect(F.payoutPct).toEqual([70, 30]);
  });

  it('ловит ошибки формата', () => {
    expect(validateFormat(null)).toHaveLength(1);
    const bad = {
      ...F,
      bountyRub: 600,
      payoutPct: [70, 20],
      levels: [{ sb: 20, bb: 10, trigger: { type: 'time', minutes: 0 } }],
    };
    const errs = validateFormat(bad);
    expect(errs).toContain('Баунти не может быть больше входа');
    expect(errs.some((e) => e.includes('Сумма долей'))).toBe(true);
    expect(errs.some((e) => e.includes('малый блайнд больше большого'))).toBe(true);
    expect(errs.some((e) => e.includes('длительность'))).toBe(true);
    expect(validateFormat({ ...F, buyInRub: 499.5 })).toHaveLength(1);
    expect(validateFormat({ ...F, levels: [] })).toEqual(['Нужен хотя бы один уровень блайндов']);
    expect(validateFormat({ ...F, payoutPct: [33.3, 33.3, 33.4] })).toEqual([]);
  });
});

describe('таймер', () => {
  it('до старта: уровень 1, время стоит, вход открыт', () => {
    const j = journal().join('A', 'B');
    const s = replay(F, j.events, j.now() + 90 * MIN);
    expect(s.timer).toMatchObject({
      status: 'not_started',
      levelIndex: 0,
      levelElapsedMs: 0,
      totalElapsedMs: 0,
    });
    expect(s.timer.levelRemainingMs).toBe(40 * MIN);
    expect(s.currentLevel.bb).toBe(10);
    expect(s.nextLevel?.bb).toBe(20);
    expect(s.rebuysOpen).toBe(true);
  });

  it('идёт только в running: паузы не считаются', () => {
    const j = journal().join('A', 'B');
    j.start();
    j.wait(10).pause();
    j.wait(50); // пауза 50 минут
    let s = replay(F, j.events, j.now());
    expect(s.timer.status).toBe('paused');
    expect(s.timer.levelElapsedMs).toBe(10 * MIN);
    expect(s.timer.levelRemainingMs).toBe(30 * MIN);
    j.resume();
    s = replay(F, j.events, j.now() + 15 * MIN);
    expect(s.timer).toMatchObject({
      status: 'running',
      levelIndex: 0,
      levelElapsedMs: 25 * MIN,
      totalElapsedMs: 25 * MIN,
    });
  });

  it('time-уровень сам переходит в следующий с переносом остатка', () => {
    const j = journal().join('A', 'B');
    j.start();
    const t0 = j.now();
    let s = replay(F, j.events, t0 + 45 * MIN);
    expect(s.timer.levelIndex).toBe(1);
    expect(s.timer.levelElapsedMs).toBe(5 * MIN);
    expect(s.timer.levelRemainingMs).toBe(35 * MIN);
    expect(s.currentLevel).toMatchObject({ sb: 10, bb: 20 });
    // Через несколько уровней сразу: 130 мин = 3 полных уровня + 10 мин.
    s = replay(F, j.events, t0 + 130 * MIN);
    expect(s.timer.levelIndex).toBe(3);
    expect(s.timer.levelElapsedMs).toBe(10 * MIN);
    expect(s.timer.totalElapsedMs).toBe(130 * MIN);
  });

  it('переход уровня во время паузы не происходит, остаток переносится после resume', () => {
    const j = journal().join('A', 'B');
    j.start();
    j.wait(38).pause();
    j.wait(30).resume();
    const s = replay(F, j.events, j.now() + 5 * MIN);
    expect(s.timer.levelIndex).toBe(1);
    expect(s.timer.levelElapsedMs).toBe(3 * MIN);
    expect(s.timer.totalElapsedMs).toBe(43 * MIN);
  });

  it('после последнего уровня блайнды остаются последними', () => {
    const j = journal().join('A', 'B');
    j.start();
    const s = replay(F, j.events, j.now() + 400 * MIN);
    expect(s.timer.levelIndex).toBe(7);
    expect(s.currentLevel).toMatchObject({ sb: 100, bb: 200 });
    expect(s.nextLevel).toBeNull();
    expect(s.timer.levelElapsedMs).toBe(120 * MIN); // 400 − 7·40
    expect(s.timer.levelRemainingMs).toBe(0);
    expect(canApply(F, s, 'level_next', {}, j.now())).toBe('Это последний уровень');
  });

  it('level_next / level_prev — ручной переход, прогресс нового уровня с нуля', () => {
    const j = journal().join('A', 'B');
    expect(canApply(F, replay(F, j.events, j.now()), 'level_next', {}, j.now())).toBe(
      'Таймер не запущен',
    );
    j.start();
    j.wait(10).next();
    let s = replay(F, j.events, j.now());
    expect(s.timer).toMatchObject({ levelIndex: 1, levelElapsedMs: 0 });
    s = replay(F, j.events, j.now() + 45 * MIN);
    expect(s.timer).toMatchObject({ levelIndex: 2, levelElapsedMs: 5 * MIN });
    j.wait(45).prev();
    s = replay(F, j.events, j.now() + 1 * MIN);
    expect(s.timer).toMatchObject({ levelIndex: 1, levelElapsedMs: 1 * MIN });
    expect(s.timer.totalElapsedMs).toBe(56 * MIN);
    j.prev();
    s = replay(F, j.events, j.now());
    expect(s.timer.levelIndex).toBe(0);
    expect(canApply(F, s, 'level_prev', {}, j.now())).toBe('Это первый уровень');
    const bad = j.prev();
    expect(replay(F, j.events, j.now()).errors).toEqual([
      { eventId: bad, message: 'Это первый уровень' },
    ]);
  });

  it('триггер eliminations (старый формат клуба: блайнды растут после 2 вылетов)', () => {
    const lv = (bb: number): BlindLevel => ({
      sb: bb / 2,
      bb,
      trigger: { type: 'eliminations', count: 2 },
    });
    const old: TournamentFormat = { ...F, rebuyUntilLevel: 99, levels: [lv(20), lv(40), lv(80)] };
    expect(validateFormat(old)).toEqual([]);
    const j = journal().join('A', 'B', 'C', 'D', 'E', 'F', 'G');
    j.bust('G', ['A']); // до старта таймера вылет не двигает уровень
    j.rebuy('G');
    j.start();
    j.wait(100); // время не влияет
    let s = replay(old, j.events, j.now());
    expect(s.timer).toMatchObject({ levelIndex: 0, bustsInLevel: 0, levelRemainingMs: null });
    j.bust('B', ['A']);
    s = replay(old, j.events, j.now());
    expect(s.timer).toMatchObject({ levelIndex: 0, bustsInLevel: 1 });
    j.bust('C', ['A']);
    s = replay(old, j.events, j.now());
    expect(s.timer).toMatchObject({ levelIndex: 1, bustsInLevel: 0 });
    expect(s.players.C?.bustLevel).toBe(1); // вылет случился на уровне 1
    expect(s.currentLevel.bb).toBe(40);
    // Ребай не считается вылетом; ручной переход обнуляет счётчик.
    j.rebuy('C');
    j.bust('D', ['A']);
    j.next();
    j.bust('E', ['A']);
    s = replay(old, j.events, j.now());
    expect(s.timer).toMatchObject({ levelIndex: 2, bustsInLevel: 1 });
    // Последний уровень дальше не растёт.
    j.bust('F', ['A']);
    j.bust('C', ['A']);
    s = replay(old, j.events, j.now());
    expect(s.timer).toMatchObject({ levelIndex: 2, bustsInLevel: 3 });
    expect(s.errors).toEqual([]);
  });

  it('триггер hands', () => {
    const lv = (bb: number): BlindLevel => ({
      sb: bb / 2,
      bb,
      trigger: { type: 'hands', count: 5 },
    });
    const fmt: TournamentFormat = { ...F, levels: [lv(20), lv(40)] };
    const j = journal().join('A', 'B');
    const early = j.hand();
    j.start();
    for (let i = 0; i < 4; i++) j.hand();
    let s = replay(fmt, j.events, j.now());
    expect(s.timer).toMatchObject({ levelIndex: 0, handsInLevel: 4 });
    expect(s.errors).toEqual([{ eventId: early, message: 'Таймер не запущен' }]);
    j.hand();
    s = replay(fmt, j.events, j.now());
    expect(s.timer).toMatchObject({ levelIndex: 1, handsInLevel: 0 });
    for (let i = 0; i < 7; i++) j.hand();
    s = replay(fmt, j.events, j.now());
    expect(s.timer).toMatchObject({ levelIndex: 1, handsInLevel: 7 });
  });

  it('смешанные триггеры: time-уровень после hands-уровня отсчитывается с момента перехода', () => {
    const fmt: TournamentFormat = {
      ...F,
      levels: [
        { sb: 5, bb: 10, trigger: { type: 'hands', count: 2 } },
        { sb: 10, bb: 20, trigger: { type: 'time', minutes: 20 } },
        { sb: 20, bb: 40, trigger: { type: 'time', minutes: 20 } },
      ],
    };
    const j = journal().join('A', 'B');
    j.start();
    j.wait(60).hand();
    j.wait(5).hand(); // переход на уровень 2 на 65-й минуте
    const s = replay(fmt, j.events, j.now() + 25 * MIN);
    expect(s.timer).toMatchObject({ levelIndex: 2, levelElapsedMs: 5 * MIN });
  });

  it('ребаи закрываются на границе 5-го уровня: 3:20 игрового времени при уровнях по 40 минут', () => {
    const j = journal().join('A', 'B', 'C');
    j.start();
    const t0 = j.now();
    const at = (min: number) => replay(F, j.events, t0 + min * MIN);
    expect(at(199.99).rebuysOpen).toBe(true);
    expect(at(199.99).timer.levelIndex).toBe(4);
    expect(at(200).rebuysOpen).toBe(false);
    expect(at(200).timer.levelIndex).toBe(5);
    expect(at(200).currentLevel.bb).toBe(100);

    j.wait(150).bust('A', ['B']);
    j.wait(49.99);
    const ok = j.rebuy('A'); // 3:19:59.4 — ещё можно
    j.wait(0.01).bust('A', ['C']); // 3:20:00 — ребаи уже закрыты
    const late = j.rebuy('A');
    const lateJoin = j.add('join', { playerId: 'D' });
    const s = replay(F, j.events, j.now());
    expect(s.errors).toEqual([
      { eventId: late, message: 'Ребаи закрыты' },
      { eventId: lateJoin, message: 'Регистрация закрыта' },
    ]);
    expect(s.players.A).toMatchObject({
      rebuys: 1,
      entries: 2,
      alive: false,
      bustLevel: 6,
      place: 3,
    });
    expect(ok).toBeGreaterThan(0);
  });

  it('пауза сдвигает закрытие ребаев: считается игровое, а не настенное время', () => {
    const j = journal().join('A', 'B');
    j.start();
    j.wait(100).pause();
    j.wait(30).resume();
    j.wait(95).bust('A', ['B']); // настенное 3:45, игровое 3:15
    j.rebuy('A');
    const s = replay(F, j.events, j.now());
    expect(s.errors).toEqual([]);
    expect(s.players.A?.rebuys).toBe(1);
    expect(s.rebuysOpen).toBe(true);
    expect(replay(F, j.events, j.now() + 5 * MIN).rebuysOpen).toBe(false);
  });

  it('пауза/resume/start в неверном состоянии — ошибки', () => {
    const j = journal().join('A', 'B');
    const p0 = j.pause();
    j.start();
    const s2 = j.start();
    const r = j.resume();
    j.pause();
    const p2 = j.pause();
    expect(errorsOf(replay(F, j.events, j.now()))).toEqual([
      'Таймер не идёт',
      'Таймер уже запущен',
      'Таймер не на паузе',
      'Таймер не идёт',
    ]);
    expect([p0, s2, r, p2].every((x) => x > 0)).toBe(true);
  });

  it('время событий слегка назад (конкурентная вставка) не отматывает часы', () => {
    const j = journal().join('A', 'B');
    j.start();
    j.wait(10).hand();
    const ev = j.events[j.events.length - 1];
    j.add('hand');
    const last = j.events[j.events.length - 1];
    if (!ev || !last) throw new Error('нет событий');
    last.at = new Date(j.now() - 2 * MIN).toISOString();
    const s = replay(F, j.events, j.now());
    expect(s.timer.totalElapsedMs).toBe(10 * MIN);
  });
});

describe('места, финал и ошибки', () => {
  it('окончательный вылет vs вылет с ребаем; места в обратном порядке окончательных вылетов', () => {
    const j = journal().join('A', 'B', 'C', 'D');
    j.start();
    j.wait(5).bust('B', ['A']);
    j.rebuy('B');
    j.wait(5).bust('C', ['B']); // окончательный, ребаи ещё открыты
    j.wait(5).bust('B', ['D']);
    j.rebuy('B');
    let s = replay(F, j.events, j.now());
    expect(s.players.B).toMatchObject({
      alive: true,
      busts: 2,
      rebuys: 2,
      entries: 3,
      finalBustEventId: null,
      bustLevel: null,
    });
    expect(s.players.C).toMatchObject({ alive: false, busts: 1, place: null }); // ребаи открыты — место неизвестно
    expect(s.firstBustPlayerId).toBe('B');
    expect(s.places).toEqual([]);

    j.wait(300); // ребаи закрылись
    j.bust('D', ['A']);
    s = replay(F, j.events, j.now());
    expect(s.rebuysOpen).toBe(false);
    expect(s.players.D?.place).toBe(3);
    expect(s.firstBustPlayerId).toBe('B'); // первый вылет вечера не меняется последующими
    expect(s.players.C?.place).toBe(4);
    expect(s.places).toEqual([]); // полный список — только после finish

    j.bust('B', ['A']);
    j.finish();
    s = replay(F, j.events, j.now());
    expect(s.finished).toBe(true);
    expect(s.places).toEqual(['A', 'B', 'D', 'C']);
    expect(['A', 'B', 'C', 'D'].map((id) => s.players[id]?.place)).toEqual([1, 2, 4, 3]);
    expect(s.players.A).toMatchObject({ kos: 3, koVictims: ['B', 'D', 'B'], bountyWonRub: 300 });
    expect(s.players.B).toMatchObject({ busts: 3, entries: 3 });
    expect(s.totalEntries).toBe(6);
    expect(s.totalChips).toBe(3000);
    expect(s.prizePoolRub).toBe(2400);
    expect(s.aliveCount).toBe(1);
    expect(s.errors).toEqual([]);
  });

  it('finish при открытых ребаях закрывает их', () => {
    const j = journal().join('A', 'B', 'C');
    j.start();
    j.wait(10).bust('C', ['A']);
    j.bust('B', ['A']);
    expect(replay(F, j.events, j.now()).rebuysOpen).toBe(true);
    j.finish();
    const lateRebuy = j.rebuy('B');
    const lateJoin = j.add('join', { playerId: 'Z' });
    const s = replay(F, j.events, j.now() + 60 * MIN);
    expect(s.finished).toBe(true);
    expect(s.rebuysOpen).toBe(false);
    expect(s.places).toEqual(['A', 'B', 'C']);
    expect(s.errors).toEqual([
      { eventId: lateRebuy, message: 'Вечер уже завершён' },
      { eventId: lateJoin, message: 'Вечер уже завершён' },
    ]);
    // Время после finish не идёт.
    expect(s.timer.totalElapsedMs).toBe(10 * MIN);
  });

  it('ошибочные события пропускаются и попадают в errors, replay продолжается', () => {
    const j = journal().join('A', 'B', 'C');
    const dupJoin = j.add('join', { playerId: 'A' });
    j.start();
    const rebuyAlive = j.rebuy('A');
    const rebuyStranger = j.rebuy('X');
    j.bust('C', ['A']);
    const bustDead = j.bust('C', ['B']);
    const byDead = j.bust('B', ['C']);
    const bySelf = j.bust('B', ['B']);
    const byDup = j.bust('B', ['A', 'A']);
    const noBy = j.add('bust', { playerId: 'B' } as never);
    const noPlayer = j.add('join', {});
    const earlyFinish = j.finish();
    const badPayment = j.add('payment', { playerId: 'A', amountRub: 10.5 } as never);
    j.bust('B', ['A']);
    const killLast = j.bust('A', []);
    j.finish();
    const afterFinish = j.add('hand');
    const s = replay(F, j.events, j.now());
    expect(s.errors).toEqual([
      { eventId: dupJoin, message: 'Игрок уже в турнире' },
      { eventId: rebuyAlive, message: 'Игрок ещё в игре — ребай только после вылета' },
      { eventId: rebuyStranger, message: 'Игрок не входил в турнир' },
      { eventId: bustDead, message: 'Игрок уже выбыл' },
      { eventId: byDead, message: 'Выбить может только игрок, который сейчас в игре' },
      { eventId: bySelf, message: 'Игрок не может выбить сам себя' },
      { eventId: byDup, message: 'Игрок повторяется в списке выбивших' },
      { eventId: noBy, message: 'Не указано, кто выбил (пустой список — если никто)' },
      { eventId: noPlayer, message: 'Не указан игрок' },
      { eventId: earlyFinish, message: 'Завершить можно, когда в игре остался один игрок' },
      { eventId: badPayment, message: 'Платёж: нужен игрок и ненулевая сумма в целых рублях' },
      { eventId: killLast, message: 'Нельзя выбить последнего игрока' },
      { eventId: afterFinish, message: 'Вечер уже завершён' },
    ]);
    expect(s.finished).toBe(true);
    expect(s.places).toEqual(['A', 'B', 'C']);
    expect(s.players.A?.entries).toBe(1);
  });

  it('лимит ребаев', () => {
    const fmt: TournamentFormat = { ...F, rebuyLimit: 1 };
    const j = journal().join('A', 'B');
    j.bust('A', ['B']);
    j.rebuy('A');
    j.bust('A', ['B']);
    const over = j.rebuy('A');
    const s = replay(fmt, j.events, j.now());
    expect(s.errors).toEqual([{ eventId: over, message: 'Лимит ребаев исчерпан' }]);
  });

  it('voided-события игнорируются, отмена finish возвращает вечер в игру', () => {
    const j = journal().join('A', 'B', 'C');
    j.start();
    const b = j.bust('C', ['A']);
    j.voidEvent(b);
    let s = replay(F, j.events, j.now());
    expect(s.players.C?.alive).toBe(true);
    expect(s.players.A?.kos).toBe(0);
    expect(s.firstBustPlayerId).toBeNull();
    j.bust('C', ['B']);
    j.bust('B', ['A']);
    const fin = j.finish();
    expect(replay(F, j.events, j.now()).finished).toBe(true);
    j.voidEvent(fin);
    s = replay(F, j.events, j.now());
    expect(s.finished).toBe(false);
    expect(s.rebuysOpen).toBe(true);
    expect(s.places).toEqual([]);
  });

  it('порядок применения — по id, а не по порядку массива', () => {
    const j = journal().join('A', 'B');
    j.bust('B', ['A']);
    const shuffled = [...j.events].reverse();
    expect(replay(F, shuffled, j.now()).players.A?.kos).toBe(1);
  });

  it('canApply совпадает с правилами replay', () => {
    const j = journal().join('A', 'B');
    const now = j.now();
    const s = replay(F, j.events, now);
    expect(canApply(F, s, 'join', { playerId: 'A' }, now)).toBe('Игрок уже в турнире');
    expect(canApply(F, s, 'join', { playerId: 'C' }, now)).toBeNull();
    expect(canApply(F, s, 'rebuy', { playerId: 'A' }, now)).toBe(
      'Игрок ещё в игре — ребай только после вылета',
    );
    expect(canApply(F, s, 'bust', { playerId: 'A', by: ['B'] }, now)).toBeNull();
    expect(canApply(F, s, 'bust', { playerId: 'A', by: [] }, now)).toBeNull();
    expect(canApply(F, s, 'finish', {}, now)).toBe(
      'Завершить можно, когда в игре остался один игрок',
    );
    expect(canApply(F, s, 'payment', { playerId: 'A', amountRub: 500 }, now)).toBeNull();
    expect(canApply(F, s, 'payment', { playerId: 'A', amountRub: 0 }, now)).not.toBeNull();
    expect(canApply(F, s, 'timer_start', {}, now)).toBeNull();
  });

  it('некорректное время события — ошибка, а не падение', () => {
    const j = journal().join('A');
    const ev = j.events[0];
    if (!ev) throw new Error('нет события');
    ev.at = 'не дата';
    const s = replay(F, j.events, j.now());
    expect(s.errors).toEqual([{ eventId: ev.id, message: 'Некорректное время события' }]);
  });

  it('replayLog отдаёт только принятые события', () => {
    const j = journal().join('A', 'B');
    j.rebuy('A');
    j.bust('B', ['A']);
    const { applied } = replayLog(F, j.events, j.now());
    expect(applied.map((e) => e.type)).toEqual(['join', 'join', 'bust']);
  });

  it('формат без уровней не роняет replay', () => {
    const j = journal().join('A', 'B');
    j.start();
    const s = replay({ ...F, levels: [] }, j.events, j.now() + 10 * MIN);
    expect(s.currentLevel.bb).toBe(0);
    expect(s.nextLevel).toBeNull();
  });
});

// Отмена finish («вернуть вечер в игру»). add_event (миграция 007) при finish на идущем таймере
// сначала пишет timer_pause с тем же `at`. Тогда отмена finish не запускает таймер задним числом.
describe('отмена finish и пауза перед ним', () => {
  const DAY = 24 * 60 * MIN;

  it('с паузой перед finish: после отмены через двое суток таймер стоит там, где был', () => {
    const j = journal().join('A', 'B', 'C');
    j.start();
    j.wait(90);
    j.bust('B', ['A']);
    j.bust('C', ['A']);
    j.pause(); // вставляет add_event перед finish, тот же now()
    const fin = j.finish();
    const atFinish = replay(F, j.events, j.now());
    expect(atFinish.timer.levelIndex).toBe(2);
    expect(atFinish.timer.totalElapsedMs).toBe(90 * MIN);

    j.wait(2 * DAY);
    j.voidEvent(fin);
    const back = replay(F, j.events, j.now());
    expect(back.finished).toBe(false);
    expect(back.timer.status).toBe('paused');
    expect(back.timer.levelIndex).toBe(2);
    expect(back.timer.totalElapsedMs).toBe(90 * MIN);
    // finish был в периоде ребаев — после возврата ребай снова можно записать
    expect(back.rebuysOpen).toBe(true);
    expect(canApply(F, back, 'rebuy', { playerId: 'B' }, j.now())).toBeNull();
  });

  it('без паузы (старые журналы) отмена finish запускает таймер задним числом', () => {
    const j = journal().join('A', 'B');
    j.start();
    j.wait(90);
    j.bust('B', ['A']);
    const fin = j.finish();
    j.wait(2 * DAY);
    j.voidEvent(fin);
    const back = replay(F, j.events, j.now());
    expect(back.timer.status).toBe('running');
    expect(back.rebuysOpen).toBe(false);
  });
});
