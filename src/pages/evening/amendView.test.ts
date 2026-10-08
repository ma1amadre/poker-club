// Шторка «Изменить запись»: кого предложить выбившим, что изменилось, текст тоста. Правку
// применяет домен (amend.ts) — здесь проверяется, что предложенные выбившие проходят его canAmend.
import { amendImpact, canAmend, currentAmendValue } from '@domain/amend.ts';
import { DEFAULT_FORMAT } from '@domain/format.ts';
import { computeMoney } from '@domain/money.ts';
import { replay } from '@domain/replay.ts';
import { journal } from '@domain/test-utils.ts';
import { describe, expect, it } from 'vitest';
import { amendChanged, amendImpactText, amendKillerCandidates, amendToast } from './amendView';

const F = DEFAULT_FORMAT;
const names: Record<string, string> = { a: 'Женя', b: 'Саша', c: 'Дима', d: 'Лёша' };
const nameOf = (id: string) => names[id] ?? '?';
const rub = (n: number) => `${n} ₽`;

describe('amendKillerCandidates', () => {
  it('в игре перед вылетом, без жертвы; кто вылетел раньше — не предлагается', () => {
    const j = journal();
    j.join('a', 'b', 'c', 'd');
    j.start();
    j.wait(5).bust('d', ['a']);
    const bustC = j.wait(5).bust('c', ['a']);
    // Позже: Лёша докупился — для вылета Димы это не важно, тогда Лёши в игре не было.
    j.wait(1).rebuy('d');
    const cand = amendKillerCandidates(F, j.events, bustC, ['a'], j.now());
    expect(cand).toEqual({ ids: ['a', 'b'], out: [] });
    // Предложенные проходят правило домена: Саша — правка, Женя — то же, что в записи.
    expect(canAmend(F, j.events, { eventId: bustC, by: ['b'] }, j.now())).toBeNull();
    expect(canAmend(F, j.events, { eventId: bustC, by: ['a', 'b'] }, j.now())).toBeNull();
    expect(canAmend(F, j.events, { eventId: bustC, by: ['a'] }, j.now())).toBe(
      'Правка ничего не меняет',
    );
    // Выбывший к тому моменту — отказ домена, поэтому его в списке и нет.
    expect(canAmend(F, j.events, { eventId: bustC, by: ['d'] }, j.now())).not.toBeNull();
  });

  it('отмеченный вне игры (запись «Не принято») — в конце списка, чтобы его снять', () => {
    const j = journal();
    j.join('a', 'b', 'c');
    j.start();
    j.wait(5).bust('b', ['a']);
    const bad = j.wait(1).bust('c', ['b']); // b уже вне игры — журнал не принял
    expect(replay(F, j.events, j.now()).errors.map((e) => e.eventId)).toEqual([bad]);
    const cand = amendKillerCandidates(F, j.events, bad, ['b'], j.now());
    expect(cand).toEqual({ ids: ['a', 'b'], out: ['b'] });
    // Правка на того, кто был в игре, чинит запись: вылет принят, места и деньги — домен.
    j.amend(bad, { by: ['a'] });
    j.finish();
    const s = replay(F, j.events, j.now());
    expect(s.errors).toEqual([]);
    expect(s.places).toEqual(['a', 'c', 'b']);
    const money = computeMoney(F, s);
    const sum = (k: 'prizeRub' | 'owesRub') =>
      Object.values(money).reduce((acc, m) => acc + m[k], 0);
    expect(sum('prizeRub')).toBe(sum('owesRub'));
  });
});

describe('amendKillerCandidates: поправки к более ранним записям', () => {
  it('поправка, записанная позже, но к записи раньше, — тоже «журнал до неё»', () => {
    // Вылет Димы (выбил Саша) не принят: Саша уже вне игры. Позже его починили правкой — Дима
    // выбыл на своём месте. При правке вылета Лёши Дима не в игре, и предлагать его нельзя.
    const j = journal();
    j.join('a', 'b', 'c', 'd');
    j.start();
    j.wait(5).bust('b', ['a']);
    const bustC = j.wait(1).bust('c', ['b']);
    const bustD = j.wait(5).bust('d', ['a']);
    expect(canAmend(F, j.events, { eventId: bustC, by: ['a'] }, j.now())).toBeNull();
    j.wait(1).amend(bustC, { by: ['a'] });
    const cand = amendKillerCandidates(F, j.events, bustD, ['a'], j.now());
    expect(cand).toEqual({ ids: ['a'], out: [] });
    // Всё, что предложено, домен принимает (или это то же значение); Дима — отказ.
    expect(canAmend(F, j.events, { eventId: bustD, by: [] }, j.now())).toBeNull();
    expect(canAmend(F, j.events, { eventId: bustD, by: ['c'] }, j.now())).toBe(
      'Правка не подходит: выбить может только игрок, который сейчас в игре',
    );
  });

  it('поправка к этой или более поздней записи в «журнал до неё» не входит', () => {
    const j = journal();
    j.join('a', 'b', 'c');
    j.start();
    const bustC = j.wait(5).bust('c', ['a']);
    const bustB = j.wait(5).bust('b', ['a']);
    j.amend(bustB, { by: [] });
    j.amend(bustC, { by: ['b'] });
    expect(amendKillerCandidates(F, j.events, bustC, ['b'], j.now())).toEqual({
      ids: ['a', 'b'],
      out: [],
    });
  });
});

