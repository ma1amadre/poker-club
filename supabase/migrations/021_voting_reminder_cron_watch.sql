-- 021: напоминание о голосовании и сторож будильника (аудит 07.10.2026, «Быстрые победы», п. 9–10).
-- 1) evenings.voting_reminder_posted_at timestamptz — напоминание о голосовании в группу ушло («Голосование
--    закрывается в 18:00 — проголосовали 3 из 7», за 3 ч до voting_closes_at) или не понадобилось: итоги
--    ушли уже внутри этих 3 ч, проголосовали все, голосовать некому, до закрытия меньше получаса. Пишет
--    только cron-tick (_shared/votingReminder.ts), защита от дублей — тот же приём «застолбить → отправить →
--    при ошибке снять», что у остальных *_posted_at (notify/results.ts, publishOnce).
-- 2) Новое закрытие голосования — новое напоминание: триггер evenings_reset_voting_reminder снимает
--    отметку, когда voting_closes_at меняется (void_event при отмене finish обнуляет его, повторный finish
--    ставит новое). Путь записи не важен; то же значение (upsert формы админки) отметку не трогает.
-- 3) Сторож будильника. pg_cron дёргает cron-tick раз в 15 минут, но если будильник встал (в Vault нет
--    project_url или cron_secret — private.invoke_cron_tick тихо возвращает null; задание выключено;
--    функция падает до алертов), об этом никто не узнаёт: алерты админу шлёт сама функция. Теперь каждый
--    тик, прошедший проверку секрета, пишет отметку в public.cron_heartbeat (одна строка): last_run_at —
--    тик отработал, last_ok_at — отработал без единой ошибки. Пишет public.mark_cron_tick(p_ok) — только
--    service_role (cron-tick); время ставит база. Читает public.cron_last_tick() — anon: keepalive из
--    poker-club-ops ходит с publishable-ключом, как к server_now; отдаёт только эти два времени и время
--    сервера. keepalive краснеет, если last_ok_at старше часа, — GitHub присылает письмо.
--
-- Гранты: новая колонка evenings — права на таблицу выданы целиком (002, 011), отдельный grant не нужен.
-- Новая таблица cron_heartbeat — RLS без политик, права только service_role (как admin_alerts, 012);
-- функции — явно.

-- ---------------------------------------------------------------------------
-- 1. Отметка напоминания о голосовании
-- ---------------------------------------------------------------------------
alter table public.evenings add column voting_reminder_posted_at timestamptz;

comment on column public.evenings.voting_reminder_posted_at is
  'Напоминание о голосовании ушло в группу (или не понадобилось). Пишет только cron-tick; смена voting_closes_at снимает отметку (триггер evenings_reset_voting_reminder). Миграция 021.';

-- ---------------------------------------------------------------------------
-- 2. Новое закрытие голосования снимает отметку
-- ---------------------------------------------------------------------------
create function private.evenings_reset_voting_reminder()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.voting_reminder_posted_at is not null
     and new.voting_closes_at is distinct from old.voting_closes_at then
    new.voting_reminder_posted_at := null;
  end if;
  return new;
end;
$$;

revoke execute on function private.evenings_reset_voting_reminder() from public, anon, authenticated;

create trigger evenings_reset_voting_reminder
  before update of voting_closes_at on public.evenings
  for each row execute function private.evenings_reset_voting_reminder();

-- ---------------------------------------------------------------------------
-- 3. Сторож будильника
-- ---------------------------------------------------------------------------
create table public.cron_heartbeat (
  id          integer primary key default 1 check (id = 1),
  last_run_at timestamptz,
  last_ok_at  timestamptz,
  updated_at  timestamptz not null default now()
);

comment on table public.cron_heartbeat is
  'Сторож будильника (021): когда cron-tick последний раз отработал (last_run_at) и отработал без ошибок (last_ok_at). Пишет mark_cron_tick (service_role), читает cron_last_tick (anon, keepalive).';

alter table public.cron_heartbeat enable row level security;

-- Прав по умолчанию нет (ARCHITECTURE.md, «Гранты»); локально default privileges дают service_role ещё
-- truncate/references/trigger — снимаем, чтобы права совпадали с облаком.
revoke all on table public.cron_heartbeat from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.cron_heartbeat to service_role;

-- Тик отработал; p_ok — без единой ошибки (иначе last_ok_at остаётся прежним).
create function public.mark_cron_tick(p_ok boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.cron_heartbeat as h (id, last_run_at, last_ok_at, updated_at)
  values (1, now(), case when p_ok then now() end, now())
  on conflict (id) do update
    set last_run_at = excluded.last_run_at,
        last_ok_at  = case when p_ok then excluded.last_run_at else h.last_ok_at end,
        updated_at  = excluded.updated_at;
$$;

comment on function public.mark_cron_tick(boolean) is
  'Отметка тика cron-tick для сторожа будильника (021). Только service_role.';

revoke execute on function public.mark_cron_tick(boolean) from public, anon, authenticated;
grant execute on function public.mark_cron_tick(boolean) to service_role;

-- Только время: когда будильник последний раз отработал и отработал без ошибок, и «сейчас» сервера,
-- чтобы возраст отметки считался по часам базы, а не раннера. Отметки ещё нет — null.
create function public.cron_last_tick()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'last_ok_at',  (select h.last_ok_at  from public.cron_heartbeat h where h.id = 1),
    'last_run_at', (select h.last_run_at from public.cron_heartbeat h where h.id = 1),
    'server_now',  now())
$$;

comment on function public.cron_last_tick() is
  'Сторож будильника (021): {last_ok_at, last_run_at, server_now}. Доступна anon — её вызывает keepalive из poker-club-ops.';

revoke execute on function public.cron_last_tick() from public, anon, authenticated;
grant execute on function public.cron_last_tick() to anon, authenticated, service_role;
