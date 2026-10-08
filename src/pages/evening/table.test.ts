// «Режим стола»: места не прыгают, ряд вылетевших, полоса часов, память вида пульта.
import { DEFAULT_FORMAT } from '@domain/format.ts';
import { replay } from '@domain/replay.ts';
import { journal, MIN } from '@domain/test-utils.ts';
import type { TournamentFormat } from '@domain/types.ts';
import { describe, expect, it } from 'vitest';
import { rebuyWindow } from './lib';
import { DEFAULT_PULT_VIEW, PULT_VIEW_KEY, readPultView, writePultView } from './pultView';
import { bustedRow, rebuyShortText, seatTiles, stripStatus } from './table';

const F = DEFAULT_FORMAT;

describe('seatTiles: места за столом не прыгают', () => {
  it('вылет и ребай — игрок на своём месте, опоздавший — в конце', () => {
    const j = journal();
    j.join('a', 'b', 'c', 'd');
    j.start();
    const order = (s: ReturnType<typeof replay>) => seatTiles(s).map((t) => t.playerId);
    const s0 = replay(F, j.events, j.now());
    expect(order(s0)).toEqual(['a', 'b', 'c', 'd']);

    j.wait(5).bust('b', ['a']);
    const s1 = replay(F, j.events, j.now());
    expect(order(s1)).toEqual(['a', 'b', 'c', 'd']);
    expect(seatTiles(s1)[1]).toEqual({ playerId: 'b', alive: false, note: 'вне игры' });

    j.wait(1).rebuy('b');
    j.add('join', { playerId: 'e' });
    const s2 = replay(F, j.events, j.now());
    expect(order(s2)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(seatTiles(s2).every((t) => t.alive && t.note === null)).toBe(true);
  });

  it('место известно — в подписи место', () => {
    const j = journal();
    j.join('a', 'b', 'c');
    j.start();
    j.wait(5).bust('c', ['a']);
    j.wait(1).bust('b', ['a']);
    j.finish();
    const tiles = seatTiles(replay(F, j.events, j.now()));
    expect(tiles.map((t) => t.note)).toEqual([null, '2-е место', '3-е место']);
  });
});

describe('bustedRow: ряд вылетевших', () => {
  const limited: TournamentFormat = { ...F, rebuyLimit: 1 };

  it('свежий вылет первым; ребай — пока можно докупиться (лимит, окно ребаев)', () => {
    const j = journal();
    j.join('a', 'b', 'c', 'd');
    j.start();
    j.wait(5).bust('b', ['a']);
    j.wait(1).rebuy('b');
    j.wait(1).bust('b', ['a']);
    j.wait(1).bust('c', ['a']);
    const s = replay(limited, j.events, j.now());
    expect(bustedRow(limited, s, j.now())).toEqual([
      { playerId: 'c', rebuy: true, note: 'ребай' },
      { playerId: 'b', rebuy: false, note: 'вне игры' },
    ]);
  });

  it('ребаи закрыты — места по порядку', () => {
    const j = journal();
    j.join('a', 'b', 'c', 'd');
    j.start();
    j.wait(5).bust('d', ['a']);
    j.wait(1).bust('c', ['a']);
    // Пять уровней по 40 минут — ребаи закрыты.
    j.wait(5 * 40);
    const s = replay(F, j.events, j.now());
    expect(s.rebuysOpen).toBe(false);
    expect(bustedRow(F, s, j.now())).toEqual([
      { playerId: 'c', rebuy: false, note: '3-е место' },
      { playerId: 'd', rebuy: false, note: '4-е место' },
    ]);
  });
});

describe('полоса часов', () => {
  it('rebuyShortText', () => {
    expect(rebuyShortText({ kind: 'closed' })).toBe('ребаи закрыты');
    expect(rebuyShortText({ kind: 'whole_game' })).toBe('ребаи всю игру');
    expect(rebuyShortText({ kind: 'not_started', untilLevel: 5 })).toBe(
      'ребаи до конца 5-го уровня',
    );
    expect(rebuyShortText({ kind: 'open', untilLevel: 5, msLeft: null })).toBe(
      'ребаи до конца 5-го уровня',
    );
    expect(rebuyShortText({ kind: 'open', untilLevel: 5, msLeft: 80 * MIN })).toBe(
      'ребаи ещё 1 ч 20 мин',
    );
  });

  it('stripStatus: не запущен, идёт, пауза, перерыв, пора продолжать', () => {
    const j = journal();
    j.join('a', 'b');
    expect(stripStatus(replay(F, j.events, j.now()), j.now()).mode).toBe('not_started');
    j.start();
    j.wait(3);
    expect(stripStatus(replay(F, j.events, j.now()), j.now())).toEqual({
      mode: 'running',
      word: null,
      line: null,
    });
    j.pause();
    j.wait(3);
    expect(stripStatus(replay(F, j.events, j.now()), j.now())).toEqual({
      mode: 'paused',
      word: 'Пауза',
      line: 'стоим 3 мин',
    });
    j.resume();
    j.pauseFor(10);
    j.wait(2);
    const brk = stripStatus(replay(F, j.events, j.now()), j.now());
    expect(brk).toEqual({ mode: 'break', word: 'Перерыв', line: 'продолжаем через 08:00' });
    j.wait(9);
    expect(stripStatus(replay(F, j.events, j.now()), j.now())).toEqual({
      mode: 'due',
      word: 'Перерыв',
      line: 'пора продолжать',
    });
  });

  it('строка ребаев из окна домена', () => {
    const j = journal();
    j.join('a', 'b');
    j.start();
    j.wait(10);
    const s = replay(F, j.events, j.now());
    // Уровни по 40 мин, ребаи до конца 5-го: 200 − 10 = 190 мин.
    expect(rebuyShortText(rebuyWindow(F, s))).toBe('ребаи ещё 3 ч 10 мин');
  });
});

describe('вид пульта помнит localStorage', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      m,
    };
  };

  it('по умолчанию — «Стол»; выбор сохраняется', () => {
    const s = memory();
    expect(readPultView(s)).toBe(DEFAULT_PULT_VIEW);
    expect(DEFAULT_PULT_VIEW).toBe('table');
    writePultView(s, 'details');
    expect(s.m.get(PULT_VIEW_KEY)).toBe('details');
    expect(readPultView(s)).toBe('details');
  });

  it('мусор в ключе, нет хранилища, хранилище бросает — «Стол» и без ошибок', () => {
    const s = memory();
    s.setItem(PULT_VIEW_KEY, 'grid');
    expect(readPultView(s)).toBe('table');
    expect(readPultView(null)).toBe('table');
    const broken = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(readPultView(broken)).toBe('table');
    expect(() => writePultView(broken, 'details')).not.toThrow();
    expect(() => writePultView(null, 'details')).not.toThrow();
  });
});