describe('amendImpactText: почему правка задела бы другие записи', () => {
  const label = (ev: { id: number }) => `#${ev.id}`;

  it('записи перестанут приниматься и вечер перестанет быть завершённым', () => {
    const j = journal();
    j.join('a', 'b', 'c', 'd');
    j.start();
    j.wait(5).bust('d', ['c']);
    const rebuyD = j.wait(1).rebuy('d');
    const bustA = j.wait(5).bust('a', ['d']);
    j.voidEvent(rebuyD);
    const bustB = j.wait(5).bust('b', ['a']);
    const bustA2 = j.wait(5).bust('a', ['c']);
    j.wait(1).finish();
    const impact = amendImpact(F, j.events, { eventId: bustA, by: [] }, j.now());
    expect(amendImpactText(impact, j.events, label)).toBe(
      `Журнал перестанет принимать записи: #${bustB} (выбить может только игрок, который сейчас в игре); #${bustA2} (игрок уже выбыл). Вечер перестанет быть завершённым. Правка исправляет только саму запись: отмени её и, если нужно, запиши заново.`,
    );
  });

  it('вступит в силу ребай вслед за вылетом; без последствий — пусто', () => {
    const j = journal();
    j.join('a', 'b', 'c');
    j.start();
    j.wait(5).bust('c', ['a']);
    const bustB = j.wait(5).bust('b', ['c']);
    const rebuyB = j.rebuy('b');
    const impact = amendImpact(F, j.events, { eventId: bustB, by: ['a'] }, j.now());
    expect(amendImpactText(impact, j.events, label)).toBe(
      `Вступит в силу запись, которую журнал сейчас не принимает: #${rebuyB}. Правка исправляет только саму запись: отмени её и, если нужно, запиши заново.`,
    );
    j.voidEvent(rebuyB);
    const none = amendImpact(F, j.events, { eventId: bustB, by: ['a'] }, j.now());
    expect(amendImpactText(none, j.events, label)).toBe('');
  });
});

describe('amendChanged', () => {
  it('кратность и набор выбивших (порядок не важен)', () => {
    expect(amendChanged({ stacks: 1 }, { stacks: 1 })).toBe(false);
    expect(amendChanged({ stacks: 1 }, { stacks: 2 })).toBe(true);
    expect(amendChanged({ by: ['a', 'b'] }, { by: ['b', 'a'] })).toBe(false);
    expect(amendChanged({ by: ['a'] }, { by: [] })).toBe(true);
    expect(amendChanged(null, { by: [] })).toBe(false);
  });

  it('значение в силе — с правкой: повтор той же правки ничего не меняет', () => {
    const j = journal();
    const join = j.add('join', { playerId: 'a' });
    j.join('b');
    j.amend(join, { stacks: 3 });
    const now = currentAmendValue(F, j.events, join, j.now());
    expect(now).toEqual({ stacks: 3 });
    expect(amendChanged(now, { stacks: 3 })).toBe(false);
    expect(amendChanged(now, { stacks: 1 })).toBe(true);
  });
});

describe('amendToast: тост после правки', () => {
  const ev = (type: 'join' | 'rebuy' | 'bust', playerId = 'd') => ({
    id: 1,
    type,
    payload: { playerId },
    at: '2026-10-08T16:00:00.000Z',
    voided: false,
  });

  it('вылет: кто выбил', () => {
    expect(amendToast(ev('bust'), { by: ['b'] }, nameOf, F, rub)).toEqual({
      title: 'Вылет исправлен: Лёша',
      detail: 'Выбивает Саша.',
    });
    expect(amendToast(ev('bust'), { by: ['b', 'c'] }, nameOf, F, rub).detail).toBe(
      'Выбивают Саша и Дима — нокаут каждому.',
    );
    expect(amendToast(ev('bust'), { by: [] }, nameOf, F, rub).detail).toBe(
      'Кто выбил — не указано.',
    );
  });

  it('вход и ребай: кратность и сумма', () => {
    expect(amendToast(ev('join', 'a'), { stacks: 2 }, nameOf, F, rub)).toEqual({
      title: 'Вход исправлен: Женя',
      detail: '×2 — 1000 ₽.',
    });
    expect(amendToast(ev('rebuy', 'a'), { stacks: 1 }, nameOf, F, rub).title).toBe(
      'Ребай исправлен: Женя',
    );
  });
});
