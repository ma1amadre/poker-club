import { describe, expect, it } from 'vitest';
import {
  emptyDraft,
  placeCard,
  placeCards,
  setPlayers,
  type ShowdownDraft,
  type Slot,
} from './showdownDraft';
import {
  VOICE_EXAMPLE,
  VOICE_NOTHING_TEXT,
  bestVoiceParse,
  keptLines,
  lexiconConflicts,
  lexiconWords,
  parseVoiceCards,
  placedGroups,
  placementLines,
  readVoiceReady,
  slotOwner,
  speechTexts,
  voiceErrorText,
  voiceIssueLines,
  voiceQueue,
  writeVoiceReady,
  type VoiceIssue,
} from './voiceCards';

const cards = (text: string) => parseVoiceCards(text).cards;

describe('parseVoiceCards: фраза → карты', () => {
  // Каждая строка — фраза и карты, которые из неё должны выйти, по порядку.
  const PHRASES: readonly [string, string[]][] = [
    // Замер на iPhone (09.10.2026, Telegram iOS 9.6): фраза «восемь крести, три буби» и её варианты.
    ['Восемь крестик три Буби', ['8c', '3d']],
    ['Восемь крести три Буби', ['8c', '3d']],
    ['Восемь крестик три Бубы', ['8c', '3d']],
    // Пример у кнопки.
    ['туз пик, король червей', ['As', 'Kh']],
    ['Туз пик король червей', ['As', 'Kh']],
    // Масть перед рангом — прилагательным.
    ['пиковый туз червовая дама', ['As', 'Qh']],
    ['пиковый туз, червовая дама', ['As', 'Qh']],
    ['бубновый валет трефовая десятка', ['Jd', 'Tc']],
    ['крестовая восьмёрка червонный король', ['8c', 'Kh']],
    // Смешанный порядок.
    ['туз пик червовая дама', ['As', 'Qh']],
    ['дама червей пиковый туз', ['Qh', 'As']],
    ['туз пиковый король червей', ['As', 'Kh']],
    ['король пиковый, туз червовый', ['Ks', 'Ah']],
    // Падежи.
    ['короля треф и даму бубен', ['Kc', 'Qd']],
    ['с тузом пик и королём червей', ['As', 'Kh']],
    ['десяткой бубей', ['Td']],
    ['девятку пиками', ['9s']],
    ['двух трефовых', ['2c']],
    // Ранги словом и цифрой, десятка.
    ['десять червей', ['Th']],
    ['десятка пик', ['Ts']],
    ['10 пик', ['Ts']],
    ['10ка пик', ['Ts']],
    ['8 крестей 3 бубей', ['8c', '3d']],
    ['2 пики 9 черви', ['2s', '9h']],
    ['двойка треф тройка бубен четвёрка червей пятёрка пик', ['2c', '3d', '4h', '5s']],
    ['шестёрка пик семёрка червей восьмерка бубен девятка треф', ['6s', '7h', '8d', '9c']],
    ['валет треф дама пик король бубен туз червей', ['Jc', 'Qs', 'Kd', 'Ah']],
    ['четыре пики пять черви шесть буби семь крести', ['4s', '5h', '6d', '7c']],
    // «Кароль», жаргон и регистр.
    ['КАРОЛЬ ЧЕРВЕЙ', ['Kh']],
    ['кароль пик и туз крестей', ['Ks', 'Ac']],
    ['дама черва', ['Qh']],
    ['валет бубна', ['Jd']],
    ['туз трефа', ['Ac']],
    ['туз крест', ['Ac']],
    ['семёрка крестиков', ['7c']],
    // Лишние слова, предлоги, «и», знаки.
    ['так, у Жени туз пик и король червей, а на флопе двойка бубен', ['As', 'Kh', '2d']],
    ['ну это восемь крести и потом три буби!', ['8c', '3d']],
    ['Туз пик. Король червей.', ['As', 'Kh']],
    ['восьмёрка-треф, тройка-бубен', ['8c', '3d']],
    // Две руки и флоп одной фразой.
    [
      'туз пик король червей, дама бубен дама треф, двойка пик семёрка червей девятка бубен',
      ['As', 'Kh', 'Qd', 'Qc', '2s', '7h', '9d'],
    ],
    // Нечёткое совпадение: одна буква — без путаницы.
    ['валит пик', ['Js']],
    ['король кристи', ['Kc']],
    ['дама червовой', ['Qh']],
  ];

  it.each(PHRASES)('«%s»', (text, expected) => {
    expect(cards(text)).toEqual(expected);
  });

  it('фраз в таблице не меньше 40', () => {
    expect(PHRASES.length).toBeGreaterThanOrEqual(40);
  });
});

