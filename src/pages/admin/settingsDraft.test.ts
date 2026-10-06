import { describe, expect, it } from 'vitest';
import type { Settings } from '../../shared/api/types';
import {
  draftFromSettings,
  normalizeBotUsername,
  parseSettingsDraft,
  settingsDirty,
  type SettingsDraft,
} from './settingsDraft';

const SAVED: Settings = {
  id: 1,
  group_chat_id: null,
  bot_username: 'poker_club_local_bot',
  game_weekday: 4,
  game_time: '19:00:00',
  announce_hours_before: 48,
  default_location: 'У Жени',
  default_format_id: 'f0000000-0000-4000-8000-000000000001',
  season_best_n: 10,
  ko_points: 0.5,
  win_bonus: 1,
  updated_at: '2026-10-06T12:00:00Z',
};

const draft = (patch: Partial<SettingsDraft> = {}): SettingsDraft => ({
  ...draftFromSettings(SAVED),
  ...patch,
});

describe('draftFromSettings', () => {
  it('поля формы — строки по правилам набора', () => {
    expect(draftFromSettings(SAVED)).toEqual({
      groupChatId: '',
      botUsername: 'poker_club_local_bot',
      weekday: '4',
      time: '19:00',
      announceHours: '48',
      location: 'У Жени',
      formatId: 'f0000000-0000-4000-8000-000000000001',
      bestN: '10',
      koPoints: '0,5',
      winBonus: '1',
    });
  });

  it('bigint группы — и числом, и строкой', () => {
    expect(draftFromSettings({ ...SAVED, group_chat_id: -1001234567890 }).groupChatId).toBe(
      '-1001234567890',
    );
  });
});

describe('normalizeBotUsername', () => {
  it('убирает @ и ссылку', () => {
    expect(normalizeBotUsername('@poker_bot')).toBe('poker_bot');
    expect(normalizeBotUsername(' https://t.me/poker_bot?startapp=r ')).toBe('poker_bot');
    expect(normalizeBotUsername('t.me/poker_bot/app')).toBe('poker_bot');
    expect(normalizeBotUsername('')).toBe('');
  });
});

describe('parseSettingsDraft', () => {
  it('сохранённые настройки разбираются без ошибок', () => {
    const { patch, errors } = parseSettingsDraft(draft());
    expect(errors).toEqual({});
    expect(patch).toEqual({
      group_chat_id: null,
      bot_username: 'poker_club_local_bot',
      game_weekday: 4,
      game_time: '19:00',
      announce_hours_before: 48,
      default_location: 'У Жени',
      default_format_id: 'f0000000-0000-4000-8000-000000000001',
      season_best_n: 10,
      ko_points: 0.5,
      win_bonus: 1,
    });
  });

  it('ID группы: отрицательное целое, типографский минус и пробелы допустимы', () => {
    expect(parseSettingsDraft(draft({ groupChatId: '−1001234567890' })).patch.group_chat_id).toBe(
      -1001234567890,
    );
    expect(parseSettingsDraft(draft({ groupChatId: '1001234567890' })).errors.groupChatId).toMatch(
      /отрицательное/,
    );
    expect(parseSettingsDraft(draft({ groupChatId: 'chat' })).errors.groupChatId).toBeDefined();
  });

  it('имя бота: без @, на «bot», 5–32 символа', () => {
    expect(parseSettingsDraft(draft({ botUsername: '@Club_Bot' })).patch.bot_username).toBe(
      'Club_Bot',
    );
    expect(parseSettingsDraft(draft({ botUsername: 'a_bot' })).errors.botUsername).toBeUndefined();
    expect(parseSettingsDraft(draft({ botUsername: 'abot' })).errors.botUsername).toBeDefined();
    expect(
      parseSettingsDraft(draft({ botUsername: 'poker_club' })).errors.botUsername,
    ).toBeDefined();
    expect(
      parseSettingsDraft(draft({ botUsername: `a${'b'.repeat(28)}bot` })).errors.botUsername,
    ).toBeUndefined();
    expect(
      parseSettingsDraft(draft({ botUsername: `a${'b'.repeat(29)}bot` })).errors.botUsername,
    ).toBeDefined();
    expect(parseSettingsDraft(draft({ botUsername: '' })).patch.bot_username).toBeNull();
  });

  it('расписание и окно анонса — как ограничения БД', () => {
    expect(parseSettingsDraft(draft({ weekday: '8' })).errors.weekday).toBeDefined();
    expect(parseSettingsDraft(draft({ time: '25:00' })).errors.time).toBeDefined();
    expect(parseSettingsDraft(draft({ announceHours: '0' })).errors.announceHours).toBeDefined();
    expect(
      parseSettingsDraft(draft({ announceHours: '336' })).errors.announceHours,
    ).toBeUndefined();
    expect(parseSettingsDraft(draft({ announceHours: '337' })).errors.announceHours).toBeDefined();
  });

  it('очки: десятичная запятая, не меньше 0', () => {
    const ok = parseSettingsDraft(draft({ koPoints: '0,25', winBonus: '2' }));
    expect(ok.errors).toEqual({});
    expect(ok.patch.ko_points).toBe(0.25);
    expect(parseSettingsDraft(draft({ koPoints: '-1' })).errors.koPoints).toBeDefined();
    expect(parseSettingsDraft(draft({ winBonus: '' })).errors.winBonus).toBeDefined();
    expect(parseSettingsDraft(draft({ bestN: '0' })).errors.bestN).toBeDefined();
  });

  it('пустые место и формат — null', () => {
    const { patch } = parseSettingsDraft(draft({ location: '  ', formatId: '' }));
    expect(patch.default_location).toBeNull();
    expect(patch.default_format_id).toBeNull();
  });
});

describe('settingsDirty', () => {
  it('без правок — чисто, даже если написано иначе', () => {
    expect(settingsDirty(draft(), SAVED)).toBe(false);
    expect(
      settingsDirty(draft({ koPoints: '0.5', botUsername: '@poker_club_local_bot' }), SAVED),
    ).toBe(false);
  });

  it('любая правка — грязно', () => {
    expect(settingsDirty(draft({ weekday: '5' }), SAVED)).toBe(true);
    expect(settingsDirty(draft({ location: 'У Саши' }), SAVED)).toBe(true);
    expect(settingsDirty(draft({ groupChatId: '-100123' }), SAVED)).toBe(true);
  });
});
