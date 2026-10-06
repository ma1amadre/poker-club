# poker-club

Telegram Mini App покерного клуба. Контракт архитектуры — `ARCHITECTURE.md` (читать перед любой правкой),
продуктовые решения — `C:\Users\JUK\.claude\plans\dynamic-crafting-fairy.md`.

## Правила
- Push в GitHub и любые действия в облачном Supabase — только по явной команде пользователя.
- Деньги, очки и ачивки считает только домен (`supabase/functions/_shared/domain`), один код на сервер и клиент.
  Любое изменение правил подсчёта — с тестом.
- Домен без зависимостей и без `Date.now()`; импорты внутри домена — относительные с `.ts`.
- Секреты (токен бота, secret-ключ Supabase, CRON_SECRET) — только в секретах функций/Vault, никогда в git.
  Во фронте только publishable/anon-ключ.
- Сессия Supabase на клиенте только в памяти (домен общий с mrgn-board).
- Без `dangerouslySetInnerHTML`; пользовательский текст только как текст.
- Локальный стек Supabase на портах 573xx (`npm run db:start`), dev-сервер на 5174.

## Проверка
`npm run typecheck && npm run lint && npm test` — зелёные перед каждым коммитом.
