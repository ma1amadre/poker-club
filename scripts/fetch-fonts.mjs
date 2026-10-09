#!/usr/bin/env node
// Свои шрифты «Материи» вместо Google Fonts.
//
// Зачем: интерфейс не должен зависеть от того, открываются ли fonts.googleapis.com и fonts.gstatic.com
// у игрока (из РФ — не всегда). Файлы шрифтов лежат в репозитории и уходят на GitHub Pages вместе
// с приложением; сборка и CI в сеть за шрифтами не ходят.
//
// Что пишет:
//   public/fonts/<семейство>-<подмножество>.woff2   файлы шрифтов (Vite копирует public/ в dist как есть)
//   public/fonts/OFL.txt                           лицензии семейств (все — SIL OFL 1.1) с копирайтами
//   src/styles/fonts.css                           @font-face (font-display: swap, unicode-range);
//                                                  подключён из src/styles/base.css
//
// Какие шрифты — только регистры, которые использует приложение (ARCHITECTURE.md → «Фронт»):
//   Терминал (всё приложение и табло) — Inter (текст) и JetBrains Mono (цифры, метки, заголовки);
//   Кобальт (витрина /dev/kit)        — Geologica и Martian Mono;
//   Янтарь (витрина /dev/kit-yantar)  — Sofia Sans Condensed, Sofia Sans, JetBrains Mono.
// Фарфор (Literata, Commissioner) не используется и не скачивается.
//
// Оси. Geologica — вариативная с осями wght и SHRP: «Материя» пишет заголовкам
// font-variation-settings: "SHRP" …, без этой оси заголовки потеряют рисунок. Оси, которых «Материя»
// не касается, зафиксированы на тех значениях, которые браузер и так выбирал с Google Fonts:
// у Geologica slnt 0 и CRSV 0 (курсива в Кобальте и Янтаре нет), у Martian Mono wdth 100
// (font-stretch: normal). Рисунок тот же, а основной экран легче примерно на 50 КБ. Если «Материя»
// начнёт использовать курсив или ширину — вернуть ось в FAMILIES и перезапустить скрипт.
//
// Подмножества — latin и cyrillic, как их режет Google (его unicode-range). Плюс «extra»: крошечный
// файл с символами интерфейса вне этих двух (EXTRA_CHARS: ₽, →) — иначе знак рубля рисовался бы
// системным шрифтом. В его unicode-range попадают только символы, которые в шрифте действительно есть
// (в Sofia Sans знака рубля нет — на табло он, как и раньше, из фолбэка).
//
// Браузер скачивает файл шрифта, только когда на экране есть текст этим семейством и символом из
// unicode-range файла. Поэтому шрифты Кобальта и Янтаря грузятся только в своих dev-витринах,
// а на основном экране их нет даже в очереди.
//
// Почему не @fontsource-variable/*: у Geologica там тоже есть файлы с wght + SHRP (shrp.css, проверено),
// но это лишняя npm-зависимость ради разового копирования и без отдельного маленького файла под ₽ и →.
//
// Запуск (нужен доступ к fonts.googleapis.com, fonts.gstatic.com и raw.githubusercontent.com):
//   node scripts/fetch-fonts.mjs
// Повторный запуск перезаписывает файлы; лишние .woff2 в public/fonts удаляет. Результат коммитится.
// Файлы в public/fonts и src/styles/fonts.css руками не править.

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';
import { format, resolveConfig } from 'prettier';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fontsDir = join(root, 'public', 'fonts');
const cssPath = join(root, 'src', 'styles', 'fonts.css');

/**
 * axes — спецификация осей для Google Fonts CSS API (css2): оси в его порядке (сначала строчные теги),
 * диапазон «a..b» — ось остаётся вариативной, одно число — ось зафиксирована на этом значении.
 * ofl — папка семейства в github.com/google/fonts/tree/main/ofl.
 */
