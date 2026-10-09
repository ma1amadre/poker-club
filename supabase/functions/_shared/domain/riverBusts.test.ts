// Олл-ин после ривера: итог раздачи, предложение вылета, кто выбил при побочном банке и порядок мест
// для вылетов одной раздачи. Правило «кто выбил» сверяется с прямым счётом банков по всем порядкам
// стеков: варианты домена — ровно те, что дают настоящие банки при таком исходе.
import { describe, expect, it } from 'vitest';
import { riverRanking } from './allins.ts';
import { DEFAULT_FORMAT } from './format.ts';
import { computeMoney } from './money.ts';
import { canApplySequence, replay, replayLog } from './replay.ts';
import {
  bustedInHand,
  riverBustDrafts,
  riverBustKillers,
  riverBustSuggestion,
  riverKillerGroups,
  riverOutcome,
  type RiverHand,
} from './riverBusts.ts';
import { CARD_RANKS, CARD_SUITS } from './showdown.ts';
import { journal, prng } from './test-utils.ts';
import type { CardCode, PlayerId, ShowdownHand } from './types.ts';

const F = DEFAULT_FORMAT;
const hand = (playerId: string, a: string, b: string): ShowdownHand => ({
  playerId,
  cards: [a, b],
});
/** Стол без стрита и флеша: решают пары и старшие карты. */
const BOARD = ['2c', '7h', '9s', 'Jc', '3d'];
// Руки по силе на BOARD: тузы > короли (две равные пары) > дамы > десятки > восьмёрки.
const AA = (id: string) => hand(id, 'As', 'Ah');
const KK = (id: string) => hand(id, 'Kd', 'Ks');
const KK2 = (id: string) => hand(id, 'Kc', 'Kh');
const QQ = (id: string) => hand(id, 'Qs', 'Qh');
const TT = (id: string) => hand(id, 'Td', 'Th');
const EE = (id: string) => hand(id, '8c', '8d');
const sd = (...hands: ShowdownHand[]): RiverHand => ({ hands, board: BOARD });
const groups = (s: RiverHand, busted: string[]) =>
  Object.fromEntries(riverKillerGroups(s, busted) ?? []);

describe('riverOutcome: кто выиграл раздачу на ривере', () => {
  it('хедз-ап: пара тузов против короля-дамы', () => {
    const out = riverOutcome({
      hands: [hand('a', 'As', 'Ah'), hand('b', 'Kd', 'Qd')],
      board: BOARD,
    });
    expect(out).toEqual({ winners: ['a'], losers: ['b'] });
  });

  it('делёж: одинаковая рука на столе — проигравших нет', () => {
    const out = riverOutcome({
      hands: [hand('a', '2c', '3d'), hand('b', '2h', '3s')],
      board: ['Ah', 'Kh', 'Qh', 'Jh', 'Th'],
    });
    expect(out).toEqual({ winners: ['a', 'b'], losers: [] });
  });

  it('три руки: один победитель, двое проиграли — в порядке рук', () => {
    const out = riverOutcome(sd(KK('a'), AA('b'), QQ('c')));
    expect(out).toEqual({ winners: ['b'], losers: ['a', 'c'] });
  });

  it('до ривера и сломанные карты — null', () => {
    const hands = [hand('a', 'As', 'Ah'), hand('b', 'Kd', 'Qd')];
    expect(riverOutcome({ hands, board: [] })).toBeNull();
    expect(riverOutcome({ hands, board: ['2c', '7h', '9s', 'Jc'] })).toBeNull();
    expect(riverOutcome({ hands, board: ['2c', '7h', '9s', 'Jc', 'zz'] })).toBeNull();
    expect(riverOutcome({ hands: hands.slice(0, 1), board: BOARD })).toBeNull();
  });

  it('riverRanking: группы равных рук от лучшей к худшей', () => {
    const s = sd(QQ('q'), KK('k1'), AA('a'), KK2('k2'), EE('e'));
    expect(riverRanking(s.hands, s.board)).toEqual([['a'], ['k1', 'k2'], ['q'], ['e']]);
  });
});

