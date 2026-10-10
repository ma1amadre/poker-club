import { DEFAULT_FORMAT } from '@domain/format.ts';
import { DEFAULT_SCORING } from '@domain/scoring.ts';
import { describe, expect, it, vi } from 'vitest';
import {
  markWelcomeSeen,
  onWelcomeRequest,
  requestWelcome,
  WELCOME_STORAGE_KEY,
  welcomeCards,
  welcomeSeen,
} from './welcome';

/** Неразрывные пробелы — обычными: так проще сравнивать. */
const plain = (text: string): string => text.replace(/ /g, ' ');

/** Родовые формы о человеке, которых в Mini App быть не должно. */
const GENDERED =
  /\b(играл|играла|выиграл|выиграла|сыграл|сыграла|сделал|сделала|стал|стала|пришёл|пришла|должен|должна)\b/i;

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

const throwing: Storage = {
  length: 0,
  clear: () => {
    throw new Error('нет доступа');
  },
  getItem: () => {
    throw new Error('нет доступа');
  },
  key: () => null,
  removeItem: () => {
    throw new Error('нет доступа');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('память «шторку уже показывали»', () => {
  it('один раз: после отметки — видел', () => {
    const storage = memoryStorage();
    expect(welcomeSeen(storage)).toBe(false);
    markWelcomeSeen(storage);
    expect(welcomeSeen(storage)).toBe(true);
    expect(storage.getItem(WELCOME_STORAGE_KEY)).toBe('1');
  });

  it('хранилища нет или оно бросает — без ошибок, считаем «не видел»', () => {
    expect(welcomeSeen(null)).toBe(false);
    expect(welcomeSeen(throwing)).toBe(false);
    expect(() => markWelcomeSeen(throwing)).not.toThrow();
    expect(() => markWelcomeSeen(null)).not.toThrow();
  });

  it('мусор в ключе — не «видел»', () => {
    const storage = memoryStorage();
    storage.setItem(WELCOME_STORAGE_KEY, 'true');
    expect(welcomeSeen(storage)).toBe(false);
  });

  it('просьба открыть доходит до подписчика, отписка работает', () => {
    const listener = vi.fn();
    const off = onWelcomeRequest(listener);
    requestWelcome();
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    requestWelcome();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('карточки «Как всё устроено»', () => {
  const cards = welcomeCards({ format: DEFAULT_FORMAT, scoring: DEFAULT_SCORING, bestN: 10 });

  it('три карточки по порядку', () => {
    expect(cards.map((c) => c.id)).toEqual(['evening', 'season', 'predict']);
    expect(cards.map((c) => c.title)).toEqual([
      'Вечер и деньги',
      'Очки сезона',
      'Прогноз и голосование',
    ]);
  });

  it('деньги — из формата клуба: взнос, ребаи, доли призовых', () => {
    const lines = cards[0]?.lines.map(plain) ?? [];
    // Сумма формата — по умолчанию, не нижняя граница (не «от 500 ₽»): вход любой суммой от 1 ₽.
    expect(lines).toContain(
      'Вход — 500 ₽, можно другой суммой; ребай — так же, до конца 5-го уровня.',
    );
    expect(lines.join('\n')).not.toMatch(/(^|\s)от \d/);
    expect(lines).toContain(
      'Весь взнос идёт в призовой фонд, его делят призовые места: первое — 70 %, второе — 30 %. Призовые — вниз до 100 ₽, остаток — первому месту.',
    );
    const limited = welcomeCards({
      format: { ...DEFAULT_FORMAT, rebuyLimit: 2, payoutPct: [50, 30, 20] },
      scoring: DEFAULT_SCORING,
      bestN: 10,
    })[0]?.lines.map(plain);
    expect(limited).toContain(
      'Вход — 500 ₽, можно другой суммой; ребай — так же, до конца 5-го уровня, не больше 2 на игрока.',
    );
    expect(limited).toContain(
      'Весь взнос идёт в призовой фонд, его делят призовые места: первое — 50 %, второе — 30 %, третье — 20 %. Призовые — вниз до 100 ₽, остаток — первому месту.',
    );
    // Формат без шага (до 027) — без оговорки; без ребаев — только вход.
    const { payoutStepRub: _step, ...noStep } = DEFAULT_FORMAT;
    const plainCard = welcomeCards({
      format: { ...noStep, rebuyLimit: 0 },
      scoring: DEFAULT_SCORING,
      bestN: 10,
    })[0]?.lines.map(plain);
    expect(plainCard).toContain('Вход — 500 ₽, можно другой суммой.');
    expect(plainCard).toContain(
      'Весь взнос идёт в призовой фонд, его делят призовые места: первое — 70 %, второе — 30 %.',
    );
  });

  it('без формата клуба — без сумм', () => {
    const lines = welcomeCards({ format: null, scoring: DEFAULT_SCORING, bestN: 10 })[0]?.lines;
    expect(lines?.join(' ')).not.toMatch(/₽/);
  });

  it('очки сезона — из настроек клуба', () => {
    const lines =
      welcomeCards({ format: null, scoring: { koPoints: 1, winBonus: 2 }, bestN: 8 })[1]?.lines.map(
        plain,
      ) ?? [];
    expect(lines).toContain(
      'Очки за вечер: +1 за каждого, кто вылетел раньше, +1 за нокаут, +2 за победу.',
    );
    expect(lines).toContain('В зачёт сезона идут лучшие 8 вечеров игрока.');
  });

  it('прогноз и голосование — очки прогноза и порог звезды из домена', () => {
    const lines = cards[2]?.lines.map(plain) ?? [];
    expect(lines[0]).toBe(
      'До старта таймера сделай прогноз: угаданный победитель — 3 очка, первый вылет — 2 очка.',
    );
    expect(lines).toContain('После игры сутки идёт голосование: рука, блеф и бэд-бит вечера.');
    expect(lines).toContain(
      'Единственный лидер номинации — от 2 голосов — получает «Звезду вечера».',
    );
  });

  it('без родовых форм и восклицаний', () => {
    for (const card of cards) {
      for (const line of card.lines) {
        expect(line).not.toMatch(GENDERED);
        expect(line).not.toContain('!');
      }
    }
  });
});