describe('parseVoiceCards: что не карта', () => {
  const issues = (text: string): VoiceIssue[] => parseVoiceCards(text).issues;

  it('ранг без масти', () => {
    expect(parseVoiceCards('туз')).toEqual({
      text: 'туз',
      cards: [],
      sure: 0,
      issues: [{ kind: 'no-suit', word: 'туз' }],
    });
  });

  it('масть без ранга', () => {
    expect(cards('червей')).toEqual([]);
    expect(issues('червей')).toEqual([{ kind: 'no-rank', word: 'червей' }]);
  });

  it('потерянный ранг: «пик, король червей» — пики отдельно, король с червами', () => {
    expect(cards('пик король червей')).toEqual(['Kh']);
    expect(issues('пик король червей')).toEqual([{ kind: 'no-rank', word: 'пик' }]);
  });

  it('потерянная масть: «туз король червей» — туз отдельно', () => {
    expect(cards('туз король червей')).toEqual(['Kh']);
    expect(issues('туз король червей')).toEqual([{ kind: 'no-suit', word: 'туз' }]);
  });

  it('повтор карты в одной фразе — одна карта и замечание', () => {
    expect(cards('туз пик, пиковый туз, король червей')).toEqual(['As', 'Kh']);
    expect(issues('туз пик, пиковый туз, король червей')).toEqual([{ kind: 'repeat', card: 'As' }]);
  });

  it('два ранга подряд и масть: последняя пара — карта', () => {
    expect(cards('туз король пик')).toEqual(['Ks']);
    expect(issues('туз король пик')).toEqual([{ kind: 'no-suit', word: 'туз' }]);
  });

  it('ничего похожего на карты', () => {
    expect(parseVoiceCards('привет как дела')).toEqual({
      text: 'привет как дела',
      cards: [],
      sure: 0,
      issues: [],
    });
    expect(parseVoiceCards('')).toEqual({ text: '', cards: [], sure: 0, issues: [] });
  });

  it('числа кроме 2–10 и короткие похожие слова — не карты', () => {
    expect(parseVoiceCards('1 пик').cards).toEqual([]);
    expect(parseVoiceCards('11 пик').cards).toEqual([]);
    // «при» на одну букву от «три», но слова короче пяти букв нечётко не читаются.
    expect(parseVoiceCards('при пик').cards).toEqual([]);
  });

  it('нечёткое совпадение не берёт слово, близкое к разным значениям', () => {
    // «пиком» нет в словаре; на одну букву от него — «пикой», «пиков», «пикам»: все — пики.
    expect(cards('туз пиком')).toEqual(['As']);
    // Длинное слово, далёкое от всех, — лишнее.
    expect(cards('туз пикник')).toEqual([]);
  });

  it('в словаре нет слова с двумя значениями, каждое слово само по себе — ранг или масть', () => {
    expect(lexiconConflicts()).toEqual([]);
    for (const word of lexiconWords()) expect(parseVoiceCards(word).issues).toHaveLength(1);
  });
});

