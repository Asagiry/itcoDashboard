import React, { useState } from 'react';
import { api } from '../../api/client';

interface ShiftResetTabProps {
  onResetTodayShift: () => Promise<void>;
  showToast: (type: 'success' | 'error' | 'info', title: string, message?: string) => void;
}

export const ShiftResetTab: React.FC<ShiftResetTabProps> = ({
  onResetTodayShift,
  showToast,
}) => {
  const [isResettingToday, setIsResettingToday] = useState(false);
  const [isResettingAll, setIsResettingAll] = useState(false);

  const handleResetToday = async () => {
    if (!window.confirm('Сбросить данные текущей смены за сегодня?')) return;
    setIsResettingToday(true);
    try {
      await onResetTodayShift();
      showToast('info', 'Смена сброшена', 'Данные за сегодня удалены.');
    } catch (err: any) {
      showToast('error', 'Ошибка сброса', err.message);
    } finally {
      setIsResettingToday(false);
    }
  };

  const handleResetAll = async () => {
    if (!window.confirm('ВНИМАНИЕ! Это полностью очистит ВСЮ историю смен из базы данных. Продолжить?')) return;
    setIsResettingAll(true);
    try {
      await api.resetAllData();
      showToast('success', 'База очищена', 'Вся история смен успешно удалена.');
      await onResetTodayShift();
    } catch (err: any) {
      showToast('error', 'Ошибка очистки', err.message);
    } finally {
      setIsResettingAll(false);
    }
  };

  return (
    <div className="space-y-6 select-none cursor-default">
      <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1 select-none cursor-default">
        <h4 className="font-bold select-none cursor-default">Зона управления данными</h4>
        <p className="text-amber-800 leading-relaxed select-none cursor-default">
          Используйте сброс для тестирования начала/завершения рабочего дня или очистки отладочных записей.
        </p>
      </div>

      <div className="space-y-4 select-none cursor-default">
        {/* Reset Today */}
        <div className="p-4 rounded-xl border border-slate-200 flex items-center justify-between bg-white select-none cursor-default">
          <div className="select-none cursor-default">
            <h5 className="text-xs font-bold text-slate-800 select-none cursor-default">Сбросить сегодняшнюю смену</h5>
            <p className="text-[11px] text-slate-500 select-none cursor-default">Удаляет запись смены за текущую дату</p>
          </div>
          <button
            type="button"
            onClick={handleResetToday}
            disabled={isResettingToday}
            className="px-3.5 py-2 bg-slate-100 hover:bg-amber-100 text-amber-900 rounded-lg text-xs font-semibold transition-colors cursor-pointer select-none"
          >
            {isResettingToday ? 'Сброс...' : 'Сбросить сегодня'}
          </button>
        </div>

        {/* Reset All */}
        <div className="p-4 rounded-xl border border-rose-200/80 flex items-center justify-between bg-rose-50/30 select-none cursor-default">
          <div className="select-none cursor-default">
            <h5 className="text-xs font-bold text-rose-900 select-none cursor-default">Очистить всю историю смен</h5>
            <p className="text-[11px] text-rose-700 select-none cursor-default">Полное удаление всех смен из базы данных</p>
          </div>
          <button
            type="button"
            onClick={handleResetAll}
            disabled={isResettingAll}
            className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer select-none"
          >
            {isResettingAll ? 'Очистка...' : 'Очистить всю базу'}
          </button>
        </div>
      </div>
    </div>
  );
};
