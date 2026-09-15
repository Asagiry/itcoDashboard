import React, { useState } from 'react';
import {
  RefreshCw,
  Terminal,
  Eye,
  EyeOff
} from 'lucide-react';
import { TrackerAuthStatus, TrackerLogItem } from '../../types';
import { api } from '../../api/client';

interface TrackerSettingsTabProps {
  trackerStatus: TrackerAuthStatus | null;
  onRefreshStatus: () => void;
  showToast: (type: 'success' | 'error' | 'info', title: string, message?: string) => void;
}

export const TrackerSettingsTab: React.FC<TrackerSettingsTabProps> = ({
  trackerStatus,
  onRefreshStatus,
  showToast,
}) => {
  const [isChangingAccount, setIsChangingAccount] = useState(false);
  const [trackerEmail, setTrackerEmail] = useState(trackerStatus?.account_name || '');
  const [trackerPassword, setTrackerPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginLogs, setLoginLogs] = useState<string[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [logs, setLogs] = useState<TrackerLogItem[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  const handlePasswordLogin = async () => {
    if (!trackerEmail.trim() || !trackerPassword.trim()) {
      showToast('error', 'Заполните поля', 'Укажите e-mail и пароль от ITCO Tracker.');
      return;
    }
    setIsLoggingIn(true);
    setLoginLogs(['Запуск авторизации в Tracker...']);
    try {
      const res = await api.trackerPasswordLogin(trackerEmail.trim(), trackerPassword.trim());
      setLoginLogs(res.logs || []);
      if (res.success) {
        showToast('success', 'Вход выполнен!', res.message);
        setIsChangingAccount(false);
        setTrackerPassword('');
        onRefreshStatus();
      } else {
        showToast('error', 'Ошибка авторизации', res.message);
      }
    } catch (err: any) {
      showToast('error', 'Ошибка', err.message);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const res = await api.syncTracker();
      if (res.success) {
        showToast('success', 'Синхронизация завершена', `Загружено задач: ${res.issues_count}`);
        onRefreshStatus();
      } else {
        showToast('error', 'Ошибка синхронизации', res.message);
      }
    } catch (err: any) {
      showToast('error', 'Ошибка', err.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleOpenLogs = async () => {
    setShowLogsModal(true);
    setIsLoadingLogs(true);
    try {
      const res = await api.getTrackerLogs();
      setLogs(res.logs || []);
    } catch {
    } finally {
      setIsLoadingLogs(false);
    }
  };

  const handleLogout = async () => {
    try {
      await api.trackerLogout();
      showToast('info', 'Сессия завершена', 'Вы вышли из ITCO Tracker.');
      onRefreshStatus();
    } catch (err: any) {
      showToast('error', 'Ошибка выхода', err.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Account Status Card */}
      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#e11d48] text-white flex items-center justify-center font-bold text-xs shadow-2xs">
            ⬡
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-800">
              {trackerStatus?.account_name || 'ITCO Tracker (Huly)'}
            </h4>
            <p className="text-[11px] text-slate-500">
              {trackerStatus?.is_authenticated ? 'Авторизован в трекере' : 'Требуется авторизация'}
              {trackerStatus?.last_sync && ` • Синхр: ${trackerStatus.last_sync}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSync}
            disabled={isSyncing}
            className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-white text-xs font-semibold text-slate-700 transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Синхронизация...' : 'Синхронизировать'}</span>
          </button>

          <button
            type="button"
            onClick={handleOpenLogs}
            className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-white text-xs font-semibold text-slate-700 flex items-center gap-1 cursor-pointer"
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Логи</span>
          </button>

          <button
            type="button"
            onClick={() => setIsChangingAccount(!isChangingAccount)}
            className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white transition-colors cursor-pointer"
          >
            {isChangingAccount ? 'Отмена' : 'Войти'}
          </button>
        </div>
      </div>

      {/* Login Form */}
      {isChangingAccount && (
        <div className="p-4 rounded-xl bg-rose-50/40 border border-rose-200/60 space-y-4">
          <h5 className="text-xs font-bold text-rose-900">Вход в ITCO Tracker (Email & Пароль)</h5>
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-medium text-slate-600 block mb-1">E-mail</label>
              <input
                type="email"
                value={trackerEmail}
                onChange={(e) => setTrackerEmail(e.target.value)}
                placeholder="vepishin@it-co.ru"
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs"
              />
            </div>

            <div>
              <label className="text-[11px] font-medium text-slate-600 block mb-1">Пароль</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={trackerPassword}
                  onChange={(e) => setTrackerPassword(e.target.value)}
                  placeholder="Пароль от Tracker"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={handlePasswordLogin}
                disabled={isLoggingIn}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
              >
                {isLoggingIn && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>{isLoggingIn ? 'Авторизация...' : 'Выполнить вход'}</span>
              </button>

              {trackerStatus?.is_authenticated && (
                <button
                  type="button"
                  onClick={handleLogout}
                  className="px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-100/50 rounded-lg"
                >
                  Выйти из аккаунта
                </button>
              )}
            </div>

            {/* Login Logs Output */}
            {loginLogs.length > 0 && (
              <div className="p-3 bg-slate-900 text-slate-200 rounded-lg text-[11px] font-mono space-y-1 max-h-36 overflow-y-auto">
                {loginLogs.map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Logs Modal */}
      {showLogsModal && (
        <div
          className="fixed inset-0 z-60 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShowLogsModal(false)}
        >
          <div
            className="w-[600px] max-w-full bg-slate-900 text-slate-200 rounded-2xl p-5 shadow-xl border border-slate-800 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <Terminal className="w-4 h-4 text-emerald-400" />
                Журнал синхронизации ITCO Tracker
              </span>
              <button
                type="button"
                onClick={() => setShowLogsModal(false)}
                className="text-slate-400 hover:text-white text-xs"
              >
                Закрыть
              </button>
            </div>

            <div className="max-h-72 overflow-y-auto font-mono text-xs space-y-1.5 p-1">
              {isLoadingLogs ? (
                <div className="text-center py-4 text-slate-500">Загрузка...</div>
              ) : logs.length === 0 ? (
                <div className="text-center py-4 text-slate-500">Нет записей в журнале</div>
              ) : (
                logs.map((log, idx) => (
                  <div key={idx} className="flex gap-2">
                    <span className="text-slate-500 shrink-0">[{log.time}]</span>
                    <span className={log.level === 'error' ? 'text-rose-400' : log.level === 'success' ? 'text-emerald-400' : 'text-slate-300'}>
                      {log.message}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
