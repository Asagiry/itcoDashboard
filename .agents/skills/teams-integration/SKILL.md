---
name: teams-integration
description: Экспертиза интеграции с Microsoft Teams chatsvc API, фонового обновления токенов Playwright и изоляции тестового контура.
---

# Microsoft Teams Integration Skill

## 1. Top-Level Invariant
**НИКОГДА НЕ ОТПРАВЛЯТЬ РЕАЛЬНЫЕ СООБЩЕНИЯ В TEAMS ИЗ ТЕСТОВ ИЛИ DEV-СРЕДЫ.**
Все вызовы `teams_client.send_message` или прямые HTTP-запросы в тестах `backend/tests/` должны быть гарантированно замоканы (`unittest.mock.patch`).

## 2. Архитектура интеграции
- **Транспорт**: Прямой HTTP REST клиент к `https://teams.microsoft.com/api/chatsvc/...` (через `httpx.AsyncClient`).
- **Авторизация**: `Bearer <skypetoken_asm>`.
- **Фоновые демоны**:
  - `proactive_token_keeper`: раз в 5 минут проверяет валидность токена; если до истечения < 10 минут, обновляет в фоне через headless Playwright.
  - `scheduled_report_runner`: каждые 5 секунд проверяет расписание отчетов в SQLite и формирует отправку в Teams по времени (17:30 / 18:00 и т.д.).
- **Восстановление сессии**: При получении `401 Unauthorized` триггерится `browser_auth.py`, проходящий тихую авторизацию через сохраненные cookie и стейт.

## 3. Кодирование Thread ID
Teams thread ID содержит специальные символы (двоеточия, @):
`19:...@thread.v2`
При формировании URL сообщений thread ID должен быть правильно закодирован или передан в неизменном виде в зависимости от спецификации эндпоинта.
