-- 008_reopen_merge_announce.sql — решения пользователя от 06.10.2026.
--
-- 1) «Расчёт закрыт» снимается правкой журнала. Любое новое событие (add_event любого типа, в том
--    числе платёж банкира и join через add_guest) или отмена события (void_event) у вечера
--    в статусе settled атомарно возвращает его в finished: settled_at = null, а settle_reopened_at
--    запоминает, что расчёт открылся сам (экраны вечера и расчёта объясняют почему). Сделано
--    триггером на evening_events, а не правкой каждой RPC: одна точка на все пути записи журнала,
--    включая будущие. mark_settled и unmark_settled метку снимают.
-- 2) merge_players — слияние гостя (игрок без Telegram) с Telegram-профилем: всё, что связано
--    с гостем, переходит на профиль, гость удаляется. merge_players_preview — то же без записи:
--    что перенесётся и что мешает (для подтверждения в админке).
-- 3) announce_snapshot — что группа знает о вечере из постов бота (время, место, отменён ли).
--    notify (kind evening_changed) и cron-tick сравнивают его с вечером и пишут в группу о переносе,
--    отмене или возврате вечера; снимок переставляется по старому значению — это защита от дублей.
-- 4) set_prediction гостей не ограничивает (любой существующий игрок) — правка не нужна.

-- ---------------------------------------------------------------------------
-- 1. Правка журнала открывает закрытый расчёт
-- ---------------------------------------------------------------------------
alter table public.evenings add column settle_reopened_at timestamptz;

comment on column public.evenings.settle_reopened_at is
  'Когда закрытый расчёт открылся сам из-за правки журнала (миграция 008); null — не открывался или его снова закрыли.';

create function private.reopen_settlement_on_journal_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Баланс банкира «сошёлся в ноль» по старому журналу; после правки это уже не факт.
  update public.evenings
  set status = 'finished',
      settled_at = null,
      settle_reopened_at = now()
  where id = new.evening_id
    and status = 'settled';
  return null;
end;
$$;

revoke execute on function private.reopen_settlement_on_journal_change() from public, anon, authenticated;

create trigger evening_events_reopen_settlement_on_insert
  after insert on public.evening_events
  for each row execute function private.reopen_settlement_on_journal_change();

-- Только сама отмена: перепривязка игрока в merge_players меняет payload/created_by, а не voided_at.
create trigger evening_events_reopen_settlement_on_void
  after update of voided_at on public.evening_events
  for each row
  when (old.voided_at is null and new.voided_at is not null)
  execute function private.reopen_settlement_on_journal_change();

