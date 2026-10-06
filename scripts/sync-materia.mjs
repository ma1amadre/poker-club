#!/usr/bin/env node
// Вендоринг дизайн-системы «Материя» в src/vendor/materia/.
//
// Откуда: «Материя» — собственная дизайн-система, её исходник живёт ВНЕ этого репозитория
// (по умолчанию D:/dev/materia) и не публикуется в npm. Поэтому готовые файлы её сборки
// копируются сюда и коммитятся: CI на GitHub Pages и любой другой клон собирают приложение
// без доступа к папке «Материи».
//
// Что копируется (из <materia>/dist и корня):
//   dist/materia.mjs  → materia.mjs    ES-модуль компонентов (React — внешняя зависимость, React.createElement)
//   dist/materia.d.ts → materia.d.mts  типы; TS берёт .d.mts для импорта «./materia.mjs».
//                                       Правки: JSX.IntrinsicElements → React.JSX.IntrinsicElements
//                                       (в @types/react 19 нет глобального JSX), убран declare global
//                                       с window.Materia (у нас ES-модуль, глобала нет).
//   dist/materia.css  → materia.css    tokens.css + стили компонентов — единый лист. Первую строку
//                                       (@import шрифтов Google Fonts) скрипт ВЫРЕЗАЕТ и никуда не
//                                       переносит: шрифты у приложения свои (public/fonts,
//                                       @font-face в src/styles/fonts.css — их пишет
//                                       scripts/fetch-fonts.mjs), от fonts.googleapis.com оно не
//                                       зависит. По вырезанному адресу скрипт только сверяет, что
//                                       «Материя» не завела семейство, которого у нас нет, а по листу —
//                                       что не появилась новая ось в font-variation-settings.
//   tokens.css        → tokens.css     справочно: имена и значения токенов. Он УЖЕ вшит в materia.css
//                                       (скрипт это проверяет), отдельно его не импортировать.
//
// Как обновлять: пересобрать «Материю» (npm run build в её папке), затем
//   node scripts/sync-materia.mjs [путь к materia]      (или MATERIA_DIR=… node scripts/sync-materia.mjs)
// и прогнать npm run typecheck && npm run lint && npm test && npx vite build, посмотреть /#/dev/kit.
// Вендоренные файлы руками не править — правка потеряется при следующей синхронизации.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(process.argv[2] ?? process.env.MATERIA_DIR ?? 'D:/dev/materia');
const target = join(root, 'src', 'vendor', 'materia');

const read = (path) => readFileSync(join(source, path), 'utf8').replace(/\r\n/g, '\n');
const fail = (message) => {
  console.error(`sync-materia: ${message}`);
  process.exit(1);
};

let version = 'неизвестна';
try {
  version = JSON.parse(read('package.json')).version ?? version;
} catch {
  fail(`не найден ${join(source, 'package.json')} — укажите путь к «Материи» аргументом`);
}

const stamp = `Материя ${version} — вендорено scripts/sync-materia.mjs из ${source.replace(/\\/g, '/')}. Руками не править.`;

const mjs = read('dist/materia.mjs');
const rawCss = read('dist/materia.css');
const tokens = read('tokens.css');
let dts = read('dist/materia.d.ts');

// Проверки допущений, на которых держится подключение в src/main.tsx.
if (!/^import \* as React from "react";/m.test(mjs))
  fail('materia.mjs больше не импортирует react как ожидается');
// Первая строка — @import шрифтов Google Fonts: вырезаем. @import в листе бандла блокирует и
// отрисовку, и модульный скрипт, а Google из РФ открывается не всегда.
const fontImport = rawCss.match(/^@import url\("([^"]+)"\);?[^\n]*\n/);
if (!fontImport) fail('materia.css должен начинаться с @import url("…") шрифтов');
const css = rawCss.slice(fontImport[0].length);
if (/@import/.test(css)) fail('в materia.css остался @import — он снова заблокирует запуск');

