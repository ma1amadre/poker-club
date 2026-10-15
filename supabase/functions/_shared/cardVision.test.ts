import { describe, expect, it, vi } from 'vitest';
import {
  CARD_VISION_PROMPT,
  CARD_VISION_SCHEMA,
  MAX_PHOTO_BYTES,
  RATE_LIMIT,
  base64Bytes,
  cardVision,
  createRateLimiter,
  failureForStatus,
  normalizeCard,
  normalizeVisionAnswer,
  parseVisionText,
  readVisionRequest,
  sniffImageType,
  visionFailure,
  type CardVisionDeps,
  type RecognizeOutcome,
  type VisionEvening,
  type VisionFailureCode,
} from './cardVision.ts';
import {
  CARD_VISION_FIXTURES,
  DEFAULT_FIXTURE,
  isKnownMockMode,
  mockRecognize,
} from './cardVisionFixtures.ts';

const EVENING = 'e0000000-0000-4000-8000-000000000006';
const BANKER = 'a0000000-0000-4000-8000-000000001002';
const OTHER = 'a0000000-0000-4000-8000-000000001003';

const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));
/** Начало JPEG (FF D8 FF E0 … JFIF), 21 байт — base64 без «=» (дописывать можно). */
const JPEG = b64([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0]);
const PNG = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
const WEBP = b64([82, 73, 70, 70, 36, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32]);

const photoBody = (extra: Record<string, unknown> = {}) => ({
  eveningId: EVENING,
  image: JPEG,
  mediaType: 'image/jpeg',
  ...extra,
});

describe('промпт и схема — как в тесте на 17 фото', () => {
  it('руки группами, стол слева направо, формат карт и сукно', () => {
    expect(CARD_VISION_PROMPT).toContain('hands — открытые руки игроков');
    expect(CARD_VISION_PROMPT).toContain('board — карты стола в центре, слева направо');
    expect(CARD_VISION_PROMPT).toContain('нарисованные на сукне, — не карты');
    expect(CARD_VISION_SCHEMA.required).toEqual(['hands', 'board']);
    expect(CARD_VISION_SCHEMA.additionalProperties).toBe(false);
    const pattern = new RegExp(CARD_VISION_SCHEMA.properties.board.items.pattern);
    expect(['10c', 'Qh', 'As', '2d'].every((c) => pattern.test(c))).toBe(true);
    expect(['Tc', '1c', '10', 'Qx', 'qh'].some((c) => pattern.test(c))).toBe(false);
  });
});

describe('normalizeCard', () => {
  it('формат схемы → код домена', () => {
    expect(normalizeCard('10c')).toBe('Tc');
    expect(normalizeCard('Qh')).toBe('Qh');
    expect(normalizeCard('As')).toBe('As');
    expect(normalizeCard('2d')).toBe('2d');
  });

  it('терпит регистр, T, пробелы и значки мастей', () => {
    expect(normalizeCard('qH')).toBe('Qh');
    expect(normalizeCard('Ts')).toBe('Ts');
    expect(normalizeCard(' 10 d ')).toBe('Td');
    expect(normalizeCard('A♠')).toBe('As');
    expect(normalizeCard('K♥')).toBe('Kh');
    expect(normalizeCard('9♦')).toBe('9d');
    expect(normalizeCard('J♣')).toBe('Jc');
  });

  it('не карта — null', () => {
    for (const raw of ['1x', '11c', '1c', 'Ax', '', 'AK', 'Joker', 10, null, undefined, ['As']])
      expect(normalizeCard(raw)).toBeNull();
  });
});

