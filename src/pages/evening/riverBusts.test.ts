// Олл-ин после ривера: итог раздачи, предложение вылета и порядок мест для вылетов одной раздачи.
// Места и деньги считает домен — здесь проверяется, что записи пульта дают те места, которые
// банкир задал порядком по фишкам, а инвариант «призовые = взносы» и replay не страдают.
import { DEFAULT_FORMAT } from '@domain/format.ts';
import { computeMoney } from '@domain/money.ts';
import { canApplySequence, replay, replayLog } from '@domain/replay.ts';
import { journal, prng } from '@domain/test-utils.ts';
import type { ShowdownHand } from '@domain/types.ts';
import { describe, expect, it } from 'vitest';
import {
  bustedInHand,
  keepChipOrder,
  moveUp,
  riverBustDrafts,
  riverBustLabel,
  riverBustQuestion,
  riverBustSuggestion,
  riverKillersText,
  riverOutcome,
} from './riverBusts';

const F = DEFAULT_FORMAT;
const hand = (playerId: string, a: string, b: string): ShowdownHand => ({
  playerId,
  cards: [a, b],
});

describe('riverOutcome: кто выиграл раздачу на ривере', () => {
  it('хедз-ап: пара тузов против короля-дамы', () => {
    const out = riverOutcome({
      hands: [hand('a', 'As', 'Ah'), hand('b', 'Kd', 'Qd')],
      board: ['2c', '7h', '9s', 'Jc', '3d'],
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
    const out = riverOutcome({
      hands: [hand('a', 'Kc', 'Kd'), hand('b', 'Ac', 'Ad'), hand('c', 'Qs', 'Qh')],
      board: ['2c', '7h', '9s', 'Jc', '3d'],
    });
    expect(out).toEqual({ winners: ['b'], losers: ['a', 'c'] });
  });

  it('до ривера и сломанные карты — null', () => {
    const hands = [hand('a', 'As', 'Ah'), hand('b', 'Kd', 'Qd')];
    expect(riverOutcome({ hands, board: [] })).toBeNull();
    expect(riverOutcome({ hands, board: ['2c', '7h', '9s', 'Jc'] })).toBeNull();
    expect(riverOutcome({ hands, board: ['2c', '7h', '9s', 'Jc', 'zz'] })).toBeNull();
    expect(
      riverOutcome({ hands: hands.slice(0, 1), board: ['2c', '7h', '9s', 'Jc', '3d'] }),
    ).toBeNull();
  });
});

describe('riverBustSuggestion', () => {
  const showdown = {
    hands: [hand('a', 'Kc', 'Kd'), hand('b', 'Ac', 'Ad'), hand('c', 'Qs', 'Qh')],
    board: ['2c', '7h', '9s', 'Jc', '3d'],
  };

  it('проигравшие в игре — кандидаты, победитель — кто выбивает', () => {
    expect(riverBustSuggestion(showdown, () => true)).toEqual({
      victims: ['a', 'c'],
      killers: ['b'],
    });
  });

  it('уже вылетевшего (записали руками) не предлагает', () => {
    expect(riverBustSuggestion(showdown, (id) => id !== 'a')).toEqual({
      victims: ['c'],
      killers: ['b'],
    });
    expect(riverBustSuggestion(showdown, (id) => id === 'b')).toBeNull();
  });

  it('до ривера — null', () => {
    expect(riverBustSuggestion({ ...showdown, board: ['2c', '7h', '9s'] }, () => true)).toBeNull();
  });

  it('вылет записан, затем ребай: второй раз в той же раздаче не предлагаем', () => {
    // Ривер висит ещё 2 минуты: «Записать вылет: b» → «Ребай» из тоста → b снова в игре.
    const j = journal();
    j.join('a', 'b', 'c');
    j.start();
    j.wait(5).showdown(
      '00000000-0000-4000-8000-000000000001',
      [
        ['a', 'As', 'Ah'],
        ['b', 'Kd', 'Qd'],
      ],
      ['2c', '7h', '9s', 'Jc', '3d'],
    );
    const suggest = () => {
      const { state, applied } = replayLog(F, j.events, j.now());
      const sd = state.showdown;
      if (!sd) throw new Error('раздача закрыта');
      return riverBustSuggestion(sd, (id) => Boolean(state.players[id]?.alive), applied);
    };
    expect(suggest()).toEqual({ victims: ['b'], killers: ['a'] });
    j.wait(0.3).bust('b', ['a']);
    expect(suggest()).toBeNull();
    j.wait(0.3).rebuy('b');
    expect(replay(F, j.events, j.now()).players.b?.alive).toBe(true);
    expect(suggest()).toBeNull();
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
    j.wait(0.2).showdown(id, hands, ['2c', '7h', '9s', 'Jc', '3d']);
    const { state, applied } = replayLog(F, j.events, j.now());
    const sd = state.showdown!;
    expect(riverBustSuggestion(sd, (p) => Boolean(state.players[p]?.alive), applied)).toEqual({
      victims: ['c'],
      killers: ['a'],
    });
    // Без журнала — как раньше: только «в игре».
    expect(riverBustSuggestion(sd, (p) => Boolean(state.players[p]?.alive))).toEqual({
      victims: ['b', 'c'],
      killers: ['a'],
    });
    // Вылет до открытия раздачи (другая раздача) не в счёт.
    expect(bustedInHand(applied, sd.openedEventId)).toEqual(new Set(['b']));
    expect(bustedInHand(applied, sd.eventId)).toEqual(new Set());
  });
});

describe('вылеты одной раздачи: порядок мест по фишкам', () => {
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
    // У c фишек больше, чем у a: c — 2-е место, a — 3-е.
    const drafts = riverBustDrafts(['c', 'a'], ['b']);
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
    // Деньги — домен: призовые ровно равны взносам.
    const money = computeMoney(F, state);
    const prizes = Object.values(money).reduce((s, m) => s + m.prizeRub, 0);
    const owes = Object.values(money).reduce((s, m) => s + m.owesRub, 0);
    expect(prizes).toBe(owes);
    expect(money.c?.prizeRub).toBeGreaterThan(0);
  });

  it('обратный порядок по фишкам меняет места местами', () => {
    const j = evening();
    for (const d of riverBustDrafts(['a', 'c'], ['b'])) j.add(d.type, d.payload);
    j.finish();
    expect(replay(F, j.events, j.now()).places).toEqual(['b', 'a', 'c', 'd']);
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
      // Случайный олл-ин: победитель и 1–3 вылетевших в случайном порядке по фишкам.
      const shuffled = [...ids].sort(() => rnd() - 0.5);
      const winner = shuffled[0] as string;
      const victims = shuffled.slice(1, 2 + Math.floor(rnd() * 3));
      const drafts = riverBustDrafts(victims, [winner]);
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
      // Вылетевшие — в обратном порядке по фишкам: последний записанный — у кого фишек больше.
      const finals = victims.map((id) => a.state.players[id]?.finalBustEventId ?? 0);
      expect([...finals].sort((x, y) => y - x)).toEqual(finals);
      // Доигрываем до победителя: инвариант денег — у завершённого вечера.
      for (const id of ids) if (a.state.players[id]?.alive && id !== winner) j.bust(id, [winner]);
      j.finish();
      const done = replay(F, j.events, j.now());
      expect(done.errors).toEqual([]);
      expect(done.places[0]).toBe(winner);
      const money = computeMoney(F, done);
      const prizes = Object.values(money).reduce((s, m) => s + m.prizeRub, 0);
      const owes = Object.values(money).reduce((s, m) => s + m.owesRub, 0);
      expect(prizes).toBe(owes);
    }
  });

  it('делёж банка: нокаут каждому победителю', () => {
    const j = evening();
    for (const d of riverBustDrafts(['a'], ['b', 'c'])) j.add(d.type, d.payload);
    const state = replay(F, j.events, j.now());
    expect(state.players.b?.kos).toBe(2);
    expect(state.players.c?.kos).toBe(1);
    expect(state.errors).toEqual([]);
  });
});

