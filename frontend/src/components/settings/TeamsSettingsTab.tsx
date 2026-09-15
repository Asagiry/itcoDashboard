import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Search,
  Check,
  User,
  Users,
  Loader2,
  Mail,
  ShieldCheck,
  AlertTriangle,
  Eye,
  EyeOff,
  X
} from 'lucide-react';
import { AppSettings, TeamsChat } from '../../types';
import { api } from '../../api/client';

interface TeamsSettingsTabProps {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  teamsChats: TeamsChat[];
  isLoadingChats: boolean;
  onRefreshChats: () => void;
  showToast: (type: 'success' | 'error' | 'info', title: string, message?: string) => void;
}

export const TeamsSettingsTab: React.FC<TeamsSettingsTabProps> = ({
  settings,
  setSettings,
  teamsChats,
  isLoadingChats,
  onRefreshChats,
  showToast,
}) => {
  const [isChangingAccount, setIsChangingAccount] = useState(false);
  const [isTestingTeams, setIsTestingTeams] = useState(false);

  // Email OTP state
  const [emailAddr, setEmailAddr] = useState('');
  const [emailSid, setEmailSid] = useState<string | null>(null);
  const [emailStage, setEmailStage] = useState<string | null>(null);
  const [emailOptions, setEmailOptions] = useState<string[]>([]);
  const [codeInput, setCodeInput] = useState('');
  const [isEmailBusy, setIsEmailBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<'sending_code' | 'verifying_code' | null>(null);
  const [showShot, setShowShot] = useState(false);
  const [shotKey, setShotKey] = useState<number>(Date.now());

  // Active chat picker state per field
  const [activePicker, setActivePicker] = useState<'director' | 'daily' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const handleTestTeams = async () => {
    setIsTestingTeams(true);
    try {
      const res = await api.testTeams('self', 'test ping');
      if (res.success) {
        showToast('success', 'Тест прошёл успешно', 'Сообщение отправлено в ЛС Teams.');
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
    setBusyAction('sending_code');
    showToast('info', 'Подключение к Microsoft', 'Открываем страницу входа и запрашиваем код (~5–15 сек)...');
    try {
      const res = await api.teamsEmailStart(emailAddr.trim());
      if (res.session_id) {
        setEmailSid(res.session_id);
        setEmailStage(res.stage || 'code_sent');
        setEmailOptions((res as any).options || []);
        setShotKey(Date.now());
        if (res.stage === 'code_sent') {
          showToast('success', 'Код отправлен', 'Проверьте почту и введите 6 цифр ниже.');
        } else {
          showToast('info', 'Внимание', (res as any).message || 'Microsoft ожидает подтверждения.');
        }
      } else if (res.success) {
        showToast('success', 'Вход выполнен', res.message || 'Сессия уже активна.');
        setIsChangingAccount(false);
        const fresh = await api.getSettings();
        setSettings(fresh);
        onRefreshChats();
      } else {
        showToast('error', (res as any).stage === 'limited' ? 'Лимит Microsoft' : 'Ошибка отправки', res.message);
      }
    } catch (err: any) {
      showToast('error', 'Ошибка входа по почте', err.message);
    } finally {
      setIsEmailBusy(false);
      setBusyAction(null);
    }
  };

  const handleEmailSubmit = async () => {
    if (!emailSid || !codeInput.trim()) {
      showToast('error', 'Введите код', 'Введите код из письма (6 цифр).');
      return;
    }
    setIsEmailBusy(true);
    setBusyAction('verifying_code');
    showToast('info', 'Проверка кода', 'Авторизуемся в Teams и сохраняем сессию (~5–10 сек)...');
    try {
      const res = await api.teamsEmailSubmit(emailSid, codeInput.trim());
      if (res.success) {
        showToast('success', 'Вход выполнен успешно!', 'Сессия Teams сохранена.');
        setEmailSid(null);
        setEmailStage(null);
        setEmailOptions([]);
        setCodeInput('');
        setShowShot(false);
        setIsChangingAccount(false);
        const fresh = await api.getSettings();
        setSettings(fresh);
        onRefreshChats();
      } else {
        showToast('error', 'Код не принят', res.message || 'Проверьте правильность кода.');
        setShotKey(Date.now());
      }
    } catch (err: any) {
      showToast('error', 'Ошибка проверки кода', err.message);
    } finally {
      setIsEmailBusy(false);
      setBusyAction(null);
    }
  };

  const handleEmailCancel = async () => {
    if (emailSid) {
      try {
        await api.teamsEmailCancel(emailSid);
      } catch {}
    }
    setEmailSid(null);
    setEmailStage(null);
    setEmailOptions([]);
    setCodeInput('');
    setShowShot(false);
    setIsChangingAccount(false);
    setIsEmailBusy(false);
    setBusyAction(null);
  };

  const handleEmailOptionClick = async (text: string) => {
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
        setIsChangingAccount(false);
        const fresh = await api.getSettings();
        setSettings(fresh);
        onRefreshChats();
      } else {
        const opts = (res.page?.buttons || []).concat(res.page?.tiles || []);
        setEmailOptions(opts.slice(0, 12));
        showToast('info', 'Действие выполнено', res.message);
      }
    } catch (err: any) {
      showToast('error', 'Ошибка', err.message);
    } finally {
      setIsEmailBusy(false);
    }
  };

  const findChatByUrl = (url?: string): TeamsChat | null => {
    if (!url || !url.trim()) return null;
    const clean = url.trim();
    return (
      teamsChats.find(
        (c) =>
          c.url === clean ||
          c.id === clean ||
          (clean.includes(encodeURIComponent(c.id)) && c.id.length > 5) ||
          (c.id && clean.includes(c.id))
      ) || null
    );
  };

  const isGroupChat = (chat: TeamsChat) => {
    return (
      chat.id.includes('@thread.skype') ||
      chat.id.includes('@thread.v2') ||
      chat.id.startsWith('19:')
    );
  };

  const filteredChats = teamsChats.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.title.toLowerCase().includes(q) ||
      (c.preview && c.preview.toLowerCase().includes(q))
    );
  });

  const handleSelectChat = (chat: TeamsChat, target: 'director' | 'daily') => {
    if (target === 'director') {
      setSettings((prev) => ({ ...prev, director_chat_url: chat.url }));
      showToast('success', 'Чат руководителя выбран', chat.title);
    } else {
      setSettings((prev) => ({ ...prev, daily_chat_url: chat.url }));
      showToast('success', 'Чат отчётов команды выбран', chat.title);
    }
    setActivePicker(null);
    setSearchQuery('');
  };

  const selectedDirectorChat = findChatByUrl(settings.director_chat_url);
  const selectedDailyChat = findChatByUrl(settings.daily_chat_url);

  return (
    <div className="space-y-6">
      {/* Account Info Header */}
      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-xs">
            MS
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-800">
              {settings.account_name || 'Учётная запись Teams'}
            </h4>
            <p className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5">
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${settings.has_browser_profile ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              <span>{settings.has_browser_profile ? 'Сессия браузера сохранена' : 'Требуется авторизация'}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleTestTeams}
            disabled={isTestingTeams}
            className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-white text-xs font-semibold text-slate-700 transition-colors cursor-pointer disabled:opacity-50"
          >
            {isTestingTeams ? 'Проверка...' : 'Проверить связь'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (isChangingAccount) {
                handleEmailCancel();
              } else {
                setIsChangingAccount(true);
              }
            }}
            className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white transition-colors cursor-pointer"
          >
            {isChangingAccount ? 'Отмена' : 'Сменить аккаунт'}
          </button>
        </div>
      </div>

      {/* OTP Login Form */}
      {isChangingAccount && (
        <div className="p-4 rounded-xl bg-blue-50/40 border border-blue-200/80 space-y-4 animate-in fade-in duration-150">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-blue-600" />
              <h5 className="text-xs font-bold text-blue-950">Вход по одноразовому коду Teams</h5>
            </div>
            <button
              type="button"
              onClick={handleEmailCancel}
              className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Email input line */}
          <div className="flex gap-2">
            <input
              type="email"
              value={emailAddr}
              onChange={(e) => setEmailAddr(e.target.value)}
              disabled={isEmailBusy || !!emailSid}
              placeholder="name@it-co.ru"
              className="flex-1 px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs disabled:bg-slate-100 disabled:text-slate-500 focus:outline-none focus:border-blue-500"
            />
            {!emailSid ? (
              <button
                type="button"
                onClick={handleEmailStart}
                disabled={isEmailBusy || !emailAddr.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl flex items-center gap-2 disabled:opacity-50 cursor-pointer whitespace-nowrap shadow-2xs"
              >
                {busyAction === 'sending_code' ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Отправка...</span>
                  </>
                ) : (
                  <span>Отправить код</span>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleEmailCancel}
                disabled={isEmailBusy}
                className="px-3 py-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-medium rounded-xl cursor-pointer"
              >
                Сменить почту
              </button>
            )}
          </div>

          {/* Progress / Status banner while busy */}
          {isEmailBusy && (
            <div className="p-3 bg-blue-100/60 border border-blue-200 rounded-xl flex items-center gap-3 text-blue-900 text-xs animate-pulse">
              <Loader2 className="w-4 h-4 animate-spin text-blue-600 shrink-0" />
              <span>
                {busyAction === 'sending_code'
                  ? 'Связываемся с Microsoft и запрашиваем код подтверждения на почту...'
                  : 'Проверяем код и авторизуем учётную запись Teams...'}
              </span>
            </div>
          )}

          {/* Code verification section */}
          {emailSid && !isEmailBusy && (
            <div className="space-y-3 pt-1 border-t border-blue-100">
              {/* Status Message */}
              <div
                className={`text-[11px] p-3 rounded-xl border leading-relaxed flex items-start gap-2.5 ${
                  emailStage === 'code_sent'
                    ? 'text-blue-900 bg-blue-50 border-blue-200'
                    : emailStage === 'limited'
                    ? 'text-red-900 bg-red-50 border-red-200'
                    : 'text-amber-900 bg-amber-50 border-amber-200'
                }`}
              >
                {emailStage === 'code_sent' ? (
                  <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                )}
                <div>
                  {emailStage === 'code_sent' && (
                    <span>
                      Код отправлен на <strong>{emailAddr}</strong>. Введите полученный из письма 6-значный код.
                    </span>
                  )}
                  {emailStage === 'limited' && (
                    <span>
                      Microsoft временно ограничил отправку кодов из-за частых запросов. Подождите несколько минут или выберите другой вариант.
                    </span>
                  )}
                  {emailStage !== 'code_sent' && emailStage !== 'limited' && (
                    <span>
                      Microsoft ожидает подтверждения (стадия: {emailStage || 'проверка'}). Если код уже пришёл — введите его ниже.
                    </span>
                  )}
                </div>
              </div>

              {/* Microsoft Choice Options if any */}
              {emailOptions.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
                    Варианты от Microsoft:
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {emailOptions.map((opt, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => handleEmailOptionClick(opt)}
                        disabled={isEmailBusy}
                        className="px-2.5 py-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-[11px] font-medium transition-colors cursor-pointer"
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Code input form */}
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && codeInput.trim()) {
                      handleEmailSubmit();
                    }
                  }}
                  placeholder="123456"
                  className="w-44 px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-mono tracking-widest text-center focus:outline-none focus:border-emerald-500"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleEmailSubmit}
                  disabled={isEmailBusy || !codeInput.trim()}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-2xs"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Подтвердить код</span>
                </button>
              </div>

              {/* Screenshot toggle */}
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => setShowShot(!showShot)}
                  className="text-[11px] text-blue-600 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  {showShot ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  <span>{showShot ? 'Скрыть экран Microsoft' : 'Показать экран Microsoft'}</span>
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
                <div className="border border-slate-200 rounded-xl overflow-hidden max-h-56 overflow-y-auto bg-slate-50 p-1">
                  <img
                    src={`/api/auth/teams-email/shot/${emailSid}?t=${shotKey}`}
                    alt="Microsoft login screen"
                    className="w-full object-contain rounded-lg"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Chat Configuration */}
      <div className="space-y-5">
        
        {/* FIELD 1: DIRECTOR CHAT */}
        <div className="space-y-2 p-3.5 rounded-xl border border-slate-200/80 bg-slate-50/30">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-800">
              Чат с руководителем (Приветствие)
            </label>
          </div>

          {/* Selected Chat Box */}
          <div className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between gap-3 shadow-2xs">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center shrink-0">
                {selectedDirectorChat && isGroupChat(selectedDirectorChat) ? (
                  <Users className="w-4 h-4" />
                ) : (
                  <User className="w-4 h-4" />
                )}
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-slate-900 text-xs truncate">
                  {selectedDirectorChat ? selectedDirectorChat.title : (settings.director_chat_url ? 'Пользовательский диалог' : 'Диалог не выбран')}
                </div>
                <div className="text-[11px] text-slate-400 truncate">
                  {selectedDirectorChat?.preview
                    ? `«${selectedDirectorChat.preview}»`
                    : (settings.director_chat_url ? settings.director_chat_url : 'Выберите чат из списка Teams')}
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
              {activePicker === 'director' ? (
                <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              )}
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
                  onClick={onRefreshChats}
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
                        onClick={() => handleSelectChat(chat, 'director')}
                        className={`w-full text-left p-2 rounded-lg flex items-center justify-between gap-2.5 transition-colors cursor-pointer ${
                          isSelected ? 'bg-blue-50/80 text-blue-900' : 'hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-7 h-7 rounded-md bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
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
        </div>

        {/* FIELD 2: DAILY REPORT CHAT */}
        <div className="space-y-2 p-3.5 rounded-xl border border-slate-200/80 bg-slate-50/30">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-800">
              Командный чат (Ежедневный отчёт)
            </label>
          </div>

          {/* Selected Chat Box */}
          <div className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between gap-3 shadow-2xs">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center shrink-0">
                {selectedDailyChat && isGroupChat(selectedDailyChat) ? (
                  <Users className="w-4 h-4" />
                ) : (
                  <User className="w-4 h-4" />
                )}
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-slate-900 text-xs truncate">
                  {selectedDailyChat ? selectedDailyChat.title : (settings.daily_chat_url ? 'Пользовательский диалог' : 'Диалог не выбран')}
                </div>
                <div className="text-[11px] text-slate-400 truncate">
                  {selectedDailyChat?.preview
                    ? `«${selectedDailyChat.preview}»`
                    : (settings.daily_chat_url ? settings.daily_chat_url : 'Выберите чат из списка Teams')}
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
              {activePicker === 'daily' ? (
                <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              )}
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
                  placeholder="Поиск по чатам команды..."
                  className="w-full bg-transparent text-xs text-slate-800 placeholder-slate-400 focus:outline-none"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={onRefreshChats}
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
                        onClick={() => handleSelectChat(chat, 'daily')}
                        className={`w-full text-left p-2 rounded-lg flex items-center justify-between gap-2.5 transition-colors cursor-pointer ${
                          isSelected ? 'bg-emerald-50/80 text-emerald-900' : 'hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-7 h-7 rounded-md bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
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
        </div>

        {/* Template */}
        <div>
          <label className="text-xs font-bold text-slate-700 block mb-1.5">
            Шаблон приветствия руководителя
          </label>
          <input
            type="text"
            value={settings.director_message_template}
            onChange={(e) => setSettings((prev) => ({ ...prev, director_message_template: e.target.value }))}
            className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
          />
        </div>
      </div>
    </div>
  );
};
