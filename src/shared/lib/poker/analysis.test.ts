import { describe, expect, it } from 'vitest';
import { analyzeShowdown, computeHolds, computeOuts, roundShares } from './analysis';
import { cardCode, parseCards } from './cards';
import { computeEquity, exactEquity, mulberry32 } from './equity';
import { outsEquity } from './pokermath';

const split = (s: string) => s.match(/../g) ?? [];
const H = (s: string) => parseCards(split(s));

function analyze(hands: string[], board: string) {
  const h = hands.map(split);
  const b = split(board);
  return analyzeShowdown(h, b, computeEquity(h, b));
}

describe('ауты', () => {
  it('тёрн: флеш-дро и две оверкарты против пары дам — 15 аутов, эквити 15/44', () => {
    const a = analyze(['AhKh', 'QsQd'], '2h7h9cJd');
    expect(a.street).toBe('turn');
    expect(a.unseen).toBe(44);
    const [ak, qq] = a.players;
    expect(qq?.ahead).toBe(true);
    expect(qq?.outs).toBeNull();
    expect(ak?.ahead).toBe(false);
    expect(ak?.hand).toBe('Старшая карта: туз');
    expect(qq?.hand).toBe('Пара дам');
    // 9 червей + 3 туза + 3 короля, делёжа нет.
    expect(ak?.outs?.outs).toHaveLength(15);
    expect(ak?.outs?.splitOuts).toEqual([]);
    expect([...(ak?.outs?.outs ?? [])].sort()).toEqual(
      [
        '3h',
        '4h',
        '5h',
        '6h',
        '8h',
        '9h',
        'Th',
        'Jh',
        'Qh',
        'Ac',
        'Ad',
        'As',
        'Kc',
        'Kd',
        'Ks',
      ].sort(),
    );
    // На тёрне ауты и есть шансы: 15 из 44 — та же формула курса.
    expect(ak?.equity).toBeCloseTo((15 / 44) * 100, 9);
    expect(ak?.outs?.hitPct).toBeCloseTo(outsEquity(15, 1, 44), 9);
  });

  it('флоп: стрит-дро и флеш-дро против тузов — 15 аутов к тёрну, шансы до ривера выше', () => {
    const a = analyze(['8h9h', 'AsAd'], 'Th Jc 2h'.replace(/ /g, ''));
    expect(a.street).toBe('flop');
    expect(a.unseen).toBe(45);
    const [draw, aces] = a.players;
    expect(aces?.ahead).toBe(true);
    expect(draw?.outs?.outs).toHaveLength(15); // 9 червей + Q и 7 других мастей
    expect(draw?.outs?.hitPct).toBeCloseTo((15 / 45) * 100, 9);
    // До ривера к аутам тёрна добавляются раннеры: шансы больше, чем 15/45.
    expect(draw?.equity ?? 0).toBeGreaterThan((15 / 45) * 100);
  });

  it('доли побед и дележей отстающего на тёрне — его ауты из невидимых карт', () => {
    // K♠Q♦ против K♥J♣ на K♦ 7♣ 2♠ 3♥: пара королей у обоих, у первого кикер старше.
    const a = analyze(['KsQd', 'KhJc'], 'Kd7c2s3h');
    const behind = a.players[1];
    expect(behind?.ahead).toBe(false);
    expect(behind?.outs?.outs.length).toBeGreaterThan(0);
    expect(behind?.win).toBeCloseTo(((behind?.outs?.outs.length ?? 0) / 44) * 100, 9);
    expect(behind?.tie).toBeCloseTo(((behind?.outs?.splitOuts.length ?? 0) / 44) * 100, 9);
  });

  it('стол играет: ауты отстающего только к дележу', () => {
    // T♥4♣ против 2♦3♦ на A♠K♠Q♠J♠: у первого стрит до туза, у второго старшая карта.
    // Десятка даёт второму тот же стрит, любая пика — флеш на столе у обоих, T♠ — роял-флеш на
    // столе: всё это делёж, а выиграть второму нечем.
    const a = analyze(['Th4c', '2d3d'], 'AsKsQsJs');
    const b = a.players[1];
    expect(a.players[0]?.ahead).toBe(true);
    expect(b?.outs?.outs).toEqual([]);
    expect([...(b?.outs?.splitOuts ?? [])].sort()).toEqual(
      ['2s', '3s', '4s', '5s', '6s', '7s', '8s', '9s', 'Ts', 'Tc', 'Td'].sort(),
    );
    expect(b?.equity).toBeCloseTo(((11 / 44) * 100) / 2, 9);
    expect(b?.outs?.hitPct).toBeCloseTo(outsEquity(11, 1, 44), 9);
  });

  it('на тёрне ауты сходятся с точным перебором — 200 случайных раздач с seed', () => {
    const rng = mulberry32(170);
    for (let k = 0; k < 200; k += 1) {
      const n = 2 + (k % 4);
      const deck = Array.from({ length: 52 }, (_, i) => i);
      for (let i = 51; i > 0; i -= 1) {
        const j = (rng() * (i + 1)) | 0;
        [deck[i], deck[j]] = [deck[j]!, deck[i]!];
      }
      const hands = Array.from({ length: n }, (_, i) => [deck[2 * i]!, deck[2 * i + 1]!]);
      const board = deck.slice(2 * n, 2 * n + 4);
      const outs = computeOuts(hands, board);
      const eq = exactEquity(hands, board);
      const unseen = 52 - 4 - 2 * n;
      outs?.forEach((o, i) => {
        if (!o) return; // впереди — аутов нет
        // Отстающий выигрывает ровно на своих аутах, делит — ровно на аутах дележа.
        expect(eq.win[i]).toBeCloseTo((o.outs.length / unseen) * 100, 9);
        expect(eq.tie[i]).toBeCloseTo((o.splitOuts.length / unseen) * 100, 9);
      });
      // Каждый аут — карта не из рук и не со стола.
      const used = new Set([...board, ...hands.flat()].map(cardCode));
      outs?.forEach((o) =>
        o?.outs.concat(o.splitOuts).forEach((c) => expect(used.has(c)).toBe(false)),
      );
    }
  });

  it('до флопа и на ривере аутов нет', () => {
    expect(computeOuts([H('AsKd'), H('QhQc')], [])).toBeNull();
    expect(computeOuts([H('AsKd'), H('QhQc')], H('2c7d9hJdTc'))).toBeNull();
    const pre = analyze(['AsKd', 'QhQc'], '');
    expect(pre.street).toBe('preflop');
    expect(pre.exact).toBe(false);
    expect(pre.players.every((p) => p.outs === null && p.hand === null && !p.ahead)).toBe(true);
    expect(pre.winners).toBeNull();
  });
});

