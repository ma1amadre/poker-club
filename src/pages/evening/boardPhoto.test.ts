import { describe, expect, it } from 'vitest';
import {
  applyBoardPhoto,
  assignHand,
  canAssignHand,
  photoHandsHint,
  photoHaptic,
  photoIssueLines,
  photoKeptLines,
  photoPlacedAny,
  photoSeconds,
  readBoardPhotoAnswer,
  readPhotoUsed,
  syncBoardPhoto,
  undoBoardPhoto,
  writePhotoUsed,
  type BoardPhotoAnswer,
} from './boardPhoto';
import {
  cardIn,
  checkDraft,
  emptyDraft,
  placeCard,
  setPlayers,
  type ShowdownDraft,
  type Slot,
} from './showdownDraft';

const SD = '5d000000-0000-4000-8000-000000000001';
const names: Record<string, string> = { A: 'Женя', B: 'Саша', C: 'Лёша' };
const nameOf = (id: string) => names[id] ?? 'Игрок';
const NBSP = ' ';

const draftOf = (players: string[]): ShowdownDraft => setPlayers(emptyDraft(SD), players);
const hand = (playerId: string, index: 0 | 1): Slot => ({ kind: 'hand', playerId, index });
const board = (index: number): Slot => ({ kind: 'board', index });
const handOf = (d: ShowdownDraft, id: string) => [cardIn(d, hand(id, 0)), cardIn(d, hand(id, 1))];

/** Ответ функции на фото 6 теста (хедз-ап, весь стол). */
const PHOTO_6: BoardPhotoAnswer = {
  hands: [
    ['7h', 'As'],
    ['2h', '7d'],
  ],
  board: ['4d', 'Kd', 'Th', 'Kc', 'Jh'],
  issues: [],
  ms: 2480,
};

const answer = (a: Partial<BoardPhotoAnswer>): BoardPhotoAnswer => ({
  hands: [],
  board: [],
  issues: [],
  ms: 1000,
  ...a,
});

describe('readBoardPhotoAnswer', () => {
  it('ответ функции — как есть', () => {
    expect(
      readBoardPhotoAnswer({ ...PHOTO_6, issues: [{ kind: 'duplicate', card: 'Qh' }] }),
    ).toEqual({ ...PHOTO_6, issues: [{ kind: 'duplicate', card: 'Qh' }] });
  });

  it('не та форма, не та нотация, повтор, стол длиннее пяти — null', () => {
    expect(readBoardPhotoAnswer(null)).toBeNull();
    expect(readBoardPhotoAnswer({ hands: [] })).toBeNull();
    expect(readBoardPhotoAnswer({ hands: [['As']], board: [] })).toBeNull();
    expect(readBoardPhotoAnswer({ hands: [['10s', 'Kh']], board: [] })).toBeNull();
    expect(readBoardPhotoAnswer({ hands: [['As', 'Kh']], board: ['As'] })).toBeNull();
    expect(
      readBoardPhotoAnswer({ hands: [], board: ['2s', '3s', '4s', '5s', '6s', '7s'] }),
    ).toBeNull();
  });

  it('незнакомые замечания пропускаются, без ms — 0', () => {
    expect(
      readBoardPhotoAnswer({ hands: [], board: [], issues: [{ kind: 'new_kind' }, 'x'] }),
    ).toEqual({ hands: [], board: [], issues: [], ms: 0 });
  });
});