const FAMILIES = [
  // Регистр «Терминал» (src/styles/terminal-theme.css, DESIGN.md) — главный. Inter: только ось wght
  // (opsz зафиксирован на значении по умолчанию — рисунок текстового кегля, файл легче).
  { family: 'Inter', register: 'Терминал', axes: 'wght@400..700', ofl: 'inter' },
  { family: 'Geologica', register: 'Кобальт', axes: 'wght,SHRP@100..900,0..100', ofl: 'geologica' },
  {
    family: 'Martian Mono',
    register: 'Кобальт',
    axes: 'wdth,wght@100,100..800',
    ofl: 'martianmono',
  },
  {
    family: 'Sofia Sans Condensed',
    register: 'Янтарь',
    axes: 'wght@400..900',
    ofl: 'sofiasanscondensed',
  },
  { family: 'Sofia Sans', register: 'Янтарь', axes: 'wght@300..700', ofl: 'sofiasans' },
  // JetBrains Mono — общий у Янтаря и Терминала; 800 — цифры табло в Терминале.
  {
    family: 'JetBrains Mono',
    register: 'Терминал, Янтарь',
    axes: 'wght@400..800',
    ofl: 'jetbrainsmono',
  },
];
const SUBSETS = ['cyrillic', 'latin'];
/** Символы интерфейса вне latin и cyrillic. Новый такой символ в UI — дописать сюда и перезапустить. */
const EXTRA_CHARS = '₽→';

// С таким User-Agent Google отдаёт woff2 и вариативные шрифты одним файлом на подмножество.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const fail = (message) => {
  console.error(`fetch-fonts: ${message}`);
  process.exit(1);
};

async function get(url, as, headers = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return as === 'text' ? await response.text() : Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt === 3) fail(`не скачать ${url}: ${error.cause?.code ?? error.message}`);
      await new Promise((done) => setTimeout(done, 1000 * attempt));
    }
  }
}

const slugOf = (family) => family.toLowerCase().replace(/ /g, '-');
/** Ответ Google Fonts CSS API (css2) для семейства с осями; extra — доп. параметры запроса. */
const css2 = (family, axes, extra = '') =>
  get(
    `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:${axes}${extra}&display=swap`,
    'text',
    { 'user-agent': UA },
  );

/** Блоки @font-face из ответа css2: подмножество (из комментария перед блоком) и дескрипторы. */
function parseFaces(css) {
  const faces = [];
  for (const m of css.matchAll(/(?:\/\* ([\w-]+) \*\/\s*)?@font-face \{([^}]*)\}/g)) {
    const descriptors = Object.fromEntries(
      [...m[2].matchAll(/([\w-]+):\s*([^;]+);/g)].map((d) => [d[1], d[2].trim()]),
    );
    const url = descriptors.src?.match(/url\(([^)]+)\)/)?.[1];
    if (!url) fail(`в ответе Google нет url шрифта: ${m[0]}`);
    faces.push({ subset: m[1], url, descriptors });
  }
  return faces;
}

// ── Чтение woff2: оси (fvar) и покрытие символов (cmap) — проверка, что скачано то, что нужно ──
// prettier-ignore
const WOFF2_TAGS = ['cmap','head','hhea','hmtx','maxp','name','OS/2','post','cvt ','fpgm','glyf','loca',
  'prep','CFF ','VORG','EBDT','EBLC','gasp','hdmx','kern','LTSH','PCLT','VDMX','vhea','vmtx','BASE','GDEF',
  'GPOS','GSUB','EBSC','JSTF','MATH','CBDT','CBLC','COLR','CPAL','SVG ','sbix','acnt','avar','bdat','bloc',
  'bsln','cvar','fdsc','feat','fmtx','fvar','gvar','hsty','just','lcar','mort','morx','opbd','prop','trak',
  'Zapf','Silf','Glat','Gloc','Feat','Sill'];

