-- 005_cron.sql — раз в 15 минут дёргаем Edge Function cron-tick (анонсы, итоги голосования,
-- добивка неотправленных постов). Логика расписания живёт в функции, здесь — только будильник.
--
-- Адрес проекта и секрет берутся из Vault, а не из миграции: миграции лежат в публичном репо,
-- и один и тот же файл должен работать и локально, и в облаке. Секреты заводятся отдельно:
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<CRON_SECRET функций>',      'cron_secret');
-- Локально их кладёт seed.sql.

-- Supabase требует pg_cron в pg_catalog (схему cron расширение создаёт само), pg_net — в extensions
-- (функции http_* всё равно в схеме net).
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- private.invoke_cron_tick — асинхронный POST на cron-tick
-- ---------------------------------------------------------------------------
-- Возвращает id запроса pg_net (ответ смотреть в net._http_response) или null, если секретов нет.
-- Без секретов выходим молча: свежий проект или локалка без seed не должны сыпать ошибками
-- в cron.job_run_details каждые 15 минут.
create function private.invoke_cron_tick()
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  select s.decrypted_secret into v_url
  from vault.decrypted_secrets s
  where s.name = 'project_url'
  limit 1;

  select s.decrypted_secret into v_secret
  from vault.decrypted_secrets s
  where s.name = 'cron_secret'
  limit 1;

  if nullif(btrim(v_url), '') is null or nullif(v_secret, '') is null then
    return null;
  end if;

  return net.http_post(
    url := rtrim(btrim(v_url), '/') || '/functions/v1/cron-tick',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret),
    -- cron-tick ходит в Telegram; 30 с хватает с запасом, а зависший запрос не копится.
    timeout_milliseconds := 30000);
end;
$$;

-- Вызывает только pg_cron от имени postgres; клиентам API схема private и так не видна.
revoke execute on function private.invoke_cron_tick() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Расписание
-- ---------------------------------------------------------------------------
-- cron.schedule с именем — upsert: повторное применение миграции не плодит дублей.
-- Время cron — UTC; это не важно: cron-tick сам считает «сколько до игры» по Москве.
select cron.schedule(
  'poker-club-cron-tick',
  '*/15 * * * *',
  'select private.invoke_cron_tick()');
