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
//                                       (@import шрифтов Google Fonts) скрипт ВЫРЕЗАЕТ и переносит
//                                       в index.html неблокирующей ссылкой (между метками
//                                       materia-fonts): @import в листе бандла блокирует и отрисовку,
//                                       и модульный скрипт — если fonts.googleapis.com принял соединение
//                                       и молчит, не выполнится даже Telegram.WebApp.ready().
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
// Первая строка — @import шрифтов: вырезаем, адрес уходит в index.html.
const fontImport = rawCss.match(/^@import url\("([^"]+)"\);?[^\n]*\n/);
if (!fontImport) fail('materia.css должен начинаться с @import url("…") шрифтов');
const fontsUrl = fontImport[1];
const css = rawCss.slice(fontImport[0].length);
if (/@import/.test(css)) fail('в materia.css остался @import — он снова заблокирует запуск');
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

mkdirSync(target, { recursive: true });
writeFileSync(
  join(target, 'materia.css'),
  `/* ${stamp} Шрифты подключает index.html (метки materia-fonts). */\n${css}`,
);

// Шрифты — неблокирующе: preload + stylesheet с media="print", который onload переключает на all.
// Пока шрифтов нет (или Google не отвечает), работают системные стеки фолбэка из materia.css.
const indexPath = join(root, 'index.html');
if (existsSync(indexPath)) {
  const html = readFileSync(indexPath, 'utf8').replace(/\r\n/g, '\n');
  const block = /( *)<!-- materia-fonts:start -->[\s\S]*?<!-- materia-fonts:end -->/;
  const found = html.match(block);
  if (!found)
    fail('в index.html нет меток <!-- materia-fonts:start --> … <!-- materia-fonts:end -->');
  const pad = found[1];
  const href = fontsUrl.replace(/&/g, '&amp;');
  // Разметка — ровно как её оставляет prettier: повторная синхронизация не даёт лишнего диффа.
  const tag = (attrs) => [`${pad}<link`, ...attrs.map((a) => `${pad}  ${a}`), `${pad}/>`];
  const links = [
    `${pad}<!-- materia-fonts:start -->`,
    ...tag(['rel="preload"', 'as="style"', `href="${href}"`]),
    ...tag(['rel="stylesheet"', `href="${href}"`, 'media="print"', `onload="this.media = 'all'"`]),
    `${pad}<!-- materia-fonts:end -->`,
  ].join('\n');
  writeFileSync(indexPath, html.replace(block, links));
}
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