// Ревью 09.10.2026: потерянное слово сдвигало все следующие карты фразы на место раньше — к чужой руке.
describe('сбой во фразе: дальше карты не кладутся (sure)', () => {
  const twoHands = () => draftOf(['A', 'B']);
  const A0: Slot = { kind: 'hand', playerId: 'A', index: 0 };

  it.each([
    // Потеряна масть или ранг между картами.
    ['туз пик червей дама бубен дама треф', ['As', 'Qd', 'Qc'], 1],
    ['туз пик король дама бубен дама треф', ['As', 'Qd', 'Qc'], 1],
    // В начале — тоже: где лежала бы первая карта, неясно.
    ['туз король червей', ['Kh'], 0],
    ['пик король червей', ['Kh'], 0],
    // В конце — карты до него кладутся все.
    ['туз пик король', ['As'], 1],
    // Повтор подряд — оговорка, не сбой; не подряд — сбой.
    ['туз пик туз пик король червей', ['As', 'Kh'], 2],
    ['туз пик король червей туз пик дама бубен', ['As', 'Kh', 'Qd'], 2],
    // Без сбоя — все.
    ['туз пик король червей дама бубен', ['As', 'Kh', 'Qd'], 3],
  ] as const)('«%s»', (text, expected, sure) => {
    const parse = parseVoiceCards(text);
    expect(parse.cards).toEqual(expected);
    expect(parse.sure).toBe(sure);
  });

  it('потерян «король»: Жене — только туз, дамы не уезжают к нему от Саши', () => {
    const parse = parseVoiceCards('туз пик червей дама бубен дама треф');
    const r = placeCards(twoHands(), A0, parse.cards.slice(0, parse.sure));
    expect(r.draft.hands).toEqual({ A: ['As', null], B: [null, null] });
    expect(r.active).toEqual({ kind: 'hand', playerId: 'A', index: 1 });
    expect(parse.cards.slice(parse.sure)).toEqual(['Qd', 'Qc']);
  });
});

// Ревью 09.10.2026: «короче» читалось как «короле» и забирало масть у соседней карты.
describe('обычные слова речи — не карты', () => {
  it.each([
    ['короче туз пик король червей', ['As', 'Kh']],
    ['восемь короче крести три буби', ['8c', '3d']],
    ['туз короче пик король червей', ['As', 'Kh']],
    ['дама короче червей', ['Qh']],
    ['у Валеры пики туз', ['As']],
    ['нас семеро, у Валеры туз пик', ['As']],
    // Нечёткое слово не из списка: картой — только в паре с соседним, одно — лишнее.
    ['Королёв: восемь крести три буби', ['8c', '3d']],
    ['восемь королёв крести', ['8c']],
  ] as const)('«%s» — без замечаний', (text, expected) => {
    expect(parseVoiceCards(text)).toMatchObject({ cards: expected, issues: [] });
  });

  it.each([
    'короче',
    'семья',
    'семье',
    'семьи',
    'семечки',
    'домой',
    'дамка',
    'валера',
    'валеры',
    'валерой',
    'четверо',
    'пятеро',
    'шестеро',
    'семеро',
    'восьмеро',
    'двойной',
    'тройной',
  ])('«%s пик» — не карта', (word) => {
    expect(parseVoiceCards(`${word} пик`).cards).toEqual([]);
  });

  it('нечёткое слово одно — лишнее, без замечания; точное одно — замечание', () => {
    expect(parseVoiceCards('валит')).toMatchObject({ cards: [], issues: [] });
    expect(parseVoiceCards('валет').issues).toEqual([{ kind: 'no-suit', word: 'валет' }]);
  });
});

