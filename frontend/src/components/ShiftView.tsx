import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Play,
  CheckCircle2,
  Lock,
  Clock,
  Send,
  Save,
  Check,
  Calendar,
  Building2,
  Wallet,
  AlertCircle,
  Copy,
  Edit2,
  X,
  Loader2
} from 'lucide-react';
import { Shift, SalaryStats } from '../types';
import { api } from '../api/client';

interface ShiftViewProps {
  shift: Shift | null;
  onStartShift: () => Promise<void>;
  onEndShift: (report: string) => Promise<void>;
  onSendReportNow?: () => Promise<void>;
  onSaveDraft: (report: string) => Promise<void>;
  onRefreshShift?: () => Promise<void>;
  onOpenSettings?: () => void;
  isLoading: boolean;
  previousReport?: string | null;
}

export const ShiftView: React.FC<ShiftViewProps> = ({
  shift,
  onStartShift,
  onEndShift,
  onSendReportNow,
  onSaveDraft,
  onRefreshShift,
  isLoading,
  previousReport,
}) => {
  const [reportText, setReportText] = useState('');
  const [draftSaved, setDraftSaved] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [salaryStats, setSalaryStats] = useState<SalaryStats | null>(null);
  const [isEditingStart, setIsEditingStart] = useState(false);
  const [newStartTime, setNewStartTime] = useState('');
  const [isSavingStart, setIsSavingStart] = useState(false);
  const draftTimerRef = useRef<NodeJS.Timeout | null>(null);

  const effectivePreviousReport = useMemo(() => {
    const raw = previousReport ?? shift?.previous_report;
    return raw && raw.trim().length > 0 ? raw.trim() : null;
  }, [previousReport, shift?.previous_report]);

  const handleSaveStartTime = async () => {
    if (!shift) return;
    setIsSavingStart(true);
    try {
      await api.updateShift(shift.date, {
        start_time: newStartTime.trim(),
        status: shift.status,
      });
      setIsEditingStart(false);
      await onRefreshShift?.();
      await loadSalaryStats();
    } catch (err: any) {
      alert(`Ошибка при сохранении времени начала смены: ${err.message}`);
    } finally {
      setIsSavingStart(false);
    }
  };

  const loadSalaryStats = async () => {
    try {
      const stats = await api.getSalaryStats();
      setSalaryStats(stats);
    } catch {}
  };

  useEffect(() => {
    loadSalaryStats();
  }, [shift?.status, shift?.end_time]);

  useEffect(() => {
    if (shift?.daily_report) {
      setReportText(shift.daily_report);
    }
  }, [shift?.daily_report]);

  useEffect(() => {
    const clockTimer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(clockTimer);
  }, []);

  // Live polling when shift report is scheduled to catch automatic completion
  useEffect(() => {
    if (shift?.status === 'completed' && shift?.report_status === 'scheduled') {
      const pollTimer = setInterval(() => {
        onRefreshShift?.();
      }, 6000);
      return () => clearInterval(pollTimer);
    }
  }, [shift?.status, shift?.report_status, onRefreshShift]);

  useEffect(() => {
    if (shift?.status === 'in_progress' && shift.start_time) {
      const calculateElapsed = () => {
        const [hours, minutes, seconds] = shift.start_time!.split(':').map(Number);
        const startDate = new Date();
        startDate.setHours(hours, minutes, seconds || 0, 0);

        const now = new Date();
        const diff = Math.max(0, now.getTime() - startDate.getTime());
        setElapsedMs(diff);
      };

      calculateElapsed();
      const interval = setInterval(calculateElapsed, 50);
      return () => clearInterval(interval);
    } else if (shift?.status === 'completed' && shift.start_time && shift.end_time) {
      const [sh, sm, ss] = shift.start_time.split(':').map(Number);
      const [eh, em, es] = shift.end_time.split(':').map(Number);
      const s = sh * 3600 + sm * 60 + (ss || 0);
      const e = eh * 3600 + em * 60 + (es || 0);
      setElapsedMs(Math.max(0, (e - s) * 1000));
    } else {
      setElapsedMs(0);
    }
  }, [shift?.status, shift?.start_time, shift?.end_time]);

  const isShiftNotStarted = !shift || shift.status === 'not_started';
  const isShiftInProgress = shift?.status === 'in_progress';
  const isShiftCompleted = shift?.status === 'completed';

  const parseShiftHours = (start?: string | null, end?: string | null) => {
    if (!start || !end) return 8.0;
    try {
      const [sh, sm, ss] = start.split(':').map(Number);
      const [eh, em, es] = end.split(':').map(Number);
      const s = sh * 3600 + sm * 60 + (ss || 0);
      const e = eh * 3600 + em * 60 + (es || 0);
      let diff = e - s;
      if (diff < 0) diff += 24 * 3600;
      return Math.round((diff / 3600) * 10) / 10;
    } catch {
      return 8.0;
    }
  };

  const currentShiftRate = salaryStats?.shift_rate ?? 1667.0;
  const SECOND_RATE = currentShiftRate / 28800.0;

  const todayHours = isShiftCompleted
    ? (shift?.start_time && shift?.end_time ? parseShiftHours(shift.start_time, shift.end_time) : 8.0)
    : 0;

  const elapsedSeconds = elapsedMs / 1000.0;

  // Today's earned
  const todayEarnedLive = isShiftInProgress
    ? elapsedSeconds * SECOND_RATE
    : isShiftCompleted
    ? todayHours * (currentShiftRate / 8.0)
    : 0;

  // Monthly earnings
  const totalMonthEarnedLive = useMemo(() => {
    if (isShiftCompleted) {
      return salaryStats?.total_month_earned_live ?? 0;
    }
    const priorCompleted = salaryStats?.completed_earned_total ?? 0;
    return isShiftInProgress ? priorCompleted + todayEarnedLive : (salaryStats?.total_month_earned_live ?? priorCompleted);
  }, [salaryStats, isShiftCompleted, isShiftInProgress, todayEarnedLive]);

  const formatMoneyParts = (amount: number) => {
    const whole = Math.floor(amount).toLocaleString('ru-RU');
    const cents = (amount % 1).toFixed(2).split('.')[1] || '00';
    return { whole, cents };
  };
  const monthMoney = formatMoneyParts(totalMonthEarnedLive);
  const todayMoney = formatMoneyParts(todayEarnedLive);

  const handleReportChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setReportText(text);
    setDraftSaved(false);

    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current);
    }

    if (shift?.status === 'in_progress') {
      draftTimerRef.current = setTimeout(async () => {
        await onSaveDraft(text);
        setDraftSaved(true);
      }, 1000);
    }
  };

  const formatElapsedTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const tenths = Math.floor((ms % 1000) / 100);
    return {
      main: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
      tenths: `.${tenths}`,
    };
  };

  const timerObj = formatElapsedTime(elapsedMs);

  const formattedDate = currentTime.toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const MONTHS_NAMES_RU = [
    'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
    'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'
  ];
  const currentMonthName = MONTHS_NAMES_RU[currentTime.getMonth()];

  return (
    <div className="flex-1 w-full h-full p-3.5 sm:p-5 md:px-8 md:py-6 flex flex-col gap-3.5 sm:gap-5 overflow-y-auto lg:overflow-hidden">
      {/* Top Header Card */}
      <div className="w-full bg-white p-4 sm:px-6 sm:py-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 shrink-0">
        <div>
          <div className="flex items-center gap-1.5 text-slate-500 text-xs font-semibold mb-1">
            <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="capitalize">{formattedDate}</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
            Рабочая смена
          </h2>
        </div>

        <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3 sm:gap-6 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
          <div className="text-left sm:text-right">
            <div className="text-xl sm:text-2xl font-bold font-mono tracking-tight text-slate-800 tabular-nums">
              {currentTime.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
            <div className="text-[11px] sm:text-xs text-slate-400 font-medium">Время</div>
          </div>

          <div className="h-8 w-px bg-slate-200 hidden sm:block" />

          <div className="text-right hidden sm:block">
            <div className="text-2xl font-bold font-mono tracking-tight text-emerald-600 flex items-baseline justify-end tabular-nums">
              <span>{monthMoney.whole}</span>
              <span className="text-sm opacity-90 inline-block ml-0.5">
                .{monthMoney.cents} ₽
              </span>
            </div>
            <div className="text-xs text-slate-400 font-medium capitalize">За {currentMonthName}</div>
          </div>

          <div className="h-8 w-px bg-slate-200 hidden sm:block" />

          <div className="shrink-0">
            {isShiftNotStarted && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                <span className="w-2 h-2 rounded-full bg-slate-400" />
                Смена не начата
              </span>
            )}
            {isShiftInProgress && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Смена активна
              </span>
            )}
            {isShiftCompleted && shift?.report_status === 'scheduled' && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span className="truncate max-w-[200px] sm:max-w-none">
                  Смена завершена (отчёт в {shift.report_scheduled_at ? shift.report_scheduled_at.slice(0, 5) : '18:00'})
                </span>
              </span>
            )}
            {isShiftCompleted && shift?.report_status === 'failed' && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                Ошибка отправки отчёта
              </span>
            )}
            {isShiftCompleted && (shift?.report_status === 'sent' || shift?.report_status === 'not_scheduled' || !shift?.report_status) && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                Смена завершена
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row gap-4 sm:gap-5 min-h-0 w-full">
        {/* Left Column: 3 Metric Cards */}
        <div className="w-full lg:w-[380px] xl:w-[410px] shrink-0 flex flex-col gap-3.5 sm:gap-4 justify-between">
          {/* Card 1: Начало смены */}
          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between flex-1">
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-bold text-slate-900">
                  Начало смены
                </h3>
                <div className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-200/60 flex items-center justify-center text-slate-500">
                  <Building2 className="w-4 h-4" />
                </div>
              </div>

              <div className="mt-1 p-3 bg-slate-50/80 rounded-xl border border-slate-100 space-y-1">
                <div className="text-[11px] font-medium text-slate-400">
                  Сообщение в Teams:
                </div>
                <div className="text-xs font-semibold text-slate-800 italic">
                  «Здравствуйте, я на рабочем месте»
                </div>
                <div className="text-[10px] text-slate-400 pt-0.5">
                  Официальный старт с 10:00 (ранний приход округляется)
                </div>
              </div>
            </div>

            <div className="mt-3.5">
              {isShiftNotStarted ? (
                <button
                  onClick={onStartShift}
                  disabled={isLoading}
                  className="w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm sm:text-xs shadow-xs transition-colors active:scale-[0.98] disabled:opacity-50 cursor-pointer min-h-[44px]"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>{isLoading ? 'Отправка...' : 'Я на смене'}</span>
                </button>
              ) : isEditingStart ? (
                <div className="p-3 rounded-xl bg-blue-50/80 border border-blue-200 text-xs space-y-2.5 animate-in fade-in duration-150">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-blue-900">Время начала смены:</span>
                    <button
                      onClick={() => setIsEditingStart(false)}
                      className="text-slate-400 hover:text-slate-600 p-1 rounded-md cursor-pointer"
                      aria-label="Отмена редактирования"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newStartTime}
                      onChange={(e) => setNewStartTime(e.target.value)}
                      placeholder="10:00:00"
                      className="flex-1 px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-mono font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 min-h-[40px]"
                    />
                    <button
                      onClick={handleSaveStartTime}
                      disabled={isSavingStart || !newStartTime.trim()}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-xs transition-colors flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50 shrink-0 min-h-[40px]"
                    >
                      {isSavingStart ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      <span>ОК</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/70 text-slate-700 text-xs flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="font-semibold">
                      {shift?.start_time ? `Смена начата в ${shift.start_time}` : 'Смена активна'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {shift && (
                      <button
                        onClick={() => {
                          setNewStartTime(shift.start_time || '10:00:00');
                          setIsEditingStart(true);
                        }}
                        className="p-1.5 rounded-lg hover:bg-slate-200/70 text-slate-400 hover:text-blue-600 transition-colors cursor-pointer"
                        title="Изменить время начала смены"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {isShiftInProgress && (
                      <span className="flex h-2.5 w-2.5 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                      </span>
                    )}
                    {isShiftCompleted && (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Card 2: Рабочее время */}
          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between flex-1">
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-base font-bold text-slate-900">
                  Рабочее время
                </h3>
                <div className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-200/60 flex items-center justify-center text-slate-500">
                  <Clock className="w-4 h-4" />
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 flex flex-col items-center justify-center my-1">
              <div className={`text-3xl sm:text-4xl font-mono font-extrabold tracking-tight tabular-nums flex items-baseline justify-center ${isShiftInProgress ? 'text-emerald-600' : 'text-slate-800'}`}>
                <span>{timerObj.main}</span>
                <span className="text-xl sm:text-2xl font-mono opacity-60 ml-0.5 tabular-nums">{timerObj.tenths}</span>
              </div>
              <div className="text-xs text-slate-400 mt-1">
                {isShiftInProgress ? 'Идёт смена' : isShiftCompleted ? `${todayHours} ч отработано` : 'Ожидание старта'}
              </div>

              {/* Day progress */}
              <div className="w-full mt-2.5 pt-2 border-t border-slate-200/60">
                <div className="flex justify-between text-[11px] text-slate-500 mb-1 tabular-nums">
                  <span>Отработано</span>
                  <span className="font-mono font-semibold text-slate-700">
                    {(elapsedSeconds / 3600).toFixed(1)} / 8.0 ч ({Math.min(100, Math.round((elapsedSeconds / 28800) * 100))}%)
                  </span>
                </div>
                <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${isShiftCompleted ? 'bg-emerald-500' : 'bg-blue-600'}`}
                    style={{ width: `${Math.min(100, Math.round((elapsedSeconds / 28800) * 100))}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 grid grid-cols-3 text-center sm:flex sm:justify-between text-xs text-slate-500 tabular-nums">
              <div>
                <span className="text-slate-400 block sm:inline sm:mr-1">Приход:</span>
                <span className="font-semibold text-slate-700">{shift?.start_time || '10:00'}</span>
              </div>
              <div>
                <span className="text-slate-400 block sm:inline sm:mr-1">План:</span>
                <span className="font-semibold text-slate-700">18:00</span>
              </div>
              <div>
                <span className="text-slate-400 block sm:inline sm:mr-1">Уход:</span>
                <span className="font-semibold text-slate-700">{shift?.end_time || (isShiftInProgress ? '18:00' : '—')}</span>
              </div>
            </div>
          </div>

          {/* Card 3: Доход за месяц */}
          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between flex-1 relative overflow-hidden">
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-base font-bold text-slate-900 capitalize">
                  Доход за {currentMonthName}
                </h3>
                <div className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-200/60 flex items-center justify-center text-slate-500">
                  <Wallet className="w-4 h-4" />
                </div>
              </div>
            </div>

            <div className="relative p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex flex-col items-center justify-center my-1">
              <div className="flex items-baseline justify-center gap-0.5 tabular-nums">
                <span className="text-3xl sm:text-4xl font-mono font-extrabold tracking-tight text-slate-900">
                  {monthMoney.whole}
                </span>
                <span className="text-lg sm:text-xl font-mono font-bold text-emerald-600">
                  .{monthMoney.cents} ₽
                </span>
              </div>

              <div className="text-xs font-medium text-slate-600 mt-1.5 flex flex-wrap items-center justify-center gap-1.5 tabular-nums">
                {isShiftInProgress ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 self-center" />
                    <span>Сегодня: +{todayMoney.whole}.{todayMoney.cents} ₽</span>
                    <span className="text-[11px] text-slate-400 font-normal">(~0.06 ₽/с)</span>
                  </>
                ) : isShiftCompleted ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 self-center" />
                    <span>Сегодня: +{todayMoney.whole}.{todayMoney.cents} ₽ ({todayHours} ч)</span>
                  </>
                ) : (
                  <span className="text-slate-400">Смена не начата (0.00 ₽)</span>
                )}
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 flex justify-between items-center text-xs text-slate-500 tabular-nums">
              <div>
                Смен: <span className="font-semibold text-slate-700">{(salaryStats?.completed_shifts_count ?? 0)}</span>
              </div>
              <div className="text-slate-500 text-xs">
                Ставка: <span className="font-semibold text-slate-700">1 667 ₽/смена</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Что я сегодня сделал */}
        <div className="flex-1 bg-white p-4 sm:p-6 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between min-h-[420px] lg:min-h-0 min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-slate-100 pb-3 shrink-0">
            <div className="flex items-center gap-2">
              <h3 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                Что я сегодня сделал
              </h3>
              {draftSaved && (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md font-semibold border border-emerald-100">
                  <Check className="w-3.5 h-3.5" /> Сохранено
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {isShiftInProgress && !reportText && effectivePreviousReport && (
                <button
                  type="button"
                  onClick={() => {
                    setReportText(effectivePreviousReport);
                    setDraftSaved(false);
                    onSaveDraft(effectivePreviousReport).then(() => setDraftSaved(true));
                  }}
                  className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors cursor-pointer min-h-[38px]"
                  title="Подставить текст из отчёта предыдущей смены"
                >
                  <Copy className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>Из прошлой смены</span>
                </button>
              )}
              {isShiftInProgress && (
                <button
                  onClick={() => onSaveDraft(reportText).then(() => setDraftSaved(true))}
                  className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors cursor-pointer min-h-[38px]"
                  title="Сохранить черновик"
                >
                  <Save className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>Сохранить черновик</span>
                </button>
              )}
            </div>
          </div>

          <div className="relative flex-1 py-3 min-h-0 flex flex-col">
            <textarea
              value={reportText}
              onChange={handleReportChange}
              disabled={isShiftCompleted}
              placeholder={
                isShiftNotStarted
                  ? "Нажмите «Я на смене», чтобы начать рабочий день..."
                  : isShiftCompleted && shift?.report_status === 'scheduled'
                  ? "Смена завершена. Отчёт зафиксирован и будет отправлен в Teams автоматически в " + (shift.report_scheduled_at || "18:00:00") + "."
                  : isShiftCompleted
                  ? "Смена за сегодня завершена."
                  : (effectivePreviousReport || "Опишите выполненные за день задачи...")
              }
              className="w-full flex-1 min-h-[160px] sm:min-h-[200px] p-3.5 sm:p-4 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-base sm:text-sm text-slate-800 placeholder-slate-400 resize-none transition-all disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed font-sans leading-relaxed"
            />

            <div className="flex justify-between items-center mt-2 px-1 text-xs text-slate-400 shrink-0 tabular-nums">
              <span>Символов: {reportText.length}</span>
              {isShiftInProgress && (
                <span className="flex items-center gap-1 text-emerald-600 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Автосохранение
                </span>
              )}
            </div>
          </div>

          <div className="pt-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-t border-slate-100 shrink-0">
            <div className="text-xs text-slate-500 flex items-center gap-2">
              {isShiftCompleted && shift?.report_status === 'scheduled' && (
                <div className="w-full sm:w-auto flex items-center gap-2 text-amber-800 bg-amber-50 px-3 py-2 rounded-xl border border-amber-200/80 text-xs font-medium">
                  <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>Отчёт будет отправлен в Teams в <strong className="font-semibold">{shift.report_scheduled_at || '18:00:00'}</strong></span>
                </div>
              )}
              {isShiftCompleted && shift?.report_status === 'sent' && (
                <div className="w-full sm:w-auto flex items-center gap-2 text-emerald-700 bg-emerald-50 px-3 py-2 rounded-xl border border-emerald-200 text-xs font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Отчёт отправлен в Teams {shift.report_sent_at ? `в ${shift.report_sent_at}` : ''}</span>
                </div>
              )}
              {isShiftCompleted && shift?.report_status === 'failed' && (
                <div className="w-full sm:w-auto flex items-center gap-2 text-rose-700 bg-rose-50 px-3 py-2 rounded-xl border border-rose-200 text-xs font-medium">
                  <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                  <span>Не удалось отправить отчёт в Teams</span>
                </div>
              )}
              {isShiftCompleted && (shift?.report_status === 'not_scheduled' || !shift?.report_status) && (
                <span>Смена за сегодня закрыта</span>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
              {isShiftCompleted && shift?.report_status === 'scheduled' && onSendReportNow && (
                <button
                  onClick={onSendReportNow}
                  disabled={isLoading}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-3 sm:py-2.5 rounded-xl font-semibold text-xs bg-blue-600 hover:bg-blue-700 text-white transition-colors shadow-xs active:scale-[0.98] cursor-pointer disabled:opacity-50 min-h-[44px]"
                  title="Отправить отчёт в Teams прямо сейчас, не дожидаясь наступления 18:00"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isLoading ? 'Отправка...' : 'Отправить сейчас'}</span>
                </button>
              )}
              {isShiftCompleted && shift?.report_status === 'failed' && onSendReportNow && (
                <button
                  onClick={onSendReportNow}
                  disabled={isLoading}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-3 sm:py-2.5 rounded-xl font-semibold text-xs bg-rose-600 hover:bg-rose-700 text-white transition-colors shadow-xs active:scale-[0.98] cursor-pointer disabled:opacity-50 min-h-[44px]"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isLoading ? 'Отправка...' : 'Повторить отправку'}</span>
                </button>
              )}
              {isShiftCompleted && (shift?.report_status === 'sent' || shift?.report_status === 'not_scheduled' || !shift?.report_status) && (
                <div className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 text-slate-500 font-semibold text-xs border border-slate-200">
                  <Lock className="w-3.5 h-3.5 text-slate-400" />
                  <span>Смена закрыта</span>
                </div>
              )}
              {isShiftInProgress && (
                <button
                  onClick={() => onEndShift(reportText)}
                  disabled={isLoading || !reportText.trim()}
                  className={`w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3.5 sm:py-3 rounded-xl font-bold text-sm sm:text-xs transition-all shadow-xs shrink-0 min-h-[44px] ${
                    reportText.trim()
                      ? 'bg-slate-900 hover:bg-slate-800 text-white shadow-xs active:scale-[0.98] cursor-pointer'
                      : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  <Send className="w-4 h-4" />
                  <span>{isLoading ? 'Отправка...' : 'Завершить смену'}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