function inspectWoff2(buf) {
  if (buf.toString('latin1', 0, 4) !== 'wOF2') throw new Error('это не woff2');
  let p = 48; // размер заголовка WOFF2
  const base128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = buf[p++];
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw new Error('битый UIntBase128');
  };
  // Таблицы в распакованном потоке идут подряд в порядке каталога, без выравнивания.
  const tables = {};
  let offset = 0;
  for (let i = buf.readUInt16BE(12); i > 0; i--) {
    const flags = buf[p++];
    let tag = WOFF2_TAGS[flags & 0x3f];
    if ((flags & 0x3f) === 63) {
      tag = buf.toString('latin1', p, p + 4);
      p += 4;
    }
    const version = flags >> 6;
    const length = base128();
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0;
    const stored = transformed ? base128() : length;
    tables[tag] = { offset, length: stored };
    offset += stored;
  }
  const data = brotliDecompressSync(buf.subarray(p, p + buf.readUInt32BE(20)));
  const table = (tag) =>
    tables[tag] && data.subarray(tables[tag].offset, tables[tag].offset + tables[tag].length);

  const axes = [];
  const fvar = table('fvar');
  if (fvar) {
    const size = fvar.readUInt16BE(10);
    for (let i = 0, a = fvar.readUInt16BE(4); i < fvar.readUInt16BE(8); i++, a += size) {
      axes.push(fvar.toString('latin1', a, a + 4));
    }
  }

  const codepoints = new Set();
  const cmap = table('cmap');
  const subtables = Array.from({ length: cmap.readUInt16BE(2) }, (_, i) =>
    cmap.readUInt32BE(8 + i * 8),
  );
  const format12 = subtables.find((o) => cmap.readUInt16BE(o) === 12);
  const format4 = subtables.find((o) => cmap.readUInt16BE(o) === 4);
  if (format12 !== undefined) {
    for (let g = 0, groups = cmap.readUInt32BE(format12 + 12); g < groups; g++) {
      const start = cmap.readUInt32BE(format12 + 16 + g * 12);
      const end = cmap.readUInt32BE(format12 + 20 + g * 12);
      for (let cp = start; cp <= end; cp++) codepoints.add(cp);
    }
  } else if (format4 !== undefined) {
    const segments = cmap.readUInt16BE(format4 + 6) / 2;
    const ends = format4 + 14;
    const starts = ends + segments * 2 + 2;
    const deltas = starts + segments * 2;
    const rangeOffsets = deltas + segments * 2;
    for (let s = 0; s < segments; s++) {
      const start = cmap.readUInt16BE(starts + s * 2);
      const end = cmap.readUInt16BE(ends + s * 2);
      const delta = cmap.readInt16BE(deltas + s * 2);
      const rangeOffset = cmap.readUInt16BE(rangeOffsets + s * 2);
      for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
        let glyph = rangeOffset
          ? cmap.readUInt16BE(rangeOffsets + s * 2 + rangeOffset + (cp - start) * 2)
          : cp;
        if (glyph) glyph = (glyph + delta) & 0xffff;
        if (glyph) codepoints.add(cp);
      }
    }
  } else throw new Error('в cmap нет подтаблицы формата 4 или 12');
  return { axes, codepoints };
}

