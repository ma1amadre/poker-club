import { DEFAULT_FORMAT } from '@domain/format.ts';
import { replay } from '@domain/replay.ts';
import type { EveningEvent, TournamentFormat } from '@domain/types.ts';
import { describe, expect, it } from 'vitest';
import {
  appendLevel,
  changeTrigger,
  checkDraft,
  doublePrevious,
  draftFromFormat,
  formatFromDraft,
  formatGameClock,
  formatSummary,
  moveLevel,
  newFormatDraft,
  payoutSum,
  poolPerEntryRub,
  previewFormat,
  removeLevel,
  sameDraft,
  type FormatDraft,
} from './formatDraft';

const NBSP = ' ';

const valid = (patch: Partial<FormatDraft> = {}): FormatDraft => ({
  ...draftFromFormat(DEFAULT_FORMAT),
  ...patch,
});

describe('draftFromFormat / formatFromDraft', () => {
  it('клубный формат проходит туда и обратно без потерь', () => {
    expect(formatFromDraft(draftFromFormat(DEFAULT_FORMAT))).toEqual(DEFAULT_FORMAT);
  });

  it('анте, лимит ребаев и не-временные триггеры', () => {
    const f: TournamentFormat = {
      ...DEFAULT_FORMAT,
      name: 'Турбо',
      rebuyLimit: 2,
      payoutPct: [50, 30, 20],
      levels: [
        { sb: 10, bb: 20, trigger: { type: 'hands', count: 5 } },
        { sb: 20, bb: 40, ante: 40, trigger: { type: 'eliminations', count: 2 } },
        { sb: 50, bb: 100, ante: 100, trigger: { type: 'time', minutes: 15 } },
      ],
    };
    expect(formatFromDraft(draftFromFormat(f))).toEqual(f);
  });

  it('пустое анте и анте 0 — без анте, пустой лимит — без лимита', () => {
    const d = valid();
    d.levels = d.levels.map((l, i) => (i === 0 ? { ...l, ante: '0' } : l));
    const f = formatFromDraft({ ...d, rebuyLimit: '' });
    expect(f.levels[0]).not.toHaveProperty('ante');
    expect(f.rebuyLimit).toBeNull();
  });

  it('битый jsonb не роняет форму', () => {
    const broken = { name: 5, levels: [{ sb: 5 }], payoutPct: 'x' } as unknown as TournamentFormat;
    const d = draftFromFormat(broken);
    expect(d.name).toBe('');
    expect(d.levels).toHaveLength(1);
    expect(d.levels[0]).toMatchObject({ sb: '5', bb: '', trigger: 'time', amount: '' });
    expect(d.payouts).toEqual([]);
  });

  it('новый формат — клубный без названия', () => {
    const d = newFormatDraft();
    expect(d.name).toBe('');
    expect(formatFromDraft({ ...d, name: 'Клубный' })).toEqual(DEFAULT_FORMAT);
  });

  it('sameDraft не смотрит на ключи строк и пробелы в названии', () => {
    const a = valid();
    const b = draftFromFormat(DEFAULT_FORMAT);
    expect(sameDraft(a, { ...b, name: ` ${b.name} ` })).toBe(true);
    expect(sameDraft(a, { ...b, buyIn: '600' })).toBe(false);
  });
});

