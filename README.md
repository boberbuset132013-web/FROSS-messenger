# FROSS Messenger

Веб-мессенджер на HTML/CSS/JS + Cloudflare Workers + D1.

## Исходный код
- `prototype.html` — ваш загруженный HTML-прототип, сохранённый без изменений.
- `public/index.html` — новая версия сайта с регистрацией и серверной общей комнатой.

## Что уже есть в первой версии
- Регистрация и вход по имени пользователя и паролю.
- Хранение пользователей, сессий и сообщений в Cloudflare D1.
- Общая комната.
- Обновление сообщений каждые 2,5 секунды.
- Хеширование паролей через PBKDF2 (210 000 итераций), токены сессий хранятся в базе только в виде SHA-256-хеша.
- Адаптивный интерфейс для телефона и компьютера.

## Подключение Cloudflare
1. Создайте отдельный Worker с именем `fross-messenger`, подключив GitHub-репозиторий `boberbuset132013-web/FROSS-messenger` через Workers Builds. Не подключайте этот проект к существующему Worker `fross`: он обслуживает другой сервис.
2. Создайте Cloudflare D1 Database с именем `fross-messenger-db`.
3. Скопируйте Database ID и замените `REPLACE_WITH_D1_DATABASE_ID` в `wrangler.toml`.
4. Создайте D1 binding с переменной `DB` и выберите эту базу данных.
5. Примените миграцию из `migrations/0001_init.sql` к базе:
   ```sh
   npx wrangler d1 migrations apply fross-messenger-db --remote
   ```
6. Запустите Deploy в Cloudflare. Проверка API: `https://ИМЯ-WORKER.workers.dev/api/health`.

## Локальный запуск
```sh
npm install --save-dev wrangler
npx wrangler dev
``

## Что пока не реализовано
В первой версии доступна только общая комната. Личные чаты, поиск пользователей, вложения, статусы присутствия, WebSocket realtime, восстановление пароля и модерация — следующие этапы. Перед широким публичным запуском добавьте rate limiting для регистрации/входа, защиту от перебора паролей и процедуры удаления аккаунта/данных. Используйте HTTPS и не публикуйте секреты в репозитории.

## Важно: публикация именно Worker, а не Static Assets only

В репозитории теперь есть `package.json` с Wrangler 4 и командой `npm run deploy`.
В Cloudflare откройте **Workers & Pages → fross-messenger → Settings → Builds**:
- Git repository: `boberbuset132013-web/FROSS-messenger`
- Production branch: `main`
- Root directory: `/` (корень репозитория)
- Build command: оставить пустой
- Deploy command: `npm run deploy`

После сохранения настроек запустите новый build/retry deployment. Wrangler прочитает `wrangler.toml`, загрузит `worker.js` как серверный код и `public/` как статические файлы. Не выбирайте режим публикации только Static Assets. Название Worker в Cloudflare должно быть `fross-messenger`.

Перед успешной публикацией обязательно замените заглушку `REPLACE_WITH_D1_DATABASE_ID` в `wrangler.toml` на ID вашей D1-базы. D1 binding уже описан в конфигурации с именем `DB`; после deploy он появится у скрипта как `env.DB`.

Применить таблицы после добавления ID можно командой:
```sh
npm run d1:migrate:prod
```
