-- 012_admin_alerts.sql — журнал оповещений админа о сбоях автоматики (_shared/alerts.ts).
-- cron-tick и notify при сбое пишут админу клуба в личку от бота. Чтобы сломанный шаг cron-tick
-- (раз в 15 минут) не засыпал админа сообщениями, по каждому ключу сбоя шлётся не больше одного
-- сообщения в 6 часов, а подавленные повторы считаются и попадают в следующее сообщение.
--
-- key              — ключ сбоя: вид ('cron_announce', 'cron_crash', 'notify_post', …) или код ответа
--                    Telegram ('telegram:403', 'telegram:network') — бот, выкинутый из группы, ломает
--                    сразу несколько шагов, а сообщение об этом одно;
-- last_sent_at     — когда ушло последнее сообщение по ключу;
-- suppressed_count — сколько раз сбой повторился после него (обнуляется при отправке).
-- Запись — compare-and-set из функции (update … where last_sent_at = прочитанное and
-- suppressed_count = прочитанное), поэтому одновременные notify и cron-tick не пришлют два сообщения.
--
-- Доступ только service_role (Edge Functions): клиенту Mini App журнал не нужен. RLS включён и без
-- политик — authenticated и anon не видят ничего даже при случайном гранте; service_role RLS обходит.

create table public.admin_alerts (
  key              text primary key check (char_length(key) between 1 and 200),
  last_sent_at     timestamptz not null,
  suppressed_count integer not null default 0 check (suppressed_count >= 0),
  updated_at       timestamptz not null default now()
);

comment on table public.admin_alerts is
  'Троттлинг оповещений админа о сбоях автоматики (supabase/functions/_shared/alerts.ts). Только service_role.';

alter table public.admin_alerts enable row level security;

-- Прав по умолчанию на новые таблицы в облаке нет (ARCHITECTURE.md, «Гранты») — выдаём явно и только
-- функциям. Локально default privileges дают service_role ещё truncate/references/trigger — снимаем,
-- чтобы права совпадали с облаком.
revoke all on table public.admin_alerts from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.admin_alerts to service_role;
