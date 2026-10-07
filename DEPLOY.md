# Деплой poker-club

Сайт Mini App — GitHub Pages, бэкенд — облачный Supabase. Всё, кроме секретов и пары переключателей
в браузере, делает `.github/workflows/deploy.yml` на каждый push в `main` (и по кнопке Run workflow).
Резервные копии, их ежемесячная проверка восстановлением, «пульс» против засыпания проекта и напоминание
о сроке токена Supabase — в приватном репозитории `poker-club-ops` (его README).

| Что | Где |
|---|---|
| Сайт Mini App | https://ma1amadre.github.io/poker-club/ (репозиторий `ma1amadre/poker-club`, публичный) |
| Supabase | проект `rgykkewfrefdeyxltzwp`, организация `poker-club` (Free), eu-central-1, https://rgykkewfrefdeyxltzwp.supabase.co |
| Ops | `ma1amadre/poker-club-ops` (приватный): `keepalive.yml` раз в сутки, `backup.yml` раз в неделю, `restore-check.yml` (восстановление копии во временную базу) раз в месяц, `reminders.yml` (срок токена Supabase, переменная `TOKEN_EXPIRES`) раз в неделю |
| Бот | создан в BotFather; токен — только в секрете `TELEGRAM_BOT_TOKEN` |

## Что уже сделано

- Supabase: организация и проект созданы, регистрация пользователей в Auth выключена. Миграций и функций
  в проекте нет — их ставит первый деплой.
- GitHub: оба репозитория созданы пустыми.
- Telegram: бот создан.
- В коде: `.env.production` (адрес проекта и publishable-ключ — публичные по замыслу), миграция 011
  (секрет cron, стартовые настройки и клубный формат — seed в облако не идёт), функция `bot-setup`
  (имя бота и группа подтягиваются из админки), workflow деплоя.

## 1. В браузере, один раз (без доступов к облаку)

`ma1amadre/poker-club`:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.** Включить Pages может только
   владелец: у `GITHUB_TOKEN` workflow таких прав нет (`enablement: true` в `actions/configure-pages`
   работает только с личным токеном). Без этого шаг «Сборка сайта» упадёт на `configure-pages`.
2. **Settings → Secrets and variables → Actions → Variables → New repository variable:**

   | Имя | Значение |
   |---|---|
   | `SUPABASE_PROJECT_REF` | `rgykkewfrefdeyxltzwp` |
   | `APP_URL` | `https://ma1amadre.github.io/poker-club/` |

   Это переменные, а не секреты: в логах они видны. `APP_URL` уходит в окружение функций (по контракту;
   сейчас его ни одна функция не читает).
3. **Secrets → New repository secret:** `ADMIN_TG_ID` = `<tg id админа клуба>` (число). Сам по себе id
   не секрет (войти по нему без токена бота нельзя), но репозиторий и его логи публичные: секрет GitHub
   маскирует в логах, переменная — нет. Поэтому значения нет ни в коде, ни в этом файле.

## 2. Секреты (вводит только владелец)

Settings → Secrets and variables → Actions → **Secrets → New repository secret**. Значения нигде больше не
записывать: ни в код, ни в чат, ни в файлы.

`ma1amadre/poker-club`:

| Секрет | Где взять | Зачем |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | https://supabase.com/dashboard/account/tokens — **scoped-токен**, см. ниже | CLI (`link`, `functions deploy`, `secrets set`) и Management API (`project_url` в Vault, проверка после деплоя) |
| `SUPABASE_DB_PASSWORD` | пароль базы, заданный при создании проекта; забыт — Project Settings → Database → Reset database password | `supabase link` и `db push` |
| `TELEGRAM_BOT_TOKEN` | @BotFather → `/mybots` → бот → API Token | секрет функций: вход (подпись initData), посты, `bot-setup` |

**Токен Supabase — только scoped.** Classic-токен (в дашборде помечен **Legacy**; его же создаёт
`supabase login` в браузере) получает все права на все организации и проекты аккаунта, в том числе
будущие: утечка из публичного репозитория открыла бы SQL и удаление проектов везде. Scoped-токен
(начинается с `sbp_fc`) ограничен выбранным (docs: supabase.com/docs/guides/platform/personal-access-tokens).
При создании:

