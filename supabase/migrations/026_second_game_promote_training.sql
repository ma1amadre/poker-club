-- 026: вторая игра в тот же день и зачёт тренировки как настоящего вечера (решение клуба 10.10.2026).
-- 09.10 после первой игры сыграли вторую, но второй настоящий вечер на ту же московскую дату создать не
-- дал индекс evenings_one_per_club_day_idx (006, 023) — игру провели тренировкой, а пометку «Тренировка»
-- не снять (триггер evenings_training_guard, 023).
-- 1) evenings.game_no — номер игры в московском дне (1, 2, …; по умолчанию 1). Уникальность — по паре
--    «московская дата + game_no» среди настоящих неотменённых вечеров (индекс evenings_club_day_game_idx
--    вместо evenings_one_per_club_day_idx). Вставка без номера — игра 1: cron-tick и форма админки
--    по-прежнему создают только её, и защита от дублей (двойной клик, гонка cron-tick с ручным
--    созданием) работает как раньше.
-- 2) create_next_game(вечер) — «Ещё игра сегодня» на экране завершённого настоящего вечера: банкир этого
--    вечера или админ, не позже 12 ч после финала и только в тот же московский день, что у этой игры
--    (после полуночи новая игра стала бы игрой 1 другой даты — отдельным днём «Железного стула», без
--    состава прошлой игры в шторке посадки; такой вечер назначает админ). Новый вечер — на сейчас, то же
--    место, формат и банкир (банкира нет — тот, кто создаёт), game_no — следующий свободный на дату этой
--    игры; анонс и пост дня игры сразу отмечены отправленными (бот ночью их не пришлёт). Уже есть
--    объявленная или идущая игра того же дня с бо́льшим номером, созданная после финала этой (двойное
--    нажатие, второй телефон, повтор по тайм-ауту — в том числе после полуночи), — она и возвращается.
-- 3) promote_training_evening(вечер) — только админ, только завершённая тренировка, только в одну
--    сторону: снимает is_training (триггер пропускает смену только по флагу сессии
--    poker.promote_training, который ставит эта функция), game_no — следующий свободный на дату вечера,
--    голосование — на 24 ч с момента зачёта, evenings.promoted_at — момент зачёта. results_posted_at не
--    трогает: пост итогов уходит как у обычного вечера (notify с клиента, подстраховка — cron-tick: окно
--    3 суток от финала или от зачёта, иначе тренировку старше 3 суток бот бы не допослал). Снимок очков
--    (scoring) у завершённой тренировки уже есть (013) — он и остаётся.
-- 4) Табло клуба: итог игры уступает анонсу следующей настоящей игры того же дня (иначе итог игры 1
--    до 6 ч перекрывал бы анонс игры 2). Табло отдаёт evening.game_no («· игра 2»).
--
-- Гранты: новая колонка — права на evenings выданы на таблицу целиком (002, 011). Функции — явно;
-- служебные private.* — revoke у public/anon/authenticated.

-- ---------------------------------------------------------------------------
-- 1. Номер игры в дне
-- ---------------------------------------------------------------------------
alter table public.evenings
  add column game_no integer not null default 1
    constraint evenings_game_no_positive check (game_no >= 1);

comment on column public.evenings.game_no is
  'Номер игры в московском дне: 1 — по расписанию или из формы админки, 2… — «Ещё игра сегодня» (create_next_game) или зачёт тренировки (promote_training_evening). Уникален на дату среди настоящих неотменённых вечеров. Миграция 026.';

-- Момент зачёта тренировки: от него cron-tick отсчитывает окно допосылки итогов (finished_at у засчитанной
-- тренировки прежний и может быть старше окна). У остальных вечеров — null.
alter table public.evenings
  add column promoted_at timestamptz;

comment on column public.evenings.promoted_at is
  'Когда тренировку засчитали как настоящий вечер (promote_training_evening); null — не засчитывали. cron-tick допосылает итоги, если не старше 3 суток finished_at или promoted_at. Миграция 026.';