describe('checkDraft', () => {
  it('годный формат — без ошибок', () => {
    const { ok, problems } = checkDraft(valid());
    expect(ok).toBe(true);
    expect(problems.count).toBe(0);
  });

  it('пустое название — у поля названия', () => {
    const { ok, problems } = checkDraft(newFormatDraft());
    expect(ok).toBe(false);
    expect(Object.keys(problems.fields)).toEqual(['name']);
    expect(problems.count).toBe(1);
  });

  it('длинное название — своё сообщение', () => {
    expect(checkDraft(valid({ name: 'я'.repeat(81) })).problems.fields.name).toMatch(/длиннее 80/);
  });

  it('нечисло — у поля, без дубля от домена', () => {
    const { problems } = checkDraft(valid({ buyIn: 'пятьсот', chips: '' }));
    expect(problems.fields.buyIn).toBe('Введи целое число.');
    expect(problems.fields.chips).toBe('Заполни поле.');
    expect(problems.other).toEqual([]);
    expect(problems.count).toBe(2);
  });

  it('каждое сообщение validateFormat попадает к своему полю', () => {
    const cases: [Partial<FormatDraft>, string][] = [
      [{ buyIn: '0', bounty: '0' }, 'buyIn'],
      [{ chips: '-5' }, 'chips'],
      [{ bounty: '-1' }, 'bounty'],
      [{ bounty: '600' }, 'bounty'],
      [{ rebuyUntil: '-1' }, 'rebuyUntil'],
      [{ rebuyLimit: '-1' }, 'rebuyLimit'],
      [{ payouts: [] }, 'payouts'],
      [{ payouts: ['70', '0'] }, 'payouts'],
      [{ payouts: ['70', '20'] }, 'payouts'],
    ];
    for (const [patch, field] of cases) {
      const { problems } = checkDraft(valid(patch));
      expect(Object.keys(problems.fields), JSON.stringify(patch)).toEqual([field]);
      expect(problems.other, JSON.stringify(patch)).toEqual([]);
    }
  });

  it('технические слова домена — в язык формы', () => {
    expect(checkDraft(valid({ rebuyLimit: '-1' })).problems.fields.rebuyLimit).not.toMatch(/null/);
    expect(checkDraft(valid({ payouts: ['70', '20,5'] })).problems.fields.payouts).toBe(
      `Доли мест в сумме дают 90,5${NBSP}%, а нужно ровно 100${NBSP}%.`,
    );
  });

  it('ошибки уровня — к строке уровня и её полям', () => {
    const d = valid();
    d.levels = d.levels.map((l, i) => (i === 2 ? { ...l, sb: '50', bb: '30' } : l));
    const { problems } = checkDraft(d);
    expect(problems.levels[2]).toEqual({
      fields: ['sb', 'bb'],
      messages: ['Малый блайнд больше большого'],
    });
    expect(problems.count).toBe(1);
  });

  it('длительность и число для триггера — к полю числа', () => {
    const d = valid();
    d.levels = d.levels.map((l, i) =>
      i === 0 ? { ...l, amount: '0' } : i === 1 ? { ...l, trigger: 'hands', amount: '0' } : l,
    );
    const { problems } = checkDraft(d);
    expect(problems.levels[0]?.fields).toEqual(['amount']);
    expect(problems.levels[1]?.fields).toEqual(['amount']);
  });

  it('нечисло в уровне — одно сообщение на строку, без дублей домена', () => {
    const d = valid();
    d.levels = d.levels.map((l, i) => (i === 0 ? { ...l, sb: '', ante: 'x' } : l));
    const { problems } = checkDraft(d);
    expect(problems.levels[0]?.fields.sort()).toEqual(['ante', 'sb']);
    expect(problems.levels[0]?.messages).toHaveLength(1);
  });

  it('нет уровней — общая ошибка', () => {
    const { problems } = checkDraft(valid({ levels: [] }));
    expect(problems.other).toEqual(['Нужен хотя бы один уровень блайндов']);
  });

  it('доли-нечисла отмечаются по индексу', () => {
    const { problems } = checkDraft(valid({ payouts: ['70', 'тридцать'] }));
    expect(problems.payoutItems).toEqual([1]);
    expect(problems.fields.payouts).toMatch(/число процентов/);
  });
});

describe('payoutSum', () => {
  it('сумма долей без хвостов двоичной арифметики', () => {
    expect(payoutSum(['70', '30'])).toBe(100);
    expect(payoutSum(['33,3', '33,3', '33,4'])).toBe(100);
    expect(payoutSum(['50', '30'])).toBe(80);
    expect(payoutSum([])).toBe(0);
  });

  it('если есть нечисло — null', () => {
    expect(payoutSum(['70', ''])).toBeNull();
    expect(payoutSum(['70', 'x'])).toBeNull();
  });
});

