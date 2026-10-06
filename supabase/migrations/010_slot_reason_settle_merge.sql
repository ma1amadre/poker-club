-- 010: исправления по ревью от 06.10.2026.
--
-- 1) evenings.slot_date — московский день, за которым вечер закреплён в расписании. Ставит триггер
--    при вставке (по scheduled_at), перенос вечера его не меняет. cron-tick считает слот расписания
--    занятым, если на этот день есть вечер по scheduled_at ИЛИ по slot_date: перенос объявленного
--    вечера с четверга на пятницу больше не порождает второй вечер и свежий анонс на четверг.
-- 2) evenings.cancel_reason — причина отмены для поста в группу. Раньше причиной служила заметка
--    вечера: старая заметка анонса уходила в группу как причина, а причина после возврата вечера
--    оставалась заметкой. Теперь заметка анонса при отмене и возврате не трогается.
-- 3) mark_settled(p_evening, p_last_event_id, p_voided_count) — клиент передаёт, какой журнал он
--    видел (последний id и число отменённых записей). Если журнал с тех пор менялся (платёж
--    записали или отменили с другого устройства), расчёт не закрывается: P0001. Сам баланс
--    по-прежнему считает домен на клиенте.
-- 4) merge_players_report: препятствие «оба в журнале» сначала советует выбрать другой профиль
--    (чаще всего выбран не тот человек), журнал — вторым вариантом.
-- 5) merge_players: перед удалением гостя явно проверяет, что на него не осталось ссылок (все
--    внешние ключи на players — cascade или set null, удаление само бы не упало и тихо стёрло бы
--    данные); текст отказа — «Привязать профиль … к профилю … нельзя», как в интерфейсе.

-- ---------------------------------------------------------------------------
-- 1. Слот расписания
-- ---------------------------------------------------------------------------
alter table public.evenings add column slot_date date;

comment on column public.evenings.slot_date is
  'Московский день, за которым вечер закреплён в расписании: ставится при создании по scheduled_at, перенос его не меняет. cron-tick не создаёт вечер на занятый слот. Миграция 010.';

-- Уже созданные вечера: истории переносов нет — слот по текущему времени.
update public.evenings
set slot_date = (scheduled_at at time zone 'Europe/Moscow')::date;

create function private.evenings_set_slot_date()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.slot_date is null then
    new.slot_date := (new.scheduled_at at time zone 'Europe/Moscow')::date;
  end if;
  return new;
end;
$$;

revoke execute on function private.evenings_set_slot_date() from public, anon, authenticated;

-- Только вставка: upsert формы админки (insert … on conflict do update) slot_date не передаёт,
-- поэтому у существующего вечера он не меняется.
create trigger evenings_set_slot_date
  before insert on public.evenings
  for each row execute function private.evenings_set_slot_date();

create index evenings_slot_date_idx on public.evenings (slot_date);

-- ---------------------------------------------------------------------------
-- 2. Причина отмены
-- ---------------------------------------------------------------------------
alter table public.evenings
  add column cancel_reason text
  check (cancel_reason is null or char_length(cancel_reason) between 1 and 200);

comment on column public.evenings.cancel_reason is
  'Причина отмены для поста в группу (пишет админ вместе с отменой, снимает возврат). Миграция 010.';

-- До 010 причиной отмены служила заметка вечера.
update public.evenings
set cancel_reason = left(nullif(btrim(note), ''), 200)
where status = 'cancelled';

-- ---------------------------------------------------------------------------
-- 3. Закрыть расчёт — только по тому журналу, который видел банкир
-- ---------------------------------------------------------------------------
drop function public.mark_settled(uuid);

