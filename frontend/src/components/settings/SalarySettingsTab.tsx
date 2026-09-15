import React from 'react';
import { Coins, Calculator } from 'lucide-react';
import { AppSettings } from '../../types';

interface SalarySettingsTabProps {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}

export const SalarySettingsTab: React.FC<SalarySettingsTabProps> = ({
  settings,
  setSettings,
}) => {
  const currentRate = settings.monthly_rate && settings.monthly_rate > 0 ? settings.monthly_rate : 35000;
  
  const shiftRate = Math.abs(currentRate - 35000) < 0.1 ? 1667.0 : Math.round((currentRate / 21.0) * 100) / 100;
  const hourlyRate = Math.round((shiftRate / 8.0) * 100) / 100;
  const minuteRate = Math.round((hourlyRate / 60.0) * 1000) / 1000;
  const secondRate = (minuteRate / 60.0).toFixed(5);

  const handleRateChange = (val: number) => {
    setSettings((prev) => ({
      ...prev,
      monthly_rate: val,
    }));
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-150 select-none cursor-default">
      {/* Monthly Rate Input Card */}
      <div className="p-5 rounded-2xl bg-white border border-slate-200/80 shadow-2xs space-y-4 select-none cursor-default">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200/60 flex items-center justify-center shadow-2xs shrink-0 select-none">
            <Coins className="w-5 h-5" />
          </div>
          <div className="select-none cursor-default">
            <h4 className="text-sm font-bold text-slate-900 select-none cursor-default">Оклад за месяц</h4>
            <p className="text-xs text-slate-500 select-none cursor-default">
              Базовый размер месячной заработной платы для расчёта ставок и онлайн-таймера
            </p>
          </div>
        </div>

        <div className="space-y-3 pt-1 select-none cursor-default">
          <label className="text-xs font-semibold text-slate-700 block select-none cursor-default">
            Сумма оклада в рублях (₽ / месяц)
          </label>
          <div className="relative">
            <input
              type="number"
              min={1000}
              max={10000000}
              step={1000}
              value={currentRate}
              onChange={(e) => handleRateChange(Math.max(0, Number(e.target.value)))}
              placeholder="35000"
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 font-mono tracking-wide focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all tabular-nums select-text cursor-text"
            />
            <span className="absolute right-4 top-2.5 text-xs font-bold text-slate-400 font-mono select-none cursor-default pointer-events-none">
              ₽ / мес
            </span>
          </div>
        </div>
      </div>

      {/* Calculated Rates Grid */}
      <div className="p-5 rounded-2xl bg-slate-50/80 border border-slate-200/80 space-y-4 select-none cursor-default">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-800 select-none cursor-default">
          <Calculator className="w-4 h-4 text-blue-600" />
          <span className="select-none cursor-default">Автоматически рассчитанные ставки</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 select-none cursor-default">
          <div className="p-3.5 bg-white rounded-xl border border-slate-200/70 shadow-2xs space-y-1 select-none cursor-default">
            <span className="text-[11px] font-medium text-slate-500 block select-none cursor-default">День (8 часов)</span>
            <div className="text-sm font-bold text-slate-900 font-mono tabular-nums select-none cursor-default">
              {shiftRate.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽
            </div>
            <span className="text-[10px] text-slate-400 block select-none cursor-default">оклад / 21 день</span>
          </div>

          <div className="p-3.5 bg-white rounded-xl border border-slate-200/70 shadow-2xs space-y-1 select-none cursor-default">
            <span className="text-[11px] font-medium text-slate-500 block select-none cursor-default">Час</span>
            <div className="text-sm font-bold text-slate-900 font-mono tabular-nums select-none cursor-default">
              {hourlyRate.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽
            </div>
            <span className="text-[10px] text-slate-400 block select-none cursor-default">дневная / 8ч</span>
          </div>

          <div className="p-3.5 bg-white rounded-xl border border-slate-200/70 shadow-2xs space-y-1 select-none cursor-default">
            <span className="text-[11px] font-medium text-slate-500 block select-none cursor-default">Минута</span>
            <div className="text-sm font-bold text-slate-900 font-mono tabular-nums select-none cursor-default">
              {minuteRate.toFixed(2)} ₽
            </div>
            <span className="text-[10px] text-slate-400 block select-none cursor-default">часовая / 60м</span>
          </div>

          <div className="p-3.5 bg-white rounded-xl border border-slate-200/70 shadow-2xs space-y-1 select-none cursor-default">
            <span className="text-[11px] font-medium text-slate-500 block select-none cursor-default">Секунда (тикер)</span>
            <div className="text-sm font-bold text-slate-900 font-mono tabular-nums select-none cursor-default">
              ~{secondRate} ₽
            </div>
            <span className="text-[10px] text-slate-400 block select-none cursor-default">онлайн-счётчик</span>
          </div>
        </div>
      </div>
    </div>
  );
};
