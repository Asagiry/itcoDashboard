---
name: refero-design
description: Экспертиза дизайн-системы Refero Minimalist, верстки Tailwind CSS без AI-slop и высокоточных компонентов таймеров.
---

# Refero Minimalist Design System Skill

## 1. Философия и визуальный язык (Anti-AI-Slop)
- Никаких вычурных 3D-градиентов, летающих бейджей, избыточных теней или резких пружинящих анимаций (`scale(1.05)`).
- Сдержанная, функциональная рабочая среда (Swiss / Linear / Refero aesthetic).
- Палитра: нейтральный светлый slate (`bg-slate-50`, `bg-white`, `text-slate-900`, `text-slate-600`, границы `border-slate-200/80`).
- Акценты: умеренные пастельные и статусные тона (`emerald` для успеха/активной смены, `amber` для ожидания, `violet` для ревью).

## 2. Типографика и цифры
- **Абсолютное правило**: Все числовые значения, суммы в рублях, таймеры и счетчики ОБЯЗАНЫ использовать класс `tabular-nums` (моноширинные цифры), чтобы верстка не "дергалась" при обновлении значений.
- Четкая иерархия шрифтов: `text-xs`, `text-sm`, `text-base`, `font-medium`, `font-semibold`.

## 3. Динамический таймер в заголовке вкладки
- Хук `useDynamicTitle.ts` обновляет `document.title` каждые ~50ms (20 кадров/сек):
  `04:12:35 • 876.54 ₽ | ITCO Dashboard`
- При завершении смены title восстанавливается в базовый `ITCO Dashboard`.

## 4. Drag-and-Drop и модальные окна
- В `TrackerView.tsx` Drag-and-Drop карточек смены/задач использует нулевой лаг (0ms optimistic UI).
- `TaskDetailModal.tsx` и `Lightbox.tsx` поддерживают плавное затемнение (`backdrop-blur-sm`), закрытие по `Esc` и клику вне области.