describe('riverBustSuggestion', () => {
  const showdown = sd(KK('a'), AA('b'), QQ('c'));

  it('проигравшие в игре — кандидаты, победитель — кто выбивает', () => {
    expect(riverBustSuggestion(showdown, () => true)).toEqual({
      victims: ['a', 'c'],
      killers: ['b'],
      out: [],
    });
  });

  it('уже вылетевшего (записали руками) не предлагает — он «вне игры»', () => {
    expect(riverBustSuggestion(showdown, (id) => id !== 'a')).toEqual({
      victims: ['c'],
      killers: ['b'],
      out: ['a'],
    });
    expect(riverBustSuggestion(showdown, (id) => id === 'b')).toBeNull();
  });

  it('до ривера — null', () => {
    expect(riverBustSuggestion({ ...showdown, board: ['2c', '7h', '9s'] }, () => true)).toBeNull();
  });

  it('вылет записан, затем ребай: второй раз в той же раздаче не предлагаем', () => {
    const j = journal();
    j.join('a', 'b', 'c');
    j.start();
    j.wait(5).showdown(
      '00000000-0000-4000-8000-000000000001',
      [
        ['a', 'As', 'Ah'],
        ['b', 'Kd', 'Qd'],
      ],
      BOARD,
    );
    const suggest = () => {
      const { state, applied } = replayLog(F, j.events, j.now());
      const s = state.showdown;
      if (!s) throw new Error('раздача закрыта');
      return riverBustSuggestion(s, (id) => Boolean(state.players[id]?.alive), applied);
    };
    expect(suggest()).toEqual({ victims: ['b'], killers: ['a'], out: [] });
    j.wait(0.3).bust('b', ['a']);
    expect(suggest()).toBeNull();
    j.wait(0.3).rebuy('b');
    expect(replay(F, j.events, j.now()).players.b?.alive).toBe(true);
    expect(suggest()).toBeNull();
    // Через 2 минуты табло раздачу прячет, но в состоянии она есть: предложение держится, пока
    // раздачу не закрыли (здесь его уже нет — вылет записан).
    j.wait(5);
    expect(replay(F, j.events, j.now()).showdown).not.toBeNull();
  });

  it('вылет, записанный до ривера (после открытия раздачи), — тоже уже в этой раздаче', () => {
    const j = journal();
    j.join('a', 'b', 'c');
    j.start();
    const id = '00000000-0000-4000-8000-000000000002';
    const hands: [string, string, string][] = [
      ['a', 'As', 'Ah'],
      ['b', 'Kd', 'Qd'],
      ['c', 'Tc', 'Td'],
    ];
    j.wait(5).showdown(id, hands, ['2c', '7h', '9s']);
    j.wait(0.2).bust('b', ['a']); // банкир записал вылет сразу, ещё до тёрна
    j.wait(0.2).rebuy('b');
    j.wait(0.2).showdown(id, hands, BOARD);
    const { state, applied } = replayLog(F, j.events, j.now());
    const s = state.showdown!;
    expect(riverBustSuggestion(s, (p) => Boolean(state.players[p]?.alive), applied)).toEqual({
      victims: ['c'],
      killers: ['a'],
      out: ['b'],
    });
    // Без журнала — как раньше: только «в игре».
    expect(riverBustSuggestion(s, (p) => Boolean(state.players[p]?.alive))).toEqual({
      victims: ['b', 'c'],
      killers: ['a'],
      out: [],
    });
    expect(bustedInHand(applied, s.openedEventId)).toEqual(new Set(['b']));
    expect(bustedInHand(applied, s.eventId)).toEqual(new Set());
  });
});

