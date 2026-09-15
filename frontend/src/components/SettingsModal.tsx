import React, { useState, useEffect } from 'react';
import {
  X,
  Save,
  RotateCcw,
  KeyRound,
  MessageSquare,
  RefreshCw,
  Check,
  Search,
  Users,
  User,
  ChevronDown,
  ChevronRight,
  LogIn
} from 'lucide-react';
import { AppSettings, TeamsChat } from '../types';
import { api } from '../api/client';

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
  });

  const [activeTab, setActiveTab] = useState<'chats' | 'auth' | 'debug'>('chats');
  const [isSaving, setIsSaving] = useState(false);

  const [teamsChats, setTeamsChats] = useState<TeamsChat[]>([]);
  const [isLoadingChats, setIsLoadingChats] = useState(false);
  const [isBrowserLoggingIn, setIsBrowserLoggingIn] = useState(false);
  const [isBrowserRefreshing, setIsBrowserRefreshing] = useState(false);
  const [hasBrowserProfile, setHasBrowserProfile] = useState(false);
  const [curlInput, setCurlInput] = useState('');
  const [isParsingCurl, setIsParsingCurl] = useState(false);
  const [isTestingTeams, setIsTestingTeams] = useState(false);
  const [emailAddr, setEmailAddr] = useState('vepishin@it-co.ru');
  const [emailSid, setEmailSid] = useState<string | null>(null);
  const [emailStage, setEmailStage] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const [isEmailBusy, setIsEmailBusy] = useState(false);
  const [emailOptions, setEmailOptions] = useState<string[]>([]);
  const [showShot, setShowShot] = useState(false);
  const [shotKey, setShotKey] = useState(Date.now());

  // Search & Picker states for the two chat types
  const [activePicker, setActivePicker] = useState<'director' | 'daily' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showManualDirectorUrl, setShowManualDirectorUrl] = useState(false);
  const [showManualDailyUrl, setShowManualDailyUrl] = useState(false);

  const loadChats = async () => {
    setIsLoadingChats(true);
    try {
      const res = await api.getTeamsChats();
      setTeamsChats(res.chats || []);
    } catch {} finally {
      setIsLoadingChats(false);
    }
  };

  const loadBrowserStatus = async () => {
    try {
      const res = await api.getBrowserStatus();
      setHasBrowserProfile(res.has_profile);
    } catch {}
  };

  useEffect(() => {
    if (isOpen) {
      api.getSettings()
        .then((data) => setSettings(data))
        .catch((err) => showToast('error', 'Не удалось загрузить настройки', err.message));

      loadChats();
      loadBrowserStatus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await api.saveSettings(settings);
      showToast('success', 'Настройки успешно сохранены');
      onSettingsSaved();
    } catch (err: any) {
      showToast('error', 'Ошибка сохранения', err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleBrowserLogin = async () => {
    setIsBrowserLoggingIn(true);
    showToast('info', 'Открытие браузера', 'Авторизуйтесь в открывшемся Chrome с галочкой «Запомнить меня»');
    try {
      const res = await api.browserLogin();
      if (res.success) {
        showToast('success', 'Авторизация выполнена', res.message);
        const fresh = await api.getSettings();
        setSettings(fresh);
        onSettingsSaved();
        setHasBrowserProfile(true);
        loadChats();
      } else {
        showToast('error', 'Ошибка входа', res.message);
      }
    } catch (err: any) {
      showToast('error', 'Ошибка запуска браузера', err.message);
    } finally {
      setIsBrowserLoggingIn(false);
    }
  };

  const handleBrowserRefresh = async () => {
    setIsBrowserRefreshing(true);
    try {
      const res = await api.browserRefresh();
      if (res.success) {
        showToast('success', 'Сессия проверена', res.message);
        const fresh = await api.getSettings();
        setSettings(fresh);
        onSettingsSaved();
        loadChats();
      } else {
        showToast('error', 'Не удалось обновить', res.message);
      }
    } catch (err: any) {
      showToast('error', 'Ошибка проверки сессии', err.message);
    } finally {
      setIsBrowserRefreshing(false);
    }
  };

  const handleParseCurl = async () => {
    if (!curlInput.trim()) {
      showToast('error', 'Вставьте cURL', 'Скопируйте запрос из DevTools (F12 → Network → Copy as cURL).');
      return;
    }
    setIsParsingCurl(true);
    try {
      const res = await api.parseCurl(curlInput.trim());
      if ((res as any).success === false) {
        showToast('error', 'Не удалось распарсить', (res as any).error || 'Проверьте формат cURL');
      } else {
        showToast('success', 'Токен применён', 'URL и токен сохранены на сервере.');
        setCurlInput('');
        const fresh = await api.getSettings();
        setSettings(fresh);
        onSettingsSaved();
        loadChats();
      }
    } catch (err: any) {
      showToast('error', 'Ошибка импорта cURL', err.message);
    } finally {
      setIsParsingCurl(false);
    }
  };

  const handleTestTeams = async (chat_type: 'director' | 'daily') => {
    setIsTestingTeams(true);
    try {
      const res = await api.testTeams(chat_type);
      if (res.success) {
        showToast('success', 'Тест прошёл', `Teams ответил ${res.status_code}`);
      } else {
        showToast('error', 'Тест не прошёл', res.error || `Статус ${res.status_code}`);
      }
    } catch (err: any) {
      showToast('error', 'Ошибка теста', err.message);
    } finally {
      setIsTestingTeams(false);
    }
  };

  const handleEmailStart = async () => {
    if (!emailAddr.trim()) {
      showToast('error', 'Введите e-mail', 'Нужна почта учётной записи Microsoft.');
      return;
    }
    setIsEmailBusy(true);
    showToast('info', 'Открываем вход Microsoft', 'Ждём страницу и отправляем код на почту (до ~1 мин)...');
    try {
      const res = await api.teamsEmailStart(emailAddr.trim());
      if (res.session_id) {
        setEmailSid(res.session_id);
        setEmailStage(res.stage || null);
        setEmailOptions((res as any).options || []);
        setShotKey(Date.now());
        if (res.stage === 'code_sent') {
          showToast('success', 'Код отправлен', 'Проверьте почту и введите 6 цифр ниже.');
        } else {
          showToast('info', 'Требуется внимание', (res as any).message || 'Проверьте стадию входа.');
        }
      } else if (res.success) {
        showToast('success', 'Уже вошли', res.message);
        const fresh = await api.getSettings();
        setSettings(fresh);
        onSettingsSaved();
        loadChats();
      } else {
        showToast('error', (res as any).stage === 'limited' ? 'Лимит Microsoft' : 'Не удалось начать вход', res.message);
      }
    } catch (err: any) {
      showToast('error', 'Ошибка входа по почте', err.message);
    } finally {
      setIsEmailBusy(false);
    }
  };

  const handleEmailClick = async (text: string) => {
    if (!emailSid) return;
    setIsEmailBusy(true);
    try {
      const res = await api.teamsEmailClick(emailSid, [text]);
      setShotKey(Date.now());
      if (res.token_info || ((res as any).success && (res as any).message?.includes('сохранен'))) {
        showToast('success', 'Вход выполнен', res.message);
        setEmailSid(null);
        setEmailStage(null);
        setEmailOptions([]);
        const fresh = await api.getSettings();
        setSettings(fresh);
        onSettingsSaved();
        loadChats();
      } else {
        const opts = (res.page?.buttons || []).concat(res.page?.tiles || []);
        setEmailOptions(opts.slice(0, 12));
        showToast('info', 'Действие выполнено', res.message);
      }
    } catch (err: any) {
      showToast('error', 'Ошибка клика', err.message);
    } finally {
      setIsEmailBusy(false);
    }
  };

  const handleEmailSubmit = async () => {
    if (!emailSid || !codeInput.trim()) {
      showToast('error', 'Введите код', 'Код из письма (6 цифр).');
      return;
    }
    setIsEmailBusy(true);
    try {
      const res = await api.teamsEmailSubmit(emailSid, codeInput.trim());
      if (res.success) {
        showToast('success', 'Вход выполнен', res.message);
        setEmailSid(null);
        setEmailStage(null);
        setEmailOptions([]);
        setCodeInput('');
        setShowShot(false);
        const fresh = await api.getSettings();
        setSettings(fresh);
        onSettingsSaved();
        loadChats();
      } else {
        showToast('error', 'Код не принят', res.message);
        setShotKey(Date.now());
      }
    } catch (err: any) {
      showToast('error', 'Ошибка проверки кода', err.message);
    } finally {
      setIsEmailBusy(false);
    }
  };

  const handleEmailCancel = async () => {
    if (!emailSid) return;
    try {
      await api.teamsEmailCancel(emailSid);
    } catch {}
    setEmailSid(null);
    setEmailStage(null);
    setEmailOptions([]);
    setCodeInput('');
    setShowShot(false);
  };

  const findChatByUrl = (url: string) => {
    if (!url) return null;
    return teamsChats.find((c) => {
      if (c.url === url) return true;
      const getConvId = (u: string) => {
        const m = u.match(/conversations\/([^/]+)/);
        return m ? decodeURIComponent(m[1]) : '';
      };
      const id1 = getConvId(c.url);
      const id2 = getConvId(url);
      return id1 && id2 && id1 === id2;
    }) || null;
  };

  const isGroupChat = (chat: TeamsChat) => {
    return chat.id.includes('@thread.skype') || chat.title.includes('IT Co') || chat.title.toLowerCase().includes('чат') || chat.title.toLowerCase().includes('daily');
  };

  const selectedDirectorChat = findChatByUrl(settings.director_chat_url);
  const selectedDailyChat = findChatByUrl(settings.daily_chat_url);

  const filteredChats = teamsChats.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return c.title.toLowerCase().includes(q) || (c.preview && c.preview.toLowerCase().includes(q));
  });

  const selectChatFor = (chat: TeamsChat, target: 'director' | 'daily') => {
    if (target === 'director') {
      const updated = { ...settings, director_chat_url: chat.url };
      setSettings(updated);
      api.saveSettings(updated);
      onSettingsSaved();
      showToast('success', 'Чат руководителя выбран', chat.title);
    } else {
      const updated = { ...settings, daily_chat_url: chat.url };
      setSettings(updated);
      api.saveSettings(updated);
      onSettingsSaved();
      showToast('success', 'Чат отчётов команды выбран', chat.title);
    }
    setActivePicker(null);
    setSearchQuery('');
  };

  const isAccountActive = !!settings.auth_token && !settings.token_info?.is_expired;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
      <div className="bg-white rounded-2xl shadow-lg border border-slate-200 w-full max-w-2xl flex flex-col max-h-[88vh] overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-base font-bold text-slate-900">Настройки интеграции Teams</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Bar */}
        <div className="px-6 border-b border-slate-100 flex gap-2 shrink-0 bg-slate-50/50">
          <button
            onClick={() => { setActiveTab('chats'); setActivePicker(null); }}
            className={`py-3 px-3.5 text-xs font-semibold border-b-2 transition-colors flex items-center gap-2 cursor-pointer ${
              activeTab === 'chats'
                ? 'border-blue-600 text-blue-600 bg-white shadow-xs'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Чаты Teams</span>
          </button>
          <button
            onClick={() => { setActiveTab('auth'); setActivePicker(null); }}
            className={`py-3 px-3.5 text-xs font-semibold border-b-2 transition-colors flex items-center gap-2 cursor-pointer ${
              activeTab === 'auth'
                ? 'border-blue-600 text-blue-600 bg-white shadow-xs'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>Авторизация</span>
          </button>
          <button
            onClick={() => { setActiveTab('debug'); setActivePicker(null); }}
            className={`py-3 px-3.5 text-xs font-semibold border-b-2 transition-colors flex items-center gap-2 cursor-pointer ${
              activeTab === 'debug'
                ? 'border-blue-600 text-blue-600 bg-white shadow-xs'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Сброс смены</span>
          </button>
        </div>

        {/* Content Area */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
          
          {/* TAB 1: CHATS */}
          {activeTab === 'chats' && (
            <div className="space-y-6">
              
              {/* Director Chat Card */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/40 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-slate-900 text-sm">
                    1. Чат с руководителем
                  </div>
                  <span className="text-[11px] text-slate-400">
                    кнопка «Я на смене»
                  </span>
                </div>

                {/* Selected Chat Box */}
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center shrink-0">
                      {selectedDirectorChat && isGroupChat(selectedDirectorChat) ? (
                        <Users className="w-4 h-4" />
                      ) : (
                        <User className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 text-xs truncate">
                        {selectedDirectorChat ? selectedDirectorChat.title : (settings.director_chat_url ? 'Диалог выбран' : 'Диалог не выбран')}
                      </div>
                      <div className="text-[11px] text-slate-400 truncate">
                        {selectedDirectorChat?.preview ? `«${selectedDirectorChat.preview}»` : (settings.director_chat_url ? 'Пользовательский URL' : 'Выберите диалог из списка Teams')}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setActivePicker(activePicker === 'director' ? null : 'director');
                      setSearchQuery('');
                    }}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold shrink-0 transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>{selectedDirectorChat || settings.director_chat_url ? 'Сменить' : 'Выбрать'}</span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                </div>

                {/* Inline Dialog Picker for Director */}
                {activePicker === 'director' && (
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 space-y-2.5 animate-in fade-in duration-150">
                    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50/50">
                      <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Поиск по диалогам и коллегам..."
                        className="w-full bg-transparent text-xs text-slate-800 placeholder-slate-400 focus:outline-none"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={loadChats}
                        title="Обновить список чатов из Teams"
                        className="text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isLoadingChats ? 'animate-spin' : ''}`} />
                      </button>
                    </div>

                    <div className="max-h-52 overflow-y-auto divide-y divide-slate-100 pr-1">
                      {filteredChats.length > 0 ? (
                        filteredChats.map((chat) => {
                          const isSelected = selectedDirectorChat?.id === chat.id || settings.director_chat_url === chat.url;
                          return (
                            <button
                              key={chat.id}
                              type="button"
                              onClick={() => selectChatFor(chat, 'director')}
                              className={`w-full text-left p-2 rounded-lg flex items-center justify-between gap-2.5 transition-colors cursor-pointer ${
                                isSelected ? 'bg-blue-50/80 text-blue-900' : 'hover:bg-slate-50 text-slate-700'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${
                                  isGroupChat(chat) ? 'bg-slate-100 text-slate-600' : 'bg-slate-100 text-slate-600'
                                }`}>
                                  {isGroupChat(chat) ? <Users className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
                                </div>
                                <div className="min-w-0">
                                  <div className="font-semibold text-xs truncate">{chat.title}</div>
                                  {chat.preview && (
                                    <div className="text-[10px] text-slate-400 truncate max-w-sm">
                                      {chat.preview}
                                    </div>
                                  )}
                                </div>
                              </div>
                              {isSelected && <Check className="w-4 h-4 text-blue-600 shrink-0" />}
                            </button>
                          );
                        })
                      ) : (
                        <div className="py-4 text-center text-slate-400 text-xs">
                          {isLoadingChats ? 'Загрузка диалогов...' : 'Диалоги не найдены'}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Message Template */}
                <div>
                  <label className="block text-slate-600 font-medium mb-1">
                    Текст утреннего сообщения:
                  </label>
                  <input
                    type="text"
                    value={settings.director_message_template}
                    onChange={(e) => setSettings({ ...settings, director_message_template: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                  />
                </div>

                {/* Optional Manual URL */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowManualDirectorUrl(!showManualDirectorUrl)}
                    className="text-[11px] text-slate-400 hover:text-slate-600 flex items-center gap-1 cursor-pointer"
                  >
                    {showManualDirectorUrl ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    <span>Указать URL вручную</span>
                  </button>
                  {showManualDirectorUrl && (
                    <input
                      type="text"
                      value={settings.director_chat_url}
                      onChange={(e) => setSettings({ ...settings, director_chat_url: e.target.value })}
                      className="mt-1.5 w-full px-3 py-2 rounded-lg border border-slate-200 font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-white"
                      placeholder="https://teams.live.com/api/chatsvc/consumer/v1/users/ME/conversations/.../messages"
                    />
                  )}
                </div>
              </div>

              {/* Daily Report Chat Card */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/40 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-slate-900 text-sm">
                    2. Чат отчётов команды
                  </div>
                  <span className="text-[11px] text-slate-400">
                    кнопка «Завершить смену»
                  </span>
                </div>

                {/* Selected Chat Box */}
                <div className="bg-white p-3.5 rounded-xl border border-slate-200 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center shrink-0">
                      {selectedDailyChat && isGroupChat(selectedDailyChat) ? (
                        <Users className="w-4 h-4" />
                      ) : (
                        <User className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 text-xs truncate">
                        {selectedDailyChat ? selectedDailyChat.title : (settings.daily_chat_url ? 'Диалог выбран' : 'Диалог не выбран')}
                      </div>
                      <div className="text-[11px] text-slate-400 truncate">
                        {selectedDailyChat?.preview ? `«${selectedDailyChat.preview}»` : (settings.daily_chat_url ? 'Пользовательский URL' : 'Выберите диалог для ежедневных отчётов')}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setActivePicker(activePicker === 'daily' ? null : 'daily');
                      setSearchQuery('');
                    }}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold shrink-0 transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>{selectedDailyChat || settings.daily_chat_url ? 'Сменить' : 'Выбрать'}</span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                </div>

                {/* Inline Dialog Picker for Daily */}
                {activePicker === 'daily' && (
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 space-y-2.5 animate-in fade-in duration-150">
                    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50/50">
                      <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Поиск по диалогам..."
                        className="w-full bg-transparent text-xs text-slate-800 placeholder-slate-400 focus:outline-none"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={loadChats}
                        title="Обновить список чатов из Teams"
                        className="text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isLoadingChats ? 'animate-spin' : ''}`} />
                      </button>
                    </div>

                    <div className="max-h-52 overflow-y-auto divide-y divide-slate-100 pr-1">
                      {filteredChats.length > 0 ? (
                        filteredChats.map((chat) => {
                          const isSelected = selectedDailyChat?.id === chat.id || settings.daily_chat_url === chat.url;
                          return (
                            <button
                              key={chat.id}
                              type="button"
                              onClick={() => selectChatFor(chat, 'daily')}
                              className={`w-full text-left p-2 rounded-lg flex items-center justify-between gap-2.5 transition-colors cursor-pointer ${
                                isSelected ? 'bg-emerald-50/80 text-emerald-900' : 'hover:bg-slate-50 text-slate-700'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${
                                  isGroupChat(chat) ? 'bg-slate-100 text-slate-600' : 'bg-slate-100 text-slate-600'
                                }`}>
                                  {isGroupChat(chat) ? <Users className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
                                </div>
                                <div className="min-w-0">
                                  <div className="font-semibold text-xs truncate">{chat.title}</div>
                                  {chat.preview && (
                                    <div className="text-[10px] text-slate-400 truncate max-w-sm">
                                      {chat.preview}
                                    </div>
                                  )}
                                </div>
                              </div>
                              {isSelected && <Check className="w-4 h-4 text-emerald-600 shrink-0" />}
                            </button>
                          );
                        })
                      ) : (
                        <div className="py-4 text-center text-slate-400 text-xs">
                          {isLoadingChats ? 'Загрузка диалогов...' : 'Диалоги не найдены'}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Optional Manual URL */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowManualDailyUrl(!showManualDailyUrl)}
                    className="text-[11px] text-slate-400 hover:text-slate-600 flex items-center gap-1 cursor-pointer"
                  >
                    {showManualDailyUrl ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    <span>Указать URL вручную</span>
                  </button>
                  {showManualDailyUrl && (
                    <input
                      type="text"
                      value={settings.daily_chat_url}
                      onChange={(e) => setSettings({ ...settings, daily_chat_url: e.target.value })}
                      className="mt-1.5 w-full px-3 py-2 rounded-lg border border-slate-200 font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-white"
                      placeholder="https://teams.live.com/api/chatsvc/consumer/v1/users/ME/conversations/.../messages"
                    />
                  )}
                </div>
              </div>

            </div>
          )}

          {/* TAB 2: AUTH (Streamlined, zero AI slop, no manual inputs) */}
          {activeTab === 'auth' && (
            <div className="space-y-4">
              <div className="p-5 bg-white border border-slate-200 rounded-xl space-y-4">
                
                {/* Account Top Row */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm tracking-wide shrink-0">
                      {(settings.account_name || 'Teams')
                        .split(' ')
                        .map((p) => p[0])
                        .filter(Boolean)
                        .join('')
                        .slice(0, 2)
                        .toUpperCase() || 'TM'}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900">
                        {settings.account_name || 'Пользователь Teams'}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        {settings.token_info?.skypeid || 'Сессия браузера активна'}
                      </div>
                    </div>
                  </div>

                  <div>
                    {isAccountActive ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        Активен
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                        <span className="w-2 h-2 rounded-full bg-slate-400" />
                        Не активен
                      </span>
                    )}
                  </div>
                </div>

                {/* Session Details */}
                <div className="pt-3 border-t border-slate-100 grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <div className="text-slate-400 text-[11px] mb-0.5">Сессия Teams:</div>
                    <div className="font-semibold text-slate-800">
                      Бессрочно (Запомнить меня)
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400 text-[11px] mb-0.5">Авто-продление:</div>
                    <div className="font-semibold text-emerald-700 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      Активно в фоне
                    </div>
                  </div>
                </div>

                <div className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-lg border border-slate-100 leading-relaxed">
                  Временный ключ Teams действует до {settings.token_info?.expires_at ? settings.token_info.expires_at.split(' ')[1] : 'вечера'} и обновляется сервером автоматически за час до окончания. Повторно входить не потребуется.
                </div>

                {!hasBrowserProfile && (
                  <div className="text-[11px] text-amber-800 bg-amber-50 p-2.5 rounded-lg border border-amber-200 leading-relaxed">
                    На сервере (VPS) браузера нет — это нормально. Вход через браузер там не сработает.
                    Используйте импорт cURL ниже с локального ПК: Teams в браузере → F12 → Network → отправьте сообщение → Copy as cURL.
                  </div>
                )}

                {/* Вход по коду из письма — основной способ */}
                <div className="pt-3 border-t border-slate-100 space-y-2">
                  <div className="text-xs font-bold text-slate-900">Вход по коду из письма</div>
                  {!emailSid ? (
                    <div className="flex gap-2">
                      <input
                        type="email"
                        value={emailAddr}
                        onChange={(e) => setEmailAddr(e.target.value)}
                        placeholder="vepishin@it-co.ru"
                        className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                      />
                      <button
                        type="button"
                        onClick={handleEmailStart}
                        disabled={isEmailBusy}
                        className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
                      >
                        <span>{isEmailBusy ? 'Ждём Microsoft...' : 'Отправить код'}</span>
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {/* Статус / Сообщение */}
                      <div className={`text-[11px] p-2.5 rounded-lg border leading-relaxed ${
                        emailStage === 'code_sent'
                          ? 'text-blue-800 bg-blue-50 border-blue-200'
                          : emailStage === 'limited'
                          ? 'text-red-800 bg-red-50 border-red-200'
                          : 'text-amber-800 bg-amber-50 border-amber-200'
                      }`}>
                        {emailStage === 'code_sent' && `Код отправлен на ${emailAddr}. Введите 6 цифр из письма.`}
                        {emailStage === 'limited' && 'Microsoft временно ограничил отправку кодов (слишком частые запросы). Подождите 30–60 минут или выберите другой способ.'}
                        {emailStage !== 'code_sent' && emailStage !== 'limited' && (
                          `Microsoft ожидает подтверждения (стадия: ${emailStage || 'проверка'}). Если код уже пришёл — введите его ниже, либо выберите вариант действия.`
                        )}
                      </div>

                      {/* Кнопки вариантов от Microsoft если есть */}
                      {emailOptions.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-[10px] text-slate-500 font-medium">Варианты от Microsoft:</div>
                          <div className="flex flex-wrap gap-1.5">
                            {emailOptions.map((opt, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => handleEmailClick(opt)}
                                disabled={isEmailBusy}
                                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-medium transition-colors cursor-pointer"
                              >
                                {opt}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Поле ввода кода доступно ВСЕГДА при наличии активного emailSid */}
                      <div className="flex gap-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={codeInput}
                          onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 8))}
                          placeholder="123456"
                          className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-xs font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={handleEmailSubmit}
                          disabled={isEmailBusy}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
                        >
                          <span>{isEmailBusy ? 'Проверяем...' : 'Войти'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleEmailCancel}
                          disabled={isEmailBusy}
                          className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                        >
                          <span>Отмена</span>
                        </button>
                      </div>

                      {/* Переключатель просмотра снимка экрана */}
                      <div className="flex items-center justify-between pt-1">
                        <button
                          type="button"
                          onClick={() => setShowShot(!showShot)}
                          className="text-[11px] text-blue-600 hover:underline cursor-pointer"
                        >
                          {showShot ? 'Скрыть снимок экрана' : 'Показать снимок экрана Microsoft'}
                        </button>
                        {showShot && (
                          <button
                            type="button"
                            onClick={() => setShotKey(Date.now())}
                            className="text-[11px] text-slate-500 hover:text-slate-800 cursor-pointer"
                          >
                            Обновить снимок
                          </button>
                        )}
                      </div>

                      {showShot && (
                        <div className="mt-2 border border-slate-200 rounded-lg overflow-hidden max-h-60 overflow-y-auto bg-slate-50">
                          <img
                            src={`/api/auth/teams-email/shot/${emailSid}?t=${shotKey}`}
                            alt="Microsoft login screen"
                            className="w-full object-contain"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* cURL import — запасной способ входа на VPS */}
                <div className="pt-3 border-t border-slate-100 space-y-2">
                  <div className="text-xs font-bold text-slate-900">Импорт cURL (работает на VPS)</div>
                  <textarea
                    value={curlInput}
                    onChange={(e) => setCurlInput(e.target.value)}
                    placeholder="Вставьте сюда 'Copy as cURL' из DevTools Teams..."
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-white"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleParseCurl}
                      disabled={isParsingCurl}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <span>{isParsingCurl ? 'Импорт...' : 'Распарсить и применить'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTestTeams('director')}
                      disabled={isTestingTeams}
                      className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <span>Тест: директор</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTestTeams('daily')}
                      disabled={isTestingTeams}
                      className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <span>Тест: дейли-чат</span>
                    </button>
                  </div>
                </div>

                {/* Actions */}
                <div className="pt-3 border-t border-slate-100 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleBrowserLogin}
                    disabled={isBrowserLoggingIn}
                    className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <LogIn className={`w-3.5 h-3.5 ${isBrowserLoggingIn ? 'animate-spin' : ''}`} />
                    <span>{isBrowserLoggingIn ? 'Ожидание браузера...' : hasBrowserProfile ? 'Сменить аккаунт' : 'Выполнить вход'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleBrowserRefresh}
                    disabled={isBrowserRefreshing}
                    className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isBrowserRefreshing ? 'animate-spin' : ''}`} />
                    <span>{isBrowserRefreshing ? 'Проверка...' : 'Проверить сессию'}</span>
                  </button>
                </div>

              </div>
            </div>
          )}

          {/* TAB 3: DEBUG */}
          {activeTab === 'debug' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-rose-200 bg-rose-50/40 space-y-3">
                <h4 className="font-bold text-rose-950 text-sm">
                  Сброс статуса смены за сегодня
                </h4>
                <p className="text-xs text-rose-800/80">
                  Удаляет запись смены за текущую дату и возвращает статус к «Смена не начата».
                </p>
                <button
                  onClick={async () => {
                    await onResetTodayShift();
                    onClose();
                  }}
                  className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs transition-colors flex items-center gap-2 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Сбросить статус дня</span>
                </button>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/80 flex items-center justify-between shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-white transition-colors cursor-pointer"
          >
            Закрыть
          </button>

          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-6 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs transition-colors flex items-center gap-2 disabled:opacity-50 cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isSaving ? 'Сохранение...' : 'Сохранить'}</span>
          </button>
        </div>

      </div>
    </div>
  );
};
