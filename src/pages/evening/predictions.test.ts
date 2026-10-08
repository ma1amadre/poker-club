import { DEFAULT_FORMAT } from '@domain/format.ts';
import { replay } from '@domain/replay.ts';
import { journal } from '@domain/test-utils.ts';
import { describe, expect, it } from 'vitest';
import { NBSP } from '../../shared/lib/format';
import {
  candidateHint,
  type CandidatePlayer,
  oraclePointsText,
  predictionCandidates,
  predictionPickLine,
  predictionResults,
  predictionSummary,
  rsvpHint,
} from './predictions';

const player = (
  id: string,
  name: string,
  extra: Partial<CandidatePlayer> = {},
): CandidatePlayer => ({
  id,
  display_name: name,
  is_guest: false,
  is_active: true,
  ...extra,
});

describe('кандидаты в прогноз', () => {
  const players = [
    player('j', 'Женя'),
    player('s', 'Саша'),
    player('d', 'Дима'),
    player('m', 'Миша'),
    player('k', 'Костя'),
    player('old', 'Бывший', { is_active: false }),
    player('g1', 'Вова (гость)', { is_guest: true }),
    player('g2', 'Петя (гость)', { is_guest: true }),
  ];
  const rsvps = [
    { player_id: 's', status: 'yes' as const },
    { player_id: 'j', status: 'yes' as const },
    { player_id: 'd', status: 'maybe' as const },
    { player_id: 'm', status: 'no' as const },
    { player_id: 'g1', status: 'yes' as const },
  ];

  it('все активные; постоянные по ответу на анонс, за ними гости по имени', () => {
    const list = predictionCandidates(players, rsvps);
    expect(list.map((c) => c.player.id)).toEqual(['j', 's', 'd', 'k', 'm', 'g1', 'g2']);
    expect(list.find((c) => c.player.id === 'k')?.rsvp).toBeNull();
  });

  it('гость в прогнозе без ответа на анонс; отключённый — нет', () => {
    const list = predictionCandidates(players, []);
    expect(list.map((c) => c.player.id)).toEqual(['d', 'j', 'k', 'm', 's', 'g1', 'g2']);
    const off = predictionCandidates(
      [...players, player('g3', 'Ушедший гость', { is_guest: true, is_active: false })],
      [],
    );
    expect(off.map((c) => c.player.id)).not.toContain('g3');
  });

  it('подпись кандидата: гость — «гость», постоянный — ответ на анонс', () => {
    const list = predictionCandidates(players, rsvps);
    const hint = (id: string) => {
      const c = list.find((x) => x.player.id === id);
      return c ? candidateHint(c) : null;
    };
    expect(hint('g1')).toBe('гость');
    expect(hint('g2')).toBe('гость');
    expect(hint('j')).toBe('идёт');
    expect(hint('k')).toBe('без ответа');
  });

  it('подпись к кандидату по ответу на анонс', () => {
    expect(rsvpHint('yes')).toBe('идёт');
    expect(rsvpHint('maybe')).toBe('под вопросом');
    expect(rsvpHint('no')).toBe('не идёт');
    expect(rsvpHint(null)).toBe('без ответа');
  });

  it('игрок из сохранённого прогноза остаётся в списке, даже отключённый', () => {
    expect(predictionCandidates(players, rsvps).map((c) => c.player.id)).not.toContain('old');
    const list = predictionCandidates(players, rsvps, ['old', null]);
    expect(list.map((c) => c.player.id)).toContain('old');
  });

  it('болельщик (миграция 024): без «иду» / «под вопросом» и места за столом — не кандидат', () => {
    const fans = [
      ...players,
      player('f1', 'Аня', { is_spectator: true }),
      player('f2', 'Оля', { is_spectator: true }),
      player('f3', 'Таня', { is_spectator: true }),
      player('f4', 'Юля', { is_spectator: false }),
    ];
    const answers = [
      ...rsvps,
      { player_id: 'f2', status: 'maybe' as const },
      { player_id: 'f3', status: 'no' as const },
    ];
    const ids = (seated?: Set<string>, keep: string[] = []) =>
      predictionCandidates(fans, answers, keep, seated).map((c) => c.player.id);
    expect(ids()).toEqual(['j', 's', 'd', 'f2', 'k', 'f4', 'm', 'g1', 'g2']);
    // Посадили за стол — кандидат, как все, и без подписи «болельщик».
    expect(ids(new Set(['f1']))).toContain('f1');
    const seatedF1 = predictionCandidates(fans, answers, [], new Set(['f1'])).find(
      (c) => c.player.id === 'f1',
    );
    expect(seatedF1 && candidateHint(seatedF1)).toBe('без ответа');
    // Уже названный в прогнозе — остаётся с подписью «болельщик».
    const kept = predictionCandidates(fans, answers, ['f3']);
    const f3 = kept.find((c) => c.player.id === 'f3');
    expect(f3 && candidateHint(f3)).toBe('болельщик · не идёт');
    const f2 = kept.find((c) => c.player.id === 'f2');
    expect(f2 && candidateHint(f2)).toBe('под вопросом');
  });
});