// Сверка шрифтов «Материи» со своими (src/styles/fonts.css, scripts/fetch-fonts.mjs).
// Семейства Фарфора приложению не нужны: регистр не используется, файлы не скачиваются.
const UNUSED_FAMILIES = ['Literata', 'Commissioner'];
// Оси в font-variation-settings, которые учтены: SHRP — у Geologica (Кобальт) она сохранена в
// fetch-fonts.mjs; opsz — только у Literata (Фарфор). Остальные оси свои шрифты фиксируют.
const KNOWN_VARIATION_AXES = ['SHRP', 'opsz'];
const fontsCssPath = join(root, 'src', 'styles', 'fonts.css');
if (!existsSync(fontsCssPath))
  fail('нет src/styles/fonts.css — запустите node scripts/fetch-fonts.mjs');
const ownFamilies = new Set(
  [...readFileSync(fontsCssPath, 'utf8').matchAll(/font-family:\s*'([^']+)'/g)].map((m) => m[1]),
);
const materiaFamilies = new URL(fontImport[1]).searchParams
  .getAll('family')
  .map((spec) => spec.split(':')[0]);
const missingFamilies = materiaFamilies.filter(
  (family) => !ownFamilies.has(family) && !UNUSED_FAMILIES.includes(family),
);
if (missingFamilies.length) {
  fail(
    `«Материя» подключает шрифты, которых нет в src/styles/fonts.css: ${missingFamilies.join(', ')}. ` +
      'Добавьте их в FAMILIES в scripts/fetch-fonts.mjs и запустите его (или в UNUSED_FAMILIES здесь, ' +
      'если регистр приложению не нужен).',
  );
}
const newAxes = [
  ...new Set(
    // Сами свойства и токены-значения для них (--m-display-vary: "SHRP" 100 и т. п.).
    [...css.matchAll(/(?:font-variation-settings|--[\w-]*-vary):([^;]+);/g)].flatMap((m) =>
      [...m[1].matchAll(/["']([\w ]{4})["']/g)].map((tag) => tag[1]),
    ),
  ),
].filter((axis) => !KNOWN_VARIATION_AXES.includes(axis));
if (newAxes.length) {
  fail(
    `в materia.css новые оси font-variation-settings: ${newAxes.join(', ')}. Свои шрифты их не содержат — ` +
      'оставьте ось вариативной в FAMILIES в scripts/fetch-fonts.mjs, перезапустите его и допишите ось ' +
      'в KNOWN_VARIATION_AXES здесь.',
  );
}
if (!css.includes(tokens.trim())) {
  fail(
    'tokens.css больше не вшит в materia.css — подключите его отдельно перед materia.css в main.tsx',
  );
}

const jsxBefore = (dts.match(/\bJSX\.IntrinsicElements\b/g) ?? []).length;
dts = dts.replace(/(?<!React\.)\bJSX\.IntrinsicElements\b/g, 'React.JSX.IntrinsicElements');
const globalAt = dts.indexOf('declare global {');
if (globalAt !== -1) dts = `${dts.slice(0, globalAt).trimEnd()}\n`;
if (/(?<!React\.)\bJSX\./.test(dts)) fail('в materia.d.ts остался глобальный JSX');

// Ссылки на Google Fonts в index.html были до перехода на свои шрифты — не должны вернуться.
const indexPath = join(root, 'index.html');
if (
  existsSync(indexPath) &&
  /\/\/fonts\.(googleapis|gstatic)\.com/.test(readFileSync(indexPath, 'utf8'))
)
  fail('в index.html ссылка на Google Fonts — шрифты свои, см. scripts/fetch-fonts.mjs');

mkdirSync(target, { recursive: true });
writeFileSync(
  join(target, 'materia.css'),
  `/* ${stamp} Шрифты — свои: src/styles/fonts.css (scripts/fetch-fonts.mjs). */\n${css}`,
);
writeFileSync(
  join(target, 'tokens.css'),
  `/* ${stamp} Справочно: уже вшит в materia.css. */\n${tokens}`,
);
writeFileSync(join(target, 'materia.mjs'), `// ${stamp}\n${mjs}`);
writeFileSync(join(target, 'materia.d.mts'), `// ${stamp}\n${dts}`);

console.log(
  `sync-materia: ${version} → src/vendor/materia (materia.mjs, materia.d.mts, materia.css, tokens.css); ` +
    `JSX→React.JSX: ${jsxBefore}, declare global ${globalAt === -1 ? 'не найден' : 'убран'}`,
);
