-- 002_helpers_rls.sql — хелперы прав, RLS и гранты.
--
-- Модель доступа:
--   * anon не видит ни одной таблицы; ему доступна только RPC board_state (выдаётся в 003).
--   * authenticated читает всё, если он активный участник клуба (current_player_id() не null);
--     исключения — чужие прогнозы и голоса, пока они должны быть скрыты.
--   * evening_events / rsvps / predictions / votes пишутся только через RPC (003):
--     у authenticated нет на них insert/update/delete вовсе — RLS тут вторая линия, а не первая.
--   * players / settings / formats / evenings — insert/update только админу.
-- Realtime postgres_changes проверяет select-политики от имени подписчика, поэтому хелперы,
-- которые в них вызываются, должны быть исполняемы для authenticated (см. гранты ниже).

-- ---------------------------------------------------------------------------
-- Хелперы (security definer: читают players в обход RLS, иначе политика players
-- вызывала бы саму себя через current_player_id)
-- ---------------------------------------------------------------------------
create function public.current_player_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.players p
  where p.auth_user_id = auth.uid()
    and p.is_active
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.is_admin
     from public.players p
     where p.auth_user_id = auth.uid()
       and p.is_active),
    false)
$$;

create function public.is_banker(evening uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.evenings e
    where e.id = is_banker.evening
      and e.banker_id = public.current_player_id())
$$;

-- Участник вечера = есть не отменённый join. Гость тоже участник.
create function public.is_participant(evening uuid, player uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.evening_events ev
    where ev.evening_id = is_participant.evening
      and ev.type = 'join'
      and ev.voided_at is null
      and ev.payload ->> 'playerId' = is_participant.player::text)
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.players        enable row level security;
alter table public.settings       enable row level security;
alter table public.formats        enable row level security;
alter table public.evenings       enable row level security;
alter table public.evening_events enable row level security;
alter table public.rsvps          enable row level security;
alter table public.predictions    enable row level security;
alter table public.votes          enable row level security;

-- (select f()) вместо f(): Postgres считает значение один раз на запрос (initPlan), а не на строку.

-- players
create policy players_select_members on public.players
  for select to authenticated
  using ((select public.current_player_id()) is not null);

create policy players_insert_admin on public.players
  for insert to authenticated
  with check ((select public.is_admin()));

create policy players_update_admin on public.players
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- settings
create policy settings_select_members on public.settings
  for select to authenticated
  using ((select public.current_player_id()) is not null);

create policy settings_insert_admin on public.settings
  for insert to authenticated
  with check ((select public.is_admin()));

create policy settings_update_admin on public.settings
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- formats
create policy formats_select_members on public.formats
  for select to authenticated
  using ((select public.current_player_id()) is not null);

create policy formats_insert_admin on public.formats
  for insert to authenticated
  with check ((select public.is_admin()));

create policy formats_update_admin on public.formats
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- evenings
create policy evenings_select_members on public.evenings
  for select to authenticated
  using ((select public.current_player_id()) is not null);

create policy evenings_insert_admin on public.evenings
  for insert to authenticated
  with check ((select public.is_admin()));

create policy evenings_update_admin on public.evenings
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- evening_events / rsvps: только чтение, запись — RPC
create policy evening_events_select_members on public.evening_events
  for select to authenticated
  using ((select public.current_player_id()) is not null);

create policy rsvps_select_members on public.rsvps
  for select to authenticated
  using ((select public.current_player_id()) is not null);

-- predictions: свои всегда; чужие — когда приём прогнозов закрыт (вечер уже не announced),
-- иначе первый же прогноз подсказывал бы остальным.
create policy predictions_select_own_or_closed on public.predictions
  for select to authenticated
  using (
    (select public.current_player_id()) is not null
    and (
      player_id = (select public.current_player_id())
      or exists (
        select 1
        from public.evenings e
        where e.id = predictions.evening_id
          and e.status <> 'announced')));

-- votes: свои всегда; чужие — только после закрытия голосования, чтобы не было «голосования за лидера».
create policy votes_select_own_or_closed on public.votes
  for select to authenticated
  using (
    (select public.current_player_id()) is not null
    and (
      voter_id = (select public.current_player_id())
      or exists (
        select 1
        from public.evenings e
        where e.id = votes.evening_id
          and e.voting_closes_at is not null
          and e.voting_closes_at <= now())));

-- ---------------------------------------------------------------------------
-- Гранты
-- ---------------------------------------------------------------------------
-- Supabase по умолчанию раздаёт anon/authenticated ВСЕ права на новые таблицы и функции public
-- (включая truncate, который RLS не проверяет). Снимаем и выдаём ровно нужное.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant select on
  public.players, public.settings, public.formats, public.evenings,
  public.evening_events, public.rsvps, public.predictions, public.votes
  to authenticated;

grant insert, update on
  public.players, public.settings, public.formats, public.evenings
  to authenticated;

-- Хелперы вызываются внутри RLS-политик от имени пользователя — без execute запрос упадёт.
grant execute on function
  public.current_player_id(),
  public.is_admin(),
  public.is_banker(uuid),
  public.is_participant(uuid, uuid)
  to authenticated;

-- service_role (Edge Functions) RLS обходит, но гранты ему нужны явно после revoke from public.
grant execute on function
  public.current_player_id(),
  public.is_admin(),
  public.is_banker(uuid),
  public.is_participant(uuid, uuid)
  to service_role;

-- Чтобы таблица или функция из будущей миграции не оказалась открытой anon «по умолчанию»:
-- снимаем выдачу Supabase по умолчанию для объектов, которые создаёт postgres в public.
-- Каждая новая миграция выдаёт права явно. Глобальный execute для PUBLIC так не снять
-- (он не по схеме) — его по-прежнему отзывают поимённо, как в 003.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
