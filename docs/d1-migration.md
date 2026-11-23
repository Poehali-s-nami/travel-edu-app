# Архитектура Firestore и Cloudflare D1

Актуально на 23 ноября 2026 года.

## Статус

Этап безопасного production-перехода завершен. PSN HUB работает в гибридной архитектуре:

- Firebase Authentication остается системой логинов и паролей;
- Firestore остается источником истины для профилей, импорта и части записей;
- D1 обслуживает авторизованный каталог и хранит нормализованную копию 11 коллекций;
- Worker `psn-hub-data-api` проверяет Firebase ID token и связывает Firestore с D1;
- frontend имеет защищенный Firestore fallback при временной недоступности D1.

Это не полный отказ от Firebase. Удаление Firebase или Firestore не планируется без
отдельного проекта миграции.

## Production-компоненты

- Worker: `psn-hub-data-api`;
- API: `https://api.psnhub.kz`;
- D1: `psn-hub-production`;
- D1 UUID: `6cbaeaf0-368a-4a85-8cf7-09dab381ae47`;
- Firebase: `travel-edu-app`;
- Pages: `psn-hub-next`, ветка `main`.

`workers.dev` и preview URLs Worker отключены. Административные операции доступны только
центральному администратору после проверки Firebase token.

## Коллекции

D1 хранит точную копию Firestore в `firestore_documents` и нормализованные таблицы:

- `access_users`;
- `materials`;
- `tracks`;
- `training_groups`;
- `learning_progress`;
- `material_views`;
- `audit_events`;
- `reference_documents`;
- `migration_runs`.

Поддерживаемые коллекции Firestore:

`materials`, `tracks`, `trainingGroups`, `accessUsers`, `learningProgress`,
`materialViews`, `videoCategories`, `catalogMeta`, `loginEvents`,
`adminImpersonations`, `importHistory`.

## Синхронизация

### Немедленная

- материалы, треки и группы синхронизируются после подтвержденной записи Firestore;
- просмотры и прогресс синхронизируются Worker после чтения канонического документа;
- браузер не передает Worker доверенное содержимое документа, только идентификатор.

### Ежедневная

Cloudflare Cron запускается ежедневно в `21:15 UTC`, то есть в `02:15` по времени
Кызылорды. Полностью сверяются:

- `accessUsers`;
- `loginEvents`;
- `materialViews`.

Коллекции выполняются последовательно. Ошибка одной коллекции не мешает проверить остальные,
но весь scheduled event помечается ошибкой в журнале Worker.

### Полная ручная

`POST /admin/migrate-page` копирует выбранную коллекцию страницами до 100 документов.
Первый запрос не содержит `runId` и `pageToken`; продолжения используют значения из
предыдущего ответа. После успешной последней страницы удаляются только действительно
устаревшие строки D1.

`GET /admin/reconciliation` сравнивает количества всех коллекций. Оба endpoint требуют
Firebase token центрального администратора.

## Безопасность

- `FIREBASE_SERVICE_ACCOUNT_JSON` хранится только как Cloudflare secret;
- сервисный ключ и OAuth token не записываются в D1 и не отправляются браузеру;
- сервисный аккаунт имеет роль `Cloud Datastore User`, а не Owner/Editor;
- CORS разрешает production-домены и Pages preview проекта;
- каталог без Firebase token возвращает отказ;
- профиль пользователя читается из Firestore перед выдачей каталога, поэтому блокировка и
  обязательная смена пароля применяются сразу, не дожидаясь cron.

## Проверка и публикация

```powershell
cd cloudflare/d1-worker
npm ci
npm test
npm run check
npm run deploy
```

После публикации Wrangler должен показать custom domain `api.psnhub.kz` и schedule
`15 21 * * *`.

Проверка доступности:

```text
GET https://api.psnhub.kz/health
```

Ожидаемый ответ содержит `ok: true` и `service: psn-hub-data-api`.

## Откат

При ошибке D1 frontend использует `/api/content` на Firestore. Для полного отката:

1. вернуть предыдущую версию Worker;
2. проверить Firestore fallback обычным пользователем;
3. не удалять данные D1 до выяснения причины;
4. восстановить синхронизацию и выполнить reconciliation;
5. вернуть D1 в работу только после совпадения счетчиков и контрольной выборки.

Firestore и Firebase Authentication нельзя удалять как «старые ресурсы»: они являются
частью текущего production-стека.