describe('операции над уровнями', () => {
  const levels = valid().levels.slice(0, 3); // 5/10, 10/20, 15/30

  it('новый уровень — предыдущий ×2 с тем же триггером и новым ключом', () => {
    const next = appendLevel(levels);
    expect(next).toHaveLength(4);
    expect(next[3]).toMatchObject({ sb: '30', bb: '60', ante: '', trigger: 'time', amount: '40' });
    expect(next[3]?.key).not.toBe(levels[2]?.key);
    expect(appendLevel([])[0]).toMatchObject({ sb: '5', bb: '10', trigger: 'time', amount: '40' });
  });

  it('анте тоже удваивается, нечисло остаётся как есть', () => {
    const withAnte = [{ ...levels[0]!, ante: '10', sb: 'x' }];
    expect(appendLevel(withAnte)[1]).toMatchObject({ sb: 'x', bb: '20', ante: '20' });
  });

  it('«удвоить предыдущий» меняет только блайнды уровня', () => {
    const custom = levels.map((l, i) => (i === 2 ? { ...l, sb: '1', bb: '2', amount: '15' } : l));
    const next = doublePrevious(custom, 2);
    expect(next[2]).toMatchObject({ sb: '20', bb: '40', amount: '15', key: custom[2]?.key });
    expect(doublePrevious(custom, 0)).toEqual(custom);
  });

  it('сдвиг и удаление', () => {
    const ids = (list: typeof levels) => list.map((l) => l.bb);
    expect(ids(moveLevel(levels, 0, 1))).toEqual(['20', '10', '30']);
    expect(ids(moveLevel(levels, 2, -1))).toEqual(['10', '30', '20']);
    expect(ids(moveLevel(levels, 0, -1))).toEqual(['10', '20', '30']);
    expect(ids(moveLevel(levels, 2, 1))).toEqual(['10', '20', '30']);
    expect(ids(removeLevel(levels, 1))).toEqual(['10', '30']);
  });

  it('смена триггера ставит число по умолчанию для нового триггера', () => {
    const l = levels[0]!;
    expect(changeTrigger(l, 'time')).toBe(l);
    expect(changeTrigger(l, 'eliminations')).toMatchObject({
      trigger: 'eliminations',
      amount: '1',
    });
    expect(changeTrigger(l, 'hands')).toMatchObject({ trigger: 'hands', amount: '5' });
  });
});

/** Открыты ли ребаи через `minutes` игрового времени после старта таймера — ответ домена. */
function rebuysOpenAt(format: TournamentFormat, ms: number): boolean {
  const start = Date.parse('2026-10-08T16:00:00Z');
  const events: EveningEvent[] = [
    { id: 1, type: 'join', payload: { playerId: 'a' }, at: '2026-10-08T15:59:00Z', voided: false },
    { id: 2, type: 'timer_start', payload: {}, at: new Date(start).toISOString(), voided: false },
  ];
  return replay(format, events, start + ms).rebuysOpen;
}

