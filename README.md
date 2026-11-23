# PSN HUB

Закрытая обучающая платформа компании. Production: `https://psnhub.kz`.

## Текущая архитектура

PSN HUB работает на устойчивом гибридном стеке:

- GitHub `Poehali-s-nami/travel-edu-app` — исходный код и история изменений;
- Cloudflare Pages — frontend и автоматическая публикация ветки `main`;
- Cloudflare Worker `psn-hub-data-api` — защищенный серверный API;
- Cloudflare D1 `psn-hub-production` — рабочий каталог и синхронизированная копия данных;
- Firebase Authentication — логины, пароли и пользовательские сессии;
- Firestore `travel-edu-app` — источник истины для профилей и части операций;
- Hoster.kz — регистратор домена `psnhub.kz`;
- Netlify — внешний календарь обучения.

Это production-архитектура, а не временный тестовый стенд. Firebase пока не выведен
из эксплуатации и не должен удаляться.

## Документация

- [Передача и эксплуатация продукта](docs/project-handover.md)
- [Архитектура Firestore и D1](docs/d1-migration.md)
- [Импорт пользователей](docs/user-import.md)
- [Контроль безопасности](docs/security-launch-checklist.md)
- [Возможный перенос на собственный сервер](docs/own-server-deployment.md)

## Локальная проверка

```powershell
npm ci
npm run test:roles
npm run test:import
npm run test:password
npm run test:login-status
npm run test:roles-admin
npm run test:groups
npm run test:content-access
npm run test:progress
npm run build
```

Worker проверяется отдельно:

```powershell
cd cloudflare/d1-worker
npm ci
npm test
npm run check
```

Секреты, пароли, CRM-выгрузки и JSON-ключи сервисных аккаунтов запрещено
добавлять в Git.
