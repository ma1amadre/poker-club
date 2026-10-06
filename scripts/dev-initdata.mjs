#!/usr/bin/env node
// Подписанный initData для ручных тестов функции tg-auth (curl, REST-клиент) — тем же алгоритмом,
// что и клиент Telegram (core.telegram.org/bots/webapps, «Validating data received via the Mini App»):
//   data_check_string = поля без hash, отсортированные по ключу, «key=value» через \n
//   secret = HMAC_SHA256(key = "WebAppData", msg = bot_token)
//   hash   = hex(HMAC_SHA256(key = secret, msg = data_check_string))
// Браузерный двойник для dev-входа — src/shared/auth/devInitData.ts.
//
// Использование:
//   node scripts/dev-initdata.mjs [tg_id] [--token <токен>] [--name <имя>] [--username <ник>]
//                                 [--start <start_param>] [--age <секунд назад>] [--json]
// Токен по умолчанию — TELEGRAM_BOT_TOKEN из окружения или supabase/functions/.env,
// затем VITE_DEV_BOT_TOKEN из .env.development.local. Только для локального стека: настоящий токен
// бота сюда не подставлять.
//
// Пример:
//   curl -s http://127.0.0.1:57321/functions/v1/tg-auth -H "content-type: application/json" \
//     -d "$(node scripts/dev-initdata.mjs 1001 --json)"

import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Совпадает с DEV_PLAYERS в src/shared/auth/devInitData.ts и игроками supabase/seed.sql.
const DEV_PLAYERS = {
  1001: { first_name: 'Женя', username: 'zhenya_local' },
  1002: { first_name: 'Саша', username: 'sasha_local' },
  1003: { first_name: 'Дима', username: 'dima_local' },
  1004: { first_name: 'Лёша', username: 'lesha_local' },
  1005: { first_name: 'Миша' },
  1006: { first_name: 'Костя', username: 'kostya_local' },
};

function parseArgs(argv) {
  const out = { tgId: 1001, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`Нет значения для ${arg}`);
      i += 1;
      return value;
    };
    if (arg === '--token') out.token = next();
    else if (arg === '--name') out.name = next();
    else if (arg === '--username') out.username = next();
    else if (arg === '--start') out.start = next();
    else if (arg === '--age') out.age = Number(next());
    else if (arg === '--json') out.json = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (/^\d+$/.test(arg)) out.tgId = Number(arg);
    else throw new Error(`Неизвестный аргумент: ${arg}`);
  }
  return out;
}

/** Значение KEY из dotenv-файла (без поддержки многострочных значений — здесь не нужно). */
function readDotenv(file, key) {
  const path = resolve(root, file);
  if (!existsSync(path)) return undefined;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && match[1] === key) return match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return undefined;
}

function resolveToken(explicit) {
  return (
    explicit ||
    process.env.TELEGRAM_BOT_TOKEN ||
    readDotenv('supabase/functions/.env', 'TELEGRAM_BOT_TOKEN') ||
    process.env.VITE_DEV_BOT_TOKEN ||
    readDotenv('.env.development.local', 'VITE_DEV_BOT_TOKEN')
  );
}

export function dataCheckString(fields) {
  return Object.keys(fields)
    .filter((key) => key !== 'hash')
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');
}

export function signInitData(fields, botToken) {
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString(fields)).digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      readFileSync(fileURLToPath(import.meta.url), 'utf8')
        .split('\n')
        .slice(1, 20)
        .join('\n'),
    );
    return;
  }
  const token = resolveToken(args.token);
  if (!token) {
    console.error(
      'Нет токена: передайте --token или задайте TELEGRAM_BOT_TOKEN в supabase/functions/.env ' +
        '(или VITE_DEV_BOT_TOKEN в .env.development.local).',
    );
    process.exit(1);
  }
  const preset = DEV_PLAYERS[args.tgId] ?? { first_name: `Игрок ${args.tgId}` };
  const user = {
    id: args.tgId,
    first_name: args.name ?? preset.first_name,
    ...((args.username ?? preset.username) ? { username: args.username ?? preset.username } : {}),
    language_code: 'ru',
    allows_write_to_pm: true,
  };
  const authDate = Math.floor(Date.now() / 1000) - (Number.isFinite(args.age) ? args.age : 0);
  const fields = {
    auth_date: String(authDate),
    query_id: `dev-${args.tgId}-${authDate}`,
    user: JSON.stringify(user),
  };
  if (args.start) fields.start_param = args.start;

  const initData = signInitData(fields, token);
  process.stdout.write(args.json ? `${JSON.stringify({ initData })}\n` : `${initData}\n`);
}

// Запуск как скрипта (а не импорт функций в тестах).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
