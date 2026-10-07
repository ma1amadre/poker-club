import { describe, expect, it } from 'vitest';
import { DEFAULT_FORMAT } from './format.ts';
import type { BlindLevel } from './types.ts';
import {
  announcementVariants,
  blindsWords,
  clipHash,
  eveningVoiceTexts,
  FIXED_TEXTS,
  knockoutPhrase,
  knockoutSegments,
  levelPhrase,
  levelTexts,
  normalizeSpeech,
  normalizeSpokenName,
  numberWords,
  pairTexts,
  PHRASES,
  speakableLevels,
  speakableName,
  spokenNameError,
  startPhrase,
  VOICE_ID,
  voiceManifest,
  voiceManifestTexts,
  winnerPhrase,
  type Announcement,
  type VoiceManifestPlayer,
} from './voice.ts';

const level = (sb: number, bb: number, ante?: number): BlindLevel => ({
  sb,
  bb,
  ...(ante === undefined ? {} : { ante }),
  trigger: { type: 'time', minutes: 20 },
});

describe('числа словами', () => {
  it.each([
    [0, 'ноль'],
    [1, 'один'],
    [2, 'два'],
    [5, 'пять'],
    [10, 'десять'],
    [11, 'одиннадцать'],
    [15, 'пятнадцать'],
    [19, 'девятнадцать'],
    [20, 'двадцать'],
    [21, 'двадцать один'],
    [40, 'сорок'],
    [75, 'семьдесят пять'],
    [99, 'девяносто девять'],
    [100, 'сто'],
    [101, 'сто один'],
    [112, 'сто двенадцать'],
    [150, 'сто пятьдесят'],
    [200, 'двести'],
    [999, 'девятьсот девяносто девять'],
    [1000, 'тысяча'],
    [1001, 'тысяча один'],
    [1500, 'тысяча пятьсот'],
    [2000, 'две тысячи'],
    [2500, 'две тысячи пятьсот'],
    [4000, 'четыре тысячи'],
    [5000, 'пять тысяч'],
    [11000, 'одиннадцать тысяч'],
    [12000, 'двенадцать тысяч'],
    [14000, 'четырнадцать тысяч'],
    [21000, 'двадцать одна тысяча'],
    [22000, 'двадцать две тысячи'],
    [24000, 'двадцать четыре тысячи'],
    [25000, 'двадцать пять тысяч'],
    [101000, 'сто одна тысяча'],
    [111000, 'сто одиннадцать тысяч'],
    [1_000_000, 'миллион'],
    [2_500_000, 'два миллиона пятьсот тысяч'],
    [5_000_000, 'пять миллионов'],
    [1_001_001, 'миллион тысяча один'],
    [21_000_000, 'двадцать один миллион'],
    [1_000_000_000, 'миллиард'],
    [
      999_999_999_999,
      'девятьсот девяносто девять миллиардов девятьсот девяносто девять миллионов девятьсот девяносто девять тысяч девятьсот девяносто девять',
    ],
  ])('%i → «%s»', (n, words) => {
    expect(numberWords(n)).toBe(words);
  });

  it('в тексте нет цифр и двойных пробелов на всём диапазоне блайндов', () => {
    for (let n = 0; n <= 20_000; n += 1) {
      const w = numberWords(n);
      expect(w).not.toMatch(/\d|\s\s|^\s|\s$/);
    }
  });

  it('отрицательные, дробные и слишком большие — RangeError', () => {
    for (const n of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1_000_000_000_000])
      expect(() => numberWords(n)).toThrow(RangeError);
  });
});

