import { DEFAULT_FORMAT } from '@domain/format.ts';
import { replayLog } from '@domain/replay.ts';
import { journal, type Journal } from '@domain/test-utils.ts';
import type { LevelTrigger, TournamentFormat } from '@domain/types.ts';
import { describe, expect, it } from 'vitest';
import {
  blindsText,
  clockMode,
  cornerLevel,
  durationParts,
  finalMinute,
  levelLine,
  nextText,
  partsText,
  prizeParts,
  quietParts,
  rebuyView,
} from './gameModel';
import { applyHolds } from './tableModel';

const t: LevelTrigger = { type: 'time', minutes: 40 };
/** 8 уровней по 40 минут, ребаи до конца 5-го — как в макете. */
const FMT: TournamentFormat = {
  ...DEFAULT_FORMAT,
  rebuyUntilLevel: 5,
  payoutPct: [70, 30],
  levels: [
    { sb: 10, bb: 20, trigger: t },
    { sb: 15, bb: 30, trigger: t },
    { sb: 25, bb: 50, trigger: t },
    { sb: 50, bb: 100, trigger: t },
    { sb: 75, bb: 150, trigger: t },
    { sb: 100, bb: 200, trigger: t },
    { sb: 150, bb: 300, trigger: t },
    { sb: 1000, bb: 2000, trigger: t },
  ],
};

/** Неразрывные пробелы → обычные: ожидания читаются как текст. */
const sp = (s: string) => s.replace(/[  ]/g, ' ');

function game(): Journal {
  const j = journal().join('a', 'b', 'c', 'd', 'e', 'f', 'g');
  j.start();
  return j;
}
const state = (j: Journal) => replayLog(FMT, j.events, j.now()).state;

describe('колонка игры: длительности', () => {
  it('«1 ч 08 мин» и «28 мин»: числа — отдельными кусками (моно), никогда «1:08» рядом с часами', () => {
    expect(sp(partsText(durationParts(68)))).toBe('1 ч 08 мин');
    expect(
      durationParts(68)
        .filter((p) => p.b)
        .map((p) => p.t),
    ).toEqual(['1', '08']);
    expect(sp(partsText(durationParts(28)))).toBe('28 мин');
    expect(sp(partsText(durationParts(0)))).toBe('0 мин');
  });
});

describe('колонка игры: строка ребаев', () => {
  it('коротко, пока до закрытия больше 30 минут: уровень 4, 28:00 — «Ребаи · ещё 1 ч 08 мин»', () => {
    const j = game();
    j.wait(3 * 40 + 12);
    const v = rebuyView(FMT, state(j));
    expect(v.tone).toBe('quiet');
    expect(sp(partsText(v.parts))).toBe('Ребаи · ещё 1 ч 08 мин');
  });

  it('полностью в последние 30 минут: уровень 5, 28:00 — «до конца этого уровня»', () => {
    const j = game();
    j.wait(4 * 40 + 12);
    const v = rebuyView(FMT, state(j));
    expect(v.tone).toBe('hot');
    expect(sp(partsText(v.parts))).toBe('Ребаи — до конца этого уровня · ещё 28 мин');
  });

  it('в последние 30 минут на уровне раньше последнего — «до конца 5-го уровня»', () => {
    const j = game();
    j.wait(3 * 40 + 30); // уровень 4, до конца 10 мин + уровень 5 (40) = 50 — ещё коротко
    expect(rebuyView(FMT, state(j)).tone).toBe('quiet');
    // 5-й уровень — 20 минут: на 4-м за минуту до конца до закрытия 21 минута.
    const k = game();
    k.wait(3 * 40 + 39);
    const f2: TournamentFormat = {
      ...FMT,
      levels: FMT.levels.map((l, i) =>
        i === 4 ? { ...l, trigger: { type: 'time', minutes: 20 } } : l,
      ),
    };
    const v = rebuyView(f2, replayLog(f2, k.events, k.now()).state);
    expect(v.tone).toBe('hot');
    expect(sp(partsText(v.parts))).toBe('Ребаи — до конца 5-го уровня · ещё 21 мин');
  });

  it('сигнал за 5 минут: «Ребаи закрываются · ещё 5 мин» (минуты вверх, как часы)', () => {
    const j = game();
    j.wait(4 * 40 + 35);
    const v = rebuyView(FMT, state(j));
    expect(v.tone).toBe('signal');
    expect(sp(partsText(v.parts))).toBe('Ребаи закрываются · ещё 5 мин');
    j.wait(4.5);
    expect(sp(partsText(rebuyView(FMT, state(j)).parts))).toBe('Ребаи закрываются · ещё 1 мин');
  });

  it('после 5-го уровня — «Ребаи закрыты»; заставка нового последнего уровня ребаев — строка полностью', () => {
    const j = game();
    j.wait(5 * 40 + 1);
    expect(rebuyView(FMT, state(j))).toEqual({ tone: 'closed', parts: [{ t: 'Ребаи закрыты' }] });
    const k = game();
    k.wait(4 * 40);
    const lift = rebuyView(FMT, state(k), true);
    expect(lift.tone).toBe('hot');
    expect(sp(partsText(lift.parts))).toBe('Ребаи — до конца этого уровня · ещё 40 мин');
    expect(rebuyView(FMT, state(k)).tone).toBe('quiet');
  });

  it('ребаи всю игру — «Ребаи · всю игру»', () => {
    const f: TournamentFormat = { ...FMT, rebuyUntilLevel: FMT.levels.length };
    const j = game();
    expect(partsText(rebuyView(f, replayLog(f, j.events, j.now()).state).parts)).toBe(
      'Ребаи · всю игру',
    );
  });
});

