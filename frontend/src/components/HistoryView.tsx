import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Clock,
  Search,
  FileText,
  Copy,
  Check,
  ChevronRight,
  X,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Edit2,
  Trash2,
  Save,
  RotateCcw,
  Loader2
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Shift } from '../types';
import { api } from '../api/client';

interface HistoryViewProps {
  history: Shift[];
  onRefresh?: () => void;
}

const MONTH_NAMES_RU: Record<string, string> = {
  '01': 'Январь',
  '02': 'Февраль',
  '03': 'Март',
  '04': 'Апрель',
  '05': 'Май',
  '06': 'Июнь',
  '07': 'Июль',
  '08': 'Август',
  '09': 'Сентябрь',
  '10': 'Октябрь',
  '11': 'Ноябрь',
  '12': 'Декабрь',
};

export const HistoryView: React.FC<HistoryViewProps> = ({ history, onRefresh }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // Edit shift state
  const [isEditing, setIsEditing] = useState(false);
  const [editStartTime, setEditStartTime] = useState('');
  const [editEndTime, setEditEndTime] = useState('');
  const [editStatus, setEditStatus] = useState<string>('completed');
  const [editReport, setEditReport] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const now = new Date();
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const availableMonths = useMemo(() => {
    const monthsSet = new Set<string>();
    monthsSet.add(currentMonthStr);
    history.forEach((s) => {
      if (s.date && s.date.length >= 7) {
        monthsSet.add(s.date.slice(0, 7));
      }
    });
    return Array.from(monthsSet).sort().reverse();
  }, [history, currentMonthStr]);

  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthStr);

  const formatMonthTitle = (monthStr: string) => {
    if (monthStr === 'all') return 'Все месяцы';
    const [year, m] = monthStr.split('-');
    const name = MONTH_NAMES_RU[m] || m;
    return `${name} ${year}`;
  };

  const calculateDuration = (start?: string | null, end?: string | null) => {
    if (!start || !end) return '—';
    try {
      const [sh, sm] = start.split(':').map(Number);
      const [eh, em] = end.split(':').map(Number);
      let diffMinutes = (eh * 60 + em) - (sh * 60 + sm);
      if (diffMinutes < 0) diffMinutes += 24 * 60;
      const h = Math.floor(diffMinutes / 60);
      const m = diffMinutes % 60;
      return `${h} ч ${m} мин`;
    } catch {
      return '—';
    }
  };

  const parseShiftTimes = (shift: Shift) => {
    const start = shift.start_time || '10:00:00';
    let end = shift.end_time || '';
    let hours = 8;
    if (shift.start_time && shift.end_time) {
      const [sh, sm, ss] = shift.start_time.split(':').map(Number);
      const [eh, em, es] = shift.end_time.split(':').map(Number);
      const s = sh * 3600 + sm * 60 + (ss || 0);
      const e = eh * 3600 + em * 60 + (es || 0);
      let diff = e - s;
      if (diff < 0) diff += 24 * 3600;
      hours = Math.round((diff / 3600) * 10) / 10;
    } else if (shift.status === 'in_progress') {
      hours = 8;
      end = '18:00:00';
    }
    return { hours, start, end: end || '18:00:00' };
  };

  const monthFilteredHistory = useMemo(() => {
    if (selectedMonth === 'all') return history;
    return history.filter((s) => s.date.startsWith(selectedMonth));
  }, [history, selectedMonth]);

  const filteredHistory = useMemo(() => {
    if (!searchTerm.trim()) return monthFilteredHistory;
    const lower = searchTerm.toLowerCase();
    return monthFilteredHistory.filter(
      (s) =>
        s.date.includes(lower) ||
        (s.daily_report && s.daily_report.toLowerCase().includes(lower))
    );
  }, [monthFilteredHistory, searchTerm]);

  const stats = useMemo(() => {
    const total = monthFilteredHistory.length;
    const completed = monthFilteredHistory.filter((s) => s.status === 'completed').length;
    const withReport = monthFilteredHistory.filter((s) => s.daily_report && s.daily_report.trim().length > 0).length;
    return { total, completed, withReport };
  }, [monthFilteredHistory]);

  const handleCopyReport = (shift: Shift) => {
    if (shift.daily_report) {
      navigator.clipboard.writeText(shift.daily_report);
      if (shift.id) setCopiedId(shift.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const handleOpenShift = (shift: Shift) => {
    setSelectedShift(shift);
    setEditStartTime(shift.start_time || '10:00:00');
    setEditEndTime(shift.end_time || '');
    setEditStatus(shift.status || (shift.start_time && shift.end_time ? 'completed' : shift.start_time ? 'in_progress' : 'not_started'));
    setEditReport(shift.daily_report || '');
    setIsEditing(false);
    setSaveSuccess(false);
  };

  const handleSaveShift = async () => {
    if (!selectedShift) return;
    setIsSaving(true);
    try {
      const trimmedEnd = editEndTime.trim();
      const effectiveStatus = editStatus;
      const res = await api.updateShift(selectedShift.date, {
        start_time: editStartTime.trim() || undefined,
        end_time: trimmedEnd ? trimmedEnd : '',
        daily_report: editReport.trim(),
        status: effectiveStatus,
      });
      setSelectedShift(res.shift);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      setIsEditing(false);
      onRefresh?.();
    } catch (err: any) {
      alert(`Ошибка при сохранении смены: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteShift = async () => {
    if (!selectedShift) return;
    if (!window.confirm(`Вы действительно хотите удалить запись смены за ${selectedShift.date}?`)) {
      return;
    }
    setIsDeleting(true);
    try {
      await api.deleteShift(selectedShift.date);
      setSelectedShift(null);
      onRefresh?.();
    } catch (err: any) {
      alert(`Ошибка при удалении смены: ${err.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const exportToExcel = () => {
    if (monthFilteredHistory.length === 0) return;
    const headerRow = ['Дата', 'Сумма часов за день', 'Начало смены', 'Конец смены'];
    const sorted = [...monthFilteredHistory].sort((a, b) => a.date.localeCompare(b.date));
    let totalHours = 0;
    const dataRows = sorted.map((s) => {
      const { hours, start, end } = parseShiftTimes(s);
      totalHours += hours;
      return [s.date, hours, start, end];
    });
    const summaryRow = ['Результат месяца', totalHours, '', ''];
    const wsData = [headerRow, ...dataRows, summaryRow];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [
      { wch: 14 },
      { wch: 24 },
      { wch: 16 },
      { wch: 16 }
    ];
    const wb = XLSX.utils.book_new();
    const sheetTitle = formatMonthTitle(selectedMonth);
    XLSX.utils.book_append_sheet(wb, ws, sheetTitle);
    XLSX.writeFile(wb, `ITCO_Табель_${selectedMonth}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportToCsv = () => {
    if (monthFilteredHistory.length === 0) return;
    const headers = ['Дата', 'Сумма часов за день', 'Начало смены', 'Конец смены'];
    const sorted = [...monthFilteredHistory].sort((a, b) => a.date.localeCompare(b.date));
    let totalHours = 0;
    const dataRows = sorted.map((s) => {
      const { hours, start, end } = parseShiftTimes(s);
      totalHours += hours;
      return [s.date, hours, start, end];
    });
    const summaryRow = ['Результат месяца', totalHours, '', ''];
    const csvContent = '\uFEFF' + [
      headers.join(';'),
      ...dataRows.map((r) => r.join(';')),
      summaryRow.join(';')
    ].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `ITCO_Табель_${selectedMonth}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex-1 w-full overflow-y-auto p-4 sm:p-6 md:px-8 md:py-6 space-y-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">
            История смен
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-4 sm:gap-6">
          <div className="flex items-center gap-3">
            <div className="text-center px-4 py-2 bg-slate-50 rounded-xl border border-slate-100">
              <div className="text-2xl font-extrabold font-mono text-slate-800">{stats.total}</div>
              <div className="text-xs text-slate-400 font-medium">Смен</div>
            </div>
            <div className="text-center px-4 py-2 bg-slate-50 rounded-xl border border-slate-100">
              <div className="text-2xl font-extrabold font-mono text-emerald-600">{stats.completed}</div>
              <div className="text-xs text-slate-400 font-medium">Завершено</div>
            </div>
            <div className="text-center px-4 py-2 bg-slate-50 rounded-xl border border-slate-100">
              <div className="text-2xl font-extrabold font-mono text-blue-600">{stats.withReport}</div>
              <div className="text-xs text-slate-400 font-medium">С отчётами</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={exportToExcel}
              disabled={monthFilteredHistory.length === 0}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-xs active:scale-[0.98] transition-colors disabled:opacity-50 cursor-pointer"
              title={`Скачать табель за ${formatMonthTitle(selectedMonth)} (.xlsx)`}
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Скачать отчёт (.xlsx)</span>
            </button>

            <button
              onClick={exportToCsv}
              disabled={monthFilteredHistory.length === 0}
              className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-semibold text-xs active:scale-[0.98] transition-colors disabled:opacity-50 cursor-pointer"
              title="Скачать в формате .CSV"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>.CSV</span>
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs space-y-2.5">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span className="font-semibold">Месяц:</span>
          <span>
            {formatMonthTitle(selectedMonth)} ({monthFilteredHistory.length} смен)
          </span>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-0.5">
          <button
            onClick={() => setSelectedMonth('all')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-colors shrink-0 cursor-pointer ${
              selectedMonth === 'all'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200/70'
            }`}
          >
            <span>Все месяцы</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-md ${selectedMonth === 'all' ? 'bg-blue-700/80 text-white' : 'bg-slate-200 text-slate-700'}`}>
              {history.length}
            </span>
          </button>

          {availableMonths.map((m) => {
            const isSelected = m === selectedMonth;
            const title = formatMonthTitle(m);
            const count = history.filter((s) => s.date.startsWith(m)).length;

            return (
              <button
                key={m}
                onClick={() => setSelectedMonth(m)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-colors shrink-0 cursor-pointer ${
                  isSelected
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200/70'
                }`}
              >
                <span>{title}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-md font-semibold ${
                    isSelected
                      ? 'bg-blue-700/80 text-white'
                      : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {count} {count === 1 ? 'смена' : count >= 2 && count <= 4 ? 'смены' : 'смен'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="relative w-full">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Поиск по дате или отчёту..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors placeholder:text-xs"
          />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50/80 border-b border-slate-200/80 text-slate-600 font-semibold text-xs">
              <tr>
                <th className="px-6 py-4">Дата</th>
                <th className="px-5 py-4">Статус</th>
                <th className="px-5 py-4">Начало</th>
                <th className="px-5 py-4">Завершение</th>
                <th className="px-5 py-4">Длительность</th>
                <th className="px-6 py-4">Отчёт за день</th>
                <th className="px-6 py-4 text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredHistory.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-16 text-slate-400 text-sm">
                    <FileText className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                    Записи отсутствуют или не найдены по запросу.
                  </td>
                </tr>
              ) : (
                filteredHistory.map((row) => (
                  <tr
                    key={row.date}
                    className="hover:bg-slate-50/70 transition-colors group cursor-pointer"
                    onClick={() => handleOpenShift(row)}
                  >
                    <td className="px-6 py-4.5 font-bold text-slate-900 whitespace-nowrap">
                      {row.date}
                    </td>
                    <td className="px-5 py-4.5 whitespace-nowrap">
                      {row.status === 'completed' && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Завершена
                        </span>
                      )}
                      {row.status === 'in_progress' && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                          <Clock className="w-3.5 h-3.5" /> В процессе
                        </span>
                      )}
                      {row.status === 'not_started' && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">
                          Не начата
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4.5 font-mono text-slate-800 whitespace-nowrap font-medium">
                      {row.start_time || '—'}
                    </td>
                    <td className="px-5 py-4.5 font-mono text-slate-800 whitespace-nowrap font-medium">
                      {row.end_time || '—'}
                    </td>
                    <td className="px-5 py-4.5 font-semibold text-slate-900 whitespace-nowrap">
                      {calculateDuration(row.start_time, row.end_time)}
                    </td>
                    <td className="px-6 py-4.5 max-w-sm truncate text-slate-700">
                      {row.daily_report ? (
                        <span className="line-clamp-1">{row.daily_report}</span>
                      ) : (
                        <span className="text-slate-400 italic">Отчёт не заполнен</span>
                      )}
                    </td>
                    <td className="px-6 py-4.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2">
                        {row.daily_report && (
                          <button
                            onClick={() => handleCopyReport(row)}
                            title="Скопировать текст отчёта"
                            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                          >
                            {copiedId === row.id ? (
                              <Check className="w-4 h-4 text-emerald-600" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </button>
                        )}
                        <button
                          onClick={() => handleOpenShift(row)}
                          className="p-2 rounded-xl text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer"
                          title="Открыть детали / Редактировать"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedShift &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={() => setSelectedShift(null)}
          >
            <div
              className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="p-5 sm:p-6 border-b border-slate-100 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div>
                    <h3 className="text-lg sm:text-xl font-bold text-slate-900 flex items-center gap-2">
                      <span>{isEditing ? 'Правка смены:' : 'Рабочий день:'} {selectedShift.date}</span>
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      {selectedShift.status === 'completed' && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3" /> Завершена
                        </span>
                      )}
                      {selectedShift.status === 'in_progress' && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-200">
                          <Clock className="w-3 h-3" /> В процессе
                        </span>
                      )}
                      {selectedShift.status === 'not_started' && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full">
                          Не начата
                        </span>
                      )}
                      {saveSuccess && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md animate-in fade-in">
                          <Check className="w-3 h-3" /> Сохранено!
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {!isEditing ? (
                    <button
                      onClick={() => setIsEditing(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-600 text-xs font-semibold transition-colors cursor-pointer"
                      title="Редактировать время и отчёт"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>Редактировать</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setIsEditing(false);
                        setEditStartTime(selectedShift.start_time || '10:00:00');
                        setEditEndTime(selectedShift.end_time || '');
                        setEditStatus(selectedShift.status || (selectedShift.start_time && selectedShift.end_time ? 'completed' : selectedShift.start_time ? 'in_progress' : 'not_started'));
                        setEditReport(selectedShift.daily_report || '');
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-semibold transition-colors cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Отмена</span>
                    </button>
                  )}
                  <button
                    onClick={() => setSelectedShift(null)}
                    className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="p-5 sm:p-6 space-y-4">
                {!isEditing ? (
                  <>
                    <div className="grid grid-cols-3 gap-3 p-4 bg-slate-50 rounded-xl border border-slate-100 text-center">
                      <div>
                        <span className="text-xs text-slate-400 font-medium block">Начало</span>
                        <span className="text-lg font-bold font-mono text-slate-800">
                          {selectedShift.start_time || '—'}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-slate-400 font-medium block">Завершение</span>
                        <span className="text-lg font-bold font-mono text-slate-800">
                          {selectedShift.end_time || '—'}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-slate-400 font-medium block">Отработано</span>
                        <span className="text-lg font-bold text-blue-600 font-mono">
                          {calculateDuration(selectedShift.start_time, selectedShift.end_time)}
                        </span>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-semibold text-slate-700">
                          Текст отчёта за день
                        </h4>
                        {selectedShift.daily_report && (
                          <button
                            onClick={() => handleCopyReport(selectedShift)}
                            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-semibold cursor-pointer"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            <span>Скопировать</span>
                          </button>
                        )}
                      </div>

                      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 text-sm text-slate-800 whitespace-pre-wrap font-sans leading-relaxed max-h-72 overflow-y-auto">
                        {selectedShift.daily_report || (
                          <span className="text-slate-400 italic">Отчёт не был заполнен.</span>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Статус смены
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditStatus('in_progress');
                            setEditEndTime('');
                          }}
                          className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                            editStatus === 'in_progress'
                              ? 'bg-blue-50 border-blue-300 text-blue-700 shadow-xs'
                              : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          <Clock className="w-3.5 h-3.5 text-blue-600" />
                          <span>В процессе</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditStatus('completed');
                            if (!editEndTime) setEditEndTime('18:00:00');
                          }}
                          className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                            editStatus === 'completed'
                              ? 'bg-emerald-50 border-emerald-300 text-emerald-700 shadow-xs'
                              : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Завершена</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditStatus('not_started');
                            setEditStartTime('');
                            setEditEndTime('');
                          }}
                          className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                            editStatus === 'not_started'
                              ? 'bg-slate-200 border-slate-300 text-slate-800 shadow-xs'
                              : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          <span>Не начата</span>
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                          Время начала смены
                        </label>
                        <input
                          type="text"
                          value={editStartTime}
                          onChange={(e) => {
                            setEditStartTime(e.target.value);
                            if (editStatus === 'not_started' && e.target.value.trim()) {
                              setEditStatus('in_progress');
                            }
                          }}
                          placeholder="10:00:00"
                          className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 focus:bg-white transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                          Время завершения смены
                        </label>
                        <input
                          type="text"
                          value={editEndTime}
                          onChange={(e) => {
                            setEditEndTime(e.target.value);
                            if (e.target.value.trim()) {
                              setEditStatus('completed');
                            } else {
                              setEditStatus('in_progress');
                            }
                          }}
                          placeholder={editStatus === 'in_progress' ? 'Оставьте пустым для смены в процессе' : '18:00:00'}
                          className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 focus:bg-white transition-all"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-xl bg-blue-50/60 border border-blue-100 text-xs text-blue-900">
                      <span className="font-medium">Расчётное рабочее время:</span>
                      <span className="font-bold font-mono text-sm text-blue-700">
                        {editEndTime ? calculateDuration(editStartTime, editEndTime) : (editStatus === 'in_progress' ? 'Идёт смена (в процессе)' : '—')}
                      </span>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Текст отчёта за день
                      </label>
                      <textarea
                        rows={6}
                        value={editReport}
                        onChange={(e) => setEditReport(e.target.value)}
                        placeholder="Что было сделано за рабочий день..."
                        className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 focus:bg-white transition-all resize-y leading-relaxed font-sans"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <div>
                  {isEditing && (
                    <button
                      type="button"
                      onClick={handleDeleteShift}
                      disabled={isDeleting || isSaving}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-rose-600 hover:bg-rose-50 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{isDeleting ? 'Удаление...' : 'Удалить смену'}</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {!isEditing ? (
                    <>
                      <button
                        onClick={() => setIsEditing(true)}
                        className="px-5 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-600 font-semibold text-xs transition-colors cursor-pointer inline-flex items-center gap-1.5"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        <span>Редактировать</span>
                      </button>
                      <button
                        onClick={() => setSelectedShift(null)}
                        className="px-6 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs transition-colors cursor-pointer"
                      >
                        Закрыть
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setIsEditing(false);
                          setEditStartTime(selectedShift.start_time || '10:00:00');
                          setEditEndTime(selectedShift.end_time || '');
                          setEditStatus(selectedShift.status || (selectedShift.start_time && selectedShift.end_time ? 'completed' : selectedShift.start_time ? 'in_progress' : 'not_started'));
                          setEditReport(selectedShift.daily_report || '');
                        }}
                        disabled={isSaving}
                        className="px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs transition-colors cursor-pointer"
                      >
                        Отмена
                      </button>
                      <button
                        onClick={handleSaveShift}
                        disabled={isSaving}
                        className="px-6 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-md shadow-blue-600/20 hover:shadow-lg transition-all cursor-pointer inline-flex items-center gap-2 disabled:opacity-50"
                      >
                        {isSaving ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Сохранение...</span>
                          </>
                        ) : (
                          <>
                            <Save className="w-3.5 h-3.5" />
                            <span>Сохранить изменения</span>
                          </>
                        )}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