describe('фразы', () => {
  it('блайнды и анте словами', () => {
    expect(blindsWords(level(5, 10))).toBe('пять — десять');
    expect(blindsWords(level(10, 20, 0))).toBe('десять — двадцать');
    expect(blindsWords(level(1000, 2000, 200))).toBe('тысяча — две тысячи, анте двести');
  });

  it('старт и новый уровень — решения пользователя дословно', () => {
    expect(startPhrase(level(5, 10))).toBe('Поехали! Блайнды пять — десять.');
    expect(levelPhrase(level(50, 100))).toBe('Новый уровень. Блайнды пятьдесят — сто.');
    expect(levelPhrase(level(1250, 2500, 250))).toBe(
      'Новый уровень. Блайнды тысяча двести пятьдесят — две тысячи пятьсот, анте двести пятьдесят.',
    );
  });

  it('фиксированные фразы', () => {
    expect(PHRASES.minute).toBe('Минута до повышения блайндов.');
    expect(PHRASES.rebuysClosed).toBe('Ребаи закрыты.');
    expect(PHRASES.pause).toBe('Пауза.');
    expect(PHRASES.resume).toBe('Продолжаем.');
  });

  it('нокаут: один выбивший, двое, трое, без выбивших, без жертвы', () => {
    expect(knockoutPhrase('Эрдни', ['Саша'])).toBe('Нокаут! Вылетает Эрдни. Выбил Саша.');
    expect(knockoutPhrase('Эрдни', ['Саша', 'Дима'])).toBe(
      'Нокаут! Вылетает Эрдни. Выбили Саша и Дима.',
    );
    expect(knockoutPhrase('Эрдни', ['Саша', 'Дима', 'Женя'])).toBe(
      'Нокаут! Вылетает Эрдни. Выбили Саша, Дима и Женя.',
    );
    expect(knockoutPhrase('Эрдни', [])).toBe('Нокаут! Вылетает Эрдни.');
    expect(knockoutPhrase(null, ['Саша'])).toBe('Нокаут! Выбил Саша.');
    expect(knockoutPhrase(null, [])).toBe('Нокаут!');
  });

  it('нокаут кусками: имена отдельно, «и» перед последним выбившим', () => {
    expect(knockoutSegments('Эрдни', ['Саша', 'Дима', 'Женя'])).toEqual([
      'Нокаут! Вылетает',
      'Эрдни',
      'Выбили',
      'Саша',
      'Дима',
      'и',
      'Женя',
    ]);
    expect(knockoutSegments(null, ['Саша'])).toEqual(['Нокаут!', 'Выбил', 'Саша']);
  });

  it('победитель и финал без имени', () => {
    expect(winnerPhrase('Женя')).toBe('Победитель вечера — Женя!');
    expect(winnerPhrase(null)).toBe('Игра окончена!');
  });
});

describe('текст и хеш клипа', () => {
  it('нормализация: NFC, один пробел, без краёв', () => {
    expect(normalizeSpeech('  Нокаут!  Вылетает\nЭрдни. ')).toBe('Нокаут! Вылетает Эрдни.');
    // «й» из «и» + кратка → один символ.
    expect(normalizeSpeech('Сергей')).toBe('Сергей');
  });

  it('хеш — sha256 от «voice\\nтекст» (как constraint voice_clips_hash_matches)', async () => {
    // Эталоны посчитаны независимо — node:crypto createHash('sha256') и Postgres
    // encode(sha256(convert_to('silero-v5_5-xenia' || E'\n' || текст, 'UTF8')), 'hex') — и совпали.
    expect(await clipHash('Нокаут! Вылетает Эрдн+и. Выбил Ёжик.')).toBe(
      'f6748ab92e4fd99aba608a7485db83e4c637eaca263ce54fbaa1225414c760f6',
    );
    expect(await clipHash('Пауза.')).toBe(
      '808475d9a7e8e52d9690e2812928d961f810e589cdb2aa22d78adbd2821de3b0',
    );
    expect(await clipHash('  Пауза. ')).toBe(await clipHash('Пауза.'));
    expect(await clipHash('Пауза.', 'other-voice')).not.toBe(await clipHash('Пауза.'));
  });
});

describe('имя для озвучки', () => {
  it('нормализация: апострофы, пробелы', () => {
    expect(normalizeSpokenName('  Д’Арта́ньян  ')).not.toContain('’');
    expect(normalizeSpokenName('  Анна   Мария ')).toBe('Анна Мария');
    expect(normalizeSpokenName('О‘Нил')).toBe("О'Нил");
  });

  it('годные имена', () => {
    for (const ok of [
      'Эрдни',
      'Эрдн+и',
      'Анна-Мария',
      "Д'Артаньян",
      'Вова Петров',
      'ёжик',
      '',
      '   ',
    ])
      expect(spokenNameError(ok)).toBeNull();
  });

  it('ошибки — что не так и как исправить', () => {
    expect(spokenNameError('Erdni')).toMatch(/Латиницу/);
    expect(spokenNameError('Эрдни2')).toMatch(/Цифры/);
    expect(spokenNameError('Эрдни!')).toMatch(/Можно только/);
    expect(spokenNameError('Ўася')).toMatch(/Можно только/);
    expect(spokenNameError('- -')).toMatch(/русскими буквами/);
    expect(spokenNameError('Эрд+ни')).toMatch(/перед ударной гласной/);
    expect(spokenNameError('Эрдни+')).toMatch(/перед ударной гласной/);
    expect(spokenNameError('я'.repeat(51))).toMatch(/Сократи/);
    expect(spokenNameError('я'.repeat(50))).toBeNull();
  });

  it('кого голос называет', () => {
    expect(speakableName({ display_name: 'Женя', spoken_name: null })).toBe('Женя');
    expect(speakableName({ display_name: 'Erdni Omaev', spoken_name: null })).toBeNull();
    expect(speakableName({ display_name: 'Erdni Omaev', spoken_name: 'Эрдн+и' })).toBe('Эрдн+и');
    expect(speakableName({ display_name: 'Вова (гость)' })).toBeNull();
    expect(speakableName({ display_name: 'Женя', spoken_name: '  ' })).toBe('Женя');
    expect(speakableName({ display_name: 'Женя', spoken_name: 'Zhenya' })).toBeNull();
    // «+» в отображаемом имени — не ударение, а символ: такое имя голос не берёт.
    expect(speakableName({ display_name: 'Же+ня' })).toBeNull();
    expect(speakableName({ display_name: '  Лёша  Кузнецов ' })).toBe('Лёша Кузнецов');
  });
});

