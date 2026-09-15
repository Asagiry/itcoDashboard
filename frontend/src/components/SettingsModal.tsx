import React, { useState, useEffect } from 'react';
import { X, Save, MessageSquare, Kanban, RotateCcw, Coins } from 'lucide-react';
import { AppSettings, TeamsChat, TrackerAuthStatus } from '../types';
import { api } from '../api/client';
import { TeamsSettingsTab } from './settings/TeamsSettingsTab';
import { TrackerSettingsTab } from './settings/TrackerSettingsTab';
import { SalarySettingsTab } from './settings/SalarySettingsTab';
import { ShiftResetTab } from './settings/ShiftResetTab';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSettingsSaved: () => void;
  onResetTodayShift: () => Promise<void>;
  showToast: (type: 'success' | 'error' | 'info', title: string, message?: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onSettingsSaved,
  onResetTodayShift,
  showToast,
}) => {
  const [settings, setSettings] = useState<AppSettings>({
    director_chat_url: '',
    director_message_template: 'Здравствуйте, я на рабочем месте',
    daily_chat_url: '',
    auth_token: '',
    auth_header_name: 'Authentication',
    custom_headers: '{}',
    monthly_rate: 35000,
  });

  const [activeTab, setActiveTab] = useState<'teams' | 'tracker' | 'salary' | 'reset'>('teams');
  const [isSaving, setIsSaving] = useState(false);
  const [teamsChats, setTeamsChats] = useState<TeamsChat[]>([]);
  const [isLoadingChats, setIsLoadingChats] = useState(false);
  const [trackerStatus, setTrackerStatus] = useState<TrackerAuthStatus | null>(null);

  const loadData = async () => {
    try {
      const sett = await api.getSettings();
      setSettings(sett);
    } catch {}

    try {
      setIsLoadingChats(true);
      const res = await api.getTeamsChats();
      setTeamsChats(res.chats || []);
    } catch {} finally {
      setIsLoadingChats(false);
    }

    try {
      const st = await api.getTrackerStatus();
      setTrackerStatus(st);
    } catch {}
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await api.saveSettings(settings);
      showToast('success', 'Настройки сохранены');
      onSettingsSaved();
      onClose();
    } catch (err: any) {
      showToast('error', 'Ошибка сохранения', err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/40 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-[740px] h-[640px] min-h-[640px] max-h-[640px] max-w-[94vw] bg-white rounded-2xl shadow-2xl border border-slate-200/90 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 select-none cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white select-none cursor-default">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-slate-900 select-none cursor-default">Настройки</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer select-none"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-6 pt-3 border-b border-slate-100 bg-slate-50/50 flex gap-2 shrink-0 select-none">
          <button
            onClick={() => setActiveTab('teams')}
            className={`px-4 py-2 rounded-t-xl text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors cursor-pointer select-none ${
              activeTab === 'teams'
                ? 'border-blue-600 text-blue-600 bg-white shadow-2xs'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>Microsoft Teams</span>
          </button>

          <button
            onClick={() => setActiveTab('tracker')}
            className={`px-4 py-2 rounded-t-xl text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors cursor-pointer select-none ${
              activeTab === 'tracker'
                ? 'border-rose-600 text-rose-600 bg-white shadow-2xs'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Kanban className="w-4 h-4" />
            <span>ITCO Tracker</span>
          </button>

          <button
            onClick={() => setActiveTab('salary')}
            className={`px-4 py-2 rounded-t-xl text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors cursor-pointer select-none ${
              activeTab === 'salary'
                ? 'border-emerald-600 text-emerald-600 bg-white shadow-2xs'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Coins className="w-4 h-4" />
            <span>Оклад и ставки</span>
          </button>

          <button
            onClick={() => setActiveTab('reset')}
            className={`px-4 py-2 rounded-t-xl text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors cursor-pointer select-none ${
              activeTab === 'reset'
                ? 'border-amber-600 text-amber-600 bg-white shadow-2xs'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <RotateCcw className="w-4 h-4" />
            <span>Сброс смены</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-6 overflow-y-auto flex-1">
          {activeTab === 'teams' && (
            <TeamsSettingsTab
              settings={settings}
              setSettings={setSettings}
              teamsChats={teamsChats}
              isLoadingChats={isLoadingChats}
              onRefreshChats={() => loadData()}
              showToast={showToast}
            />
          )}

          {activeTab === 'tracker' && (
            <TrackerSettingsTab
              trackerStatus={trackerStatus}
              onRefreshStatus={() => loadData()}
              showToast={showToast}
            />
          )}

          {activeTab === 'salary' && (
            <SalarySettingsTab
              settings={settings}
              setSettings={setSettings}
            />
          )}

          {activeTab === 'reset' && (
            <ShiftResetTab
              onResetTodayShift={onResetTodayShift}
              showToast={showToast}
            />
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50/80 flex items-center justify-end gap-2 shrink-0 select-none cursor-default">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-slate-200 hover:bg-white text-slate-700 rounded-xl text-xs font-semibold transition-colors cursor-pointer select-none"
          >
            Отмена
          </button>

          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer select-none"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isSaving ? 'Сохранение...' : 'Сохранить'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
export default SettingsModal;
