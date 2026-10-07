-- Проверки миграции 016 (голос табло) на локальной БД с seed.sql: всё в одной транзакции, в конце
-- rollback — данные не меняются. Любая неудача — exception, psql с ON_ERROR_STOP выходит с кодом 3.
-- Запуск (из корня репозитория, стек поднят):
--   docker exec -i supabase_db_poker-club psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/016_board_voice.sql
\set QUIET on
begin;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000a001', 'authenticated', 'authenticated', 't1001@test.invalid'),
  ('00000000-0000-4000-8000-00000000a004', 'authenticated', 'authenticated', 't1004@test.invalid');
update public.players set auth_user_id = '00000000-0000-4000-8000-00000000a001'
  where id = 'a0000000-0000-4000-8000-000000001001';
update public.players set auth_user_id = '00000000-0000-4000-8000-00000000a004'
  where id = 'a0000000-0000-4000-8000-000000001004';

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
-- Ошибка с нужным SQLSTATE (и, если задан, текстом), иначе FAIL.
create function pg_temp.fails(p_sql text, p_state text, p_message text, p_what text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL: % — прошло без ошибки', p_what;
exception
  when others then
    if sqlerrm like 'FAIL:%' then
      raise;
    end if;
    if sqlstate <> p_state then
      raise exception 'FAIL: % — код % вместо %: %', p_what, sqlstate, p_state, sqlerrm;
    end if;
    if p_message is not null and position(p_message in sqlerrm) = 0 then
      raise exception 'FAIL: % — другой текст: %', p_what, sqlerrm;
    end if;
    raise notice 'ok: %', p_what;
end;
$$;
-- Хеш клипа — как clipHash домена и constraint voice_clips_hash_matches.
create function pg_temp.h(p_text text) returns text language sql immutable as $$
  select encode(sha256(convert_to('silero-v5_5-xenia' || E'\n' || p_text, 'UTF8')), 'hex');
$$;
grant execute on function pg_temp.check(boolean, text), pg_temp.fails(text, text, text, text),
  pg_temp.h(text) to anon, authenticated, service_role;

\set admin '''00000000-0000-4000-8000-00000000a001'''
\set lesha_auth '''00000000-0000-4000-8000-00000000a004'''
\set lesha '''a0000000-0000-4000-8000-000000001004'''
\set misha '''a0000000-0000-4000-8000-000000001005'''
\set guest '''a0000000-0000-4000-8000-000000009001'''
\set e5 '''e0000000-0000-4000-8000-000000000005'''
\set e6 '''e0000000-0000-4000-8000-000000000006'''
select board_token as tok6 from public.evenings where id = :e6 \gset
select board_token as tok5 from public.evenings where id = :e5 \gset

-- ===========================================================================
-- 1. players.spoken_name: форма имени
-- ===========================================================================
select pg_temp.check((select spoken_name = 'В+ова' from public.players where id = :guest),
       'seed: имя для озвучки гостя');
update public.players set spoken_name = 'Эрдн+и Ом+аев' where id = :misha;
update public.players set spoken_name = 'Анна-Мария' where id = :misha;
update public.players set spoken_name = 'Д''Артаньян' where id = :misha;
update public.players set spoken_name = 'ёжик Ъ' where id = :misha;
update public.players set spoken_name = null where id = :misha;
select pg_temp.check(true, 'годные имена для озвучки (кириллица, дефис, апостроф, «+», ё) и null');

select pg_temp.fails($q$update public.players set spoken_name = 'Erdni' where id = 'a0000000-0000-4000-8000-000000001005'$q$,
       '23514', 'players_spoken_name_shape', 'латиница — отказ constraint');
select pg_temp.fails($q$update public.players set spoken_name = 'Миша2' where id = 'a0000000-0000-4000-8000-000000001005'$q$,
       '23514', null, 'цифра — отказ');
select pg_temp.fails($q$update public.players set spoken_name = 'Эрд+ни' where id = 'a0000000-0000-4000-8000-000000001005'$q$,
       '23514', null, '«+» перед согласной — отказ');
select pg_temp.fails($q$update public.players set spoken_name = 'Эрдни+' where id = 'a0000000-0000-4000-8000-000000001005'$q$,
       '23514', null, '«+» в конце — отказ');
select pg_temp.fails($q$update public.players set spoken_name = ' Миша' where id = 'a0000000-0000-4000-8000-000000001005'$q$,
       '23514', null, 'пробел по краю — отказ');
select pg_temp.fails($q$update public.players set spoken_name = 'Миша  Петров' where id = 'a0000000-0000-4000-8000-000000001005'$q$,
       '23514', null, 'двойной пробел — отказ');
select pg_temp.fails($q$update public.players set spoken_name = '' where id = 'a0000000-0000-4000-8000-000000001005'$q$,
       '23514', null, 'пустая строка — отказ (сброс — null)');
select pg_temp.fails($q$update public.players set spoken_name = '- -' where id = 'a0000000-0000-4000-8000-000000001005'$q$,
       '23514', null, 'без букв — отказ');
select pg_temp.fails($q$update public.players set spoken_name = 'Ўася' where id = 'a0000000-0000-4000-8000-000000001005'$q$,
       '23514', null, 'буква не из русского алфавита — отказ');
select pg_temp.fails(format($q$update public.players set spoken_name = %L where id = 'a0000000-0000-4000-8000-000000001005'$q$, repeat('я', 51)),
       '23514', null, '51 символ — отказ');
update public.players set spoken_name = repeat('я', 50) where id = :misha;
update public.players set spoken_name = null where id = :misha;
select pg_temp.check(true, '50 символов — можно');

-- ===========================================================================
-- 2. set_my_spoken_name — своё имя
-- ===========================================================================
select pg_temp.login(:lesha_auth);
set local role authenticated;
select pg_temp.check(public.set_my_spoken_name('  Л+ёша   Кузн+ецов ') = 'Л+ёша Кузн+ецов',
       'set_my_spoken_name: пробелы схлопнуты, возвращает сохранённое');
select pg_temp.check((select spoken_name = 'Л+ёша Кузн+ецов' from public.players where id = :lesha),
       'игрок видит своё имя для озвучки');
select pg_temp.check(public.set_my_spoken_name('Д’Арт+аньян') = 'Д''Арт+аньян',
       'типографский апостроф → «''»');
select pg_temp.fails($q$select public.set_my_spoken_name('Lyosha')$q$, '22023', 'Латиницу голос не читает', 'RPC: латиница');
select pg_temp.fails($q$select public.set_my_spoken_name('Лёша 2')$q$, '22023', 'Цифры голос не читает', 'RPC: цифры');
select pg_temp.fails($q$select public.set_my_spoken_name('Лёша!')$q$, '22023', 'Можно только русские буквы', 'RPC: знак');
select pg_temp.fails($q$select public.set_my_spoken_name('- -')$q$, '22023', 'Напиши имя русскими буквами', 'RPC: без букв');
select pg_temp.fails($q$select public.set_my_spoken_name('Л+шёа')$q$, '22023', 'Знак + ставится прямо перед ударной гласной', 'RPC: «+» не перед гласной');
select pg_temp.fails(format($q$select public.set_my_spoken_name(%L)$q$, repeat('я', 51)), '22023', 'длиннее 50 символов', 'RPC: длина');
select pg_temp.check(public.set_my_spoken_name('   ') is null, 'пустое — сброс, возвращает null');
select pg_temp.check((select spoken_name is null from public.players where id = :lesha), 'сброшено в null');
select public.set_my_spoken_name('Л+ёша');

-- Чужое имя не правится: RLS update на players — только админ.
update public.players set spoken_name = 'Миша' where id = :misha;
select pg_temp.check((select spoken_name is null from public.players where id = :misha),
       'не админ чужое имя для озвучки не меняет (RLS)');
reset role;

-- Без входа и для anon RPC закрыта.
set local role authenticated;
select set_config('request.jwt.claims', '', true);
select pg_temp.fails($q$select public.set_my_spoken_name('Кто-то')$q$, '42501', null, 'без игрока — 42501');
reset role;
set local role anon;
select pg_temp.fails($q$select public.set_my_spoken_name('Кто-то')$q$, '42501', null, 'anon — нет права на RPC');
reset role;

-- Админ правит любому формой «Игроки» (upsert под RLS).
select pg_temp.login(:admin);
set local role authenticated;
insert into public.players (id, display_name, spoken_name)
values (:misha, 'Миша', 'М+иша')
on conflict (id) do update set spoken_name = excluded.spoken_name;
select pg_temp.check((select spoken_name = 'М+иша' from public.players where id = :misha),
       'админ задаёт имя для озвучки другому игроку (upsert формы)');
reset role;

-- ===========================================================================
-- 3. voice_clips: хранение и права
-- ===========================================================================
-- Хеш SQL совпадает с clipHash домена (тот же эталон — в voice.test.ts).
select pg_temp.check(pg_temp.h('Пауза.') = '808475d9a7e8e52d9690e2812928d961f810e589cdb2aa22d78adbd2821de3b0',
       'хеш клипа в SQL = хеш домена');

-- 200 байт: в base64 encode вставил бы перевод строки — проверим, что RPC его убирает.
insert into public.voice_clips (voice, text_hash, text, audio, mime, duration_ms) values
  ('silero-v5_5-xenia', pg_temp.h('Пауза.'), 'Пауза.', decode(repeat('ab', 200), 'hex'), 'audio/mpeg', 640),
  ('silero-v5_5-xenia', pg_temp.h('Нокаут! Вылетает М+иша. Выбил Л+ёша.'),
   'Нокаут! Вылетает М+иша. Выбил Л+ёша.', decode('494433', 'hex'), 'audio/mpeg', 2300),
  ('other-voice', encode(sha256(convert_to('other-voice' || E'\n' || 'Пауза.', 'UTF8')), 'hex'),
   'Пауза.', decode('00', 'hex'), 'audio/mpeg', 500);
select pg_temp.check(true, 'генератор (postgres) пишет клипы');

select pg_temp.fails($q$insert into public.voice_clips (voice, text_hash, text, audio, duration_ms)
  values ('silero-v5_5-xenia', pg_temp.h('Пауза.'), 'Продолжаем.', '\x00', 500)$q$,
  '23514', 'voice_clips_hash_matches', 'хеш не от этого текста — отказ');
select pg_temp.fails($q$insert into public.voice_clips (voice, text_hash, text, audio, duration_ms)
  values ('silero-v5_5-xenia', pg_temp.h(' Пауза.'), ' Пауза.', '\x00', 500)$q$,
  '23514', 'voice_clips_text_normalized', 'текст с пробелом по краю — отказ');
select pg_temp.fails($q$insert into public.voice_clips (voice, text_hash, text, audio, duration_ms)
  values ('silero-v5_5-xenia', pg_temp.h('Нокаут!  Вылетает'), 'Нокаут!  Вылетает', '\x00', 500)$q$,
  '23514', 'voice_clips_text_normalized', 'двойной пробел — отказ');
select pg_temp.fails($q$insert into public.voice_clips (voice, text_hash, text, audio, mime, duration_ms)
  values ('silero-v5_5-xenia', pg_temp.h('Продолжаем.'), 'Продолжаем.', '\x00', 'audio/wav', 500)$q$,
  '23514', 'voice_clips_mime', 'не MP3 — отказ');
select pg_temp.fails($q$insert into public.voice_clips (voice, text_hash, text, audio, duration_ms)
  values ('silero-v5_5-xenia', pg_temp.h('Продолжаем.'), 'Продолжаем.', '', 500)$q$,
  '23514', 'voice_clips_audio_size', 'пустой звук — отказ');
select pg_temp.fails($q$insert into public.voice_clips (voice, text_hash, text, audio, duration_ms)
  values ('silero-v5_5-xenia', pg_temp.h('Продолжаем.'), 'Продолжаем.', '\x00', 0)$q$,
  '23514', 'voice_clips_duration', 'нулевая длительность — отказ');
select pg_temp.fails($q$insert into public.voice_clips (voice, text_hash, text, audio, duration_ms)
  values ('Silero XENIA', encode(sha256(convert_to('Silero XENIA' || E'\n' || 'Пауза.', 'UTF8')), 'hex'), 'Пауза.', '\x00', 500)$q$,
  '23514', 'voice_clips_voice_shape', 'id голоса не по форме — отказ');

-- Повтор генератора — on conflict do nothing.
insert into public.voice_clips (voice, text_hash, text, audio, duration_ms)
values ('silero-v5_5-xenia', pg_temp.h('Пауза.'), 'Пауза.', '\x00', 1)
on conflict (voice, text_hash) do nothing;
select pg_temp.check((select duration_ms = 640 from public.voice_clips where text_hash = pg_temp.h('Пауза.')
                      and voice = 'silero-v5_5-xenia'), 'повторная вставка не перезаписывает клип');

select pg_temp.check(
  (select relrowsecurity from pg_class where oid = 'public.voice_clips'::regclass), 'RLS на voice_clips включён');
select pg_temp.check(
  has_table_privilege('service_role', 'public.voice_clips', 'select, insert, update, delete'),
  'service_role: select/insert/update/delete на voice_clips');
select pg_temp.check(
  not has_table_privilege('anon', 'public.voice_clips', 'select')
  and not has_table_privilege('authenticated', 'public.voice_clips', 'select')
  and not has_table_privilege('authenticated', 'public.voice_clips', 'insert'),
  'anon и authenticated — без прав на voice_clips');
select pg_temp.login(:admin);
set local role authenticated;
select pg_temp.fails($q$select count(*) from public.voice_clips$q$, '42501', null, 'даже админ клуба не читает voice_clips напрямую');
reset role;

-- ===========================================================================
-- 4. board_voice_clips и board_state по токену
-- ===========================================================================
set local role anon;
select pg_temp.check(
  jsonb_array_length(public.board_voice_clips(:'tok6', 'silero-v5_5-xenia',
    array[pg_temp.h('Пауза.'), pg_temp.h('Нокаут! Вылетает М+иша. Выбил Л+ёша.'), pg_temp.h('Нет такой фразы.')])) = 2,
  'anon по живому токену получает только озвученные клипы');
select pg_temp.check(
  (select c ->> 'audio' = translate(encode(decode(repeat('ab', 200), 'hex'), 'base64'), E'\n', '')
          and position(E'\n' in c ->> 'audio') = 0
          and decode(c ->> 'audio', 'base64') = decode(repeat('ab', 200), 'hex')
          and c ->> 'mime' = 'audio/mpeg' and (c ->> 'duration_ms')::int = 640
          and c ->> 'hash' = pg_temp.h('Пауза.')
   from jsonb_array_elements(public.board_voice_clips(:'tok6', 'silero-v5_5-xenia',
          array[pg_temp.h('Пауза.')])) as c),
  'клип: base64 без переводов строк, байты те же, mime и длительность');
select pg_temp.check(
  jsonb_array_length(public.board_voice_clips(:'tok6', 'silero-v5_5-xenia', array[]::text[])) = 0
  and jsonb_array_length(public.board_voice_clips(:'tok6', 'silero-v5_5-xenia', null)) = 0,
  'пустой список — пустой ответ');
select pg_temp.check(
  (select count(*) = 1 from jsonb_array_elements(public.board_voice_clips(:'tok6', 'other-voice',
     array[encode(sha256(convert_to('other-voice' || E'\n' || 'Пауза.', 'UTF8')), 'hex'), pg_temp.h('Пауза.')]))),
  'клипы другого голоса не смешиваются');
select pg_temp.check(public.board_voice_clips(gen_random_uuid(), 'silero-v5_5-xenia', array[pg_temp.h('Пауза.')]) is null,
       'неизвестный токен — null');
select pg_temp.check(public.board_voice_clips(:'tok5', 'silero-v5_5-xenia', array[pg_temp.h('Пауза.')]) is null,
       'вечер завершён больше 6 часов назад — null, как board_state');
select pg_temp.check(public.board_state(:'tok5') is null, 'board_state: тот же срок');
select pg_temp.fails(format('select public.board_voice_clips(%L, %L, %L::text[])', :'tok6', 'silero-v5_5-xenia',
       (select array_agg(pg_temp.h(i::text)) from generate_series(1, 101) as i)),
       '22023', 'Не больше 100 клипов', 'больше 100 хешей — 22023');
select pg_temp.fails($q$select private.board_evening_id(gen_random_uuid())$q$, '42501', null, 'anon: private.board_evening_id закрыт');
select pg_temp.fails($q$select private.voice_manifest_input()$q$, '42501', null, 'anon: private.voice_manifest_input закрыт');
reset role;

-- Вечер завершён только что — ссылка ещё живёт; отменённый — гаснет.
update public.evenings set status = 'finished', finished_at = now() - interval '5 hours 59 minutes',
  scoring = '{"koPoints": 0.5, "winBonus": 1}' where id = :e5;
set local role anon;
select pg_temp.check(public.board_voice_clips(:'tok5', 'silero-v5_5-xenia', array[pg_temp.h('Пауза.')]) is not null
                     and public.board_state(:'tok5') is not null,
       'завершён меньше 6 часов назад — клипы и табло отдаются');
reset role;
update public.evenings set status = 'cancelled' where id = :e6;
set local role anon;
select pg_temp.check(public.board_voice_clips(:'tok6', 'silero-v5_5-xenia', array[pg_temp.h('Пауза.')]) is null,
       'отменённый вечер — null');
reset role;
update public.evenings set status = 'announced' where id = :e6;

-- board_state отдаёт spoken_name игроков вечера.
select pg_temp.login(:admin);
set local role authenticated;
select public.add_event(:e6, 'join', jsonb_build_object('playerId', :misha));
select public.add_event(:e6, 'join', jsonb_build_object('playerId', :lesha));
select public.add_event(:e6, 'join', jsonb_build_object('playerId', 'a0000000-0000-4000-8000-000000001003'));
reset role;
set local role anon;
select pg_temp.check(
  (select jsonb_agg(p order by p ->> 'display_name')
   from jsonb_array_elements(public.board_state(:'tok6') -> 'players') as p)
  = jsonb_build_array(
      jsonb_build_object('id', 'a0000000-0000-4000-8000-000000001003', 'display_name', 'Дима', 'spoken_name', null),
      jsonb_build_object('id', 'a0000000-0000-4000-8000-000000001004', 'display_name', 'Лёша', 'spoken_name', 'Л+ёша'),
      jsonb_build_object('id', 'a0000000-0000-4000-8000-000000001005', 'display_name', 'Миша', 'spoken_name', 'М+иша')),
  'board_state: игроки вечера с spoken_name');
select pg_temp.check((public.board_state(:'tok6') ->> 'server_now') is not null
                     and jsonb_array_length(public.board_state(:'tok6') -> 'events') = 3,
       'board_state: события и server_now на месте');
reset role;

select pg_temp.check(
  has_function_privilege('anon', 'public.board_voice_clips(uuid, text, text[])', 'execute')
  and has_function_privilege('anon', 'public.board_state(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.set_my_spoken_name(text)', 'execute')
  and has_function_privilege('authenticated', 'public.set_my_spoken_name(text)', 'execute')
  and not has_function_privilege('authenticated', 'private.voice_manifest_input()', 'execute')
  and not has_function_privilege('authenticated', 'private.board_evening_id(uuid)', 'execute'),
  'права на функции: табло — anon, своё имя — authenticated, private — закрыты');

-- ===========================================================================
-- 5. Вход манифеста для генератора
-- ===========================================================================
update public.players set is_active = false where id = 'a0000000-0000-4000-8000-000000001006';
select private.voice_manifest_input() as manifest \gset
select pg_temp.check(
  (select count(*) = 6 from jsonb_array_elements(:'manifest'::jsonb -> 'players'))
  and not exists (select 1 from jsonb_array_elements(:'manifest'::jsonb -> 'players') as p
                  where p ->> 'id' = 'a0000000-0000-4000-8000-000000001006'),
  'манифест: только активные игроки (гость включён, выключенный — нет)');
select pg_temp.check(
  (select p ->> 'spoken_name' = 'В+ова' and (p ->> 'is_guest')::boolean
          and (p ->> 'last_played_at')::timestamptz = '2026-09-24 16:00:00+00'
   from jsonb_array_elements(:'manifest'::jsonb -> 'players') as p
   where p ->> 'id' = 'a0000000-0000-4000-8000-000000009001'),
  'манифест: гость с именем для озвучки и датой последнего вечера');
select pg_temp.check(
  (select (p ->> 'last_played_at')::timestamptz = '2026-10-08 16:00:00+00'
   from jsonb_array_elements(:'manifest'::jsonb -> 'players') as p
   where p ->> 'id' = 'a0000000-0000-4000-8000-000000001005'),
  'манифест: last_played_at — по входу в вечер (и в объявленный тоже)');
select pg_temp.check(
  jsonb_array_length(:'manifest'::jsonb -> 'formats') = 2
  and (:'manifest'::jsonb -> 'formats' -> 0) = (select config from public.formats
                                                 where id = 'f0000000-0000-4000-8000-000000000001')
  and (:'manifest'::jsonb -> 'formats' -> 1) = (select format from public.evenings where id = :e6),
  'манифест: неархивные форматы и снимок объявленного вечера');

-- ===========================================================================
-- 6. merge_players: имя для озвучки гостя переходит профилю
-- ===========================================================================
-- Гость «Вова (гость)» с «В+ова» (seed) входит через Telegram как «Vladimir K»: латиницу голос не
-- прочитает, без переноса табло перестало бы его называть.
insert into public.players (id, tg_id, display_name, username) values
  ('a0000000-0000-4000-8000-000000001007', 1007, 'Vladimir K', 'vova_tg'),
  ('a0000000-0000-4000-8000-000000001008', 1008, 'Petr', 'petr_tg');
insert into public.players (id, display_name, is_guest, spoken_name) values
  ('a0000000-0000-4000-8000-000000009002', 'Петя (гость)', true, 'П+етя'),
  ('a0000000-0000-4000-8000-000000009003', 'Гость без имени', true, null);
update public.players set spoken_name = 'П+ётр' where id = 'a0000000-0000-4000-8000-000000001008';

select pg_temp.login(:admin);
set local role authenticated;
select public.merge_players(:guest, 'a0000000-0000-4000-8000-000000001007');
select public.merge_players('a0000000-0000-4000-8000-000000009002', 'a0000000-0000-4000-8000-000000001008');
reset role;
select pg_temp.check(
  (select spoken_name = 'В+ова' and not is_guest from public.players
   where id = 'a0000000-0000-4000-8000-000000001007')
  and not exists (select 1 from public.players where id = :guest),
  'merge_players: у профиля своего имени для озвучки нет — переходит гостевое');
select pg_temp.check(
  (select spoken_name = 'П+ётр' from public.players where id = 'a0000000-0000-4000-8000-000000001008'),
  'merge_players: своё имя для озвучки профиля не перезаписывается');

-- Гость без имени для озвучки — у профиля так и остаётся null.
update public.players set spoken_name = null where id = 'a0000000-0000-4000-8000-000000001008';
select pg_temp.login(:admin);
set local role authenticated;
select public.merge_players('a0000000-0000-4000-8000-000000009003', 'a0000000-0000-4000-8000-000000001008');
reset role;
select pg_temp.check(
  (select spoken_name is null from public.players where id = 'a0000000-0000-4000-8000-000000001008'),
  'merge_players: у гостя имени нет — у профиля null');

rollback;