describe('варианты объявления', () => {
  const names: Record<string, string | null> = { v: 'Эрдни', a: 'Саша', b: 'Дима', x: null };
  const nameOf = (id: string) => names[id] ?? null;

  it('нокаут с одним выбившим: целиком → кусками → без выбившего → без жертвы → «Нокаут!»', () => {
    expect(announcementVariants({ kind: 'knockout', victim: 'v', by: ['a'] }, nameOf)).toEqual([
      ['Нокаут! Вылетает Эрдни. Выбил Саша.'],
      ['Нокаут! Вылетает', 'Эрдни', 'Выбил', 'Саша'],
      ['Нокаут! Вылетает Эрдни.'],
      ['Нокаут! Вылетает', 'Эрдни'],
      ['Нокаут! Выбил Саша.'],
      ['Нокаут!', 'Выбил', 'Саша'],
      ['Нокаут!'],
    ]);
  });

  it('выбивших без имени не называем никого; жертва без имени — «Нокаут!»', () => {
    expect(
      announcementVariants({ kind: 'knockout', victim: 'v', by: ['a', 'x'] }, nameOf)[0],
    ).toEqual(['Нокаут! Вылетает Эрдни.']);
    expect(announcementVariants({ kind: 'knockout', victim: 'x', by: [] }, nameOf)).toEqual([
      ['Нокаут!'],
    ]);
    expect(announcementVariants({ kind: 'knockout', victim: 'x', by: ['a'] }, nameOf)[0]).toEqual([
      'Нокаут! Выбил Саша.',
    ]);
    // Повтор и сама жертва в by не считаются.
    expect(
      announcementVariants({ kind: 'knockout', victim: 'v', by: ['a', 'a', 'v'] }, nameOf)[0],
    ).toEqual(['Нокаут! Вылетает Эрдни. Выбил Саша.']);
  });

  it('победитель: целиком → кусками → «Игра окончена!»', () => {
    expect(announcementVariants({ kind: 'winner', winner: 'a' }, nameOf)).toEqual([
      ['Победитель вечера — Саша!'],
      ['Победитель вечера —', 'Саша'],
      ['Игра окончена!'],
    ]);
    expect(announcementVariants({ kind: 'winner', winner: 'x' }, nameOf)).toEqual([
      ['Игра окончена!'],
    ]);
    expect(announcementVariants({ kind: 'winner', winner: null }, nameOf)).toEqual([
      ['Игра окончена!'],
    ]);
  });

  it('уровень с нечитаемым числом — молчим, а не падаем', () => {
    expect(announcementVariants({ kind: 'level', level: level(-5, 10) }, nameOf)).toEqual([]);
  });
});

