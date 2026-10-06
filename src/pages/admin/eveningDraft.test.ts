import { DEFAULT_FORMAT } from '@domain/format.ts';
import type { TournamentFormat } from '@domain/types.ts';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_FORMAT,
  checkEveningDraft,
  chosenFormat,
  draftFromEvening,
  eveningDirty,
  KEEP_FORMAT,
  newEveningDraft,
  type EveningDraft,
  type FormatOption,
} from './eveningDraft';

const NOW = Date.parse('2026-10-06T12:00:00Z'); // вторник, 15:00 МСК

const SETTINGS = {
  game_weekday: 4,
  game_time: '19:00:00',
  default_location: 'У Жени',
  default_format_id: 'f1',
};

const TURBO: TournamentFormat = { ...DEFAULT_FORMAT, name: 'Турбо (старое имя)' };
const FORMATS: FormatOption[] = [
  { id: 'f0', name: 'Старый', is_archived: true, config: DEFAULT_FORMAT },
  { id: 'f1', name: 'Клубный', is_archived: false, config: DEFAULT_FORMAT },
  { id: 'f2', name: 'Турбо', is_archived: false, config: TURBO },
];

describe('draftFromEvening', () => {
  it('время вечера — по Москве, формат остаётся снимком', () => {
    expect(
      draftFromEvening({
        scheduled_at: '2026-10-08T16:00:00+00:00',
        location: null,
        note: 'Возьмите наличку',
        banker_id: 'p2',
        status: 'announced',
      }),
    ).toEqual({
      date: '2026-10-08',
      time: '19:00',
      location: '',
      note: 'Возьмите наличку',
      formatChoice: KEEP_FORMAT,
      bankerId: 'p2',
    });
  });
});

describe('newEveningDraft', () => {
  it('ближайший четверг, место и формат по умолчанию', () => {
    expect(newEveningDraft(NOW, SETTINGS, FORMATS, new Set())).toEqual({
      date: '2026-10-08',
      time: '19:00',
      location: 'У Жени',
      note: '',
      formatChoice: 'f1',
      bankerId: null,
    });
  });

  it('на ближайший четверг вечер уже есть — следующий четверг', () => {
    expect(newEveningDraft(NOW, SETTINGS, FORMATS, new Set(['2026-10-08'])).date).toBe(
      '2026-10-15',
    );
  });

  it('формат по умолчанию в архиве — первый активный; своих нет — встроенный', () => {
    expect(
      newEveningDraft(NOW, { ...SETTINGS, default_format_id: 'f0' }, FORMATS, new Set())
        .formatChoice,
    ).toBe('f1');
    expect(newEveningDraft(NOW, SETTINGS, [], new Set()).formatChoice).toBe(BUILTIN_FORMAT);
  });

  it('без настроек — пустая дата, 19:00', () => {
    expect(newEveningDraft(NOW, null, FORMATS, new Set())).toMatchObject({
      date: '',
      time: '19:00',
      location: '',
    });
  });
});

describe('checkEveningDraft', () => {
  const base: EveningDraft = {
    date: '2026-10-15',
    time: '19:00',
    location: '',
    note: '',
    formatChoice: 'f1',
    bankerId: null,
  };
  const check = (
    patch: Partial<EveningDraft>,
    taken: string[] = [],
    format: TournamentFormat | null = DEFAULT_FORMAT,
  ) => checkEveningDraft({ ...base, ...patch }, { taken: new Set(taken), nowMs: NOW, format });

  it('годная форма — момент начала в UTC', () => {
    expect(check({})).toEqual({ scheduledAt: '2026-10-15T16:00:00.000Z', errors: {}, past: false });
  });

  it('пустые и неверные дата и время', () => {
    expect(check({ date: '' }).errors.date).toMatch(/Укажи дату/);
    expect(check({ date: '2026-02-30' }).errors.date).toBeDefined();
    expect(check({ time: '' }).errors.time).toMatch(/Укажи время/);
    expect(check({ time: '' }).scheduledAt).toBeNull();
  });

  it('второй вечер на тот же день — ошибка у даты', () => {
    expect(check({}, ['2026-10-15']).errors.date).toMatch(/На 15 октября уже есть вечер/);
  });

  it('прошедшее время — не ошибка, а пометка', () => {
    const r = check({ date: '2026-10-01' });
    expect(r.errors).toEqual({});
    expect(r.past).toBe(true);
  });

  it('формат: не выбран или с ошибками', () => {
    expect(check({}, [], null).errors.format).toMatch(/Выбери формат/);
    expect(check({}, [], { ...DEFAULT_FORMAT, levels: [] }).errors.format).toMatch(/ошибки/);
  });
});

describe('chosenFormat', () => {
  it('снимок, встроенный или копия пресета с его названием', () => {
    const snapshot = { ...DEFAULT_FORMAT, name: 'Снимок' };
    expect(chosenFormat(KEEP_FORMAT, FORMATS, snapshot)).toBe(snapshot);
    expect(chosenFormat(BUILTIN_FORMAT, FORMATS, snapshot)).toBe(DEFAULT_FORMAT);
    expect(chosenFormat('f2', FORMATS, snapshot)).toEqual({ ...TURBO, name: 'Турбо' });
    expect(chosenFormat('нет такого', FORMATS, snapshot)).toBeNull();
  });
});

describe('eveningDirty', () => {
  const a: EveningDraft = {
    date: '2026-10-15',
    time: '19:00',
    location: 'У Жени',
    note: '',
    formatChoice: KEEP_FORMAT,
    bankerId: null,
  };

  it('по смыслу', () => {
    expect(eveningDirty({ ...a, location: ' У Жени ', time: '19:00:00' }, a)).toBe(false);
    expect(eveningDirty({ ...a, bankerId: 'p1' }, a)).toBe(true);
    expect(eveningDirty({ ...a, formatChoice: 'f1' }, a)).toBe(true);
    expect(eveningDirty({ ...a, time: '19:30' }, a)).toBe(true);
  });
});