describe('кто выбил: 2, 3 и 4 руки, делёж и побочные банки', () => {
  it('2 руки: выбивает победитель, выбора нет', () => {
    expect(groups(sd(AA('a'), KK('b')), ['b'])).toEqual({ b: [['a']] });
  });

  it('один проигравший при дележе: нокаут каждому из делящих (как прежде)', () => {
    expect(groups(sd(KK('k1'), KK2('k2'), QQ('q')), ['q'])).toEqual({ q: [['k1', 'k2']] });
  });

  it('3 руки, вылетели оба проигравших: лучшая рука покрывала обоих', () => {
    // a > b > c. b вылетел — a длиннее b; c вылетел: если b длиннее c, то a — тем более.
    expect(groups(sd(AA('a'), KK('b'), QQ('c')), ['b', 'c'])).toEqual({
      b: [['a']],
      c: [['a']],
    });
  });

  it('3 руки, второй остался в игре: возможен побочный банк — выбивает a или b', () => {
    // b остался — a короче b (a забрал основной банк). c мог быть короче a (выбил a) или длиннее
    // (основной банк — a, побочный между b и c — b): выбирает банкир, по умолчанию a.
    expect(groups(sd(AA('a'), KK('b'), QQ('c')), ['c'])).toEqual({ c: [['a'], ['b']] });
  });

  it('3 руки, худший остался в игре: второй выбит лучшей рукой', () => {
    expect(groups(sd(AA('a'), KK('b'), QQ('c')), ['b'])).toEqual({ b: [['a']] });
  });

  it('4 руки, вылетели все трое: лучшая рука покрывала каждого', () => {
    expect(groups(sd(AA('a'), KK('b'), QQ('c'), TT('d')), ['b', 'c', 'd'])).toEqual({
      b: [['a']],
      c: [['a']],
      d: [['a']],
    });
  });

  it('4 руки, второй остался: третьего и четвёртого — a или b', () => {
    expect(groups(sd(AA('a'), KK('b'), QQ('c'), TT('d')), ['c', 'd'])).toEqual({
      c: [['a'], ['b']],
      d: [['a'], ['b']],
    });
  });

  it('4 руки, третий остался: четвёртого — a или c, но не b (b вылетел, его покрывал a)', () => {
    expect(groups(sd(AA('a'), KK('b'), QQ('c'), TT('d')), ['b', 'd'])).toEqual({
      b: [['a']],
      d: [['a'], ['c']],
    });
  });

  it('4 руки, остались второй и третий: четвёртого мог выбить любой из них', () => {
    expect(groups(sd(AA('a'), KK('b'), QQ('c'), TT('d')), ['d'])).toEqual({
      d: [['a'], ['b'], ['c']],
    });
  });

  it('побочный банк с дележом: вариант — пара равных рук, нокаут каждому', () => {
    // a — тузы, k1 и k2 — равные короли, остались в игре; e вылетел.
    expect(groups(sd(AA('a'), KK('k1'), KK2('k2'), EE('e')), ['e'])).toEqual({
      e: [['a'], ['k1', 'k2']],
    });
  });

  it('совпадает с прямым счётом банков по всем порядкам стеков (300 случайных раздач)', () => {
    const rnd = prng(20261009);
    const deck = [...CARD_RANKS].flatMap((r) => [...CARD_SUITS].map((s) => r + s));
    for (let t = 0; t < 300; t += 1) {
      const n = 2 + Math.floor(rnd() * 5); // 2–6 рук
      const cards = [...deck].sort(() => rnd() - 0.5);
      const hands = Array.from({ length: n }, (_, i) =>
        hand(`p${i}`, cards[2 * i] as CardCode, cards[2 * i + 1] as CardCode),
      );
      const s: RiverHand = { hands, board: cards.slice(2 * n, 2 * n + 5) as CardCode[] };
      const ranking = riverRanking(s.hands, s.board)!;
      const groupOf = new Map<PlayerId, number>();
      ranking.forEach((g, i) => g.forEach((id) => groupOf.set(id, i)));
      // Все порядки стеков (стеки разные): кто вылетел и какая группа рук забрала последние фишки.
      const seen = new Map<string, Map<PlayerId, Set<number>>>();
      for (const order of permutations(hands.map((h) => h.playerId))) {
        const stack = new Map(order.map((id, i) => [id, i + 1]));
        const busted: PlayerId[] = [];
        const killer = new Map<PlayerId, number>();
        for (const h of hands) {
          const me = h.playerId;
          const covering = hands.filter(
            (o) => o.playerId !== me && stack.get(o.playerId)! > stack.get(me)!,
          );
          const best = Math.min(...covering.map((o) => groupOf.get(o.playerId)!));
          if (covering.length > 0 && best < groupOf.get(me)!) {
            busted.push(me);
            killer.set(me, best);
          }
        }
        const key = busted.join(',');
        const byVictim = seen.get(key) ?? new Map<PlayerId, Set<number>>();
        for (const [victim, g] of killer) {
          const set = byVictim.get(victim) ?? new Set<number>();
          set.add(g);
          byVictim.set(victim, set);
        }
        seen.set(key, byVictim);
      }
      for (const [key, byVictim] of seen) {
        const busted = key === '' ? [] : key.split(',');
        const got = riverKillerGroups(s, busted)!;
        expect([...got.keys()].sort()).toEqual([...byVictim.keys()].sort());
        for (const [victim, options] of got) {
          const expected = [...(byVictim.get(victim) ?? [])].sort((x, y) => x - y);
          expect(options).toEqual(expected.map((g) => ranking[g]));
        }
      }
    }
  });
});