describe('applyBoardPhoto: хедз-ап с пустыми местами', () => {
  const { draft, result } = applyBoardPhoto(draftOf(['A', 'B']), PHOTO_6, nameOf);

  it('стол — по местам слева направо, руки — по порядку игроков', () => {
    expect(draft.board).toEqual(['4d', 'Kd', 'Th', 'Kc', 'Jh']);
    expect(handOf(draft, 'A')).toEqual(['7h', 'As']);
    expect(handOf(draft, 'B')).toEqual(['2h', '7d']);
    expect(result.auto).toBe(true);
    expect(result.hands.map((h) => h.owner)).toEqual(['A', 'B']);
    expect(result.notes).toEqual([]);
    expect(photoHandsHint(result)).toBe(
      'Руки разложены по порядку — проверь, чья какая: нажми имя, чтобы поменять.',
    );
    expect(photoHaptic(result)).toBe('success');
  });

  it('черновик готов к отправке — на табло уходит главной кнопкой', () => {
    const check = checkDraft(draft, nameOf);
    expect(check.ok && check.payload).toEqual({
      showdownId: SD,
      hands: [
        { playerId: 'A', cards: ['7h', 'As'] },
        { playerId: 'B', cards: ['2h', '7d'] },
      ],
      board: ['4d', 'Kd', 'Th', 'Kc', 'Jh'],
    });
  });

  it('касание другого игрока — руки меняются местами', () => {
    const swapped = assignHand(draft, result, 0, 'B');
    expect(swapped).not.toBeNull();
    if (!swapped) return;
    expect(handOf(swapped.draft, 'A')).toEqual(['2h', '7d']);
    expect(handOf(swapped.draft, 'B')).toEqual(['7h', 'As']);
    expect(swapped.result.hands.map((h) => h.owner)).toEqual(['B', 'A']);
    expect(swapped.result.auto).toBe(false);
    expect(photoHandsHint(swapped.result)).toBeNull();
    // И обратно.
    const back = assignHand(swapped.draft, swapped.result, 0, 'A');
    expect(back && handOf(back.draft, 'A')).toEqual(['7h', 'As']);
  });

  it('касание своего хозяина — рука снята', () => {
    const off = assignHand(draft, result, 1, 'B');
    expect(off && handOf(off.draft, 'B')).toEqual([null, null]);
    expect(off?.result.hands[1]?.owner).toBeNull();
    expect(off && photoHandsHint(off.result)).toBe('Нажми, чья рука, — карты лягут на места.');
  });

  it('«Отменить» — снимает всё с фото, кроме поправленного касанием', () => {
    expect(undoBoardPhoto(draft, result)).toEqual(draftOf(['A', 'B']));
    // Банкир поправил ривер касанием — его карта остаётся.
    const fixed = placeCard(draft, board(4), 'Qs');
    const undone = undoBoardPhoto(fixed, result);
    expect(undone.board).toEqual([null, null, null, null, 'Qs']);
    expect(handOf(undone, 'A')).toEqual([null, null]);
  });
});

describe('applyBoardPhoto: рук не столько, сколько пустых игроков', () => {
  it('трое в раздаче, на фото две руки — ничьи, назначает банкир', () => {
    const { draft, result } = applyBoardPhoto(
      draftOf(['A', 'B', 'C']),
      answer({ hands: PHOTO_6.hands, board: ['4d', 'Kd', 'Th'] }),
      nameOf,
    );
    expect(result.auto).toBe(false);
    expect(result.hands.map((h) => h.owner)).toEqual([null, null]);
    expect(handOf(draft, 'A')).toEqual([null, null]);
    expect(photoHandsHint(result)).toBe('Нажми, чья рука, — карты лягут на места.');
    const first = assignHand(draft, result, 0, 'C');
    expect(first && handOf(first.draft, 'C')).toEqual(['7h', 'As']);
    if (!first) return;
    // Игрок с рукой с фото — свободен для обмена; рука — не у двоих сразу.
    expect(canAssignHand(first.draft, first.result, 1, 'C')).toBe(true);
    const second = assignHand(first.draft, first.result, 1, 'C');
    // У C теперь вторая рука, первая стала ничьей (прежнего хозяина не было).
    expect(second && handOf(second.draft, 'C')).toEqual(['2h', '7d']);
    expect(second?.result.hands.map((h) => h.owner)).toEqual([null, 'C']);
  });

  it('игроку с картами, отмеченными касанием, руку не отдать', () => {
    const tapped = placeCard(draftOf(['A', 'B', 'C']), hand('A', 0), 'Qs');
    const { draft, result } = applyBoardPhoto(tapped, answer({ hands: PHOTO_6.hands }), nameOf);
    expect(canAssignHand(draft, result, 0, 'A')).toBe(false);
    expect(assignHand(draft, result, 0, 'A')).toBeNull();
    expect(canAssignHand(draft, result, 0, 'B')).toBe(true);
    // Две ничьи руки и двое пустых — разложены по порядку (A с картой не в счёт).
    expect(result.hands.map((h) => h.owner)).toEqual(['B', 'C']);
  });

  it('одна рука на одного пустого — ложится сразу, без «проверь по порядку»', () => {
    const tapped = placeCard(
      placeCard(draftOf(['A', 'B']), hand('A', 0), 'Qs'),
      hand('A', 1),
      'Qd',
    );
    const { draft, result } = applyBoardPhoto(
      tapped,
      answer({
        hands: [
          ['Qs', 'Qd'],
          ['2h', '7d'],
        ],
      }),
      nameOf,
    );
    expect(handOf(draft, 'B')).toEqual(['2h', '7d']);
    expect(result.auto).toBe(false);
    expect(result.info).toEqual(['Уже на месте: дама пик (Женя), дама бубён (Женя).']);
    expect(photoHandsHint(result)).toBeNull();
  });
});

