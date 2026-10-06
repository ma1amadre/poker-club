import { describe, expect, it } from 'vitest';
import { miniAppLink, startParamRoute } from './paths';

const ID = '0f0e0d0c-0000-4000-8000-000000000001';

describe('startParamRoute', () => {
  it('e_<id> → вечер, v_<id> → голосование, r → рейтинг', () => {
    expect(startParamRoute(`e_${ID}`)).toBe(`/evening/${ID}`);
    expect(startParamRoute(`v_${ID}`)).toBe(`/evening/${ID}/vote`);
    expect(startParamRoute('r')).toBe('/rating');
  });

  it('мусор и не-uuid игнорирует — путь из ссылки не собирается из произвольной строки', () => {
    expect(startParamRoute(null)).toBeNull();
    expect(startParamRoute('')).toBeNull();
    expect(startParamRoute('x_123')).toBeNull();
    expect(startParamRoute('e_../../admin')).toBeNull();
    expect(startParamRoute(`e_${ID}/settle`)).toBeNull();
  });
});

describe('miniAppLink', () => {
  it('собирает прямую ссылку с startapp', () => {
    expect(miniAppLink('@club_bot', `e_${ID}`)).toBe(`https://t.me/club_bot?startapp=e_${ID}`);
    expect(miniAppLink('club_bot')).toBe('https://t.me/club_bot');
  });
});