const hex = (cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} КБ`;

// ── Скачивание ──
mkdirSync(fontsDir, { recursive: true });
const written = new Set();
const cssBlocks = [];
const report = [];
const licenses = [];

for (const { family, register, axes, ofl } of FAMILIES) {
  const slug = slugOf(family);
  // Оси с диапазоном должны остаться вариативными в скачанном файле (прежде всего SHRP у Geologica).
  const [tags, values] = axes.split('@');
  const variableAxes = tags.split(',').filter((_, i) => values.split(',')[i].includes('..'));

  const faces = parseFaces(await css2(family, axes));
  // text= — Google собирает файл только из этих символов (с теми же осями).
  const extraFace = parseFaces(
    await css2(family, axes, `&text=${encodeURIComponent(EXTRA_CHARS)}`),
  )[0];
  if (!extraFace) fail(`${family}: Google не вернул @font-face для EXTRA_CHARS`);

  const files = [];
  for (const subset of SUBSETS) {
    const face = faces.find((f) => f.subset === subset);
    if (!face) fail(`${family}: в ответе Google нет подмножества ${subset}`);
    files.push({ subset, face, range: face.descriptors['unicode-range'] });
  }
  files.push({ subset: 'extra', face: extraFace, range: null });

  let familyBytes = 0;
  for (const { subset, face, range } of files) {
    const buf = await get(face.url, 'buffer');
    let info;
    try {
      info = inspectWoff2(buf);
    } catch (error) {
      fail(`${family} ${subset}: ${error.message}`);
    }
    const missing = variableAxes.filter((axis) => !info.axes.includes(axis));
    if (missing.length) fail(`${family} ${subset}: в файле нет осей ${missing.join(', ')}`);

    let unicodeRange = range;
    if (subset === 'extra') {
      const present = [...EXTRA_CHARS]
        .map((ch) => ch.codePointAt(0))
        .filter((cp) => info.codepoints.has(cp));
      if (!present.length) {
        report.push(`${family.padEnd(21)} extra     — (нет символов ${EXTRA_CHARS})`);
        continue;
      }
      unicodeRange = present.map(hex).join(', ');
    }

    const file = `${slug}-${subset}.woff2`;
    writeFileSync(join(fontsDir, file), buf);
    written.add(file);
    familyBytes += buf.length;
    report.push(
      `${family.padEnd(21)} ${subset.padEnd(9)} ${kb(buf.length).padStart(8)}  оси: ${info.axes.join(', ')}`,
    );

    const d = face.descriptors;
    cssBlocks.push(
      [
        `/* ${register} · ${family} · ${subset} */`,
        '@font-face {',
        `  font-family: '${family}';`,
        `  font-style: ${d['font-style'] ?? 'normal'};`,
        `  font-weight: ${d['font-weight']};`,
        ...(d['font-stretch'] ? [`  font-stretch: ${d['font-stretch']};`] : []),
        '  font-display: swap;',
        `  src: url('/fonts/${file}') format('woff2');`,
        `  unicode-range: ${unicodeRange};`,
        '}',
      ].join('\n'),
    );
  }
  report.push(`${''.padEnd(21)} итого     ${kb(familyBytes).padStart(8)}`);

  const license = await get(
    `https://raw.githubusercontent.com/google/fonts/main/ofl/${ofl}/OFL.txt`,
    'text',
  );
  if (!/SIL Open Font License,? Version 1\.1/i.test(license))
    fail(`${family}: лицензия не SIL OFL 1.1`);
  licenses.push(
    `==== ${family} — https://github.com/google/fonts/tree/main/ofl/${ofl} ====\n\n${license.replace(/\r\n/g, '\n').trim()}\n`,
  );
}

// Файлы, которых больше нет в наборе (сменилось семейство или подмножество), — убрать.
for (const file of readdirSync(fontsDir)) {
  if (file.endsWith('.woff2') && !written.has(file)) rmSync(join(fontsDir, file));
}

writeFileSync(
  join(fontsDir, 'OFL.txt'),
  [
    'Шрифты в этой папке распространяются по лицензии SIL Open Font License 1.1.',
    'Файлы — подмножества шрифтов Google Fonts (latin, cyrillic и отдельные символы интерфейса),',
    'скачаны scripts/fetch-fonts.mjs. Ниже — лицензия каждого семейства с его копирайтом.',
    '',
    ...licenses,
  ].join('\n'),
);

const css = [
  '/*',
  ' * Шрифты регистров — свои файлы из public/fonts, без Google Fonts. Сгенерировано',
  ' * scripts/fetch-fonts.mjs — руками не править. Пути от корня сайта: Vite допишет к ним BASE_PATH.',
  ' * Файл шрифта браузер качает, только когда текст этим семейством есть на экране: шрифты Кобальта',
  ' * и Янтаря грузятся только в dev-витринах. Лицензия — public/fonts/OFL.txt.',
  ' */',
  '',
  cssBlocks.join('\n\n'),
  '',
].join('\n');
// Через prettier с настройками репозитория: повторный запуск не даёт диффа форматирования.
writeFileSync(cssPath, await format(css, { ...(await resolveConfig(cssPath)), filepath: cssPath }));

console.log(report.join('\n'));
console.log(
  `fetch-fonts: ${written.size} файлов → public/fonts, @font-face → src/styles/fonts.css`,
);
