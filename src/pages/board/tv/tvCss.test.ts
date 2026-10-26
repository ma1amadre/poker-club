// Инварианты вёрстки табло ТВ в tv.css, найденные живой проверкой (26.10.2026): то, что рендер в
// тестах не видит, а на экране — артефакт или наезд.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NAME_TWO_LH } from './tableLayout';

const css = readFileSync(fileURLToPath(new URL('./tv.css', import.meta.url)), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** Объявления правила с точно таким селектором (последнее в файле). */
function rule(selector: string): Map<string, string> {
  const decls = new Map<string, string>();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const pre = (m[1] ?? '').trim().replace(/\s+/g, ' ');
    if (!pre.split(',').some((s) => s.trim() === selector)) continue;
    for (const d of (m[2] ?? '').split(';')) {
      const at = d.indexOf(':');
      if (at > 0) decls.set(d.slice(0, at).trim(), d.slice(at + 1).trim());
    }
  }
  return decls;
}

describe('табло ТВ: вёрстка (tv.css)', () => {
  it('имя места двумя строками — строка не ниже области глифов Inter (1,21 em): третья не просвечивает', () => {
    const two = rule('.tv-seat__name--two .tv-seat__nm');
    expect(two.get('-webkit-line-clamp')).toBe('2');
    expect(Number(two.get('line-height'))).toBeGreaterThanOrEqual(1.21);
    // Раскладка гнезда стека считает высоту имени тем же интервалом.
    expect(Number(two.get('line-height'))).toBe(NAME_TWO_LH);
  });

  it('карточка нокаута: длинное имя двумя строками — правило сильнее nowrap у «.tv-ko__body > div»', () => {
    // «.tv-ko__who--two» (0,1,0) проигрывал «.tv-ko__body > div» (0,1,1): имя оставалось одной
    // строкой с многоточием — «АННА-МАРИЯ …».
    expect(rule('.tv-ko__body > div').get('white-space')).toBe('nowrap');
    expect(rule('.tv-ko__who--two').get('white-space')).toBeUndefined();
    const two = rule('.tv-ko__body > .tv-ko__who--two');
    expect(two.get('white-space')).toBe('normal');
    expect(Number(two.get('line-height'))).toBeGreaterThanOrEqual(1.21);
  });

  it('«Без места» — в столбце подвала, не поверх него; заметки голоса — не выше двух строк', () => {
    expect(rule('.tv-unseated').get('position')).toBeUndefined();
    expect(rule('.tv-foot .tv-unseated').get('position')).toBeUndefined();
    const foot = rule('.tv-foot');
    expect(foot.get('position')).toBe('absolute');
    expect(foot.get('bottom')).toBeDefined();
    expect(rule('.tv-foot .tv-foot__note').get('-webkit-line-clamp')).toBe('2');
  });
});