describe('applyBoardPhoto: уже отмеченное не перекладываем', () => {
  it('фото тёрна: флоп уже на столе — остаётся, тёрн — на четвёртое место', () => {
    let d = draftOf(['A', 'B']);
    ['7h', 'As', '2h', '7d'].forEach((c, i) => {
      d = placeCard(d, hand(i < 2 ? 'A' : 'B', (i % 2) as 0 | 1), c);
    });
    ['4d', 'Kd', 'Th'].forEach((c, i) => {
      d = placeCard(d, board(i), c);
    });
    // На фото стол в другом порядке: набор тот же — место карт не меняется.
    const { draft, result } = applyBoardPhoto(
      d,
      answer({ hands: PHOTO_6.hands, board: ['Th', 'Kd', '4d', 'Kc'] }),
      nameOf,
    );
    expect(draft.board).toEqual(['4d', 'Kd', 'Th', 'Kc', null]);
    expect(result.hands).toEqual([]);
    expect(result.info).toEqual([`Уже на месте: 7${NBSP}карт — с фото сходится.`]);
    expect(result.placed).toEqual([{ slot: board(3), code: 'Kc', prev: null }]);
  });

  it('на столе отмечена карта, которой на фото нет, — стол не трогаем', () => {
    const d = placeCard(draftOf(['A', 'B']), board(0), 'Qs');
    const { draft, result } = applyBoardPhoto(d, answer({ board: ['4d', 'Kd', 'Th'] }), nameOf);
    expect(draft.board).toEqual(['Qs', null, null, null, null]);
    expect(result.notes).toEqual([
      'Стол не сходится с фото — на фото нет карты: дама пик. Стол не тронут — поправь касанием.',
    ]);
    expect(photoHaptic(result)).toBe('error');
  });

  it('стол не сходится: текст без рода карты — король и туз так же, как дама', () => {
    const one = placeCard(draftOf(['A', 'B']), board(0), 'Ks');
    expect(
      applyBoardPhoto(one, answer({ board: ['4d', 'Kd', 'Th'] }), nameOf).result.notes,
    ).toEqual([
      'Стол не сходится с фото — на фото нет карты: король пик. Стол не тронут — поправь касанием.',
    ]);
    const two = placeCard(one, board(1), 'As');
    expect(
      applyBoardPhoto(two, answer({ board: ['4d', 'Kd', 'Th'] }), nameOf).result.notes,
    ).toEqual([
      'Стол не сходится с фото — на фото нет карт: король пик, туз пик. Стол не тронут — поправь касанием.',
    ]);
  });

  it('карта стола лежит в руке — «Уже лежит», дальше стол не кладём', () => {
    const d = placeCard(draftOf(['A', 'B']), hand('B', 0), 'Th');
    const { draft, result } = applyBoardPhoto(
      d,
      answer({ board: ['4d', 'Kd', 'Th', 'Kc', 'Jh'] }),
      nameOf,
    );
    expect(draft.board).toEqual(['4d', 'Kd', null, null, null]);
    expect(result.notes).toEqual([
      'Уже лежит: десятка червей (Саша).',
      'Дальше на стол не легли: король треф, валет червей — поправь стол касанием.',
    ]);
    expect(photoHaptic(result)).toBe('warning');
  });

  it('одна карта руки уже у игрока — вторая дополняет её; карты у разных — рука не ложится', () => {
    let d = placeCard(draftOf(['A', 'B', 'C']), hand('A', 1), 'As');
    d = placeCard(d, hand('B', 0), '2h');
    d = placeCard(d, hand('C', 0), '7d');
    const { draft, result } = applyBoardPhoto(d, answer({ hands: PHOTO_6.hands }), nameOf);
    expect(handOf(draft, 'A')).toEqual(['7h', 'As']);
    expect(result.placed).toEqual([{ slot: hand('A', 0), code: '7h', prev: null }]);
    expect(result.info).toEqual(['Уже на месте: туз пик (Женя).']);
    expect(result.notes).toEqual([
      'Не легла рука «двойка червей, семёрка бубён»: уже лежит двойка червей (Саша), семёрка бубён (Лёша).',
    ]);
    expect(undoBoardPhoto(draft, result)).toEqual(d);
  });
});