describe('normalizeVisionAnswer', () => {
  it('все 17 ответов теста — 166 карт без замечаний, по две в руке, стол не длиннее пяти', () => {
    let cards = 0;
    for (let n = 1; n <= 17; n += 1) {
      const answer = parseVisionText(CARD_VISION_FIXTURES[`photo_${n}`] ?? '');
      expect(answer, `photo_${n}`).not.toBeNull();
      if (!answer) continue;
      expect(answer.issues).toEqual([]);
      expect(answer.board.length).toBeLessThanOrEqual(5);
      for (const hand of answer.hands) expect(hand).toHaveLength(2);
      cards += answer.board.length + answer.hands.length * 2;
    }
    expect(cards).toBe(166);
  });

  it('фото 6: десятка — T, порядок стола и рук сохранён', () => {
    expect(parseVisionText(CARD_VISION_FIXTURES.photo_6 ?? '')).toEqual({
      hands: [
        ['7h', 'As'],
        ['2h', '7d'],
      ],
      board: ['4d', 'Kd', 'Th', 'Kc', 'Jh'],
      issues: [],
    });
  });

  it('повтор: стол первым, повтор в руке выброшен — рука без пары не идёт', () => {
    const answer = normalizeVisionAnswer({
      hands: [
        ['As', 'Kh'],
        ['Qh', '2c'],
      ],
      board: ['Qh', '6c', 'Jd'],
    });
    expect(answer?.board).toEqual(['Qh', '6c', 'Jd']);
    expect(answer?.hands).toEqual([['As', 'Kh']]);
    expect(answer?.issues).toEqual([
      { kind: 'duplicate', card: 'Qh' },
      { kind: 'odd_hand', cards: ['2c'] },
    ]);
  });

  it('рука, разбитая на одиночные карты (ошибка Haiku в тесте), — замечания, не руки', () => {
    const answer = parseVisionText(CARD_VISION_FIXTURES.messy ?? '');
    expect(answer?.hands).toEqual([['7h', 'As']]);
    expect(answer?.board).toEqual(['4d', 'Kd', 'Th']);
    expect(answer?.issues).toEqual([
      { kind: 'bad_card', value: '1x' },
      { kind: 'odd_hand', cards: ['5s'] },
      { kind: 'odd_hand', cards: ['8h'] },
      { kind: 'duplicate', card: 'As' },
      { kind: 'odd_hand', cards: ['2d'] },
    ]);
  });

  it('стол длиннее пяти и рук больше девяти — лишнее выброшено с замечанием', () => {
    const ranks = '23456789TJQKA';
    const hands = Array.from({ length: 11 }, (_, i) => [`${ranks[i]}h`, `${ranks[i]}d`]);
    const answer = normalizeVisionAnswer({
      hands,
      board: ['As', 'Ks', 'Qs', 'Js', '10s', '9s'],
    });
    expect(answer?.board).toEqual(['As', 'Ks', 'Qs', 'Js', 'Ts']);
    expect(answer?.hands).toHaveLength(9);
    expect(answer?.issues).toEqual([
      { kind: 'board_extra', cards: ['9s'] },
      { kind: 'hands_extra', count: 2 },
    ]);
  });

  it('лишняя карта стола место не занимает: та же карта в руке остаётся в руке', () => {
    // Модель отнесла карту игрока к столу шестой.
    const answer = normalizeVisionAnswer({
      hands: [
        ['7s', '2d'],
        ['9c', '9h'],
      ],
      board: ['Qh', '6c', 'Jd', 'Ac', 'Kd', '7s'],
    });
    expect(answer).toEqual({
      board: ['Qh', '6c', 'Jd', 'Ac', 'Kd'],
      hands: [
        ['7s', '2d'],
        ['9c', '9h'],
      ],
      issues: [{ kind: 'board_extra', cards: ['7s'] }],
    });
  });

  it('карты не сложившейся группы место не занимают: рука дальше цела, в замечании группы их нет', () => {
    const answer = normalizeVisionAnswer({
      hands: [
        ['7s', '2d', '9c'],
        ['9c', '9h'],
      ],
      board: ['Qh', '6c', 'Jd'],
    });
    expect(answer?.hands).toEqual([['9c', '9h']]);
    expect(answer?.issues).toEqual([
      { kind: 'odd_hand', cards: ['7s', '2d'] },
      { kind: 'duplicate', card: '9c' },
    ]);
    // Вся группа взята руками дальше — замечание о группе уходит целиком.
    const all = normalizeVisionAnswer({
      hands: [['9c'], ['9c', '9h']],
      board: [],
    });
    expect(all?.hands).toEqual([['9c', '9h']]);
    expect(all?.issues).toEqual([{ kind: 'duplicate', card: '9c' }]);
  });

  it('повтор внутри группы или стола: «взята одна» — только если карта легла', () => {
    // Рука из трёх с повтором — рука из двух, повтор отмечен.
    expect(
      normalizeVisionAnswer({ hands: [['7s', '7s', '2d']], board: ['Qh', 'Qh', '6c'] }),
    ).toEqual({
      hands: [['7s', '2d']],
      board: ['Qh', '6c'],
      issues: [
        { kind: 'duplicate', card: 'Qh' },
        { kind: 'duplicate', card: '7s' },
      ],
    });
    // Пара из одной карты дважды — не рука; «взята» не пишем: карта не легла.
    expect(normalizeVisionAnswer({ hands: [['7s', '7s']], board: [] })?.issues).toEqual([
      { kind: 'odd_hand', cards: ['7s'] },
    ]);
    // Повтор шестой карты стола — она лишняя, «взята одна» не пишем.
    expect(
      normalizeVisionAnswer({ hands: [], board: ['As', 'Ks', 'Qs', 'Js', 'Ts', '9s', '9s'] })
        ?.issues,
    ).toEqual([{ kind: 'board_extra', cards: ['9s'] }]);
  });

  it('карты лишних рук (сверх девяти) место не занимают', () => {
    const ranks = '23456789T';
    const hands = Array.from({ length: 9 }, (_, i) => [`${ranks[i]}h`, `${ranks[i]}d`]);
    const answer = normalizeVisionAnswer({
      hands: [...hands, ['Ac', 'Kc'], ['Ac', 'Qc']],
      board: [],
    });
    expect(answer?.hands).toHaveLength(9);
    expect(answer?.issues).toEqual([{ kind: 'hands_extra', count: 2 }]);
  });

  it('группа из трёх карт — не рука; пустые группы молча пропущены', () => {
    const answer = normalizeVisionAnswer({ hands: [[], ['As', 'Ks', 'Qs']], board: [] });
    expect(answer).toEqual({
      hands: [],
      board: [],
      issues: [{ kind: 'odd_hand', cards: ['As', 'Ks', 'Qs'] }],
    });
  });

  it('не та форма или не JSON — null', () => {
    expect(normalizeVisionAnswer(null)).toBeNull();
    expect(normalizeVisionAnswer([])).toBeNull();
    expect(normalizeVisionAnswer({ hands: [] })).toBeNull();
    expect(normalizeVisionAnswer({ board: [] })).toBeNull();
    expect(parseVisionText('Карты: туз пик')).toBeNull();
    expect(parseVisionText('{"hands":[["As","Kh"]],"board":[')).toBeNull();
  });
});

