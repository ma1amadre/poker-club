-- 025: пост «Итоги сезона» — один раз на сезон (аудит 07.10.2026, «Итоги сезона как событие»).
-- В первый день нового квартала после 12:00 МСК cron-tick пишет в группу итоги прошлого сезона: чемпион,
-- подиум, «Оракул сезона», лидер по деньгам, лучший охотник, рекорды сезона (notify/season.ts). Отметка
-- «пост ушёл» — строка public.season_posts на ключ сезона ('2026-Q4', квартал по Москве, как seasonKey
-- домена). Защита от дублей — тот же приём «застолбить → отправить → при ошибке снять», что у
-- evenings.*_posted_at: cron-tick вставляет строку (on conflict do nothing — одновременный тик её не
-- вставит и не напишет), шлёт пост, при сбое Telegram удаляет её — следующий тик повторит. Пост итогов
-- вечера по этой же таблице не повторяет чемпиона и сезонные ачивки (notify/results.ts).
--
-- Гранты: новая таблица — RLS без политик, права только service_role (как admin_alerts 012 и
-- cron_heartbeat 021): клиенту она не нужна, пишет и читает только cron-tick/notify.

create table public.season_posts (
  season_key text primary key check (season_key ~ '^[0-9]{4}-Q[1-4]$'),
  posted_at  timestamptz not null default now()
);

comment on table public.season_posts is
  'Пост «Итоги сезона» ушёл в группу (025): строка на сезон. Пишет только cron-tick (notify/season.ts); при сбое Telegram строка снимается.';

alter table public.season_posts enable row level security;

-- Прав по умолчанию нет (ARCHITECTURE.md, «Гранты»); локально default privileges дают service_role ещё
-- truncate/references/trigger — снимаем, чтобы права совпадали с облаком.
revoke all on table public.season_posts from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.season_posts to service_role;
