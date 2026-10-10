import { ACHIEVEMENT_META } from '@domain/achievements.ts';
import { describe, expect, it } from 'vitest';
import { ACHIEVEMENT_SHORT, achievementShort } from './clubLife';

describe('короткие описания ачивок', () => {
  it('«Железный стул» — по игровым дням, как в каталоге домена (миграция 026)', () => {
    // Две игры в один день: хватает сесть за одну — «пропущенного вечера» в ленте быть не должно.
    expect(ACHIEVEMENT_SHORT.iron_chair).toBe('ни одного пропущенного игрового дня за сезон');
    expect(ACHIEVEMENT_SHORT.iron_chair).toBe(
      ACHIEVEMENT_META.iron_chair.description.charAt(0).toLowerCase() +
        ACHIEVEMENT_META.iron_chair.description.slice(1),
    );
    expect(achievementShort({ code: 'iron_chair', level: 1, first: true })).toBe(
      ACHIEVEMENT_SHORT.iron_chair,
    );
  });
});