describe('колонка игры: тихая строка, фонд, блайнды', () => {
  it('«Средний стек 57 BB · игра идёт 2 ч 12 мин» — число и BB моно с узкой отбивкой', () => {
    const j = game();
    j.wait(132);
    const parts = quietParts(state(j));
    expect(sp(partsText(parts))).toMatch(/^Средний стек [\d,]+ BB · игра идёт 2 ч 12 мин$/);
    expect(parts.some((p) => p.gs)).toBe(true);
  });

  it('призовые — суммы домена по местам', () => {
    const j = game();
    const prizes = prizeParts(FMT, state(j)).map((p) => `${p.place} ${sp(p.rub)}`);
    // 3 500 ₽ по 70/30 с шагом 100: 2-е — вниз до шага, остаток — 1-му.
    expect(prizes).toEqual(['1-е 2 500 ₽', '2-е 1 000 ₽']);
  });

  it('блайнды и «дальше»; на последнем уровне — «больше не растут»', () => {
    const j = game();
    j.wait(3 * 40 + 1);
    const s = state(j);
    expect(blindsText(s.currentLevel)).toBe('50/100');
    expect(nextText(s)).toEqual({ label: 'дальше', value: '75/150' });
    j.wait(4 * 40);
    const last = state(j);
    expect(sp(blindsText(last.currentLevel))).toBe('1 000/2 000');
    expect(nextText(last)).toEqual({ label: 'больше не растут', value: null });
  });
});

describe('колонка игры: строка над часами и режим часов', () => {
  it('«Уровень 4 из 8», последняя минута — critical, по раздачам — счёт, пауза — «стоим»', () => {
    const j = game();
    j.wait(3 * 40 + 10);
    const now = j.now();
    expect(levelLine(FMT, state(j), now, null)).toMatchObject({
      label: 'Уровень 4 из 8',
      note: null,
      alarm: false,
    });
    j.wait(29.5);
    expect(finalMinute(state(j))).toBe(true);
    expect(levelLine(FMT, state(j), j.now(), null)).toMatchObject({
      note: 'последняя минута',
      alarm: true,
    });
    j.pause();
    j.wait(6);
    const paused = state(j);
    expect(clockMode(paused)).toBe('paused');
    expect(sp(levelLine(FMT, paused, j.now(), 6 * 60_000).note ?? '')).toBe('стоим 6 мин');
  });

  it('уровень по раздачам — часы идут вверх, в строке — сколько раздач', () => {
    const f: TournamentFormat = {
      ...FMT,
      levels: [{ sb: 10, bb: 20, trigger: { type: 'hands', count: 10 } }, ...FMT.levels.slice(1)],
    };
    const j = game();
    j.hand();
    j.hand();
    const s = replayLog(f, j.events, j.now()).state;
    expect(clockMode(s)).toBe('counting');
    expect(levelLine(f, s, j.now(), null).note).toBe('раздач 2 из 10');
  });

  // Живая проверка 26.10.2026: уровень сменился посреди сцены бомб-пота — заставка ждёт за сценой, часы
  // в углу стоят на прежнем уровне, и подпись рядом — тоже прежняя (по показанному состоянию).
  it('подпись часов в углу — по показанному состоянию: ждёт заставка уровня — прежний уровень', () => {
    const j = game();
    j.wait(4 * 40 + 1);
    const live = state(j);
    expect(cornerLevel(FMT, live)).toEqual({ level: 5, blinds: blindsText(FMT.levels[4]!) });
    const held = applyHolds(live, FMT, { alive: [], levelIndex: 3 });
    expect(sp(cornerLevel(FMT, held).blinds)).toBe('50/100');
    expect(cornerLevel(FMT, held).level).toBe(4);
    j.wait(4 * 40);
    expect(cornerLevel(FMT, state(j)).level).toBe(8);
  });

  it('последний уровень сам не кончается — «последний, идёт», часы — тише', () => {
    const j = game();
    j.wait(7 * 40 + 5);
    const s = state(j);
    expect(clockMode(s)).toBe('last');
    expect(levelLine(FMT, s, j.now(), null)).toMatchObject({
      label: 'Уровень 8 из 8',
      note: 'последний, идёт',
    });
  });
});