describe('readVisionRequest', () => {
  it('JPEG, PNG, WebP с верным типом', () => {
    expect(readVisionRequest(photoBody())).toEqual({
      ok: true,
      eveningId: EVENING,
      photo: { mediaType: 'image/jpeg', data: JPEG },
    });
    expect(readVisionRequest(photoBody({ image: PNG, mediaType: 'image/png' })).ok).toBe(true);
    expect(readVisionRequest(photoBody({ image: WEBP, mediaType: 'image/webp' })).ok).toBe(true);
  });

  it('тип не тот, что в байтах, или не картинка — bad_type', () => {
    expect(readVisionRequest(photoBody({ mediaType: 'image/png' }))).toEqual({
      ok: false,
      failure: 'bad_type',
    });
    expect(readVisionRequest(photoBody({ mediaType: 'image/gif' }))).toEqual({
      ok: false,
      failure: 'bad_type',
    });
    expect(
      readVisionRequest(
        photoBody({ image: b64([...'%PDF-1.7 hello!!'].map((c) => c.charCodeAt(0))) }),
      ),
    ).toEqual({ ok: false, failure: 'bad_type' });
  });

  it('не base64, пусто или нет id вечера', () => {
    expect(readVisionRequest(photoBody({ image: 'data:image/jpeg;base64,/9j/4AAQ' }))).toEqual({
      ok: false,
      failure: 'bad_photo',
    });
    expect(readVisionRequest(photoBody({ image: '' })).ok).toBe(false);
    expect(readVisionRequest(photoBody({ image: 42 })).ok).toBe(false);
    expect(readVisionRequest(photoBody({ eveningId: 'вечер' }))).toEqual({
      ok: false,
      failure: 'bad_evening',
    });
    expect(readVisionRequest(null)).toEqual({ ok: false, failure: 'bad_evening' });
  });

  it('больше 4 МБ — too_large', () => {
    const big = JPEG + 'A'.repeat(Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 8 - JPEG.length);
    expect(base64Bytes(big)).toBeGreaterThan(MAX_PHOTO_BYTES);
    expect(readVisionRequest(photoBody({ image: big }))).toEqual({
      ok: false,
      failure: 'too_large',
    });
  });

  it('base64Bytes и sniffImageType', () => {
    expect(base64Bytes(btoa('abc'))).toBe(3);
    expect(base64Bytes(btoa('abcd'))).toBe(4);
    expect(base64Bytes(btoa('abcde'))).toBe(5);
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(WEBP)).toBe('image/webp');
    expect(sniffImageType(btoa('GIF89a..........'))).toBeNull();
  });
});

