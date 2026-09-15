import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { ShiftView } from './components/ShiftView';
import { HistoryView } from './components/HistoryView';
import { SettingsModal } from './components/SettingsModal';
import { LoginView } from './components/LoginView';
import { ToastContainer } from './components/Toast';
import { NavTab, Shift, ToastMessage, AuthUser } from './types';
import { api, AUTH_TOKEN_KEY } from './api/client';
import { useDynamicTitle } from './hooks/useDynamicTitle';

export const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return !!localStorage.getItem(AUTH_TOKEN_KEY);
  });
  const [user, setUser] = useState<AuthUser | null>(null);
  const [currentTab, setCurrentTab] = useState<NavTab>('shift');
  const [shift, setShift] = useState<Shift | null>(null);
  const [history, setHistory] = useState<Shift[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useDynamicTitle(isAuthenticated ? shift : null);

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

  useEffect(() => {
    if (isAuthenticated) {
      loadUser();
      loadTodayShift();
      loadHistory();
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

  const handleResetTodayShift = async () => {
    try {
      const res = await api.resetTodayShift();
      setShift(res.shift);
      showToast('info', 'Статус сброшен', res.message);
      loadHistory();
    } catch (err: any) {
      showToast('error', 'Не удалось сбросить смену', err.message);
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

  return (
    <div className="flex h-screen w-screen bg-[#f8fafc] text-slate-800 antialiased overflow-hidden font-sans">
      <Sidebar
        currentTab={currentTab}
        onSelectTab={(tab) => setCurrentTab(tab)}
        shift={shift}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onLogout={() => api.logout()}
        user={user}
      />

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {currentTab === 'shift' && (
          <ShiftView
            shift={shift}
            onStartShift={handleStartShift}
            onEndShift={handleEndShift}
            onSendReportNow={handleSendReportNow}
            onSaveDraft={handleSaveDraft}
            onRefreshShift={loadTodayShift}
            onOpenSettings={() => setIsSettingsOpen(true)}
            isLoading={isLoading}
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

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSettingsSaved={() => {
          loadTodayShift();
        }}
        onResetTodayShift={handleResetTodayShift}
        showToast={showToast}
      />

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};
export default App;