describe('итог фото после правок черновика', () => {
  it('убрали игрока — его рука снова ничья', () => {
    const { draft, result } = applyBoardPhoto(draftOf(['A', 'B']), PHOTO_6, nameOf);
    const fewer = setPlayers(draft, ['A', 'C']);
    const synced = syncBoardPhoto(fewer, result);
    expect(synced.hands.map((h) => h.owner)).toEqual(['A', null]);
    expect(canAssignHand(fewer, result, 1, 'C')).toBe(true);
    const given = assignHand(fewer, result, 1, 'C');
    expect(given && handOf(given.draft, 'C')).toEqual(['2h', '7d']);
  });

  it('карту руки сняли касанием — хозяин остаётся, пока его карта на месте', () => {
    const { draft, result } = applyBoardPhoto(draftOf(['A', 'B']), PHOTO_6, nameOf);
    const one = placeCard(draft, hand('A', 0), 'Qs');
    const synced = syncBoardPhoto(one, result);
    expect(synced.hands[0]?.owner).toBe('A');
    expect(synced.hands[0]?.placed).toEqual([{ slot: hand('A', 1), code: 'As', prev: null }]);
  });
});

describe('подписи', () => {
  it('замечания функции строками', () => {
    expect(
      photoIssueLines([
        { kind: 'bad_card', value: '1x' },
        { kind: 'duplicate', card: 'As' },
        { kind: 'odd_hand', cards: ['5s'] },
        { kind: 'odd_hand', cards: ['8h'] },
        { kind: 'board_extra', cards: ['9s'] },
        { kind: 'hands_extra', count: 2 },
      ]),
    ).toEqual([
      'На фото не разобрано: «1x».',
      'Повтор на фото — взята одна: туз пик.',
      'Не сложилось в руку из двух карт: пятёрка пик; восьмёрка червей. Отметь касанием.',
      'На столе больше пяти карт — не легли: девятка пик.',
      'Рук на фото больше девяти — лишних: 2.',
    ]);
  });

  it('замечания функции попадают в итог, вибро — warning', () => {
    const { result } = applyBoardPhoto(
      draftOf(['A', 'B']),
      { ...PHOTO_6, issues: [{ kind: 'odd_hand', cards: ['5s'] }] },
      nameOf,
    );
    expect(result.notes).toHaveLength(1);
    expect(photoHaptic(result)).toBe('warning');
  });

  it('пустое фото', () => {
    const { result } = applyBoardPhoto(draftOf(['A', 'B']), answer({}), nameOf);
    expect(result.empty).toBe(true);
    expect(photoPlacedAny(result)).toBe(false);
    expect(photoHaptic(result)).toBe('error');
  });

  it('время и «уже на месте» коротко', () => {
    expect(photoSeconds(2480)).toBe('2,5 с');
    expect(photoSeconds(10_349)).toBe('10,3 с');
    expect(photoKeptLines([{ code: 'As', slot: board(0) }], nameOf)).toEqual([
      'Уже на месте: туз пик (флоп).',
    ]);
  });

  it('отметка «уже пробовали» переживает отказ хранилища', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    expect(readPhotoUsed(storage)).toBe(false);
    writePhotoUsed(storage);
    expect(readPhotoUsed(storage)).toBe(true);
    const broken = {
      getItem: () => {
        throw new Error('нет');
      },
      setItem: () => {
        throw new Error('нет');
      },
    };
    expect(readPhotoUsed(broken)).toBe(false);
    expect(() => writePhotoUsed(broken)).not.toThrow();
    expect(readPhotoUsed(null)).toBe(false);
  });
});