describe('ошибки', () => {
  it('статус Anthropic → код: 429 — перегрузка, 5xx/529 — сбой, ключ, оплата, прочие 4xx — баг', () => {
    expect(failureForStatus(429)).toBe('busy');
    expect(failureForStatus(500)).toBe('upstream');
    expect(failureForStatus(529)).toBe('upstream');
    expect(failureForStatus(401)).toBe('bad_key');
    expect(failureForStatus(403)).toBe('bad_key');
    expect(failureForStatus(402)).toBe('billing');
    expect(failureForStatus(400)).toBe('bug');
    expect(failureForStatus(404)).toBe('bug');
    expect(failureForStatus(413)).toBe('bug');
    expect(failureForStatus(undefined)).toBe('bug');
  });

  it('тексты — на «ты», с кодом; нет ключа — как в задаче', () => {
    expect(visionFailure('not_configured')).toEqual({
      status: 503,
      body: {
        error: 'Распознавание не настроено — нужен ключ ANTHROPIC_API_KEY в секретах.',
        code: 'not_configured',
      },
    });
    const codes: VisionFailureCode[] = [
      'bad_evening',
      'bad_type',
      'bad_photo',
      'too_large',
      'not_found',
      'forbidden',
      'not_live',
      'not_configured',
      'too_many',
      'timeout',
      'busy',
      'upstream',
      'network',
      'bad_key',
      'billing',
      'bug',
      'refused',
      'bad_answer',
    ];
    for (const code of codes) {
      const reply = visionFailure(code);
      expect(reply.status).toBeGreaterThanOrEqual(400);
      expect(reply.body.code).toBe(code);
      expect(String(reply.body.error)).not.toMatch(/\b(Вы|вы|Вас|вас|Ваш|ваш)\b/);
    }
    expect(visionFailure('timeout').status).toBe(504);
    expect(visionFailure('refused').status).toBe(422);
  });
});

describe('createRateLimiter', () => {
  it('не больше limit за окно на игрока, окно скользит', () => {
    const limiter = createRateLimiter(3, 60_000);
    expect([0, 1, 2].map((t) => limiter.take('a', t))).toEqual([true, true, true]);
    expect(limiter.take('a', 59_999)).toBe(false);
    expect(limiter.take('b', 59_999)).toBe(true);
    expect(limiter.take('a', 60_000)).toBe(true);
    expect(limiter.take('a', 60_001)).toBe(true);
    expect(limiter.take('a', 60_002)).toBe(true);
    expect(limiter.take('a', 60_003)).toBe(false);
  });

  it('по умолчанию — RATE_LIMIT в минуту', () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < RATE_LIMIT; i += 1) expect(limiter.take('a', i)).toBe(true);
    expect(limiter.take('a', RATE_LIMIT)).toBe(false);
  });
});