- организация `poker-club`, проект `rgykkewfrefdeyxltzwp` — и больше ничего;
- права (названия — как в docs; в форме создания токена не сверял):

  | Право | Уровень | Кому нужно |
  |---|---|---|
  | Project Settings | Read | `supabase link` |
  | API Keys | Read | `supabase link` |
  | API Key Secrets | Read | `supabase link` |
  | Edge Functions | Read-write | `functions deploy` |
  | Edge Function Secrets | Read-write | `secrets set` |
  | Database | Read-write | Management API `database/query`: запись `project_url` в Vault, проверка после деплоя |

  `db push` идёт по паролю БД (`SUPABASE_DB_PASSWORD`) и правами токена не ограничен (так в docs).
  Если первый прогон всё же упадёт на правах — в логе шага будет, чего не хватает; добавить ровно это;
- срок действия — по желанию; истёк — деплой бэкенда упадёт на `supabase link`, нужен новый токен.
  Дату окончания — ту, что показывает список токенов (supabase.com/dashboard/account/tokens), а не расчётную —
  в переменную `TOKEN_EXPIRES` репозитория `poker-club-ops`: за 10 дней до неё `reminders.yml` откроет issue
  с инструкцией (README ops → «Напоминание о токене Supabase»). После каждой замены токена — новая дата туда же.

`ma1amadre/poker-club-ops`:

| Секрет | Где взять |
|---|---|
| `SUPABASE_DB_URL` | Supabase → проект → кнопка **Connect** → **Session pooler** → строка подключения, `[YOUR-PASSWORD]` заменить паролем БД (спецсимволы в пароле — percent-encoding, подробнее в README ops) |

Session pooler — потому что раннеры GitHub ходят только по IPv4, а прямой адрес базы на Free — только IPv6.
`supabase link` в деплое по умолчанию тоже идёт через пулер.

Секрет cron (`x-cron-secret`) никто не вводит: миграция 011 создаёт его случайным прямо в Vault, а
`cron-tick` сверяет заголовок через RPC `verify_cron_secret`.

## 3. Первый пуш

```powershell
git remote add origin https://github.com/ma1amadre/poker-club.git
git push -u origin main
```

Workflow `deploy` (все actions закреплены SHA коммита; обновления SHA раз в месяц предлагает Dependabot
одним PR — смотреть changelog и вливать руками):

1. **Проверки** — `npm ci`, typecheck, lint, тесты. Упали — дальше ничего не идёт.
2. **Сборка сайта** — `npm run build` с `BASE_PATH=/poker-club/`; проверка, что в бандле нет dev-входа
   (`VITE_DEV_BOT_TOKEN`, тестовых игроков) и есть адрес облачного Supabase; `404.html`.
   **Публикация сайта** — `deploy-pages` (окружение `github-pages`).
3. **Бэкенд Supabase** — только из ветки `main` (Run workflow с другой ветки job пропускает: `db push`
   необратим, миграции невлитой ветки в облако не идут):
   - нет `SUPABASE_ACCESS_TOKEN` или `SUPABASE_DB_PASSWORD` — notice «Бэкенд не деплоился», job зелёный
     (сайт при этом выкладывается); секреты есть, а `SUPABASE_PROJECT_REF`, `APP_URL` или `ADMIN_TG_ID`
     нет — job красный с пояснением;
   - `supabase link --project-ref $SUPABASE_PROJECT_REF` (пароль из env, без вопросов);
   - `supabase db push --linked --skip-vault --yes` — миграции 001–011, **без seed**; миграция,
     вставленная перед уже применёнными, — ошибка (флага `--include-all` нет намеренно);
   - `supabase functions deploy` — все функции (`tg-auth`, `notify`, `cron-tick`, `bot-setup`; `_shared`
     не функция), `verify_jwt` — из `supabase/config.toml`;
   - `supabase secrets set` — `ADMIN_TG_ID`, `APP_URL` и `TELEGRAM_BOT_TOKEN` (если задан; через файл
     с правами 600, не аргументом). `TELEGRAM_DRY_RUN` в облаке не задаётся;
   - `project_url` в Vault — `POST https://api.supabase.com/v1/projects/{ref}/database/query`
     (создать или обновить, идемпотентно). С этого момента pg_cron раз в 15 минут дёргает `cron-tick`;
   - проверка после деплоя, три ступени: `cron-tick` с неверным `x-cron-secret` → 401; SQL через
     Management API — у `service_role` есть права на все таблицы и sequences `public`, в Vault есть
     `cron_secret` и `project_url`, задание pg_cron активно; и вся цепочка будильника —
     `private.invoke_cron_tick()` → pg_net → `cron-tick` → таблицы, ответ из `net._http_response` должен
     быть 200 без `errors`. Это обычный тик (тот же, что pg_cron делает раз в 15 минут): если пора, он
     создаст вечер и запостит анонс.

Секретов на момент пуша не было — добавить их и Actions → deploy → **Run workflow**.

