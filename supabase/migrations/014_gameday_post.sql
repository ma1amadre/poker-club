-- 014: пост в день игры.
--
-- За settings.gameday_hours_before часов (по умолчанию 5) до начала объявленного вечера cron-tick
-- публикует в группу пост: время и место, банкир, кто идёт / под вопросом / не идёт и кто из
-- постоянных игроков ещё не ответил (с упоминанием). Тексты — _shared/messages.ts (gamedayPost),
-- решение «писать ли» — _shared/gameday.ts (decideGamedayPost), шаг — cron-tick.
--
-- 1) settings.gameday_hours_before int default 5, 1–48: за сколько часов до начала пост. Верх — двое
--    суток: дальше это уже не «день игры», а второй анонс. Правит админка «Клуб» → «Расписание».
-- 2) evenings.gameday_posted_at timestamptz — пост ушёл (или не нужен: анонс ушёл уже внутри окна
--    дня игры). Защита от дублей — тот же приём «застолбить → отправить → при ошибке снять», что у
--    announce_posted_at (notify/results.ts, publishOnce).
-- 3) Вечер перенесли на другой московский день — gameday_posted_at снимается (триггер
--    evenings_reset_gameday_post): в новый день пост уйдёт снова. Перенос в пределах того же дня
--    отметку не трогает — о новом времени группе пишет пост о переносе (notify evening_changed).
--
-- Гранты: новые колонки в существующих таблицах. Права на settings и evenings выданы на таблицу
-- целиком (002: authenticated — select, insert, update; 011: service_role — select/insert/update/
-- delete), они распространяются и на новые колонки — отдельный grant не нужен. Форма админки
-- сохраняет settings обычным update под RLS settings_update_admin (только is_admin()).

-- ---------------------------------------------------------------------------
-- 1. Настройка
-- ---------------------------------------------------------------------------
alter table public.settings
  add column gameday_hours_before int not null default 5
  check (gameday_hours_before between 1 and 48);

comment on column public.settings.gameday_hours_before is
  'За сколько часов до начала объявленного вечера бот публикует пост в день игры (кто идёт, кто не ответил). 1–48. Миграция 014.';

-- ---------------------------------------------------------------------------
-- 2. Отметка поста
-- ---------------------------------------------------------------------------
alter table public.evenings add column gameday_posted_at timestamptz;

comment on column public.evenings.gameday_posted_at is
  'Пост в день игры ушёл (или не понадобился: анонс ушёл уже внутри окна). Пишет только cron-tick; перенос вечера на другой московский день снимает отметку (триггер evenings_reset_gameday_post). Миграция 014.';

-- ---------------------------------------------------------------------------
-- 3. Перенос на другой день снимает отметку
-- ---------------------------------------------------------------------------
-- Форма админки сохраняет вечер upsert-ом (insert … on conflict do update): у конфликтной строки
-- срабатывает before update с old/new — путь записи не важен.
create function private.evenings_reset_gameday_post()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.gameday_posted_at is not null
     and (old.scheduled_at at time zone 'Europe/Moscow')::date
         is distinct from (new.scheduled_at at time zone 'Europe/Moscow')::date then
    new.gameday_posted_at := null;
  end if;
  return new;
end;
$$;

revoke execute on function private.evenings_reset_gameday_post() from public, anon, authenticated;

create trigger evenings_reset_gameday_post
  before update of scheduled_at on public.evenings
  for each row execute function private.evenings_reset_gameday_post();