describe('устоит ли тот, кто впереди', () => {
  it('тёрн, хедз-ап: дамы устоят на всех картах, кроме 15 аутов туза-короля', () => {
    const a = analyze(['AhKh', 'QsQd'], '2h7h9cJd');
    const [ak, qq] = a.players;
    expect(qq?.holds).toBe(44 - 15);
    expect(ak?.holds).toBeNull();
  });

  it('флоп: тузы устоят к тёрну на 30 картах из 45 (15 аутов дро)', () => {
    const a = analyze(['8h9h', 'AsAd'], 'ThJc2h');
    expect(a.players[1]?.holds).toBe(30);
    expect(a.players[0]?.holds).toBeNull();
  });

  it('карта, на которой отстающий догоняет до дележа, — не «устоял»', () => {
    // T♥4♣ против 2♦3♦ на A♠K♠Q♠J♠: у первого стрит; любая пика — флеш на столе у обоих, десятка
    // — стрит и у второго: 9 пик и 2 десятки — делёж. Устоит на остальных 33 из 44 — ровно столько,
    // сколько у второго не аутов на делёж.
    const a = analyze(['Th4c', '2d3d'], 'AsKsQsJs');
    expect(a.players[0]?.holds).toBe(33);
    expect(a.players[1]?.outs?.outs).toEqual([]);
    expect(a.players[1]?.outs?.splitOuts).toHaveLength(11);
    expect(a.players[1]?.holds).toBeNull();
  });

  it('впереди вдвоём вровень: устоят, пока никто из отстающих не догнал', () => {
    // A♦2♣ и A♥3♣ — оба стрит до туза на K♥Q♥J♦T♠; у 9♣8♣ — стрит до короля, туз даст ему делёж
    // (A♠ A♣ — 2 карты): лидеры устоят на остальных 40 из 42 (флеша не будет: червей на столе две).
    const a = analyze(['Ad2c', 'Ah3c', '9c8c'], 'KhQhJdTs');
    expect(a.players[2]?.outs?.splitOuts).toHaveLength(2);
    expect(a.players[0]?.holds).toBe(42 - 2);
    expect(a.players[1]?.holds).toBe(42 - 2);
  });

  it('у одного лидера «устоит» + ауты и ауты на делёж всех отстающих = вся колода — 200 раздач с seed', () => {
    const rng = mulberry32(171);
    for (let k = 0; k < 200; k += 1) {
      const n = 2 + (k % 5);
      const deck = Array.from({ length: 52 }, (_, i) => i);
      for (let i = 51; i > 0; i -= 1) {
        const j = (rng() * (i + 1)) | 0;
        [deck[i], deck[j]] = [deck[j]!, deck[i]!];
      }
      const hands = Array.from({ length: n }, (_, i) => [deck[2 * i]!, deck[2 * i + 1]!]);
      const board = deck.slice(2 * n, 2 * n + (k % 2 ? 4 : 3));
      const holds = computeHolds(hands, board);
      const outs = computeOuts(hands, board);
      const eq = board.length === 4 ? exactEquity(hands, board) : null;
      const unseen = 52 - board.length - 2 * n;
      const leaders = holds?.filter((h) => h !== null).length ?? 0;
      const caught = new Set(outs?.flatMap((o) => (o ? [...o.outs, ...o.splitOuts] : [])));
      holds?.forEach((h, i) => {
        // У каждого либо ауты, либо «устоит» — не оба сразу.
        expect(h === null).toBe(outs?.[i] !== null);
        if (h === null) return;
        if (leaders === 1) expect(h).toBe(unseen - caught.size);
        // Устоит — не чаще, чем остаётся на вершине (точный перебор, на тёрне — та же одна карта).
        if (eq) {
          expect(h / unseen).toBeLessThanOrEqual(
            ((eq.win[i] ?? 0) + (eq.tie[i] ?? 0)) / 100 + 1e-9,
          );
        }
      });
    }
  });

  it('до флопа и на ривере — нет', () => {
    expect(computeHolds([H('AsKd'), H('QhQc')], [])).toBeNull();
    expect(computeHolds([H('AsKd'), H('QhQc')], H('2c7d9hJdTc'))).toBeNull();
    expect(analyze(['AsKd', 'QhQc'], '').players.every((p) => p.holds === null)).toBe(true);
  });
});

