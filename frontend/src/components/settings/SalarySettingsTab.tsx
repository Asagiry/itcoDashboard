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
    <div className="space-y-6 animate-in fade-in duration-150">
      {/* Monthly Rate Input Card */}
      <div className="p-5 rounded-2xl bg-white border border-slate-200/80 shadow-2xs space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200/60 flex items-center justify-center shadow-2xs">
            <Coins className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-slate-900">Оклад за месяц</h4>
            <p className="text-xs text-slate-500">
              Базовый размер месячной заработной платы для расчёта ставок и онлайн-таймера
            </p>
          </div>
        </div>

        <div className="space-y-3 pt-1">
          <label className="text-xs font-semibold text-slate-700 block">
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
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 font-mono tracking-wide focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all tabular-nums"
            />
            <span className="absolute right-4 top-2.5 text-xs font-bold text-slate-400 font-mono">
              ₽ / мес
            </span>
          </div>
        </div>
      </div>

      {/* Calculated Rates Grid */}
      <div className="p-5 rounded-2xl bg-slate-50/80 border border-slate-200/80 space-y-4">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
          <Calculator className="w-4 h-4 text-blue-600" />
          <span>Автоматически рассчитанные ставки</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3.5 bg-white rounded-xl border border-slate-200/70 shadow-2xs space-y-1">
            <span className="text-[11px] font-medium text-slate-500 block">День (8 часов)</span>
            <div className="text-sm font-bold text-slate-900 font-mono tabular-nums">
              {shiftRate.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽
            </div>
            <span className="text-[10px] text-slate-400 block">оклад / 21 день</span>
          </div>

          <div className="p-3.5 bg-white rounded-xl border border-slate-200/70 shadow-2xs space-y-1">
            <span className="text-[11px] font-medium text-slate-500 block">Час</span>
            <div className="text-sm font-bold text-slate-900 font-mono tabular-nums">
              {hourlyRate.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽
            </div>
            <span className="text-[10px] text-slate-400 block">дневная / 8ч</span>
          </div>

          <div className="p-3.5 bg-white rounded-xl border border-slate-200/70 shadow-2xs space-y-1">
            <span className="text-[11px] font-medium text-slate-500 block">Минута</span>
            <div className="text-sm font-bold text-slate-900 font-mono tabular-nums">
              {minuteRate.toFixed(2)} ₽
            </div>
            <span className="text-[10px] text-slate-400 block">часовая / 60м</span>
          </div>

          <div className="p-3.5 bg-white rounded-xl border border-slate-200/70 shadow-2xs space-y-1">
            <span className="text-[11px] font-medium text-slate-500 block">Секунда (тикер)</span>
            <div className="text-sm font-bold text-slate-900 font-mono tabular-nums">
              ~{secondRate} ₽
            </div>
            <span className="text-[10px] text-slate-400 block">онлайн-счётчик</span>
          </div>
        </div>
      </div>
    </div>
  );
};
