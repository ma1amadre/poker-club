-- 013: снимок правил очков — смена настроек больше не переписывает прошлое.
--
-- До этой миграции очки за нокаут (settings.ko_points), бонус за победу (settings.win_bonus) и
-- «лучшие N вечеров» сезона (settings.season_best_n) всегда брались из текущих настроек, и любая их
-- правка пересчитывала всю историю: прошлые сезоны, Зал славы, уже объявленных чемпионов.
--
-- 1) evenings.scoring jsonb {koPoints, winBonus} — правила очков, по которым считается вечер.
--    Ставит триггер в момент, когда вечер становится завершённым (finish в add_event, вставка уже
--    завершённого вечера), по текущим settings. Пока вечер завершён (finished ↔ settled, правки
--    журнала, правка вечера в админке), снимок не меняется и снаружи не пишется. Вечер вернулся
--    в игру (отмена finish в void_event) — снимок снимается; повторный finish берёт новый.
--    Инвариант (constraint): снимок есть ровно у finished/settled.
-- 2) season_rules (season_key, best_n, frozen_at) — «лучшие N» закрытых сезонов. Значение сезона
--    может разойтись с настройкой только в одном случае: настройку поменяли после конца сезона.
--    Поэтому заморозка — в момент такой правки: триггер на settings.season_best_n перед сменой
--    записывает прежнее значение всем ещё не замороженным прошедшим кварталам (от квартала самого
--    раннего вечера клуба до предыдущего). Пока правки не было, текущее значение и есть значение на
--    конец сезона — домен берёт его (bestNForSeason). Точнее, чем заморозка по первому тику cron:
--    нет окна между концом квартала и тиком, не зависит от того, работает ли cron и задеплоены ли
--    функции. Текущий сезон всегда живёт по settings.season_best_n.
-- Существующие данные: завершённым вечерам — снимок текущих настроек, прошедшим кварталам — текущее
-- season_best_n (других значений история не сохранила).

-- ---------------------------------------------------------------------------
-- 1. Снимок правил очков вечера
-- ---------------------------------------------------------------------------
alter table public.evenings add column scoring jsonb;

comment on column public.evenings.scoring is
  'Правила очков вечера {koPoints, winBonus}: снимок settings.ko_points/win_bonus в момент завершения. Есть ровно у finished/settled; ставит и снимает триггер evenings_scoring_snapshot, снаружи не пишется. Миграция 013.';

-- Текущие правила очков клуба в форме снимка. Строка settings есть всегда (001/011); coalesce —
-- только чтобы инвариант «снимок у завершённого» не упал, если её всё же нет (значения — дефолты 001).
create function private.current_scoring()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'koPoints', coalesce((select s.ko_points from public.settings s where s.id = 1), 0.5),
           'winBonus', coalesce((select s.win_bonus from public.settings s where s.id = 1), 1))
$$;

revoke execute on function private.current_scoring() from public, anon, authenticated;

-- Существующие завершённые вечера — по текущим настройкам: прежних значений история не хранит.
update public.evenings
set scoring = private.current_scoring()
where status in ('finished', 'settled');

alter table public.evenings
  add constraint evenings_scoring_shape check (
    scoring is null or (
      jsonb_typeof(scoring) = 'object'
      and case when jsonb_typeof(scoring -> 'koPoints') = 'number'
               then (scoring ->> 'koPoints')::numeric >= 0 else false end
      and case when jsonb_typeof(scoring -> 'winBonus') = 'number'
               then (scoring ->> 'winBonus')::numeric >= 0 else false end)),
  add constraint evenings_scoring_when_closed check (
    (status in ('finished', 'settled')) = (scoring is not null));