`supabase config push` деплой **не** вызывает: в `config.toml` `[auth]` локальные `site_url` и redirect
(`http://127.0.0.1:5174`), а вслепую переносить их в облако нельзя. Нужное от Auth в облаке — выключенная
регистрация — уже сделано руками. Вход клуба от `site_url` не зависит: `tg-auth` выдаёт `token_hash`,
клиент делает `verifyOtp`, без редиректов.

## 4. BotFather: Main Mini App

Кнопки в постах бота — ссылки `https://t.me/<бот>?startapp=…`; они открывают **Main Mini App** бота,
без неё ссылки не работают.

@BotFather → `/mybots` → бот → **Bot Settings → Configure Mini App → Enable Mini App** → URL
`https://ma1amadre.github.io/poker-club/` (путь из документации Telegram «Mini Apps», раздел Main Mini
App; в мини-приложении BotFather тот же пункт в настройках бота).

## 5. Первый вход админа

Открыть бота в Telegram → кнопка **Открыть** (Open) в профиле бота. Пока группа не подключена, `tg-auth`
пускает только `ADMIN_TG_ID` и делает его админом. Войти сразу после деплоя — до подключения группы.

Проверить: «Управление клубом» → «Клуб» — расписание четверг 19:00, анонс за 48 ч, формат «Клубный»
(их ставит миграция 011), пост в день игры за 5 ч (умолчание миграции 014). Место по умолчанию пустое — вписать
и сохранить.

## 6. Группа клуба

В Mini App: «Управление клубом» → «Клуб» → «Группа и бот».

1. **«Подтянуть из бота»** — имя бота из Telegram (`getMe`), сохраняется сразу. По нему строятся кнопки
   «Открыть» в постах.
2. Добавить бота в группу клуба и сделать его **администратором** (иначе Telegram может не отвечать боту,
   кто состоит в группе, и участники не войдут).
3. Сразу после этого — **«Найти группу»** → выбрать группу в списке; ID сохраняется сразу.
   Функция `bot-setup` читает обновления бота (`getUpdates`) **без подтверждения** — повторный поиск видит
   их снова, ничего не «съедается». Telegram хранит обновления не дольше 24 часов (Bot API, «Getting
   updates»): если бота добавили раньше и группы нет в списке — удалить бота из группы, добавить снова и
   повторить поиск. Каждую найденную группу функция перепроверяет `getChatMember` — в списке только те,
   где бот есть сейчас; группа, превращённая в супергруппу, — под новым ID.
   В списке только группы, где сейчас состоят и бот, и ты (функция спрашивает `getChatMember` и про
   тебя): добавить бота в свою группу может любой, кто знает его имя, а выбранная группа открывает вход
   в клуб всем её участникам. Перед выбором сверить название.
4. **«Отправить проверочное сообщение»** — пост «Бот клуба подключён» в группу.
5. @BotFather → `/setjoingroups` → бот → **Disable** (в меню бота — пункт Allow Groups в Bot Settings;
   точные подписи кнопок не сверял): после этого бота нельзя добавить ни в одну новую группу. Из группы
   клуба он не выходит — запрет касается только новых добавлений (так описано у Telegram; на живом боте
   не проверял).
   Понадобится снова добавить бота в группу (например, для повторного поиска) — включить обратно.

С подключённой группой в клуб входят её участники, а `cron-tick` начинает постить: анонс за 48 ч до
ближайшей игры, пост в день игры за 5 ч до начала (кто идёт и кто ещё не ответил — с упоминанием), итоги,
голосования.

Если поиск отвечает «Telegram не отдаёт обновления» — у бота включён webhook или его опрашивает другая
программа (`getUpdates` тогда не работает). Webhook клубу не нужен; можно и вписать ID группы вручную.

### Оповещения о сбоях

Когда автоматика ломается (шаг `cron-tick` упал, `cron-tick` не отработал целиком, Telegram не принял пост
из `notify` — например, бота выкинули из группы), бот пишет админу клуба в личку: что сломалось, когда (МСК),
что проверить и ссылку на логи функции в дашборде. Об одном и том же сбое — не чаще раза в 6 часов, в следующем
сообщении — сколько раз он повторился. Устройство — `ARCHITECTURE.md`, «Оповещение админа о сбоях».

