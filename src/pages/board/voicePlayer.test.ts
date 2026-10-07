import { describe, expect, it } from 'vitest';
import { base64Bytes, isVoiceToggleGesture, VOICE_TOGGLE_SELECTOR } from './voicePlayer';

/** Элемент без DOM: closest находит предка по селектору (здесь — только кнопку голоса). */
function element(insideToggle: boolean): EventTarget {
  const el = {
    closest(selector: string) {
      return insideToggle && selector === VOICE_TOGGLE_SELECTOR ? {} : null;
    },
  };
  return el as unknown as EventTarget;
}

describe('голос табло: жест в кнопку голоса', () => {
  it('нажатие на кнопку голоса (или её подпись) общий обработчик пропускает', () => {
    expect(isVoiceToggleGesture(element(true))).toBe(true);
  });

  it('любое другое нажатие — будит звук', () => {
    expect(isVoiceToggleGesture(element(false))).toBe(false);
    // keydown без фокуса приходит в document/body, у window нет closest.
    expect(isVoiceToggleGesture({} as EventTarget)).toBe(false);
    expect(isVoiceToggleGesture(null)).toBe(false);
  });
});

describe('голос табло: base64 клипа', () => {
  it('байты как есть, переводы строк игнорируются', () => {
    expect([...base64Bytes('AAEC/w==')]).toEqual([0, 1, 2, 255]);
    expect([...base64Bytes('AAEC\n/w==')]).toEqual([0, 1, 2, 255]);
  });
});
