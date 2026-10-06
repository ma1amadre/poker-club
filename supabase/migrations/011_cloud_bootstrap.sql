-- 011_cloud_bootstrap.sql — всё, без чего облачный проект не работает сразу после `db push`
-- (seed.sql в облако не попадает): права service_role на таблицы, секрет cron, его проверка для
-- cron-tick, стартовые настройки клуба и клубный формат. Каждая часть идемпотентна: повторный прогон
-- файла целиком ничего не меняет, а то, что уже настроено руками, не трогается.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Права service_role (Edge Functions) на таблицы public
-- ---------------------------------------------------------------------------
-- Функции работают через adminClient (service_role) прямо с таблицами: settings, players, evenings…
-- RLS service_role обходит, но табличные права ему нужны, как любой роли. Миграции 001–010 их не
-- выдавали: локально они приходили из default privileges роли postgres, а в облачных проектах,
-- созданных после 30.05.2026, этой выдачи нет (Supabase changelog «Tables not exposed to Data and
-- GraphQL API automatically»): без строк ниже tg-auth, notify, cron-tick и bot-setup падают с
-- «permission denied for table …». Правило: каждая новая таблица в следующих миграциях явно получает
-- права для service_role (и для authenticated, если клиенту она нужна) — см. ARCHITECTURE.md, «Гранты».
-- Sequences — ради evening_events.id (bigserial). grant идемпотентен.
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ---------------------------------------------------------------------------
-- Секрет cron: создаётся здесь, руками его никто не вводит
-- ---------------------------------------------------------------------------
-- 32 случайных байта в hex. Знают его только Vault и сама база: pg_cron (private.invoke_cron_tick,
-- миграция 005) кладёт его в заголовок x-cron-secret, cron-tick сверяет заголовок через
-- public.verify_cron_secret. В окружении функций копии секрета нет — разъехаться нечему.
-- Сменить: select vault.update_secret(id, encode(extensions.gen_random_bytes(32), 'hex'))
--          from vault.secrets where name = 'cron_secret';
-- Локально seed.sql заменяет значение на известное 'local-cron-secret' (для ручных вызовов curl).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cron_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'cron_secret',
      'Заголовок x-cron-secret для cron-tick (создан миграцией 011)');
  end if;
end;
$$;

-- project_url миграция не создаёт: адрес проекта знает только окружение. В облаке его кладёт
-- деплой (.github/workflows/deploy.yml, Management API), локально — seed.sql. Пока его нет,
-- private.invoke_cron_tick тихо возвращает null (миграция 005) — cron просто ничего не делает.

-- ---------------------------------------------------------------------------
-- public.verify_cron_secret — проверка заголовка x-cron-secret для cron-tick
-- ---------------------------------------------------------------------------
-- Сравниваем не строки, а HMAC обеих строк на случайном ключе этого вызова: время сравнения
-- bytea зависит от длины общего префикса, но префикс HMAC на неизвестном ключе ничего не говорит
-- о префиксе секрета (и о его длине). Пустой или отсутствующий секрет — всегда false.
create or replace function public.verify_cron_secret(p_secret text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_expected text;
  v_key      bytea;
begin
  if p_secret is null or p_secret = '' then
    return false;
  end if;

  select s.decrypted_secret into v_expected
  from vault.decrypted_secrets s
  where s.name = 'cron_secret'
  limit 1;

  if v_expected is null or v_expected = '' then
    return false;
  end if;

  v_key := extensions.gen_random_bytes(32);
  return extensions.hmac(convert_to(p_secret, 'UTF8'), v_key, 'sha256')
       = extensions.hmac(convert_to(v_expected, 'UTF8'), v_key, 'sha256');
end;
$$;

-- Только для Edge Functions (service_role): клиентам Mini App перебирать секрет незачем.
revoke execute on function public.verify_cron_secret(text) from public, anon, authenticated;
grant execute on function public.verify_cron_secret(text) to service_role;

-- ---------------------------------------------------------------------------
-- Стартовые данные клуба
-- ---------------------------------------------------------------------------
-- Строку settings создаёт миграция 001 со значениями по умолчанию концепции: четверг (4), 19:00 МСК,
-- анонс за 48 ч; group_chat_id, bot_username и место пусты. Здесь — страховка на случай, если её
-- удалили: вставка без конфликта, существующая строка не меняется.
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- Клубный формат — ровно DEFAULT_FORMAT из supabase/functions/_shared/domain/format.ts (сверяет
-- тест _shared/bootstrap-format.test.ts). Создаётся, только если форматов ещё нет и формат по
-- умолчанию не выбран: в базе с настроенным клубом миграция ничего не трогает. id фиксированный —
-- на него ссылается seed.sql.
do $$
begin
  if exists (select 1 from public.formats)
     or (select s.default_format_id from public.settings s where s.id = 1) is not null then
    return;
  end if;

  insert into public.formats (id, name, config) values (
    'f0000000-0000-4000-8000-000000000001',
    'Клубный',
    '{
       "name": "Клубный",
       "buyInRub": 500,
       "startingChips": 500,
       "bountyRub": 100,
       "rebuyUntilLevel": 5,
       "rebuyLimit": null,
       "payoutPct": [70, 30],
       "levels": [
         {"sb": 5,   "bb": 10,  "trigger": {"type": "time", "minutes": 40}},
         {"sb": 10,  "bb": 20,  "trigger": {"type": "time", "minutes": 40}},
         {"sb": 15,  "bb": 30,  "trigger": {"type": "time", "minutes": 40}},
         {"sb": 20,  "bb": 40,  "trigger": {"type": "time", "minutes": 40}},
         {"sb": 25,  "bb": 50,  "trigger": {"type": "time", "minutes": 40}},
         {"sb": 50,  "bb": 100, "trigger": {"type": "time", "minutes": 40}},
         {"sb": 75,  "bb": 150, "trigger": {"type": "time", "minutes": 40}},
         {"sb": 100, "bb": 200, "trigger": {"type": "time", "minutes": 40}}
       ]
     }'::jsonb)
  on conflict (id) do nothing;

  update public.settings
  set default_format_id = 'f0000000-0000-4000-8000-000000000001'
  where id = 1 and default_format_id is null;
end;
$$;
