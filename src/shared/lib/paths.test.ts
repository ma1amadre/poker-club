import { describe, expect, it } from 'vitest';
import { CLUB_BOARD_CODE_RE, miniAppLink, paths, startParamRoute } from './paths';

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

describe('табло клуба', () => {
  it('маршрут /tv/<код>; код — 12 знаков hex, как check settings.club_board_token', () => {
    expect(paths.clubBoard('0123456789ab')).toBe('/tv/0123456789ab');
    expect(CLUB_BOARD_CODE_RE.test('0123456789ab')).toBe(true);
    expect(CLUB_BOARD_CODE_RE.test('0123456789a')).toBe(false);
    expect(CLUB_BOARD_CODE_RE.test('0123456789AB')).toBe(false);
    expect(CLUB_BOARD_CODE_RE.test('0123456789abc')).toBe(false);
    expect(CLUB_BOARD_CODE_RE.test(`e0000000-0000-4000-8000-000000000006`)).toBe(false);
  });
});