describe('подмена ответа (CARD_VISION_MOCK)', () => {
  const signal = () => new AbortController().signal;

  it('режимы', () => {
    for (const mode of [
      '1',
      'photo_1',
      'photo_17',
      'empty',
      'messy',
      'refusal',
      'timeout',
      'bad_answer',
      'busy',
      'network',
    ])
      expect(isKnownMockMode(mode), mode).toBe(true);
    expect(isKnownMockMode('photo_18')).toBe(false);
  });

  it('1 — фото по умолчанию; фото по номеру; ошибки и отказ', async () => {
    expect(await mockRecognize('1', 0, signal())).toEqual({
      kind: 'answer',
      text: CARD_VISION_FIXTURES[DEFAULT_FIXTURE],
    });
    expect(await mockRecognize('photo_2', 0, signal())).toEqual({
      kind: 'answer',
      text: CARD_VISION_FIXTURES.photo_2,
    });
    expect(await mockRecognize('refusal', 0, signal())).toEqual({
      kind: 'refusal',
      category: null,
    });
    expect((await mockRecognize('network', 0, signal())).kind).toBe('failure');
  });

  it('отмена обрывает паузу', async () => {
    const controller = new AbortController();
    const pending = mockRecognize('1', 60_000, controller.signal);
    controller.abort();
    expect(await pending).toMatchObject({ kind: 'failure', failure: 'timeout' });
  });
});

// ---------------------------------------------------------------------------
// cardVision — порядок проверок и вызов с подменой
// ---------------------------------------------------------------------------

function deps(overrides: Partial<CardVisionDeps> & { evening?: VisionEvening | null } = {}) {
  const log: string[] = [];
  let clock = 1_000;
  const evening: VisionEvening | null =
    overrides.evening === undefined
      ? { id: EVENING, status: 'live', banker_id: BANKER }
      : overrides.evening;
  // По умолчанию — ответ теста на фото 6 за 2,48 с по часам подмены.
  const recognize = vi.fn(
    overrides.recognize ??
      (async (_photo: unknown, signal: AbortSignal): Promise<RecognizeOutcome> => {
        clock += 2_480;
        return mockRecognize('photo_6', 0, signal);
      }),
  );
  const d: CardVisionDeps = {
    loadEvening: async (id) => (evening && id === evening.id ? evening : null),
    recognize: overrides.recognize === null ? null : recognize,
    limiter: overrides.limiter ?? createRateLimiter(),
    now: () => clock,
    log: (line) => log.push(line),
    ...(overrides.timeoutMs !== undefined ? { timeoutMs: overrides.timeoutMs } : {}),
    ...(overrides.signal ? { signal: overrides.signal } : {}),
  };
  return { d, log, recognize };
}

const banker = { id: BANKER, is_admin: false };