// Ревью 09.10.2026: «туз пик, нет, туз треф» клало обе карты.
describe('поправка: «нет», «вернее», «точнее», «отмена»', () => {
  it('карта перед «нет» отменяется, в замечаниях — что на что', () => {
    const parse = parseVoiceCards('туз пик, нет, туз треф');
    expect(parse.cards).toEqual(['Ac']);
    expect(parse.issues).toEqual([{ kind: 'corrected', from: { card: 'As' }, to: 'Ac' }]);
    expect(voiceIssueLines(parse.issues)).toEqual(['Исправлено: туз пик → туз треф.']);
  });

  it.each([
    ['туз пик вернее туз треф король червей', ['Ac', 'Kh']],
    ['туз пик, точнее туз треф', ['Ac']],
    ['восемь крести три буби отмена три черви', ['8c', '3h']],
    ['туз пик ой нет туз треф', ['Ac']],
    // В начале фразы отменять нечего.
    ['нет, туз пик', ['As']],
  ] as const)('«%s»', (text, expected) => {
    expect(parseVoiceCards(text).cards).toEqual(expected);
  });

  it('поправка в конце — карта отменена; отменено одиночное слово — не замечание «без масти»', () => {
    const end = parseVoiceCards('туз пик нет');
    expect(end.cards).toEqual([]);
    expect(voiceIssueLines(end.issues)).toEqual(['Отменено: туз пик.']);
    const word = parseVoiceCards('туз нет туз треф');
    expect(word.cards).toEqual(['Ac']);
    expect(word.sure).toBe(1);
    expect(voiceIssueLines(word.issues)).toEqual(['Исправлено: «туз» → туз треф.']);
  });
});

describe('bestVoiceParse: выбор из вариантов распознавания', () => {
  it('варианты замера — все дают 8♣ 3♦, берётся первый', () => {
    const best = bestVoiceParse([
      'Восемь крестик три Буби',
      'Восемь крести три Буби',
      'Восемь крестик три Бубы',
    ]);
    expect(best?.text).toBe('Восемь крестик три Буби');
    expect(best?.cards).toEqual(['8c', '3d']);
  });

  it('больше карт — лучше, даже если вариант не первый', () => {
    const best = bestVoiceParse(['восемь крести три', 'восемь крести три буби']);
    expect(best?.cards).toEqual(['8c', '3d']);
  });

  it('при равном числе карт — меньше замечаний', () => {
    const best = bestVoiceParse(['туз пик король червей дама', 'туз пик король червей']);
    expect(best?.text).toBe('туз пик король червей');
  });

  it('больше карт, но не первый — замечание с первым вариантом', () => {
    const best = bestVoiceParse(['восемь крести три', 'восемь крести три буби']);
    expect(best?.issues).toEqual([{ kind: 'alternative', text: 'восемь крести три' }]);
    expect(voiceIssueLines(best?.issues ?? [])).toEqual([
      'Первый вариант телефона был другим: «восемь крести три».',
    ]);
  });

  it('варианты с теми же картами — без замечания о первом', () => {
    const best = bestVoiceParse(['туз пик король червей дама', 'туз пик король червей']);
    expect(best?.text).toBe('туз пик король червей');
    expect(best?.issues).toEqual([]);
  });

  it('больше карт до сбоя — лучше: потерянное слово в первом варианте', () => {
    const best = bestVoiceParse([
      'туз пик червей дама бубен дама треф',
      'туз пик король червей дама бубен дама треф',
    ]);
    expect(best?.cards).toEqual(['As', 'Kh', 'Qd', 'Qc']);
    expect(best?.sure).toBe(4);
  });

  // Ревью 09.10.2026: фраза оборвалась паузой, 8♣ легла Жене; банкир повторил фразу целиком. Раньше
  // карта, которая уже лежит, считалась противоречием, и менее уверенный «семь крести» молча
  // подменял восьмёрку на семёрку.
  it('карта, которая уже лежит, на выбор не влияет — берётся первый вариант', () => {
    const best = bestVoiceParse(['восемь крести три буби', 'семь крести три буби']);
    expect(best?.text).toBe('восемь крести три буби');
    expect(best?.issues).toEqual([]);
    const A0: Slot = { kind: 'hand', playerId: 'A', index: 0 };
    const A1: Slot = { kind: 'hand', playerId: 'A', index: 1 };
    const d = placeCard(draftOf(['A', 'B']), A0, '8c');
    const r = placeCards(d, A1, best?.cards ?? []);
    expect(r.kept).toEqual([{ code: '8c', slot: A0 }]);
    expect(r.placed).toEqual([{ slot: A1, code: '3d', prev: null }]);
    expect(r.draft.hands.A).toEqual(['8c', '3d']);
    expect(keptLines(r.kept, nameOf)).toEqual(['Уже на месте: восьмёрка треф (Женя).']);
  });

  it('повтор в варианте — противоречие', () => {
    const best = bestVoiceParse(['туз пик туз пик', 'туз пик туз треф']);
    expect(best?.cards).toEqual(['As', 'Ac']);
  });

  it('пустые варианты — null', () => {
    expect(bestVoiceParse([])).toBeNull();
    expect(bestVoiceParse(['', '  '])).toBeNull();
  });
});

