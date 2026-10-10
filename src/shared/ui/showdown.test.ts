// Каскад showdown.css: правила плотного табло (7–9 рук, ui-sd--dense) не должны проигрывать
// правилам регистра в конце файла ([data-theme='terminal'] …). Табло всегда в «Терминале», а у
// правила «[data-theme] + класс» та же специфичность (0,2,0), что у «.ui-sd--dense + класс», и оно
// стоит ниже — при равной специфичности побеждает оно. Так разрядка 0.02em «Терминала» молча
// перебивала сброс разрядки у подписей аутов, и «Догонит на тёрне: 23 %» рвалась на две строки.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('./showdown.css', import.meta.url)), 'utf8');

interface Rule {
  selector: string;
  decls: Map<string, string>;
  /** Порядок в файле: при равной специфичности побеждает правило ниже. */
  order: number;
}

/** Правила файла (и внутри @media): селекторы по одному, объявления — свойство → значение. */
function parseRules(source: string): Rule[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  // Самые внутренние блоки «селекторы { объявления }»: у @media внутри есть «{», под шаблон он не
  // подходит, а правила внутри него — подходят.
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const prelude = (m[1] ?? '').trim();
    if (prelude.startsWith('@') || /^(from|to|\d+%)$/.test(prelude)) continue;
    const decls = new Map<string, string>();
    for (const d of (m[2] ?? '').split(';')) {
      const at = d.indexOf(':');
      if (at > 0) decls.set(d.slice(0, at).trim(), d.slice(at + 1).trim());
    }
    for (const selector of prelude.split(','))
      rules.push({ selector: selector.trim().replace(/\s+/g, ' '), decls, order: m.index ?? 0 });
  }
  return rules;
}

/** Специфичность [id, класс/атрибут/псевдокласс, тег/псевдоэлемент] для селекторов этого файла. */
function specificity(selector: string): [number, number, number] {
  let s = selector;
  const take = (re: RegExp) => {
    const n = s.match(re)?.length ?? 0;
    s = s.replace(re, ' ');
    return n;
  };
  const attrs = take(/\[[^\]]*\]/g);
  const pseudoElements = take(/::[\w-]+/g);
  // :not(x) и :is(x) — по аргументу: снимаем обёртку, аргумент считается как есть.
  s = s.replace(/:(not|is)\(/g, ' ').replace(/\)/g, ' ');
  const ids = take(/#[\w-]+/g);
  const classes = take(/\.[\w-]+/g);
  const pseudoClasses = take(/:[\w-]+/g);
  const tags = take(/(^|[\s>+~])[a-z][\w-]*/gi);
  return [ids, attrs + classes + pseudoClasses, tags + pseudoElements];
}

const beats = (a: [number, number, number], b: [number, number, number]) => {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
};

/** Последнее простое звено селектора: на чём правило стоит (класс с псевдоэлементом). */
function subject(selector: string): string {
  const last = selector.split(/\s*[\s>+~]\s*/).pop() ?? '';
  const classes = (last.match(/\.ui-sd__[\w-]+/g) ?? []).sort().join('');
  const pseudo = last.match(/::[\w-]+/)?.[0] ?? '';
  return classes ? classes + pseudo : '';
}

const rules = parseRules(css);
const dense = rules.filter((r) => r.selector.includes('.ui-sd--dense'));
// Регистры: на табло — «Терминал» и вариант board; правила компактной панели (экран вечера) табло
// не касаются.
const themed = rules.filter(
  (r) => r.selector.startsWith('[data-theme=') && !r.selector.includes('.ui-sd--compact'),
);

describe('showdown.css: плотное табло и правила регистра', () => {
  it('разбор файла видит обе группы правил', () => {
    expect(dense.length).toBeGreaterThan(10);
    expect(themed.some((r) => r.selector === "[data-theme='terminal'] .ui-sd__outs-label")).toBe(
      true,
    );
    expect(specificity("[data-theme='terminal'] .ui-sd__outs-label")).toEqual([0, 2, 0]);
    expect(specificity('.ui-sd--board.ui-sd--dense .ui-sd__outs-label')).toEqual([0, 3, 0]);
    expect(
      specificity('.ui-sd--dense .ui-sd__outs-catch > :first-child:not(:last-child)::after'),
    ).toEqual([0, 4, 1]);
  });

  it('подписи аутов и «Устоит на …» у 7–9 рук — без разрядки, и «Терминал» её не возвращает', () => {
    for (const cls of ['.ui-sd__outs-label', '.ui-sd__outs-none', '.ui-sd__hold']) {
      const reset = dense.filter(
        (r) => subject(r.selector) === cls && r.decls.has('letter-spacing'),
      );
      expect(
        reset.map((r) => r.decls.get('letter-spacing')),
        cls,
      ).toEqual(['0']);
    }
  });

  it('ни одно свойство плотного табло не перебито правилом регистра ниже по файлу', () => {
    const lost: string[] = [];
    for (const d of dense) {
      const key = subject(d.selector);
      if (!key) continue;
      for (const t of themed) {
        if (subject(t.selector) !== key) continue;
        const sd = specificity(d.selector);
        const st = specificity(t.selector);
        const themeWins = beats(st, sd) || (!beats(sd, st) && t.order > d.order);
        if (!themeWins) continue;
        for (const prop of d.decls.keys())
          if (t.decls.has(prop)) lost.push(`${d.selector} { ${prop} } ← ${t.selector}`);
      }
    }
    expect(lost).toEqual([]);
  });
});
