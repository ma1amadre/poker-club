import { describe, expect, it } from 'vitest';
import { Motion, Timeline } from './motion';

describe('часы табло: очередь тактов', () => {
  it('такты — по сроку, при равном сроке — в порядке постановки', () => {
    const tl = new Timeline();
    const log: string[] = [];
    tl.at(200, () => log.push('b'));
    tl.at(100, () => log.push('a'));
    tl.at(200, () => log.push('c'));
    tl.advance(150);
    expect(log).toEqual(['a']);
    tl.advance(50);
    expect(log).toEqual(['a', 'b', 'c']);
    expect(tl.size).toBe(0);
  });

  it('такт может поставить такт с наступившим сроком — он выполняется в том же шаге', () => {
    const tl = new Timeline();
    const log: number[] = [];
    tl.at(10, () => {
      log.push(tl.now);
      tl.after(0, () => log.push(-1));
    });
    tl.advance(20);
    expect(log).toEqual([20, -1]);
  });

  it('снятый такт не выполняется', () => {
    const tl = new Timeline();
    const log: string[] = [];
    const id = tl.after(10, () => log.push('x'));
    tl.after(10, () => log.push('y'));
    tl.cancel(id);
    tl.advance(10);
    expect(log).toEqual(['y']);
  });

  it('jump прокручивает часы синхронно и останавливает кадр (снимок посреди момента)', () => {
    const m = new Motion({ calm: false });
    const log: number[] = [];
    m.after(560, () => log.push(m.now));
    m.after(1100, () => log.push(m.now));
    m.jump(700);
    expect(log).toEqual([560]);
    expect(m.isFrozen).toBe(true);
    m.jump(400);
    expect(log).toEqual([560, 1100]);
    expect(m.now).toBe(1100);
  });
});
