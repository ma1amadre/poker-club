-- Проверки миграции 029 (ссылка-приглашение в клуб) на локальной БД с seed.sql: всё в одной транзакции,
-- в конце rollback — данные не меняются. Любая неудача — exception, psql с ON_ERROR_STOP выходит с кодом 3.
-- Внутри транзакции now() не меняется: «истёкшее» приглашение ставится сдвигом created_at/expires_at назад.
-- Запуск (из корня репозитория, стек поднят):
--   docker exec -i supabase_db_poker-club psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/029_player_invites.sql
\set QUIET on
begin;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000a001', 'authenticated', 'authenticated', 't1001@test.invalid'),
  ('00000000-0000-4000-8000-00000000a002', 'authenticated', 'authenticated', 't1002@test.invalid');
update public.players set auth_user_id = '00000000-0000-4000-8000-00000000a001'
  where id = 'a0000000-0000-4000-8000-000000001001';
update public.players set auth_user_id = '00000000-0000-4000-8000-00000000a002'
  where id = 'a0000000-0000-4000-8000-000000001002';

create function pg_temp.login(p_auth uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.check(p_ok boolean, p_what text) returns void language plpgsql as $$
begin
  if p_ok is distinct from true then
    raise exception 'FAIL: %', p_what;
  end if;
  raise notice 'ok: %', p_what;
end;
$$;
grant execute on function pg_temp.check(boolean, text) to anon, authenticated, service_role;

create function pg_temp.rejects(p_sql text, p_state text, p_what text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL: % — прошло', p_what;
exception
  when others then
    if sqlerrm like 'FAIL:%' then
      raise;
    end if;
    if sqlstate <> p_state then
      raise exception 'FAIL: % — другая ошибка: % %', p_what, sqlstate, sqlerrm;
    end if;
    raise notice 'ok: %', p_what;
end;
$$;
grant execute on function pg_temp.rejects(text, text, text) to anon, authenticated, service_role;

-- Вход по коду как его делает tg-auth (service_role): outcome ответа.
create function pg_temp.redeem(p_code text, p_tg bigint, p_name text default 'Новичок') returns text
language sql as $$
  select public.redeem_player_invite(p_code, p_tg, p_name, 'newbie', null) ->> 'outcome';
$$;
grant execute on function pg_temp.redeem(text, bigint, text) to service_role;

\set admin '''00000000-0000-4000-8000-00000000a001'''
\set sasha '''00000000-0000-4000-8000-00000000a002'''
\set p_admin '''a0000000-0000-4000-8000-000000001001'''
\set p_misha '''a0000000-0000-4000-8000-000000001005'''
\set p_kostya '''a0000000-0000-4000-8000-000000001006'''

-- ===========================================================================
-- 1. Права: таблица закрыта, RPC — только админ, вход — только service_role
-- ===========================================================================
select pg_temp.check(
  not has_table_privilege('anon', 'public.player_invites', 'select')
  and not has_table_privilege('authenticated', 'public.player_invites', 'select')
  and not has_table_privilege('authenticated', 'public.player_invites', 'insert')
  and has_table_privilege('service_role', 'public.player_invites', 'select')
  and has_table_privilege('service_role', 'public.player_invites', 'insert')
  and has_table_privilege('service_role', 'public.player_invites', 'update')
  and has_table_privilege('service_role', 'public.player_invites', 'delete')
  and not has_table_privilege('service_role', 'public.player_invites', 'truncate')
  and (select relrowsecurity from pg_class where oid = 'public.player_invites'::regclass),
  'player_invites: RLS, у anon/authenticated прав нет, у service_role — select/insert/update/delete');
select pg_temp.check(
  not has_function_privilege('anon', 'public.create_player_invite()', 'execute')
  and not has_function_privilege('anon', 'public.list_player_invites()', 'execute')
  and not has_function_privilege('anon', 'public.revoke_player_invite(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.create_player_invite()', 'execute')
  and has_function_privilege('authenticated', 'public.list_player_invites()', 'execute')
  and has_function_privilege('authenticated', 'public.revoke_player_invite(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.redeem_player_invite(text, bigint, text, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.redeem_player_invite(text, bigint, text, text, text)', 'execute')
  and has_function_privilege('service_role', 'public.redeem_player_invite(text, bigint, text, text, text)', 'execute'),
  'RPC админа — authenticated (не anon), вход по коду — только service_role');

-- Не-админ (Саша) не создаёт, не видит и не отзывает.
select pg_temp.login(:sasha);
set local role authenticated;
select pg_temp.rejects('select public.create_player_invite()', '42501', 'не-админ не создаёт приглашение');
select pg_temp.rejects('select * from public.list_player_invites()', '42501', 'не-админ не видит приглашения');
select pg_temp.rejects($q$select public.revoke_player_invite('00000000-0000-4000-8000-000000000000')$q$,
  '42501', 'не-админ не отзывает');
select pg_temp.rejects('select * from public.player_invites', '42501', 'не-админ не читает таблицу');
select pg_temp.rejects($q$select public.redeem_player_invite('x', 1, 'x', null, null)$q$,
  '42501', 'authenticated не входит по коду напрямую');
reset role;

-- ===========================================================================
-- 2. Создание: код один раз, в базе только хеш, срок 7 дней
-- ===========================================================================
select pg_temp.login(:admin);
set local role authenticated;
select r ->> 'code' as code1, r ->> 'id' as id1, r ->> 'expiresAt' as exp1
  from (select public.create_player_invite() as r) s \gset
select r ->> 'code' as code2, r ->> 'id' as id2 from (select public.create_player_invite() as r) s \gset
select r ->> 'code' as code3, r ->> 'id' as id3 from (select public.create_player_invite() as r) s \gset
select r ->> 'code' as code4, r ->> 'id' as id4 from (select public.create_player_invite() as r) s \gset
select r ->> 'code' as code5, r ->> 'id' as id5 from (select public.create_player_invite() as r) s \gset
select pg_temp.check(count(*) = 5 and bool_and(status = 'active'),
  'админ видит 5 новых приглашений, все активны') from public.list_player_invites();
reset role;

select pg_temp.check(:'code1' ~ '^[A-Za-z0-9_-]{32}$' and :'code1' <> :'code2',
  'код — 32 знака base64url, у каждого приглашения свой');
select pg_temp.check(:'exp1'::timestamptz = now() + interval '7 days', 'срок — ровно 7 дней от создания');
select pg_temp.check((select code_hash = encode(sha256(convert_to(:'code1', 'UTF8')), 'hex')
                             and created_by = :p_admin and used_at is null and revoked_at is null
                      from public.player_invites where id = :'id1'),
  'в базе — SHA-256 кода и создатель, кода нет');
select pg_temp.check(not exists (
  select 1 from public.player_invites i where to_jsonb(i)::text like '%' || :'code1' || '%'),
  'сам код нигде в строке не хранится');
select pg_temp.rejects($q$insert into public.player_invites (code_hash, expires_at) values ('abc', now() + interval '1 day')$q$,
  '23514', 'хеш не по форме — check');
select pg_temp.rejects(format($q$update public.player_invites set used_at = now(), revoked_at = now() where id = %L$q$, :'id1'),
  '23514', 'использованное и отозванное сразу — check');

-- ===========================================================================
-- 3. Вход по коду (tg-auth, service_role)
-- ===========================================================================
set local role service_role;
select pg_temp.check(pg_temp.redeem('A' || repeat('b', 31), 555001) = 'unknown', 'чужой код — unknown');
select pg_temp.check(pg_temp.redeem('короткий', 555001) = 'unknown' and pg_temp.redeem(null, 555001) = 'unknown',
  'код не по форме — unknown');
select pg_temp.rejects(format('select public.redeem_player_invite(%L, 0, %L, null, null)', :'code1', 'x'),
  '22023', 'tg id не положительный — 22023');

-- Новый человек: игрок создан, постоянный, с пометкой; код сожжён им.
select public.redeem_player_invite(:'code1', 555001, '  Новичок Первый ', 'first_new', 'https://t.me/i/a.jpg')
  ->> 'playerId' as p_new \gset
reset role;
select pg_temp.check((select display_name = 'Новичок Первый' and username = 'first_new'
                             and photo_url = 'https://t.me/i/a.jpg' and joined_by_invite and is_active
                             and not is_guest and not is_admin and auth_user_id is null
                      from public.players where id = :'p_new' and tg_id = 555001),
  'новый игрок: имя без пробелов по краям, постоянный, активный, по приглашению');
select pg_temp.check((select used_at = now() and used_by = :'p_new' from public.player_invites where id = :'id1'),
  'код сожжён: used_at и used_by');

set local role service_role;
select pg_temp.check(pg_temp.redeem(:'code1', 555002) = 'used', 'тот же код другим человеком — used');
select pg_temp.check(pg_temp.redeem(:'code1', 555001) = 'ok', 'повтор того же человека — ok (код уже его)');
reset role;
select pg_temp.check((select count(*) = 0 from public.players where tg_id = 555002),
  'по сожжённому коду игрок не создаётся');
select pg_temp.check((select count(*) = 1 from public.players where tg_id = 555001),
  'повтор не создаёт второго игрока');

-- Уже есть в клубе (Миша, не по приглашению): тот же профиль получает пометку, нового нет.
set local role service_role;
select (public.redeem_player_invite(:'code2', 1005, 'Михаил', null, null) ->> 'playerId') = :p_misha as same_misha \gset
reset role;
select pg_temp.check(:'same_misha'::boolean, 'существующий игрок по tg id — тот же профиль');
select pg_temp.check((select joined_by_invite and display_name = 'Миша' from public.players where id = :p_misha),
  'существующему — только пометка, имя клуба не меняется');

-- Отключённый (Костя): код не тратится.
update public.players set is_active = false where id = :p_kostya;
set local role service_role;
select pg_temp.check(pg_temp.redeem(:'code3', 1006) = 'inactive', 'отключённый профиль — inactive');
reset role;
select pg_temp.check((select used_at is null and used_by is null from public.player_invites where id = :'id3'),
  'отключённому код не сжигается');
select pg_temp.check(not (select joined_by_invite from public.players where id = :p_kostya),
  'отключённому пометка не ставится');

-- ===========================================================================
-- 4. Срок и отзыв
-- ===========================================================================
update public.player_invites
set created_at = now() - interval '8 days', expires_at = now() - interval '1 day'
where id = :'id4';
set local role service_role;
select pg_temp.check(pg_temp.redeem(:'code4', 555004) = 'expired', 'истёкший — expired');
reset role;

select pg_temp.login(:admin);
set local role authenticated;
select (public.revoke_player_invite(:'id5') ->> 'revokedAt')::timestamptz = now() as revoked_now \gset
select pg_temp.check(:'revoked_now'::boolean, 'админ отзывает неиспользованное');
select pg_temp.check((public.revoke_player_invite(:'id5') ->> 'revokedAt')::timestamptz = now(),
  'повторный отзыв — тот же ответ, без ошибки');
select pg_temp.rejects(format('select public.revoke_player_invite(%L)', :'id1'), 'P0001',
  'использованное отозвать нельзя');
select pg_temp.rejects($q$select public.revoke_player_invite('00000000-0000-4000-8000-000000000000')$q$,
  '22023', 'несуществующее — 22023');
select pg_temp.check(
  (select string_agg(status, ',' order by status) from public.list_player_invites()) = 'active,expired,revoked,used,used',
  'статусы списка: active, expired, revoked, used ×2');
select pg_temp.check(
  (select used_by_name = 'Новичок Первый' and used_by = :'p_new' from public.list_player_invites() where id = :'id1'),
  'в списке — кто вошёл');
select pg_temp.check(
  (select used_at is null and used_by is null from public.list_player_invites() where id = :'id3'),
  'неиспользованное — без вошедшего');
reset role;

set local role service_role;
select pg_temp.check(pg_temp.redeem(:'code5', 555005) = 'revoked', 'отозванный — revoked');
select pg_temp.check(pg_temp.redeem(:'code3', 555003) = 'ok', 'неотозванный и непросроченный — ok');
reset role;
select pg_temp.check((select count(*) = 0 from public.players where tg_id in (555004, 555005)),
  'по истёкшему и отозванному игроки не создаются');

-- ===========================================================================
-- 5. Ссылки на игроков и пометка
-- ===========================================================================
select pg_temp.check('public.player_invites.used_by' = any (private.player_references(:'p_new')),
  'player_references видит used_by — слияние не потеряет приглашение молча');
select pg_temp.check('public.player_invites.created_by' = any (private.player_references(:p_admin)),
  'player_references видит created_by');
select pg_temp.check((select count(*) = 0 from public.players where joined_by_invite and tg_id is null),
  'пометка — только у профилей с Telegram');
select pg_temp.check(not (select joined_by_invite from public.players where id = :p_admin),
  'у остальных пометки нет (default false)');

rollback;