function* permutations<T>(items: readonly T[]): Generator<T[]> {
  if (items.length <= 1) {
    yield [...items];
    return;
  }
  for (const [i, x] of items.entries()) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) yield [x, ...p];
  }
}

describe('riverBustKillers: отмеченные вылетевшие и кто в игре', () => {
  const s = sd(AA('a'), KK('b'), QQ('c'), TT('d'));

  it('отмечены все — выбор не нужен; сняли отметку — у остальных появляется выбор', () => {
    const suggestion = riverBustSuggestion(s, () => true)!;
    expect(riverBustKillers(s, suggestion, ['b', 'c', 'd'], () => true)).toEqual({
      b: [['a']],
      c: [['a']],
      d: [['a']],
    });
    expect(riverBustKillers(s, suggestion, ['c', 'd'], () => true)).toEqual({
      c: [['a'], ['b']],
      d: [['a'], ['b']],
    });
  });

  it('вылетевший раньше в этой раздаче — тоже «стека не хватило»', () => {
    // b уже вне игры: значит, a покрывал b; c и d — снова только a.
    const suggestion = riverBustSuggestion(s, (id) => id !== 'b')!;
    expect(suggestion.out).toEqual(['b']);
    expect(riverBustKillers(s, suggestion, ['c', 'd'], (id) => id !== 'b')).toEqual({
      c: [['a']],
      d: [['a']],
    });
  });

  it('выбить некому (сильнейшие вне игры) — пустой вариант: нокаут никому', () => {
    expect(
      riverBustKillers(sd(AA('a'), KK('b')), { killers: [], out: [] }, ['b'], (id) => id !== 'a'),
    ).toEqual({ b: [[]] });
  });
});