-- security definer: читает settings от имени владельца — путь записи (add_event, void_event, форма
-- админки, service_role) не важен.
create function private.evenings_scoring_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status not in ('finished', 'settled') then
    -- В игре, в анонсе, отменён: очков нет — и снимка нет. Отмена finish снимает его здесь.
    new.scoring := null;
  elsif tg_op = 'UPDATE' and old.status in ('finished', 'settled') and old.scoring is not null then
    -- Вечер и был завершён: finished ↔ settled, открытие расчёта правкой журнала, форма админки,
    -- upsert со старым значением — снимок остаётся тем, что зафиксировал finish.
    new.scoring := old.scoring;
  else
    -- Вечер только что завершился (или вставлен завершённым) — правила на этот момент.
    new.scoring := private.current_scoring();
  end if;
  return new;
end;
$$;

revoke execute on function private.evenings_scoring_snapshot() from public, anon, authenticated;

create trigger evenings_scoring_snapshot
  before insert or update on public.evenings
  for each row execute function private.evenings_scoring_snapshot();

-- ---------------------------------------------------------------------------
-- 2. «Лучшие N» закрытых сезонов
-- ---------------------------------------------------------------------------
create table public.season_rules (
  season_key text primary key check (season_key ~ '^[0-9]{4}-Q[1-4]$'),
  best_n     int not null check (best_n >= 1),
  frozen_at  timestamptz not null default now()
);

comment on table public.season_rules is
  '«Лучшие N вечеров» закрытых сезонов (season_key как в домене: 2026-Q3, квартал по Москве). Пишет только триггер settings_freeze_season_best_n (и backfill миграции 013); сезона нет — действует settings.season_best_n. Миграция 013.';

alter table public.season_rules enable row level security;

create policy season_rules_select_members on public.season_rules
  for select to authenticated
  using ((select public.current_player_id()) is not null);

-- Клиенту — только чтение (рейтинг, Зал славы, ачивки); запись — триггер от имени владельца.
-- service_role — как у всех таблиц public (011, «Гранты»): функции читают для итогов вечера.
grant select on public.season_rules to authenticated;
grant select, insert, update, delete on public.season_rules to service_role;

-- Замораживает p_best_n всем прошедшим кварталам без записи: от квартала самого раннего вечера
-- клуба (любой статус — вечер прошлого квартала может завершиться уже в новом) до предыдущего
-- квартала. Уже замороженные не трогает. Возвращает число новых строк. Ключ — квартал по Москве
-- в форме seasonKey из _shared/domain/season.ts ('2026-Q3').
create function private.freeze_past_seasons(p_best_n int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first   timestamp;
  v_current timestamp := date_trunc('quarter', now() at time zone 'Europe/Moscow');
  v_count   int;
begin
  select date_trunc('quarter', min(e.scheduled_at at time zone 'Europe/Moscow'))
  into v_first
  from public.evenings e;

  if v_first is null or v_first >= v_current then
    return 0;
  end if;

  insert into public.season_rules (season_key, best_n, frozen_at)
  select to_char(g.q, 'YYYY-"Q"Q'), p_best_n, now()
  from generate_series(v_first, v_current - interval '3 months', interval '3 months') as g(q)
  on conflict (season_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function private.freeze_past_seasons(int) from public, anon, authenticated;

create function private.settings_freeze_season_best_n()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Прежнее значение действовало до этой минуты — значит, и на конец каждого прошедшего сезона,
  -- который ещё не заморожен (иначе его заморозила бы прошлая правка).
  perform private.freeze_past_seasons(old.season_best_n);
  return new;
end;
$$;

revoke execute on function private.settings_freeze_season_best_n() from public, anon, authenticated;

-- before: заморозка и смена настройки — в одной транзакции, в порядке «сначала прошлое».
create trigger settings_freeze_season_best_n
  before update of season_best_n on public.settings
  for each row
  when (old.season_best_n is distinct from new.season_best_n)
  execute function private.settings_freeze_season_best_n();

-- Существующие прошедшие сезоны — текущим значением (другого история не сохранила).
select private.freeze_past_seasons(s.season_best_n)
from public.settings s
where s.id = 1;