**Один раз, обязательно:** админ (тот, чей id в секрете `ADMIN_TG_ID`) открывает **личный чат с ботом** и
нажимает **Start** (или отправляет боту любое сообщение). Бот не может написать человеку первым — документация
Telegram: «Bots can't start conversations with users. A user must either add them to a group or send them a
message first» (core.telegram.org/bots, проверено 07.10.2026). Вход в Mini App кнопкой «Открыть» в профиле бота
(шаг 5) — не то же самое: личный чат при этом может так и остаться с кнопкой Start. Отвечать на Start бот
не будет — так и задумано, обработчика сообщений у него нет.

- Остановил или заблокировал бота в личке — разблокировать его там же, сообщения снова пойдут (подписи
  кнопок в клиентах Telegram не сверял).
- Не нажал Start — Telegram отвечает ошибкой 403, сообщение не доходит, а в логах функции остаётся
  строка `[admin-alert] … не удалось написать админу: Telegram sendMessage: 403 …` (точный текст ответа
  Telegram на живом боте не сверял). Сам сбой всё равно виден в логах, функция от этого не падает.
- Сменился админ — поменять секрет `ADMIN_TG_ID` (шаг 2), Run workflow `deploy`, и новый админ жмёт Start.
- Журнал повторов — таблица `public.admin_alerts` (SQL Editor: `select * from public.admin_alerts;`): по
  строке на сбой, когда последний раз писали и сколько повторов с тех пор. Удалить строку — следующий такой
  же сбой придёт сразу, не дожидаясь 6 часов.

## Проверка после деплоя

В Supabase → SQL Editor:

```sql
select jobname, schedule from cron.job;                       -- poker-club-cron-tick, */15 * * * *
select name from vault.secrets order by name;                 -- cron_secret, project_url
select status_code, created from net._http_response order by id desc limit 5;  -- 200 каждые 15 минут
```

Логи функций — Edge Functions → функция → Logs.

## Обновления

Любой push в `main` — проверки, сайт и бэкенд. Новая таблица в миграции — сразу с явными грантами
для `service_role` (и `authenticated`, если нужна клиенту): в облаке прав по умолчанию нет
(ARCHITECTURE.md, «Гранты»); проверка после деплоя это ловит, локально — тоже (`auto_expose_new_tables = false`). Схема меняется только новыми файлами
`supabase/migrations/NNN_*.sql`; уже применённые не правятся. Номер новой миграции — больше всех, что уже
есть в `main`; ветки с миграциями вливаются в `main` в порядке номеров (или вместе, одним push): `db push`
без `--include-all` не применит миграцию с номером меньше уже применённой, и деплой встанет, пока её не
переименуют. Параллельные деплои не идут: следующий
ждёт, пока закончится текущий (`concurrency`).

## Откат

- **Сайт и функции:** `git revert <коммит>` и push — деплой выложит прежний код. Если в откатываемом
  коммите есть миграция, её файл оставить: миграция уже применена, а `db push` отказывается работать,
  когда в базе есть версии, которых нет в `supabase/migrations`. Откатывать код, схему чинить новой миграцией.
  Только сайт, без нового коммита: Actions → deploy → прошлый зелёный запуск → **Re-run all jobs**
  (перезапуск берёт тот же коммит, что тогда; доступно 30 дней после запуска). Если с тех пор
  добавлялись миграции, job «Бэкенд Supabase» в таком перезапуске упадёт на `db push` и функции не
  откатит — сайт при этом выложится.
- **Схема БД:** миграции только вперёд. Ошибку исправляет новая миграция. В крайнем случае —
  восстановление из резервной копии (`poker-club-ops`, README → «Восстановление»).
- **Утёк токен бота:** @BotFather → `/mybots` → бот → API Token → Revoke current token; новый — в секрет
  `TELEGRAM_BOT_TOKEN`; Run workflow `deploy`.
- **Сменить секрет cron:** в SQL Editor
  `select vault.update_secret(id, encode(extensions.gen_random_bytes(32), 'hex')) from vault.secrets where name = 'cron_secret';`
  — pg_cron и `cron-tick` читают его из Vault, больше ничего менять не нужно.
- **Утёк токен Supabase или пароль БД:** отозвать токен на странице токенов / сбросить пароль, обновить
  секреты (`SUPABASE_DB_PASSWORD` здесь и `SUPABASE_DB_URL` в ops). Новый токен — новая дата окончания в
  переменную `TOKEN_EXPIRES` в ops, иначе напоминание придёт по старому сроку, а о новом промолчит.

## Чего деплой не делает

- не заливает `seed.sql` (тестовые данные только локально);
- не трогает настройки Auth (`config push` не вызывается);
- не переносит фото голосований и не бэкапит их (Storage вне дампа);
- не включает Pages и не вводит секреты — это шаги 1–2;
- не выключает Allow Groups у бота — шаг 6.