describe('speechTexts: куски распознавания → варианты фразы', () => {
  it('один кусок — его варианты', () => {
    expect(speechTexts([['Восемь крестик три Буби', 'Восемь крести три Буби']])).toEqual([
      'Восемь крестик три Буби',
      'Восемь крести три Буби',
    ]);
  });

  it('несколько кусков — склеиваются по номеру варианта, у короткого — первый', () => {
    expect(speechTexts([['туз пик', 'туз пики'], ['король червей']])).toEqual([
      'туз пик король червей',
      'туз пики король червей',
    ]);
  });

  it('пустые и повторы выкидываются', () => {
    expect(speechTexts([[' ', ''], []])).toEqual([]);
    expect(speechTexts([['туз пик', 'туз пик ']])).toEqual(['туз пик']);
  });
});

const names: Record<string, string> = { A: 'Женя', B: 'Саша', C: 'Лёша' };
const nameOf = (id: string) => names[id] ?? 'Игрок';
const SD = '5d000000-0000-4000-8000-000000000002';

const draftOf = (players: string[]): ShowdownDraft => setPlayers(emptyDraft(SD), players);

describe('куда лягут карты (voiceQueue) и подписи', () => {
  it('новая раздача на двоих: игроки, потом флоп', () => {
    const d = draftOf(['A', 'B']);
    expect(voiceQueue(d, { kind: 'hand', playerId: 'A', index: 0 }, nameOf)).toBe(
      'Женя → Саша → флоп → …',
    );
    expect(voiceQueue(d, { kind: 'hand', playerId: 'A', index: 0 }, nameOf, 9)).toBe(
      'Женя → Саша → флоп → тёрн → ривер',
    );
  });

  it('руки отмечены — очередь стола', () => {
    const { draft, active } = placeCards(draftOf(['A', 'B']), null, ['As', 'Kh', 'Qd', 'Qc']);
    expect(voiceQueue(draft, active, nameOf)).toBe('флоп → тёрн → ривер');
  });

  it('подсвечена занятая карта — «замена», дальше пустые', () => {
    const { draft } = placeCards(draftOf(['A', 'B']), null, ['As', 'Kh']);
    expect(voiceQueue(draft, { kind: 'hand', playerId: 'A', index: 1 }, nameOf)).toBe(
      'Женя (замена) → Саша → флоп → …',
    );
  });

  it('всё заполнено — null', () => {
    const { draft, active } = placeCards(draftOf(['A', 'B']), null, [
      'As',
      'Kh',
      'Qd',
      'Qc',
      '2s',
      '7h',
      '9d',
      'Tc',
      '3h',
    ]);
    expect(active).toBeNull();
    expect(voiceQueue(draft, active, nameOf)).toBeNull();
  });

  it('что легло — группами по владельцам мест', () => {
    const r = placeCards(draftOf(['A', 'B']), null, ['As', 'Kh', 'Qd', 'Qc', '2s', '7h', '9d']);
    expect(placedGroups(r.placed, nameOf)).toEqual([
      { owner: 'Женя', cards: ['As', 'Kh'] },
      { owner: 'Саша', cards: ['Qd', 'Qc'] },
      { owner: 'флоп', cards: ['2s', '7h', '9d'] },
    ]);
    expect(placedGroups([], nameOf)).toEqual([]);
  });

  it('владелец места', () => {
    expect(slotOwner({ kind: 'hand', playerId: 'B', index: 1 }, nameOf)).toBe('Саша');
    expect(slotOwner({ kind: 'board', index: 2 }, nameOf)).toBe('флоп');
    expect(slotOwner({ kind: 'board', index: 3 }, nameOf)).toBe('тёрн');
    expect(slotOwner({ kind: 'board', index: 4 }, nameOf)).toBe('ривер');
  });

  it('замечания строками', () => {
    expect(
      voiceIssueLines([
        { kind: 'no-suit', word: 'туз' },
        { kind: 'no-suit', word: 'дама' },
        { kind: 'no-rank', word: 'червей' },
        { kind: 'repeat', card: 'As' },
      ]),
    ).toEqual(['Без масти: «туз», «дама».', 'Без ранга: «червей».', 'Повтор: туз пик.']);
    expect(voiceIssueLines([])).toEqual([]);
  });

  it('что не легло', () => {
    expect(
      placementLines(
        [{ code: '8c', slot: { kind: 'hand', playerId: 'A', index: 0 } }],
        ['Kh', 'Qd'],
        ['Qs'],
        nameOf,
      ),
    ).toEqual([
      'Уже лежит: восьмёрка треф (Женя).',
      'Дальше не легли: король червей, дама бубён. Повтори их вместе с картой перед ними.',
      'Свободных мест не хватило: дама пик.',
    ]);
    expect(
      placementLines(
        [
          { code: '8c', slot: { kind: 'hand', playerId: 'A', index: 0 } },
          { code: '3d', slot: { kind: 'board', index: 0 } },
        ],
        [],
        [],
        nameOf,
      ),
    ).toEqual(['Уже лежат: восьмёрка треф (Женя), тройка бубён (флоп).']);
    expect(placementLines([], [], [], nameOf)).toEqual([]);
    expect(placementLines([], ['Qc'], [], nameOf)).toEqual([
      'Дальше не легла: дама треф. Повтори её вместе с картой перед ней.',
    ]);
  });

  it('что уже на месте', () => {
    expect(
      keptLines(
        [
          { code: 'As', slot: { kind: 'hand', playerId: 'A', index: 0 } },
          { code: '2d', slot: { kind: 'board', index: 3 } },
        ],
        nameOf,
      ),
    ).toEqual(['Уже на месте: туз пик (Женя), двойка бубён (тёрн).']);
    expect(keptLines([], nameOf)).toEqual([]);
  });

  it('тексты на «ты», с примером фразы', () => {
    expect(VOICE_NOTHING_TEXT).toContain(`«${VOICE_EXAMPLE}»`);
    expect(voiceErrorText('not-allowed')).toMatch(/микрофону/);
    expect(voiceErrorText('no-speech')).toMatch(/Речи не слышно/);
    expect(voiceErrorText('network')).toMatch(/интернет/);
    expect(voiceErrorText('aborted')).toMatch(/прервалось/);
    expect(voiceErrorText('weird')).toBe(
      'Распознавание не сработало (weird). Отметь карты касанием.',
    );
  });
});

describe('память «распознавание уже запускалось»', () => {
  it('пишет и читает; хранилище бросает — «нет» и без исключения', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
    expect(readVoiceReady(storage)).toBe(false);
    writeVoiceReady(storage);
    expect(readVoiceReady(storage)).toBe(true);
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(readVoiceReady(broken)).toBe(false);
    expect(() => writeVoiceReady(broken)).not.toThrow();
    expect(readVoiceReady(null)).toBe(false);
  });
});