describe('что нужно вечеру и манифест', () => {
  const players = ['Женя', 'Саша', 'Эрдн+и'];

  it('табло всегда находит озвученный вариант: целый для пары, куски для сплита', () => {
    const texts = new Set(eveningVoiceTexts(DEFAULT_FORMAT, [...players, null]));
    const ids = ['p0', 'p1', 'p2', 'nobody'];
    const nameOf = (id: string) => players[Number(id.slice(1))] ?? null;
    const has = (clips: string[]) => clips.every((c) => texts.has(normalizeSpeech(c)));
    const all: Announcement[] = [
      { kind: 'start', level: DEFAULT_FORMAT.levels[0]! },
      ...DEFAULT_FORMAT.levels.slice(1).map((l): Announcement => ({ kind: 'level', level: l })),
      { kind: 'minute' },
      { kind: 'rebuys_closed' },
      { kind: 'pause' },
      { kind: 'resume' },
      ...ids.map((id): Announcement => ({ kind: 'winner', winner: id })),
    ];
    for (const victim of ids)
      for (const k1 of ids)
        for (const k2 of [null, ...ids]) {
          if (k1 === victim) continue;
          all.push({ kind: 'knockout', victim, by: k2 ? [k1, k2] : [k1] });
        }
    for (const a of all) {
      const variants = announcementVariants(a, nameOf);
      const first = variants[0]!;
      const isSplit =
        a.kind === 'knockout' && new Set(a.by.filter((id) => id !== a.victim)).size > 1;
      // Целая фраза есть всегда, кроме сплита — у него первый озвученный вариант кусками.
      expect(has(isSplit ? variants[1]! : first), JSON.stringify(a)).toBe(true);
    }
  });

  it('уровни: старт для первого, «Новый уровень» для остальных; кривой формат не роняет', () => {
    expect(levelTexts(DEFAULT_FORMAT)).toHaveLength(DEFAULT_FORMAT.levels.length);
    expect(levelTexts(DEFAULT_FORMAT)[0]).toBe('Поехали! Блайнды пять — десять.');
    expect(levelTexts({})).toEqual([]);
    expect(levelTexts(null)).toEqual([]);
    expect(
      speakableLevels({ levels: [level(5, 10), { sb: 'x', bb: 10 }, level(20, 40)] }),
    ).toHaveLength(1);
  });

  it('пары — упорядоченные, без самого себя', () => {
    expect(pairTexts(['А', 'Б', 'В'])).toHaveLength(6);
    expect(pairTexts(['А', 'А'])).toEqual([]);
  });

  const input = (list: Partial<VoiceManifestPlayer>[]) => ({
    players: list.map((p, i) => ({ id: `p${i}`, display_name: `Игрок${i}`, ...p })),
    formats: [DEFAULT_FORMAT, DEFAULT_FORMAT],
  });

  it('манифест: фиксированные, уровни, игроки и пары, без повторов', () => {
    const { texts, notes } = voiceManifestTexts(
      input([
        { display_name: 'Женя' },
        { display_name: 'Erdni', spoken_name: 'Эрдн+и' },
        { display_name: 'Mike' }, // без имени для озвучки — не попадает
        { display_name: 'Саша', is_active: false }, // выключенный — не попадает
      ]),
    );
    expect(notes).toEqual([]);
    expect(new Set(texts).size).toBe(texts.length);
    for (const t of FIXED_TEXTS) expect(texts).toContain(t);
    expect(texts).toContain('Нокаут! Вылетает Эрдн+и. Выбил Женя.');
    expect(texts).toContain('Нокаут! Вылетает Женя. Выбил Эрдн+и.');
    expect(texts).toContain('Победитель вечера — Эрдн+и!');
    expect(texts.some((t) => t.includes('Саша') || /[A-Za-z]/.test(t))).toBe(false);
    // 11 фиксированных + 8 уровней (два одинаковых формата) + 2·4 на игрока + 2 пары.
    expect(texts).toHaveLength(FIXED_TEXTS.length + 8 + 8 + 2);
  });

  it('манифест: пары — только для недавних игроков, остальным всё, кроме пар; пометка в notes', () => {
    const list = Array.from({ length: 5 }, (_, i) => ({
      display_name: ['Аня', 'Боря', 'Вера', 'Гоша', 'Даша'][i]!,
      last_played_at: i === 4 ? null : `2026-10-0${i + 1}T16:00:00Z`,
    }));
    const { texts, notes } = voiceManifestTexts(input(list), { pairPlayers: 2 });
    // Двое недавних — Гоша (04.10) и Вера (03.10).
    expect(texts).toContain('Нокаут! Вылетает Гоша. Выбил Вера.');
    expect(texts).toContain('Нокаут! Вылетает Вера. Выбил Гоша.');
    expect(texts).not.toContain('Нокаут! Вылетает Аня. Выбил Вера.');
    expect(texts).toContain('Победитель вечера — Даша!');
    expect(texts).toContain('Даша');
    expect(notes.join(' ')).toMatch(/для 2 недавних игроков из 5/);
  });

  it('манифест: предел числа фраз', () => {
    const { texts, notes } = voiceManifestTexts(input([{ display_name: 'Женя' }]), { maxTexts: 5 });
    expect(texts).toHaveLength(5);
    expect(notes.join(' ')).toMatch(/предел 5/);
  });

  it('манифест: нечитаемый уровень формата — пометка, остальные уровни до него озвучены', () => {
    const { texts, notes } = voiceManifestTexts({
      players: [],
      formats: [{ levels: [level(5, 10), level(-1, 20), level(20, 40)] }],
    });
    expect(texts).toContain('Поехали! Блайнды пять — десять.');
    expect(texts.some((t) => t.includes('сорок'))).toBe(false);
    expect(notes.join(' ')).toMatch(/1 из 3 уровней/);
  });

  it('voiceManifest: хеши совпадают с clipHash, голос — VOICE_ID', async () => {
    const { clips } = await voiceManifest(input([{ display_name: 'Женя' }]));
    expect(clips.length).toBeGreaterThan(10);
    for (const c of clips.slice(0, 20)) {
      expect(c.voice).toBe(VOICE_ID);
      expect(c.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(c.hash).toBe(await clipHash(c.text));
      expect(c.text).toBe(normalizeSpeech(c.text));
    }
  });
});
