---
name: huly-tracker
description: Экспертиза взаимодействия с ITCO Tracker (Huly) через Node.js WebSocket transactor и REST bridge.
---

# Huly Tracker Integration Skill

## 1. Архитектура интеграции
- **Компонент**: `backend/app/tracker_client.py` запускает `backend/huly_bridge.cjs` как отдельный Node.js subprocess.
- **Транспорт**: WebSocket к `wss://tracker.itco.su/_transactor`.
- **SDK**: Официальные библиотеки `@hcengineering/core`, `@hcengineering/model`, `@hcengineering/platform`.
- **Авторизация**: Постоянный workspace-токен Huly из `.env` (`HULY_TOKEN`) или сессионный токен.

## 2. Ключевые операции
- **Синхронизация задач**:
  Получение issues из проектов, маппинг статусов:
  `Backlog` -> `In Progress` -> `Review` -> `Done` / `Cancelled`.
- **Рендеринг разметки**:
  Текст описаний задач хранится в формате ProseMirror / Huly rich text; для извлечения используется SDK-метод `getMarkup`.
- **Вложения**:
  Вложения к задачам скачиваются через API трекера и кешируются локально с проверкой путей на отсутствие directory traversal.
- **Оптимистичный UI**:
  Фронтенд (`TrackerView.tsx`) реализует немедленное (0ms) обновление локального состояния при Drag-and-Drop карточек, с последующим фоновым PATCH-запросом к бэкенду.

## 3. Обработка ошибок
- При разрыве WebSocket соединения мост перезапускается с exponential backoff.
- В случае недоступности трекера бэкенд возвращает кешированные данные или понятное сообщение об ошибке (HTTP 503 / `tracker_unavailable`).