describe('ривер', () => {
  it('победитель — лучшая рука', () => {
    const a = analyze(['AhKh', 'QsQd'], 'Qc7d9hJdTc');
    expect(a.street).toBe('river');
    expect(a.winners).toEqual([0]);
    expect(a.players.map((p) => p.equity)).toEqual([100, 0]);
    expect(a.players[0]?.hand).toBe('Стрит до туза');
  });

  it('делёж — несколько победителей', () => {
    const a = analyze(['AhKh', 'AsKs', '2c2d'], '9cTdJhQs3c');
    expect(a.winners).toEqual([0, 1]);
    expect(a.players.map((p) => p.equity)).toEqual([50, 50, 0]);
  });
});

describe('проценты для экрана', () => {
  it('целые и в сумме 100', () => {
    expect(roundShares([81.95, 18.05])).toEqual([82, 18]);
    expect(roundShares([50, 50])).toEqual([50, 50]);
    expect(roundShares([100, 0])).toEqual([100, 0]);
    expect(roundShares([0, 0])).toEqual([0, 0]);
    expect(roundShares([12.5, 12.5, 37.5, 37.5])).toEqual([12, 12, 38, 38]);
    expect(roundShares([45.6, 30.3, 24.1])).toEqual([46, 30, 24]);
  });

  it('равные доли — равные цифры, даже если сумма выйдет 99', () => {
    expect(roundShares([100 / 3, 100 / 3, 100 / 3])).toEqual([33, 33, 33]);
    // Меньшая доля не обгоняет большие: 33,4 ×2 и 33,2 → 33 / 33 / 33, а не 33 / 33 / 34.
    expect(roundShares([33.4, 33.4, 33.2])).toEqual([33, 33, 33]);
    // Двое с одинаковыми AK против пары: 81,17 / 9,41 / 9,41 — не 81 / 10 / 9.
    expect(roundShares([81.17386, 9.41307, 9.41307])).toEqual([81, 9, 9]);
    const a = analyze(['7h7c', 'AdKs', 'AsKc'], '2h5c9d');
    expect(a.players[1]?.equity).toBe(a.players[2]?.equity);
    const shares = roundShares(a.players.map((p) => p.equity));
    expect(shares[1]).toBe(shares[2]);
  });

  it('разбор раздачи детерминирован: те же карты — те же цифры', () => {
    const a = analyze(['AsKd', 'QhQc', '7s6s'], '');
    const b = analyze(['AsKd', 'QhQc', '7s6s'], '');
    expect(a).toEqual(b);
    const sum = roundShares(a.players.map((p) => p.equity)).reduce((x, y) => x + y, 0);
    expect(sum === 99 || sum === 100).toBe(true);
  });
});