describe('cardVision', () => {
  it('банкир идущего вечера: руки, стол, замечания и время; фото не в логе', async () => {
    const { d, log, recognize } = deps();
    const reply = await cardVision(banker, photoBody(), d);
    expect(reply).toEqual({
      status: 200,
      body: {
        hands: [
          ['7h', 'As'],
          ['2h', '7d'],
        ],
        board: ['4d', 'Kd', 'Th', 'Kc', 'Jh'],
        issues: [],
        ms: 2480,
      },
    });
    expect(recognize).toHaveBeenCalledTimes(1);
    expect(recognize.mock.calls[0]?.[0]).toEqual({ mediaType: 'image/jpeg', data: JPEG });
    expect(log).toEqual(['card-vision: рук 2, на столе 5, замечаний 0, 2480 мс']);
    expect(log.join()).not.toContain(JPEG);
  });

  it('админ — можно и не банкиром; чужой игрок — нельзя', async () => {
    const admin = await cardVision({ id: OTHER, is_admin: true }, photoBody(), deps().d);
    expect(admin.status).toBe(200);
    const stranger = deps();
    expect(await cardVision({ id: OTHER, is_admin: false }, photoBody(), stranger.d)).toEqual(
      visionFailure('forbidden'),
    );
    expect(stranger.recognize).not.toHaveBeenCalled();
  });

  it('вечер не идёт или не найден, id кривой', async () => {
    for (const status of ['announced', 'finished', 'settled', 'cancelled']) {
      const { d, recognize } = deps({ evening: { id: EVENING, status, banker_id: BANKER } });
      expect(await cardVision(banker, photoBody(), d)).toEqual(visionFailure('not_live'));
      expect(recognize).not.toHaveBeenCalled();
    }
    expect(await cardVision(banker, photoBody(), deps({ evening: null }).d)).toEqual(
      visionFailure('not_found'),
    );
    expect(await cardVision(banker, photoBody({ eveningId: 'x' }), deps().d)).toEqual(
      visionFailure('bad_evening'),
    );
  });

  it('нет ключа и подмены — «не настроено», а не падение', async () => {
    expect(await cardVision(banker, photoBody(), deps({ recognize: null }).d)).toEqual(
      visionFailure('not_configured'),
    );
  });

  it('фото не то — ошибка до вызова модели', async () => {
    const { d, recognize } = deps();
    expect(await cardVision(banker, photoBody({ mediaType: 'image/png' }), d)).toEqual(
      visionFailure('bad_type'),
    );
    expect(recognize).not.toHaveBeenCalled();
  });

  it('частота: сверх предела — too_many без вызова модели', async () => {
    const { d, recognize } = deps({ limiter: createRateLimiter(1, 60_000) });
    expect((await cardVision(banker, photoBody(), d)).status).toBe(200);
    expect(await cardVision(banker, photoBody(), d)).toEqual(visionFailure('too_many'));
    expect(recognize).toHaveBeenCalledTimes(1);
  });

  it('отказ модели, ответ не по схеме, ошибка вызова, исключение', async () => {
    const outcome = (o: RecognizeOutcome) => deps({ recognize: async () => o }).d;
    expect(
      await cardVision(
        banker,
        photoBody(),
        outcome({ kind: 'refusal', category: 'general_harms' }),
      ),
    ).toEqual(visionFailure('refused'));
    expect(await cardVision(banker, photoBody(), outcome({ kind: 'answer', text: 'нет' }))).toEqual(
      visionFailure('bad_answer'),
    );
    for (const failure of ['busy', 'upstream', 'network', 'bad_key', 'billing', 'bug'] as const)
      expect(await cardVision(banker, photoBody(), outcome({ kind: 'failure', failure }))).toEqual(
        visionFailure(failure),
      );
    const throwing = deps({
      recognize: async () => {
        throw new Error('сбой');
      },
    });
    expect(await cardVision(banker, photoBody(), throwing.d)).toEqual(visionFailure('bug'));
    expect(throwing.log[0]).toContain('bug');
  });

  it('модель молчит дольше предела — «не ответило», вызов прерван', async () => {
    let aborted = false;
    const { d } = deps({
      timeoutMs: 20,
      recognize: (_photo, signal) => {
        signal.addEventListener('abort', () => {
          aborted = true;
        });
        return mockRecognize('timeout', 0, signal);
      },
    });
    expect(await cardVision(banker, photoBody(), d)).toEqual(visionFailure('timeout'));
    expect(aborted).toBe(true);
  });

  it('клиент ушёл — вызов модели прерывается', async () => {
    const client = new AbortController();
    let aborted = false;
    const { d } = deps({
      signal: client.signal,
      recognize: (_photo, signal) => {
        signal.addEventListener('abort', () => {
          aborted = true;
        });
        return mockRecognize('1', 60_000, signal);
      },
    });
    const pending = cardVision(banker, photoBody(), d);
    await Promise.resolve();
    client.abort();
    await pending;
    expect(aborted).toBe(true);
  });

  it('ответ с огрехами — карты и замечания', async () => {
    const { d } = deps({ recognize: (_p, signal) => mockRecognize('messy', 0, signal) });
    const reply = await cardVision(banker, photoBody(), d);
    expect(reply.status).toBe(200);
    expect(reply.body.hands).toEqual([['7h', 'As']]);
    expect(reply.body.issues).toHaveLength(5);
  });
});