describe('прогнозы вечера после финала', () => {
  const names: Record<string, string> = { a: 'Женя', b: 'Саша', c: 'Дима', d: 'Лёша', e: 'Миша' };
  const nameOf = (id: string) => names[id] ?? '?';

  // Первым вылетает c, побеждает a.
  const j = journal().join('a', 'b', 'c');
  j.start();
  j.wait(10).bust('c', ['a']);
  j.rebuy('c');
  j.wait(10).bust('b', ['a']);
  j.wait(10).bust('c', ['a']);
  j.finish();
  const outcome = replay(DEFAULT_FORMAT, j.events, j.now());

  const predictions = [
    { player_id: 'b', winner_id: 'a', first_out_id: 'b' }, // победитель: +3
    { player_id: 'd', winner_id: 'a', first_out_id: 'c' }, // оба: +5
    { player_id: 'e', winner_id: null, first_out_id: null }, // снятый — не показывается
    { player_id: 'c', winner_id: 'b', first_out_id: null }, // мимо: 0
    { player_id: 'a', winner_id: null, first_out_id: 'c' }, // первый вылет: +2
  ];

  it('очки — доменные: больше очков выше, при равенстве свой прогноз, дальше по имени', () => {
    const rows = predictionResults(predictions, outcome, nameOf, 'c');
    expect(rows.map((r) => [r.playerId, r.points, r.winnerHit, r.firstOutHit])).toEqual([
      ['d', 5, true, true],
      ['b', 3, true, false],
      ['a', 2, false, true],
      ['c', 0, false, false],
    ]);
    // Равные очки: свой прогноз выше чужого.
    const tie = [
      { player_id: 'b', winner_id: 'c', first_out_id: null },
      { player_id: 'e', winner_id: 'c', first_out_id: null },
    ];
    expect(predictionResults(tie, outcome, nameOf, 'e').map((r) => r.playerId)).toEqual(['e', 'b']);
    expect(predictionResults(tie, outcome, nameOf).map((r) => r.playerId)).toEqual(['e', 'b']); // Миша < Саша
  });

  it('первый вылет — первый bust вечера, даже если игрок потом сделал ребай', () => {
    expect(outcome.firstBustPlayerId).toBe('c');
    const rows = predictionResults(predictions, outcome, nameOf);
    expect(rows.find((r) => r.playerId === 'd')?.firstOutHit).toBe(true);
  });

  it('строка прогноза и очки: угаданное помечено очками, пустое поле — «не выбран»', () => {
    const rows = predictionResults(predictions, outcome, nameOf);
    const line = (id: string) => {
      const r = rows.find((x) => x.playerId === id);
      return r ? predictionPickLine(r, nameOf) : null;
    };
    expect(line('d')).toBe(`победитель — Женя${NBSP}(+3) · первый вылет — Дима${NBSP}(+2)`);
    expect(line('c')).toBe('победитель — Саша · первый вылет — не выбран');
    expect(line('a')).toBe(`победитель — не выбран · первый вылет — Дима${NBSP}(+2)`);
    expect(oraclePointsText(5)).toBe(`+5${NBSP}очков`);
    expect(oraclePointsText(3)).toBe(`+3${NBSP}очка`);
    expect(oraclePointsText(0)).toBe(`0${NBSP}очков`);
  });

  it('сводка: кто победил, кто вылетел первым и сколько прогнозов угадали', () => {
    const rows = predictionResults(predictions, outcome, nameOf);
    expect(predictionSummary(rows, outcome, nameOf)).toEqual({
      winner: 'Победитель — Женя: угадали 2 из 3',
      firstOut: 'Первый вылет — Дима: угадали 2 из 3',
    });
    const one = predictionResults(
      [{ player_id: 'd', winner_id: 'a', first_out_id: 'c' }],
      outcome,
      nameOf,
    );
    expect(predictionSummary(one, outcome, nameOf).winner).toBe('Победитель — Женя: угадал 1 из 1');
    const miss = predictionResults(
      [{ player_id: 'b', winner_id: 'c', first_out_id: 'a' }],
      outcome,
      nameOf,
    );
    expect(predictionSummary(miss, outcome, nameOf)).toEqual({
      winner: 'Победитель — Женя: никто не угадал',
      firstOut: 'Первый вылет — Дима: никто не угадал',
    });
  });

  it('вечер правят и победителя нет — так и написано, первый вылет уже известен', () => {
    const k = journal().join('a', 'b', 'c');
    k.start();
    k.bust('c', ['a']);
    const open = replay(DEFAULT_FORMAT, k.events, k.now());
    const rows = predictionResults(predictions, open, nameOf);
    expect(rows.every((r) => !r.winnerHit)).toBe(true);
    expect(predictionSummary(rows, open, nameOf)).toEqual({
      winner: 'Победитель ещё не определён',
      firstOut: 'Первый вылет — Дима: угадали 2 из 3',
    });
    const none = replay(DEFAULT_FORMAT, journal().join('a', 'b').events, 0);
    expect(predictionSummary([], none, nameOf).firstOut).toBe('Первого вылета не было');
  });
});