describe('порядок по фишкам в шторке', () => {
  it('keepChipOrder: прежние на месте, новые — в конец, снятые уходят', () => {
    expect(keepChipOrder(['a', 'c'], ['c', 'a'])).toEqual(['a', 'c']);
    expect(keepChipOrder(['a', 'c'], ['c', 'b'])).toEqual(['c', 'b']);
    expect(keepChipOrder([], ['b', 'a'])).toEqual(['b', 'a']);
  });

  it('moveUp: на строку выше, первый остаётся первым', () => {
    expect(moveUp(['a', 'b', 'c'], 'c')).toEqual(['a', 'c', 'b']);
    expect(moveUp(['a', 'b', 'c'], 'a')).toEqual(['a', 'b', 'c']);
    expect(moveUp(['a', 'b'], 'x')).toEqual(['a', 'b']);
  });
});

describe('тексты предложения', () => {
  it('кнопка и кто выбивает', () => {
    expect(riverBustLabel([])).toBe('Отметь, кто вылетел');
    expect(riverBustLabel(['Дима'])).toBe('Записать вылет: Дима');
    expect(riverBustLabel(['Дима', 'Лёша'])).toBe('Записать вылеты: 2');
    expect(riverKillersText(['Женя'])).toBe('выбивает Женя');
    expect(riverKillersText(['Женя', 'Саша'])).toBe('выбивают Женя и Саша — нокаут каждому');
    expect(riverKillersText([])).toBe('кто выбил — не указано');
  });

  it('вопрос: один вылет и вылеты с порядком мест', () => {
    expect(riverBustQuestion(['Дима'], ['Женя'])).toEqual({
      title: 'Записать вылет: Дима?',
      message:
        'Дима — вылет, выбивает Женя. Фишек хватило и игрок остаётся за столом — нажми «Не записывать».',
      confirmText: 'Записать вылет',
    });
    const many = riverBustQuestion(['Лёша', 'Дима'], ['Женя']);
    expect(many.title).toBe('Записать вылеты: 2?');
    expect(many.message).toBe(
      'Вылет — Лёша и Дима, выбивает Женя. Места по фишкам перед раздачей, выше — у кого больше: 1. Лёша, 2. Дима.',
    );
  });
});