create or replace function public.mark_settled(p_evening uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_player();
  v_ev public.evenings;
begin
  select e.* into v_ev
  from public.evenings e
  where e.id = p_evening
  for update;

  if not found then
    raise exception 'Вечер не найден'
      using errcode = '22023';
  end if;
  if not public.is_admin() and v_ev.banker_id is distinct from v_me then
    raise exception 'Закрыть расчёт может только банкир вечера или админ'
      using errcode = '42501';
  end if;

  if v_ev.status = 'settled' then
    return; -- повторное нажатие — не ошибка
  end if;
  if v_ev.status <> 'finished' then
    raise exception 'Закрыть расчёт можно только после окончания игры'
      using errcode = 'P0001';
  end if;

  update public.evenings
  set status = 'settled',
      settled_at = now(),
      settle_reopened_at = null
  where id = v_ev.id;
end;
$$;

create or replace function public.unmark_settled(p_evening uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_player();
  v_ev public.evenings;
begin
  select e.* into v_ev
  from public.evenings e
  where e.id = p_evening
  for update;

  if not found then
    raise exception 'Вечер не найден'
      using errcode = '22023';
  end if;
  if not public.is_admin() and v_ev.banker_id is distinct from v_me then
    raise exception 'Открыть расчёт может только банкир вечера или админ'
      using errcode = '42501';
  end if;

  if v_ev.status = 'finished' then
    return;
  end if;
  if v_ev.status <> 'settled' then
    raise exception 'Расчёт этого вечера не закрыт'
      using errcode = 'P0001';
  end if;

  -- Открыли руками — пометка «открылся сам из-за правки» тут ни к чему.
  update public.evenings
  set status = 'finished',
      settled_at = null,
      settle_reopened_at = null
  where id = v_ev.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Снимок анонса
-- ---------------------------------------------------------------------------
-- {scheduledAt: ISO UTC, location: text|null, cancelled: bool} — как его строит
-- supabase/functions/_shared/announce.ts (announceSnapshot). Пишут только функции (service_role).
alter table public.evenings
  add column announce_snapshot jsonb
  check (announce_snapshot is null or jsonb_typeof(announce_snapshot) = 'object');

comment on column public.evenings.announce_snapshot is
  'Что группа знает о вечере из постов бота: {scheduledAt, location, cancelled}. Миграция 008.';

-- Уже объявленные вечера: считаем, что группа знает их текущее состояние (истории правок нет).
update public.evenings
set announce_snapshot = jsonb_build_object(
      'scheduledAt', to_char(scheduled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'location', nullif(btrim(location), ''),
      'cancelled', status = 'cancelled')
where announce_posted_at is not null;

-- ---------------------------------------------------------------------------
-- 2. Слияние гостя с Telegram-профилем
-- ---------------------------------------------------------------------------

-- «10 сентября» — дата вечера по Москве для текстов ошибок.
create function private.club_date_text(p_at timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select extract(day from (p_at at time zone 'Europe/Moscow'))::int || ' ' ||
         (array['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа',
                'сентября', 'октября', 'ноября', 'декабря'])
           [extract(month from (p_at at time zone 'Europe/Moscow'))::int]
$$;

-- payload события с заменой игрока: playerId и элементы by (порядок by сохраняется — остаток
-- головы достаётся первому в списке). Остальные поля не трогаются.
create function private.payload_replace_player(p_payload jsonb, p_from uuid, p_to uuid)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
           when p_payload ->> 'playerId' = p_from::text
             then jsonb_set(p_payload, '{playerId}', to_jsonb(p_to::text))
           else p_payload
         end
         || case
              when jsonb_typeof(p_payload -> 'by') = 'array'
                then jsonb_build_object('by', coalesce(
                  (select jsonb_agg(
                            case when x.value = to_jsonb(p_from::text) then to_jsonb(p_to::text)
                                 else x.value end
                            order by x.ord)
                   from jsonb_array_elements(p_payload -> 'by') with ordinality as x(value, ord)),
                  '[]'::jsonb))
              else '{}'::jsonb
            end
$$;

-- Что перенесётся и что мешает слиянию. Бросает 22023 на неверных аргументах; препятствия по
-- данным возвращает списком blockers (текстом для админа).
create function private.merge_players_report(p_guest uuid, p_target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_guest    public.players;
  v_target   public.players;
  v_g        text;
  v_t        text;
  v_blockers text[] := '{}';
  v_row      record;
  v_cat      jsonb := '{"hand": "«Рука вечера»", "bluff": "«Блеф вечера»", "badbeat": "«Бэд-бит вечера»"}';
begin
  if p_guest is null or p_target is null then
    raise exception 'Выбери гостя и Telegram-профиль'
      using errcode = '22023';
  end if;
  if p_guest = p_target then
    raise exception 'Это один и тот же игрок'
      using errcode = '22023';
  end if;

  select p.* into v_guest from public.players p where p.id = p_guest;
  if not found then
    raise exception 'Гость не найден — обнови список игроков'
      using errcode = '22023';
  end if;
  select p.* into v_target from public.players p where p.id = p_target;
  if not found then
    raise exception 'Telegram-профиль не найден — обнови список игроков'
      using errcode = '22023';
  end if;
  if v_guest.tg_id is not null or v_guest.auth_user_id is not null then
    raise exception '«%» входит через Telegram — привязать можно только профиль без Telegram',
      v_guest.display_name
      using errcode = '22023';
  end if;
  if v_target.tg_id is null then
    raise exception 'У «%» нет Telegram — выбери профиль, который входит через Telegram',
      v_target.display_name
      using errcode = '22023';
  end if;

  v_g := p_guest::text;
  v_t := p_target::text;

  -- Оба в действующих записях одного журнала: после слияния один человек сыграл бы за двоих
  -- (два входа, вылет от самого себя) — это не перенос, а порча вечера.
  for v_row in
    with refs as (
      select ee.evening_id, ee.payload ->> 'playerId' as pid
      from public.evening_events ee
      where ee.voided_at is null
        and ee.payload ? 'playerId'
      union
      select ee.evening_id, b.value
      from public.evening_events ee
      cross join lateral jsonb_array_elements_text(
        case when jsonb_typeof(ee.payload -> 'by') = 'array' then ee.payload -> 'by'
             else '[]'::jsonb end) as b(value)
      where ee.voided_at is null
    )
    select e.scheduled_at
    from public.evenings e
    where exists (select 1 from refs r where r.evening_id = e.id and r.pid = v_g)
      and exists (select 1 from refs r where r.evening_id = e.id and r.pid = v_t)
    order by e.scheduled_at
  loop
    v_blockers := v_blockers || format(
      'Оба в журнале вечера %s — один человек не может сыграть за двоих. Исправь журнал этого вечера.',
      private.club_date_text(v_row.scheduled_at));
  end loop;

  for v_row in
    select e.scheduled_at
    from public.rsvps g
    join public.rsvps t on t.evening_id = g.evening_id and t.player_id = p_target
    join public.evenings e on e.id = g.evening_id
    where g.player_id = p_guest
      and g.status <> t.status
    order by e.scheduled_at
  loop
    v_blockers := v_blockers || format(
      'Оба ответили на анонс вечера %s, и ответы разные.', private.club_date_text(v_row.scheduled_at));
  end loop;

  -- Прогнозы сравниваем уже с подменой гостя на профиль.
  for v_row in
    select e.scheduled_at
    from public.predictions g
    join public.predictions t on t.evening_id = g.evening_id and t.player_id = p_target
    join public.evenings e on e.id = g.evening_id
    where g.player_id = p_guest
      and ((case when g.winner_id = p_guest then p_target else g.winner_id end)
             is distinct from (case when t.winner_id = p_guest then p_target else t.winner_id end)
        or (case when g.first_out_id = p_guest then p_target else g.first_out_id end)
             is distinct from (case when t.first_out_id = p_guest then p_target else t.first_out_id end))
    order by e.scheduled_at
  loop
    v_blockers := v_blockers || format(
      'Оба сделали прогноз на вечер %s, и прогнозы разные.', private.club_date_text(v_row.scheduled_at));
  end loop;

  for v_row in
    select e.scheduled_at, g.category
    from public.votes g
    join public.votes t
      on t.evening_id = g.evening_id and t.category = g.category and t.voter_id = p_target
    join public.evenings e on e.id = g.evening_id
    where g.voter_id = p_guest
      and (g.nominee_id is distinct from t.nominee_id
           or g.caption is distinct from t.caption
           or g.photo_path is distinct from t.photo_path)
    order by e.scheduled_at, g.category
  loop
    v_blockers := v_blockers || format(
      'Оба голосовали в номинации %s вечера %s, и голоса разные.',
      v_cat ->> v_row.category, private.club_date_text(v_row.scheduled_at));
  end loop;

  for v_row in
    select e.scheduled_at
    from public.votes v
    join public.evenings e on e.id = v.evening_id
    where (v.voter_id = p_guest and v.nominee_id = p_target)
       or (v.voter_id = p_target and v.nominee_id = p_guest)
    order by e.scheduled_at
  loop
    v_blockers := v_blockers || format(
      'В вечере %s один из них голосовал за другого — после слияния это был бы голос за себя.',
      private.club_date_text(v_row.scheduled_at));
  end loop;

  -- Фото голосов остаются в папке гостя {вечер}/{гость}/ (объекты Storage SQL не переносит).
  -- После закрытия голосования это ничего не ломает; пока оно открыто, профиль не смог бы
  -- переголосовать с этим фото (cast_vote принимает только свою папку).
  for v_row in
    select e.scheduled_at
    from public.votes v
    join public.evenings e on e.id = v.evening_id
    where v.voter_id = p_guest
      and v.photo_path is not null
      and (e.voting_closes_at is null or e.voting_closes_at > now())
    order by e.scheduled_at
  loop
    v_blockers := v_blockers || format(
      'У гостя есть фото к голосу за вечер %s, а голосование ещё идёт. Привяжи после его закрытия.',
      private.club_date_text(v_row.scheduled_at));
  end loop;

  return jsonb_build_object(
    'guest', jsonb_build_object('id', v_guest.id, 'name', v_guest.display_name),
    'target', jsonb_build_object('id', v_target.id, 'name', v_target.display_name),
    -- Сыгранные вечера: есть действующий join гостя.
    'evenings', (
      select count(distinct ee.evening_id)
      from public.evening_events ee
      where ee.type = 'join' and ee.voided_at is null and ee.payload ->> 'playerId' = v_g),
    'events', (
      select count(*)
      from public.evening_events ee
      where ee.payload ->> 'playerId' = v_g
         or (jsonb_typeof(ee.payload -> 'by') = 'array' and ee.payload -> 'by' ? v_g)),
    'votesReceived', (select count(*) from public.votes v where v.nominee_id = p_guest),
    'votesCast', (select count(*) from public.votes v where v.voter_id = p_guest),
    'predictionsAbout', (
      select count(*) from public.predictions p
      where p.winner_id = p_guest or p.first_out_id = p_guest),
    'predictionsMade', (select count(*) from public.predictions p where p.player_id = p_guest),
    'rsvps', (select count(*) from public.rsvps r where r.player_id = p_guest),
    'bankerOf', (select count(*) from public.evenings e where e.banker_id = p_guest),
    'photosKept', (
      select count(*) from public.votes v where v.voter_id = p_guest and v.photo_path is not null),
    'blockers', to_jsonb(v_blockers));
end;
$$;

-- Предпросмотр для подтверждения в админке: что перенесётся и что мешает. Только админ.
create function public.merge_players_preview(p_guest uuid, p_target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_player();
  if not public.is_admin() then
    raise exception 'Связывать игроков может только админ'
      using errcode = '42501';
  end if;
  return private.merge_players_report(p_guest, p_target);
end;
$$;

-- Слияние: всё гостя — на Telegram-профиль, гость удаляется. Атомарно; при препятствии — P0001
-- с перечнем причин, ничего не меняется. Возвращает отчёт, как merge_players_preview.
create function public.merge_players(p_guest uuid, p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report jsonb;
  v_rows   jsonb;
  v_g      text := p_guest::text;
begin
  perform private.require_player();
  if not public.is_admin() then
    raise exception 'Связывать игроков может только админ'
      using errcode = '42501';
  end if;

  -- Все вечера под блокировкой — тот же порядок, что у add_event/void_event (сначала вечер):
  -- параллельная запись в журнал дождётся слияния и увидит уже перенесённые id.
  perform 1 from public.evenings e order by e.id for update;
  perform 1 from public.players p where p.id in (p_guest, p_target) order by p.id for update;

  v_report := private.merge_players_report(p_guest, p_target);
  if jsonb_array_length(v_report -> 'blockers') > 0 then
    raise exception 'Слить «%» и «%» нельзя: %',
      v_report #>> '{guest,name}', v_report #>> '{target,name}',
      (select string_agg(b.value, ' ') from jsonb_array_elements_text(v_report -> 'blockers') as b(value))
      using errcode = 'P0001';
  end if;

  -- Журнал: playerId и элементы by — точной заменой значения; created_by / voided_by.
  -- voided_at не трогаем — триггер «правка открывает расчёт» не срабатывает: итог вечера тот же.
  update public.evening_events ee
  set payload = private.payload_replace_player(ee.payload, p_guest, p_target)
  where ee.payload ->> 'playerId' = v_g
     or (jsonb_typeof(ee.payload -> 'by') = 'array' and ee.payload -> 'by' ? v_g);
  update public.evening_events set created_by = p_target where created_by = p_guest;
  update public.evening_events set voided_by = p_target where voided_by = p_guest;

  update public.evenings set banker_id = p_target where banker_id = p_guest;
  update public.evenings set created_by = p_target where created_by = p_guest;

  -- rsvps и predictions: удалить и вставить заново, а не update — триггер updated_at переписал бы
  -- время ответа (по нему идёт порядок «кто ответил раньше»). Совпадающие строки профиля уже есть
  -- (препятствия выше гарантируют, что они равны) — on conflict do nothing.
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows
  from public.rsvps r where r.player_id = p_guest;
  delete from public.rsvps r where r.player_id = p_guest;
  insert into public.rsvps (evening_id, player_id, status, updated_at)
  select x.evening_id, p_target, x.status, x.updated_at
  from jsonb_populate_recordset(null::public.rsvps, v_rows) as x
  on conflict (evening_id, player_id) do nothing;

  select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) into v_rows
  from public.predictions p
  where p.player_id = p_guest or p.winner_id = p_guest or p.first_out_id = p_guest;
  delete from public.predictions p
  where p.player_id = p_guest or p.winner_id = p_guest or p.first_out_id = p_guest;
  insert into public.predictions (evening_id, player_id, winner_id, first_out_id, updated_at)
  select x.evening_id,
         case when x.player_id = p_guest then p_target else x.player_id end,
         case when x.winner_id = p_guest then p_target else x.winner_id end,
         case when x.first_out_id = p_guest then p_target else x.first_out_id end,
         x.updated_at
  from jsonb_populate_recordset(null::public.predictions, v_rows) as x
  on conflict (evening_id, player_id) do nothing;

  -- Голоса: тем же приёмом (check voter <> nominee проверяется уже на итоговых строках).
  -- photo_path не меняется: файл остаётся в папке гостя, см. merge_players_report.
  select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) into v_rows
  from public.votes v where v.voter_id = p_guest or v.nominee_id = p_guest;
  delete from public.votes v where v.voter_id = p_guest or v.nominee_id = p_guest;
  insert into public.votes (evening_id, voter_id, category, nominee_id, caption, photo_path, created_at)
  select x.evening_id,
         case when x.voter_id = p_guest then p_target else x.voter_id end,
         x.category,
         case when x.nominee_id = p_guest then p_target else x.nominee_id end,
         x.caption, x.photo_path, x.created_at
  from jsonb_populate_recordset(null::public.votes, v_rows) as x
  on conflict (evening_id, voter_id, category) do nothing;

  update public.players set is_guest = false where id = p_target;
  -- Ссылок на гостя больше нет: внешние ключи пустые, в payload его id не осталось. Удаляем,
  -- чтобы не висел дублем в списках. Пропущенная ссылка с внешним ключом уронит удаление
  -- (а с ним и всё слияние) — это лучше тихой потери.
  delete from public.players where id = p_guest;

  return v_report;
end;
$$;

comment on function public.merge_players(uuid, uuid) is
  'Админ: перенести всё гостя (без Telegram) на Telegram-профиль и удалить гостя. Миграция 008.';
comment on function public.merge_players_preview(uuid, uuid) is
  'Админ: что перенесёт merge_players и что ему мешает (blockers). Ничего не меняет. Миграция 008.';

-- ---------------------------------------------------------------------------
-- Гранты
-- ---------------------------------------------------------------------------
revoke execute on function
  public.merge_players(uuid, uuid),
  public.merge_players_preview(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function
  private.club_date_text(timestamptz),
  private.payload_replace_player(jsonb, uuid, uuid),
  private.merge_players_report(uuid, uuid)
  from public, anon, authenticated;

grant execute on function
  public.merge_players(uuid, uuid),
  public.merge_players_preview(uuid, uuid)
  to authenticated, service_role;
