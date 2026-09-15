# ITCO Tracker (Huly) — Руководство и архитектура интеграции

Документ описывает принципы работы, устройство и API интеграции ITCO Dashboard с корпоративным трекером задач **Huly** (`https://tracker.itco.su`).

---

## 1. Общие сведения и архитектура

ITCO Tracker построен на базе открытой платформы **Huly**.
- **URL инстанса**: `https://tracker.itco.su`
- **Рабочее пространство (Workspace)**: `itco` (`c7115f1a-9144-47f3-9cc5-156cdcdb7f0c`)
- **Пользователь**: `vepishin@it-co.ru` (ID контакта: `6a969554b09b44d03f62d9f7`)
- **Протокол работы**:
  - Авторизация и управление сессией: REST API `https://tracker.itco.su/_accounts`
  - Синхронизация задач и мутации: WebSocket Transactor `wss://tracker.itco.su/_transactor`
  - Тексты описаний и разметка: Collab Markup Service (`@hcengineering/collaborator-client`)
  - Файлы и вложения: REST Files API `https://tracker.itco.su/files/<workspace>/...`

---

## 2. Модуль интеграции (`backend/huly_bridge.cjs`)

Вся низкоуровневая работа с протоколами Huly вынесена в изолированный Node.js-скрипт `backend/huly_bridge.cjs`, использующий официальные библиотеки `@hcengineering`:
- `@hcengineering/account-client` — вход по паролю, получение JWT-токена workspace.
- `@hcengineering/api-client` — фабрика WebSocket-клиента.
- `@hcengineering/core` — управление транзакциями (`TxOperations`), поиск документов (`tx.findAll`), обновление сущностей (`tx.updateDoc`).
- `@hcengineering/collaborator-client` + `@hcengineering/text-markdown` — чтение и парсинг AST-разметки описания задач в чистый Markdown.

### Команды CLI bridge:
```bash
# 1. Авторизация по логину и паролю
node backend/huly_bridge.cjs login "vepishin@it-co.ru" "пароль"

# 2. Синхронизация всех проектов и активных задач
node backend/huly_bridge.cjs sync "<tracker_token>" "<account_id>"

# 3. Обновление статуса конкретной задачи
node backend/huly_bridge.cjs update_status "<tracker_token>" "<account_id>" "МКС-189" "in_progress"
```

---

## 3. Статусы задач и соответствие колонкам

На канбан-доске дашборда отображаются только **активные рабочие колонки** (задачи в `Ready for Production`, `Done`, `Resolved`, `Canceled` автоматически исключаются из синхронизации):

| Статус в Dashboard | Название в UI | ID статуса в Huly | Цвет / Иконка |
|---|---|---|---|
| `todo` | **Todo** | `tracker:status:Todo` / `Backlog` | Серый (`Circle`) |
| `in_progress` | **In progress** | `tracker:status:InProgress` | Синий (`Clock`) |
| `review` | **review** | `69f9bb5a112005c7f3bf3c72` | Пурпурный (`Clock`) |
| `ready_for_testing` | **ready for testing** | `6aa3c483f404981b798206bf` | Индиго (`FlaskConical`) |
| `testing` | **Testing** | `69f9bb44112005c7f3bf3c6a` | Янтарный (`Clock`) |
| `ready_to_merge` | **Ready for merge** | `69fa066535e6ece6dbd474d2` | Изумрудный (`CheckCircle2`) |

---

## 4. Пайплайн вложений и изображений

1. **Скачивание**: При выполнении `sync` скрипт `huly_bridge.cjs` извлекает метаданные вложений из класса `attachment:class:Attachment`, а также находит ссылки на скриншоты в теле описания.
2. **Локальное кэширование**: Изображения сохраняются по пути:
   `backend/media/attachments/<ISSUE_KEY>/<FILE_ID_PREFIX>.png`
3. **Раздача клиенту**: Бэкенд FastAPI отдает изображения через эндпоинт `/api/tracker/attachments/{issue_key}/{filename}` (с проверкой на безопасность путей).
4. **Просмотр в UI**:
   - В карточках отображается компактная миниатюра и счетчик `attachments_count`.
   - В модальном окне задачи есть галерея скриншотов.
   - Клик по скриншоту открывает полноэкранный лайтбокс с зумом (`z-[100]`), закрываемый по клавише `Esc` или клику на фон.

---

## 5. Нормализация и форматирование описаний

Huly хранит описания в виде JSON-структур богатого текста. При извлечении описания выполняются следующие преобразования:
- Вырезание лишних span-тегов и технического мусора (строки вида `image.png 34.5 kB • Download • Delete`).
- Преобразование меток:
  - `ОР:` / `Ожидаемый результат` -> `**ОР:**`
  - `ФР:` / `Фактический результат` -> `**ФР:**`
  - `Вопрос:` -> `**Вопрос:**`
  - `Ответ:` -> `**Ответ:**`
- Нормализация жестких переносов строк внутри абзацев (текст складывается в единый читаемый параграф, списки и скриншоты сохраняют блочную структуру).

---

## 6. Drag-and-Drop и оптимистичный UI

- При перетаскивании карточки в другую колонку UI обновляется **мгновенно (0ms)** через локальный стейт React.
- На бэкенд отправляется запрос `POST /api/tracker/issues/{key}/status`.
- Бэкенд обновляет запись в SQLite и в фоновой `asyncio`-таске вызывает `huly_bridge.cjs update_status`.
- Для предотвращения состояния гонки при фоновом автообновлении (polling раз в 12 сек / focus) используется `pendingUpdatesRef`, удерживающий статус до подтверждения синхронизации.

---

## 7. Авторизация из интерфейса

1. Открыть **«Настройки»** -> вкладка **«Трекер ITCO (Huly)»**.
2. Ввести e-mail (`vepishin@it-co.ru`) и пароль от Huly.
3. Нажать **«Выполнить вход»**.
4. После получения токена синхронизация запускается автоматически.
