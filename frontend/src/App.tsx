import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Menu,
  Clock,
  Kanban,
  ClipboardList,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { ShiftView } from './components/ShiftView';
import { TrackerView } from './components/TrackerView';
import { HistoryView } from './components/HistoryView';
import { SettingsModal } from './components/SettingsModal';
import { LoginView } from './components/LoginView';
import { ToastContainer } from './components/Toast';
import { NavTab, Shift, ToastMessage, AuthUser, TrackerIssue } from './types';
import { api, AUTH_TOKEN_KEY } from './api/client';
import { useDynamicTitle } from './hooks/useDynamicTitle';

export const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return !!localStorage.getItem(AUTH_TOKEN_KEY);
  });
  const [user, setUser] = useState<AuthUser | null>(null);
  const [currentTab, setCurrentTab] = useState<NavTab>(() => {
    const saved = localStorage.getItem('itco_active_tab');
    if (saved && ['shift', 'tracker', 'history', 'excel', 'settings'].includes(saved)) {
      return saved as NavTab;
    }
    return 'shift';
  });
  const [shift, setShift] = useState<Shift | null>(null);
  const [shiftRate, setShiftRate] = useState<number>(1667.0);
  const [history, setHistory] = useState<Shift[]>([]);
  const [trackerIssues, setTrackerIssues] = useState<TrackerIssue[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useDynamicTitle(isAuthenticated ? shift : null, shiftRate);

  useEffect(() => {
    const handleUnauthorized = () => {
      setIsAuthenticated(false);
    };
    window.addEventListener('itco_unauthorized', handleUnauthorized);
    return () => window.removeEventListener('itco_unauthorized', handleUnauthorized);
  }, []);

  const showToast = useCallback(
    (type: 'success' | 'error' | 'info', title: string, message?: string) => {
      const id = Math.random().toString(36).substring(2, 9);
      setToasts((prev) => [...prev, { id, type, title, message }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 5000);
    },
    []
  );

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const loadUser = async () => {
    try {
      const data = await api.getMe();
      if (data.user) {
        setUser(data.user);
      }
    } catch (err) {
      console.error('Ошибка получения пользователя:', err);
    }
  };

  const loadTodayShift = async () => {
    try {
      const data = await api.getTodayShift();
      setShift(data);
    } catch (err: any) {
      if (err.message && !err.message.includes('401')) {
        showToast('error', 'Ошибка загрузки смены', err.message);
      }
    }
  };

  const loadHistory = async () => {
    try {
      const data = await api.getHistory();
      setHistory(data);
    } catch (err: any) {
      console.error('Ошибка загрузки истории:', err);
    }
  };

  const loadSalaryStats = async () => {
    try {
      const stats = await api.getSalaryStats();
      if (stats?.shift_rate) {
        setShiftRate(stats.shift_rate);
      }
    } catch {}
  };

  useEffect(() => {
    if (isAuthenticated) {
      loadUser();
      loadTodayShift();
      loadHistory();
      loadSalaryStats();
    }
  }, [isAuthenticated]);

  const handleStartShift = async () => {
    setIsLoading(true);
    try {
      const res = await api.startShift();
      setShift(res.shift);
      showToast(
        res.success ? 'success' : 'info',
        res.shift.status === 'in_progress' ? 'Смена успешно начата!' : 'Статус обновлен',
        res.message
      );
      loadHistory();
    } catch (err: any) {
      showToast('error', 'Не удалось начать смену', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEndShift = async (report: string) => {
    setIsLoading(true);
    try {
      const res = await api.endShift(report);
      setShift(res.shift);
      showToast('success', 'Смена завершена!', res.message);
      await loadHistory();
      await loadTodayShift();
    } catch (err: any) {
      showToast('error', 'Не удалось завершить смену', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendReportNow = async () => {
    setIsLoading(true);
    try {
      const res = await api.sendReportNow();
      setShift(res.shift);
      showToast(
        res.success ? 'success' : 'error',
        res.success ? 'Отчёт отправлен!' : 'Ошибка отправки',
        res.message
      );
      await loadHistory();
      await loadTodayShift();
    } catch (err: any) {
      showToast('error', 'Не удалось отправить отчёт', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveDraft = async (report: string) => {
    try {
      const res = await api.saveDraft(report);
      setShift(res.shift);
    } catch (err: any) {
      console.error('Ошибка сохранения черновика:', err);
    }
  };

  if (!isAuthenticated) {
    return (
      <>
        <LoginView
          onLoginSuccess={() => {
            setIsAuthenticated(true);
            loadUser();
          }}
        />
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  const activeTrackerIssuesCount = trackerIssues.filter(
    (i) => i.status === 'in_progress' || i.status === 'todo'
  ).length;

  const previousReport = useMemo(() => {
    if (shift?.previous_report && shift.previous_report.trim().length > 0) {
      return shift.previous_report.trim();
    }
    if (history && history.length > 0) {
      const todayDate = shift?.date;
      const prev = history.find(
        (h) => (todayDate ? h.date < todayDate : true) && h.daily_report && h.daily_report.trim().length > 0
      );
      if (prev?.daily_report) {
        return prev.daily_report.trim();
      }
    }
    return null;
  }, [shift?.previous_report, shift?.date, history]);

  return (
    <div className="flex flex-col md:flex-row h-screen h-[100dvh] w-screen bg-[#f8fafc] text-slate-800 antialiased overflow-hidden font-sans">
      {/* Mobile Top Header */}
      <header className="md:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200/80 shrink-0 select-none z-30">
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setIsMobileMenuOpen(true)}
            className="p-1.5 -ml-1 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Открыть меню"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-white shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <span className="font-bold text-slate-900 text-sm tracking-tight">ITCO Dashboard</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {shift?.status === 'in_progress' ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              В работе
            </span>
          ) : shift?.status === 'completed' ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              Завершена
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600">
              Не начата
            </span>
          )}
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Настройки"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      <Sidebar
        currentTab={currentTab}
        onSelectTab={(tab) => {
          setCurrentTab(tab);
          localStorage.setItem('itco_active_tab', tab);
        }}
        shift={shift}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onLogout={() => api.logout()}
        user={user}
        activeTrackerIssuesCount={activeTrackerIssuesCount}
        isMobileOpen={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
      />

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative pb-16 md:pb-0">
        {currentTab === 'shift' && (
          <ShiftView
            shift={shift}
            previousReport={previousReport}
            onStartShift={handleStartShift}
            onEndShift={handleEndShift}
            onSendReportNow={handleSendReportNow}
            onSaveDraft={handleSaveDraft}
            onRefreshShift={loadTodayShift}
            onOpenSettings={() => setIsSettingsOpen(true)}
            isLoading={isLoading}
          />
        )}

        {currentTab === 'tracker' && (
          <TrackerView
            showToast={showToast}
            onIssuesUpdated={(updatedIssues) => setTrackerIssues(updatedIssues)}
          />
        )}

        {currentTab === 'history' && (
          <HistoryView
            history={history}
            onRefresh={() => {
              loadHistory();
              loadTodayShift();
            }}
          />
        )}
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/80 px-2 py-1 flex items-center justify-around safe-area-bottom shadow-[0_-2px_10px_rgba(0,0,0,0.04)] select-none">
        <button
          onClick={() => {
            setCurrentTab('shift');
            localStorage.setItem('itco_active_tab', 'shift');
          }}
          className={`flex flex-col items-center justify-center flex-1 py-1 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
            currentTab === 'shift' ? 'text-blue-600 font-semibold' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <div className="relative">
            <Clock className="w-5 h-5" />
            {shift?.status === 'in_progress' && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white" />
            )}
          </div>
          <span className="text-[11px] mt-0.5">Смена</span>
        </button>

        <button
          onClick={() => {
            setCurrentTab('tracker');
            localStorage.setItem('itco_active_tab', 'tracker');
          }}
          className={`flex flex-col items-center justify-center flex-1 py-1 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
            currentTab === 'tracker' ? 'text-blue-600 font-semibold' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <div className="relative">
            <Kanban className="w-5 h-5" />
            {activeTrackerIssuesCount > 0 && (
              <span className="absolute -top-1 -right-2 px-1 text-[9px] font-bold rounded-full bg-blue-100 text-blue-700 ring-1 ring-white">
                {activeTrackerIssuesCount}
              </span>
            )}
          </div>
          <span className="text-[11px] mt-0.5">Задачи</span>
        </button>

        <button
          onClick={() => {
            setCurrentTab('history');
            localStorage.setItem('itco_active_tab', 'history');
          }}
          className={`flex flex-col items-center justify-center flex-1 py-1 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
            currentTab === 'history' ? 'text-blue-600 font-semibold' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <ClipboardList className="w-5 h-5" />
          <span className="text-[11px] mt-0.5">История</span>
        </button>

        <button
          onClick={() => setIsMobileMenuOpen(true)}
          className="flex flex-col items-center justify-center flex-1 py-1 rounded-xl text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
        >
          <Menu className="w-5 h-5" />
          <span className="text-[11px] mt-0.5">Меню</span>
        </button>
      </nav>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSettingsSaved={() => {
          loadTodayShift();
          loadSalaryStats();
        }}
        showToast={showToast}
      />

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};
export default App;