describe('вылеты одной раздачи: порядок мест и нокауты', () => {
  /** Четверо: Лёша (d) вылетел раньше, затем олл-ин a, b, c: b выигрывает, a и c вылетают. */
  function evening() {
    const j = journal();
    j.join('a', 'b', 'c', 'd');
    j.start();
    j.wait(10).bust('d', ['b']);
    j.wait(5);
    return j;
  }

  it('записи — от меньшего стека к большему: у кого больше фишек, тот выше', () => {
    const drafts = riverBustDrafts(['c', 'a'], { a: ['b'], c: ['b'] });
    expect(drafts).toEqual([
      { type: 'bust', payload: { playerId: 'a', by: ['b'] } },
      { type: 'bust', payload: { playerId: 'c', by: ['b'] } },
    ]);
    const j = evening();
    expect(canApplySequence(F, j.events, drafts, j.now())).toBeNull();
    for (const d of drafts) j.add(d.type, d.payload);
    j.finish();
    const state = replay(F, j.events, j.now());
    expect(state.errors).toEqual([]);
    expect(state.places).toEqual(['b', 'c', 'a', 'd']);
    expect(state.players.b?.kos).toBe(3);
    const money = computeMoney(F, state);
    const prizes = Object.values(money).reduce((sum, m) => sum + m.prizeRub, 0);
    const owes = Object.values(money).reduce((sum, m) => sum + m.owesRub, 0);
    expect(prizes).toBe(owes);
    expect(money.c?.prizeRub).toBeGreaterThan(0);
  });

  it('обратный порядок по фишкам меняет места местами', () => {
    const j = evening();
    for (const d of riverBustDrafts(['a', 'c'], { a: ['b'], c: ['b'] })) j.add(d.type, d.payload);
    j.finish();
    expect(replay(F, j.events, j.now()).places).toEqual(['b', 'a', 'c', 'd']);
  });

  it('побочный банк: у каждого вылетевшего свой выбивший — нокауты по ним', () => {
    // Пятеро: a, b, c, d в олл-ине (a > b > c > d по рукам), e сидит. b остался в игре (a короче),
    // c выбил a (c был короче a), d — b (побочный банк).
    const j = journal();
    j.join('a', 'b', 'c', 'd', 'e');
    j.start();
    j.wait(5);
    const drafts = riverBustDrafts(['c', 'd'], { c: ['a'], d: ['b'] });
    expect(canApplySequence(F, j.events, drafts, j.now())).toBeNull();
    for (const d of drafts) j.add(d.type, d.payload);
    const state = replay(F, j.events, j.now());
    expect(state.errors).toEqual([]);
    expect(state.players.a?.kos).toBe(1);
    expect(state.players.a?.koVictims).toEqual(['c']);
    expect(state.players.b?.kos).toBe(1);
    expect(state.players.b?.koVictims).toEqual(['d']);
    expect(state.players.b?.alive).toBe(true);
  });

  it('делёж банка: нокаут каждому делящему', () => {
    const j = evening();
    for (const d of riverBustDrafts(['a'], { a: ['b', 'c'] })) j.add(d.type, d.payload);
    const state = replay(F, j.events, j.now());
    expect(state.players.b?.kos).toBe(2);
    expect(state.players.c?.kos).toBe(1);
    expect(state.errors).toEqual([]);
  });

  it('одно действие = те же записи по одной: replay совпадает (100 случайных раздач)', () => {
    const rnd = prng(20261008);
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (let n = 0; n < 100; n += 1) {
      const j = journal();
      j.join(...ids);
      j.start();
      const minutes = 1 + Math.floor(rnd() * 30);
      j.wait(minutes);
      const shuffled = [...ids].sort(() => rnd() - 0.5);
      const winner = shuffled[0] as string;
      const victims = shuffled.slice(1, 2 + Math.floor(rnd() * 3));
      const killers = Object.fromEntries(victims.map((v) => [v, [winner]]));
      const drafts = riverBustDrafts(victims, killers);
      expect(canApplySequence(F, j.events, drafts, j.now())).toBeNull();
      const batch = journal();
      batch.join(...ids);
      batch.start();
      batch.wait(minutes);
      for (const d of drafts) j.add(d.type, d.payload);
      for (const victim of [...victims].reverse()) batch.bust(victim, [winner]);
      const a = replayLog(F, j.events, j.now());
      const b = replayLog(F, batch.events, batch.now());
      expect(a.state).toEqual(b.state);
      const finals = victims.map((id) => a.state.players[id]?.finalBustEventId ?? 0);
      expect([...finals].sort((x, y) => y - x)).toEqual(finals);
      for (const id of ids) if (a.state.players[id]?.alive && id !== winner) j.bust(id, [winner]);
      j.finish();
      const done = replay(F, j.events, j.now());
      expect(done.errors).toEqual([]);
      expect(done.places[0]).toBe(winner);
      const money = computeMoney(F, done);
      const prizes = Object.values(money).reduce((sum, m) => sum + m.prizeRub, 0);
      const owes = Object.values(money).reduce((sum, m) => sum + m.owesRub, 0);
      expect(prizes).toBe(owes);
    }
  });
});
