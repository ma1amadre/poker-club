import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playBack, playEnter, type AllinEls } from './choreo';
import { Motion } from './motion';
import { emptyGameEls } from './stage';

/** Элемент без DOM: такты табло ставят только transform, opacity и visibility. */
function fakeEl(): HTMLElement {
  const style: Record<string, string> & { setProperty?: (k: string, v: string) => void } = {
    opacity: '',
    transform: '',
    visibility: '',
  };
  style.setProperty = (k: string, v: string) => {
    style[k] = v;
  };
  return { style } as unknown as HTMLElement;
}

describe('такты табло: вход в олл-ин и возврат к столу', () => {
  beforeEach(() => {
    vi.stubGlobal('getComputedStyle', (el: HTMLElement) => ({
      opacity: el.style.opacity === '' ? '1' : el.style.opacity,
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('возврат раньше, чем вход доиграл, — подпись уровня у часов не встаёт поверх стола', () => {
    const motion = new Motion({ calm: false });
    const els = emptyGameEls();
    els.clock = fakeEl();
    els.lvl = fakeEl();
    const ai: AllinEls = { ai: fakeEl(), inner: fakeEl(), wipe: fakeEl(), level: fakeEl() };
    const cancel = playEnter(motion, els, ai, () => {});
    // Раздача пропала через 100 мс (вкладка была спрятана, правка на грани «спрятать»).
    motion.tl.advance(100);
    cancel();
    playBack(motion, els, ai, () => {});
    motion.tl.advance(3000);
    expect(ai.level?.style.opacity).toBe('0');
    expect(els.lvl.style.opacity).toBe('1');
  });

  it('вход доиграл — подпись уровня у часов видна', () => {
    const motion = new Motion({ calm: false });
    const els = emptyGameEls();
    els.clock = fakeEl();
    els.lvl = fakeEl();
    const ai: AllinEls = { ai: fakeEl(), inner: fakeEl(), wipe: fakeEl(), level: fakeEl() };
    const done = vi.fn();
    playEnter(motion, els, ai, done);
    motion.tl.advance(1000);
    expect(ai.level?.style.opacity).toBe('1');
    expect(done).toHaveBeenCalledOnce();
  });
});