-- Один неотменённый настоящий вечер на (московскую дату, номер игры); тренировки — вне индекса (023).
drop index public.evenings_one_per_club_day_idx;
create unique index evenings_club_day_game_idx
  on public.evenings (((scheduled_at at time zone 'Europe/Moscow')::date), game_no)
  where status <> 'cancelled' and not is_training;

-- Следующий свободный номер игры на московскую дату: наибольший среди настоящих неотменённых + 1.
create function private.next_game_no(p_day date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(e.game_no), 0) + 1
  from public.evenings e
  where (e.scheduled_at at time zone 'Europe/Moscow')::date = p_day
    and e.status <> 'cancelled'
    and not e.is_training
$$;

revoke execute on function private.next_game_no(date) from public, anon, authenticated;

-- Блокировка московского дня на время выбора номера: два одновременных вызова create_next_game или
-- promote_training_evening на одну дату не возьмут один номер (иначе второй упал бы на 23505).
create function private.lock_club_day(p_day date)
returns void
language sql
security definer
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('poker-club:club-day:' || p_day::text, 0))
$$;

revoke execute on function private.lock_club_day(date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Пометка «Тренировка»: единственный путь снять — promote_training_evening
-- ---------------------------------------------------------------------------
create or replace function private.evenings_training_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.is_training is distinct from old.is_training then
    -- Тренировка → настоящий вечер — только под флагом сессии, который ставит promote_training_evening
    -- (через PostgREST его не поставить: set_config не выставлен в API). Обратно — никогда: обычный
    -- вечер нельзя «переделать» в тренировку и удалить.
    if not (old.is_training
            and not new.is_training
            and coalesce(current_setting('poker.promote_training', true), '') = 'on') then
      raise exception 'Пометку «Тренировка» меняют только при создании вечера — создай новый вечер'
        using errcode = '22023';
    end if;
  end if;
  -- Голосования у тренировки нет: finish (add_event) ставит закрытие через 24 ч — снимаем.
  if new.is_training then
    new.voting_closes_at := null;
  end if;
  return new;
end;
$$;

revoke execute on function private.evenings_training_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Засчитать тренировку как настоящий вечер
-- ---------------------------------------------------------------------------
create function public.promote_training_evening(p_evening uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ev     public.evenings;
  v_day    date;
  v_no     integer;
  v_closes timestamptz := now() + interval '24 hours';
begin
  perform private.require_player();
  if not public.is_admin() then
    raise exception 'Засчитать тренировку как настоящий вечер может только админ'
      using errcode = '42501';
  end if;

  -- Та же блокировка, что у записи в журнал: идущая правка журнала дождётся зачёта.
  select e.* into v_ev from public.evenings e where e.id = p_evening for update;
  if not found then
    raise exception 'Такого вечера нет — обнови экран'
      using errcode = '22023';
  end if;
  if not v_ev.is_training then
    raise exception 'Это уже настоящий вечер — засчитывать нечего'
      using errcode = 'P0001';
  end if;
  if v_ev.status not in ('finished', 'settled') then
    raise exception 'Засчитать можно только завершённую тренировку — сначала заверши её на пульте'
      using errcode = 'P0001';
  end if;

  v_day := (v_ev.scheduled_at at time zone 'Europe/Moscow')::date;
  perform private.lock_club_day(v_day);
  v_no := private.next_game_no(v_day);

  perform set_config('poker.promote_training', 'on', true);
  update public.evenings e
  set is_training = false,
      game_no = v_no,
      voting_closes_at = v_closes,
      promoted_at = now()
  where e.id = p_evening;
  perform set_config('poker.promote_training', 'off', true);

  return jsonb_build_object('evening', p_evening, 'gameNo', v_no, 'votingClosesAt', v_closes);
end;
$$;

comment on function public.promote_training_evening(uuid) is
  'Админ: завершённая тренировка → настоящий вечер (в одну сторону). game_no — следующий свободный на дату вечера, голосование — 24 ч с момента зачёта, promoted_at — момент зачёта; пост итогов — как у обычного вечера (notify, cron-tick 3 суток от зачёта). {evening, gameNo, votingClosesAt}. Миграция 026.';

revoke execute on function public.promote_training_evening(uuid) from public, anon, authenticated;
grant execute on function public.promote_training_evening(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. «Ещё игра сегодня»
-- ---------------------------------------------------------------------------
create function public.create_next_game(p_evening uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := private.require_player();
  v_src   public.evenings;
  v_day   date;
  v_found public.evenings;
  v_id    uuid;
  v_no    integer;
begin
  select e.* into v_src from public.evenings e where e.id = p_evening;
  if not found then
    raise exception 'Такого вечера нет — обнови экран'
      using errcode = '22023';
  end if;
  if not (public.is_admin() or v_src.banker_id = v_me) then
    raise exception 'Ещё одну игру создаёт банкир этого вечера или админ'
      using errcode = '42501';
  end if;
  if v_src.is_training then
    raise exception 'После тренировки новую игру создают тренировкой: «Админ» → «Вечера»'
      using errcode = 'P0001';
  end if;
  if v_src.status not in ('finished', 'settled') or v_src.finished_at is null then
    raise exception 'Следующую игру создают, когда эта завершена'
      using errcode = 'P0001';
  end if;
  if v_src.finished_at < now() - interval '12 hours' then
    raise exception 'Игра закончилась больше 12 часов назад — новый вечер назначает админ'
      using errcode = 'P0001';
  end if;

  -- День этой игры, а не сегодняшний: повтор после полуночи (тайм-аут в 23:58 — нажатие в 00:01, второй
  -- телефон) ищет и ждёт на той же дате, что и первый вызов.
  v_day := (v_src.scheduled_at at time zone 'Europe/Moscow')::date;
  perform private.lock_club_day(v_day);

  -- Уже создана после финала этой игры (двойное нажатие, второй телефон) — открываем её.
  select e.* into v_found
  from public.evenings e
  where not e.is_training
    and e.status in ('announced', 'live')
    and (e.scheduled_at at time zone 'Europe/Moscow')::date = v_day
    and e.game_no > v_src.game_no
    and e.created_at >= v_src.finished_at
  order by e.created_at desc, e.id
  limit 1;
  if found then
    return jsonb_build_object('evening', v_found.id, 'gameNo', v_found.game_no, 'created', false);
  end if;

  -- Новая игра — на сейчас. После полуночи (по Москве) она легла бы на другую дату: игра 1 нового дня,
  -- отдельный игровой день «Железного стула», без состава прошлой игры — это уже не «ещё игра сегодня».
  if (now() at time zone 'Europe/Moscow')::date <> v_day then
    raise exception 'После полуночи это уже другой день — новый вечер назначает админ'
      using errcode = 'P0001';
  end if;

  v_no := private.next_game_no(v_day);
  insert into public.evenings (
    scheduled_at, location, status, banker_id, format, game_no,
    announce_posted_at, gameday_posted_at, created_by)
  values (
    now(), v_src.location, 'announced', coalesce(v_src.banker_id, v_me), v_src.format, v_no,
    now(), now(), v_me)
  returning id into v_id;

  return jsonb_build_object('evening', v_id, 'gameNo', v_no, 'created', true);
end;
$$;

comment on function public.create_next_game(uuid) is
  'Банкир вечера или админ: «Ещё игра сегодня» после завершённого настоящего вечера (до 12 ч после финала и только в его московский день) — вечер на сейчас с тем же местом, форматом и банкиром, game_no — следующий на дату этой игры, анонс и пост дня игры отмечены отправленными. Повтор после создания (и после полуночи) возвращает ту же игру. {evening, gameNo, created}. Миграция 026.';

revoke execute on function public.create_next_game(uuid) from public, anon, authenticated;
grant execute on function public.create_next_game(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Табло клуба: итог игры уступает анонсу следующей игры
-- ---------------------------------------------------------------------------
-- Ступени — как в 023. Новое: итог настоящей игры не кандидат, если в тот же московский день (сегодня)
-- объявлена настоящая игра с бо́льшим номером — «Ещё игра сегодня»: табло переходит к анонсу игры 2, а
-- не держит итог игры 1 ещё 6 ч. Итог вчерашней игры, как и раньше, важнее сегодняшнего анонса игры 1.
create or replace function private.club_board_evening_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
  from public.evenings e
  where e.status = 'live'
     or (e.status in ('finished', 'settled')
         and e.finished_at > now() - interval '6 hours'
         and (e.is_training or not exists (
               select 1
               from public.evenings n
               where n.status = 'announced'
                 and not n.is_training
                 and n.game_no > e.game_no
                 and (n.scheduled_at at time zone 'Europe/Moscow')::date
                     = (e.scheduled_at at time zone 'Europe/Moscow')::date
                 and (n.scheduled_at at time zone 'Europe/Moscow')::date
                     = (now() at time zone 'Europe/Moscow')::date)))
     or (e.status = 'announced'
         and (e.scheduled_at at time zone 'Europe/Moscow')::date
             = (now() at time zone 'Europe/Moscow')::date)
  order by
    case
      when e.status = 'live' and not e.is_training then 1
      when e.status = 'live' then 2
      when e.status in ('finished', 'settled') and not e.is_training then 3
      when e.status = 'announced' and not e.is_training then 4
      when e.status in ('finished', 'settled') then 5
      else 6
    end,
    case
      when e.status = 'live' then -extract(epoch from coalesce(e.started_at, e.scheduled_at))
      when e.status = 'announced' then extract(epoch from e.scheduled_at)
      else -extract(epoch from e.finished_at)
    end,
    e.id
  limit 1
$$;

revoke execute on function private.club_board_evening_id() from public, anon, authenticated;

-- Ответ табло (тело из 023) + evening.game_no: табло подписывает игру 2 и дальше.
create or replace function private.board_payload(p_evening uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ev      public.evenings;
  v_events  jsonb;
  v_players jsonb;
begin
  select e.* into v_ev
  from public.evenings e
  where e.id = p_evening;
  if not found then
    return null;
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', ee.id,
               'type', ee.type,
               'payload', ee.payload,
               'at', ee.at,
               'voided', false)
             order by ee.id),
           '[]'::jsonb)
  into v_events
  from public.evening_events ee
  where ee.evening_id = v_ev.id
    and ee.voided_at is null
    and ee.type <> 'payment';

  -- Имена только тех, кто упомянут в событиях вечера, — не весь клуб.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', p.id,
               'display_name', p.display_name,
               'spoken_name', p.spoken_name)
             order by p.display_name),
           '[]'::jsonb)
  into v_players
  from public.players p
  where p.id::text in (
    select ev.value -> 'payload' ->> 'playerId'
    from jsonb_array_elements(v_events) as ev(value)
    union
    select b.value
    from jsonb_array_elements(v_events) as ev(value)
    cross join lateral jsonb_array_elements_text(
      coalesce(ev.value -> 'payload' -> 'by', '[]'::jsonb)) as b(value));

  return jsonb_build_object(
    'evening', jsonb_build_object(
      'id', v_ev.id,
      'scheduled_at', v_ev.scheduled_at,
      'location', v_ev.location,
      'status', v_ev.status,
      'started_at', v_ev.started_at,
      'finished_at', v_ev.finished_at,
      'is_training', v_ev.is_training,
      'game_no', v_ev.game_no),
    'format', v_ev.format,
    'events', v_events,
    'players', v_players,
    -- Табло без входа сверяет часы по этому полю на каждом опросе.
    'server_now', clock_timestamp());
end;
$$;

revoke execute on function private.board_payload(uuid) from public, anon, authenticated;