describe('previewFormat', () => {
  it('клубный формат: 5 ч 20 мин уровней, ребаи до 3:20, 50 BB на старте', () => {
    const p = previewFormat(DEFAULT_FORMAT);
    expect(p.levelStarts).toEqual([0, 40, 80, 120, 160, 200, 240, 280]);
    expect(p.timeMinutes).toBe(320);
    expect(p.timeLevels).toBe(8);
    expect(p.otherLevels).toBe(0);
    expect(p.uniformMinutes).toBe(40);
    expect(p.rebuys).toEqual({ kind: 'at', level: 5, minutes: 200 });
    expect(p.startingBb).toBe(50);
  });

  it('время закрытия ребаев совпадает с replay', () => {
    const formats: TournamentFormat[] = [
      DEFAULT_FORMAT,
      { ...DEFAULT_FORMAT, rebuyUntilLevel: 1 },
      {
        ...DEFAULT_FORMAT,
        rebuyUntilLevel: 3,
        levels: [
          { sb: 10, bb: 20, trigger: { type: 'time', minutes: 15 } },
          { sb: 20, bb: 40, trigger: { type: 'time', minutes: 25 } },
          { sb: 30, bb: 60, trigger: { type: 'time', minutes: 30 } },
          { sb: 50, bb: 100, trigger: { type: 'time', minutes: 30 } },
        ],
      },
    ];
    for (const f of formats) {
      const p = previewFormat(f);
      expect(p.rebuys?.kind).toBe('at');
      const minutes = p.rebuys?.kind === 'at' ? p.rebuys.minutes : 0;
      expect(rebuysOpenAt(f, minutes * 60_000 - 1)).toBe(true);
      expect(rebuysOpenAt(f, minutes * 60_000)).toBe(false);
    }
  });

  it('без ребаев, до конца турнира и «после вылетов»', () => {
    const none = { ...DEFAULT_FORMAT, rebuyUntilLevel: 0 };
    expect(previewFormat(none).rebuys).toEqual({ kind: 'none' });
    expect(rebuysOpenAt(none, 0)).toBe(false);

    const open = { ...DEFAULT_FORMAT, rebuyUntilLevel: 8 };
    expect(previewFormat(open).rebuys).toEqual({ kind: 'open' });
    expect(rebuysOpenAt(open, 24 * 3_600_000)).toBe(true);

    const mixed: TournamentFormat = {
      ...DEFAULT_FORMAT,
      rebuyUntilLevel: 2,
      levels: [
        { sb: 10, bb: 20, trigger: { type: 'time', minutes: 20 } },
        { sb: 20, bb: 40, trigger: { type: 'eliminations', count: 2 } },
        { sb: 40, bb: 80, trigger: { type: 'time', minutes: 20 } },
      ],
    };
    const p = previewFormat(mixed);
    expect(p.rebuys).toEqual({ kind: 'after', level: 2 });
    expect(p.levelStarts).toEqual([0, 20, null]);
    expect(p.timeMinutes).toBe(40);
    expect(p.otherLevels).toBe(1);
    expect(p.uniformMinutes).toBe(20);
  });

  it('недописанный формат — что нельзя посчитать, то null', () => {
    const f = formatFromDraft(valid({ chips: '', rebuyUntil: 'x' }));
    const p = previewFormat(f);
    expect(p.startingBb).toBeNull();
    expect(p.rebuys).toBeNull();
    expect(p.timeMinutes).toBe(320);
  });
});

describe('formatGameClock / poolPerEntryRub / formatSummary', () => {
  it('ч:мм игрового времени', () => {
    expect(formatGameClock(200)).toBe('3:20');
    expect(formatGameClock(45)).toBe('0:45');
    expect(formatGameClock(0)).toBe('0:00');
    expect(formatGameClock(600)).toBe('10:00');
  });

  it('фонд с одного входа — из домена', () => {
    expect(poolPerEntryRub(DEFAULT_FORMAT)).toBe(400);
    expect(poolPerEntryRub({ ...DEFAULT_FORMAT, bountyRub: 0 })).toBe(500);
    expect(poolPerEntryRub({ ...DEFAULT_FORMAT, levels: [] })).toBeNull();
  });

  it('строка о формате', () => {
    expect(formatSummary(DEFAULT_FORMAT)).toBe(
      `500${NBSP}₽ · 500${NBSP}фишек · 8${NBSP}уровней по 40${NBSP}мин · ребаи до 5-го уровня`,
    );
    expect(formatSummary({ ...DEFAULT_FORMAT, startingChips: 1500, rebuyLimit: 1 })).toBe(
      `500${NBSP}₽ · 1${NBSP}500${NBSP}фишек · 8${NBSP}уровней по 40${NBSP}мин · ребаи до 5-го уровня, не больше 1${NBSP}на${NBSP}игрока`,
    );
    expect(formatSummary({ ...DEFAULT_FORMAT, rebuyUntilLevel: 0 })).toMatch(/без ребаев$/);
    expect(formatSummary({ ...DEFAULT_FORMAT, rebuyUntilLevel: 9 })).toMatch(/ребаи до конца$/);
    expect(
      formatSummary({
        ...DEFAULT_FORMAT,
        levels: [
          { sb: 5, bb: 10, trigger: { type: 'time', minutes: 20 } },
          { sb: 10, bb: 20, trigger: { type: 'hands', count: 5 } },
        ],
      }),
    ).toContain(`2${NBSP}уровня · `);
  });
});