create function public.mark_settled(p_evening uuid, p_last_event_id bigint, p_voided_count int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := private.require_player();
  v_ev     public.evenings;
  v_last   bigint;
  v_voided int;
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

  -- add_event и void_event пишут под той же блокировкой вечера: журнал сейчас не меняется.
  -- Новая запись даёт новый id, отмена — ещё одну отменённую (обратно отмену не снимают).
  select coalesce(max(ee.id), 0), count(*) filter (where ee.voided_at is not null)
  into v_last, v_voided
  from public.evening_events ee
  where ee.evening_id = v_ev.id;

  if v_last <> coalesce(p_last_event_id, 0) or v_voided <> coalesce(p_voided_count, 0) then
    raise exception 'Журнал вечера изменился, пока был открыт расчёт: остатки на экране устарели. Проверь их и закрой расчёт снова.'
      using errcode = 'P0001';
  end if;

  update public.evenings
  set status = 'settled',
      settled_at = now(),
      settle_reopened_at = null
  where id = v_ev.id;
end;
$$;

comment on function public.mark_settled(uuid, bigint, int) is
  'Банкир или админ: закрыть расчёт. p_last_event_id и p_voided_count — журнал, который видел клиент (последний id, число отменённых); журнал изменился → P0001. Миграция 010.';

revoke execute on function public.mark_settled(uuid, bigint, int) from public, anon, authenticated;
grant execute on function public.mark_settled(uuid, bigint, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Препятствия слияния (тело из 008, поменялся текст «оба в журнале»)
-- ---------------------------------------------------------------------------
create or replace function private.merge_players_report(p_guest uuid, p_target uuid)
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
  -- (два входа, вылет от самого себя) — это не перенос, а порча вечера. Чаще всего это значит,
  -- что выбран не тот профиль: совет об этом — первым, правка журнала — только если гостя
  -- вписали по ошибке.
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
      'Оба есть в журнале вечера %s — похоже, это разные люди. Выбери другой профиль или, если гостя вписали по ошибке, отмени его записи в журнале этого вечера.',
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

-- ---------------------------------------------------------------------------
-- 5. Слияние: явная проверка, что на гостя не осталось ссылок
-- ---------------------------------------------------------------------------

-- Где ещё упоминается игрок: каждый внешний ключ на public.players (обход pg_constraint — новая
-- таблица со ссылкой на игрока попадёт сюда сама) и payload журнала. Возвращает «таблица.колонка».
create function private.player_references(p_player uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_fk    record;
  v_found boolean;
  v_refs  text[] := '{}';
  v_id    text := p_player::text;
begin
  for v_fk in
    select c.conrelid::regclass::text as tbl, a.attname as col
    from pg_catalog.pg_constraint c
    cross join lateral unnest(c.conkey) as k(attnum)
    join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.contype = 'f'
      and c.confrelid = 'public.players'::regclass
    order by 1, 2
  loop
    execute format('select exists (select 1 from %s where %I = $1)', v_fk.tbl, v_fk.col)
      into v_found
      using p_player;
    if v_found then
      v_refs := v_refs || (v_fk.tbl || '.' || v_fk.col);
    end if;
  end loop;

  if exists (
    select 1
    from public.evening_events ee
    where ee.payload ->> 'playerId' = v_id
       or (jsonb_typeof(ee.payload -> 'by') = 'array' and ee.payload -> 'by' ? v_id)
  ) then
    v_refs := v_refs || 'public.evening_events.payload'::text;
  end if;
  return v_refs;
end;
$$;

revoke execute on function private.player_references(uuid) from public, anon, authenticated;

-- Тело из 008; поменялись текст отказа и проверка ссылок перед удалением гостя.
create or replace function public.merge_players(p_guest uuid, p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report jsonb;
  v_rows   jsonb;
  v_left   text[];
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
    raise exception 'Привязать профиль «%» к профилю «%» нельзя: %',
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

  -- Все внешние ключи на players — on delete cascade или set null: забытая ссылка не уронила бы
  -- удаление, а тихо стёрла бы или обнулила данные гостя. Поэтому проверяем явно: осталась
  -- ссылка (новая таблица, которую не добавили в перенос выше) — отказ, всё слияние откатывается.
  v_left := private.player_references(p_guest);
  if cardinality(v_left) > 0 then
    raise exception 'Привязать профиль «%» к профилю «%» не получилось: перенос не учёл записи в %. Ничего не изменилось. Это ошибка приложения — перешли этот текст разработчику.',
      v_report #>> '{guest,name}', v_report #>> '{target,name}', array_to_string(v_left, ', ')
      using errcode = 'XX000';
  end if;
  delete from public.players where id = p_guest;

  return v_report;
end;
$$;
