# Каталог блюд — API

Express.js / PostgreSQL. CRUD для блюд и их фотографий; остатки и наличие не входят в сервис. `is_active` управляет публикацией в каталоге, а не остатками. Фотографии хранятся в PostgreSQL вместе с блюдами и сохраняются в томе БД при запуске через Compose.

## Локальный запуск на macOS без Docker

Требуются Node.js 24+ и PostgreSQL 17. В этом окружении PostgreSQL установлен через Homebrew:

```sh
brew services start postgresql@17
/opt/homebrew/opt/postgresql@17/bin/psql -d postgres -c "CREATE ROLE products_app LOGIN PASSWORD 'local-products-password';"
/opt/homebrew/opt/postgresql@17/bin/psql -d postgres -c "CREATE DATABASE products_db OWNER products_app;"
npm ci
```

Скопируйте `.env.example` в `.env`, установите `DATABASE_URL` с паролем созданной роли и задайте уникальный `ADMIN_TOKEN` длиной от 16 символов. Если локальная БД уже создана, команды `CREATE` повторять не нужно. Далее:

```sh
npm run db:migrate
npm run dev
```

API: `http://localhost:3001/api`; проверка БД: `GET /api/health`. В текущей локальной установке `.env` уже создан для разработки: токен `local-only-change-before-deploy`. Не используйте его при деплое. Файл `.env` исключён из Git.

## Docker Compose / Coolify

После установки Docker задайте `POSTGRES_PASSWORD` и `ADMIN_TOKEN` в `.env` (см. `.env.example`) и запустите `docker compose up --build -d` в этом репозитории. PostgreSQL сохраняет данные в именованном томе; он доступен локально на порту 5433, API — на 3001. Если локальный API уже запущен через `npm run dev`, остановите его перед запуском Compose, либо задайте другой `API_PORT`. Добавьте `http://localhost:8080` к `CORS_ORIGIN`, если используете фронтенд в контейнере. Docker здесь пока не установлен, поэтому Compose не проверен исполнением.

Для Coolify подключите репозиторий как Docker Compose, укажите секреты `POSTGRES_PASSWORD`, `ADMIN_TOKEN` и `CORS_ORIGIN=https://<домен-фронта>`; направьте домен API на сервис `api`, порт 3001. Не публикуйте порт PostgreSQL наружу; при деплое уберите привязку `db.ports` либо используйте отдельный внутренний PostgreSQL Coolify. Порт API можно также не публиковать непосредственно, если трафик идёт через прокси Coolify. В продакшене обязательны HTTPS и длинный случайный токен. При следующем этапе стоит заменить единый токен полноценной авторизацией администраторов.

## Контракт

- `GET /api/dishes` — без токена только опубликованные блюда, с токеном все.
- `POST /api/dishes` — создать, `PUT /api/dishes/:id` — изменить, `DELETE /api/dishes/:id` — удалить. Для записи обязателен `Authorization: Bearer <ADMIN_TOKEN>`.
- Тело POST/PUT: `{ "name": "Борщ", "description": "", "category": "Супы", "image_url": "", "price_kopeks": 35000, "is_active": true }`. Цена хранится в копейках; `is_active` не означает наличие на складе. `image_url` оставлен для совместимости со старыми клиентами; ранее заданные ссылки один раз переносятся в галерею.
- Ответы с блюдами содержат `photos`: массив `{ id, url, is_primary }`, отсортированный главным фото первым. Загруженное фото отдаётся по `GET /api/photos/:id` как JPEG.
- `POST /api/dishes/:id/photos` — загрузить файл полем `photo` (`multipart/form-data`), максимум 10 МБ/файл и 10 фото/блюдо; сервер проверяет формат и пересохраняет изображение без метаданных. `PATCH /api/dishes/:id/photos/:photoId/primary` — выбрать главное, `DELETE /api/dishes/:id/photos/:photoId` — удалить фото. Для всех изменений нужен токен администратора.

Тесты: `TEST_DATABASE_URL=postgres://products_app:<пароль>@127.0.0.1:5432/products_test_db npm test`. Если переменная не задана, интеграционный тест пропускается.
