import React from 'react';
import {
  Clock,
  ClipboardList,
  Settings,
  ShieldCheck,
  CircleDot,
  LogOut
} from 'lucide-react';
import { NavTab, Shift, AuthUser } from '../types';

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  shift: Shift | null;
  onOpenSettings: () => void;
  onLogout?: () => void;
  user?: AuthUser | null;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  shift,
  onOpenSettings,
  onLogout,
  user,
}) => {
  const navItems = [
    {
      id: 'shift' as NavTab,
      label: 'Рабочая смена',
      icon: Clock,
      badge: shift?.status === 'in_progress' ? 'В работе' : null,
      badgeColor: 'bg-emerald-100 text-emerald-700',
    },
    {
      id: 'history' as NavTab,
      label: 'История отчётов',
      icon: ClipboardList,
    },
    {
      id: 'settings' as NavTab,
      label: 'Настройки Teams',
      icon: Settings,
    },
  ];

  const getStatusDisplay = () => {
    if (!shift) return { label: 'Загрузка...', color: 'text-slate-400 bg-slate-100' };
    switch (shift.status) {
      case 'in_progress':
        return { label: 'Смена активна', color: 'text-emerald-700 bg-emerald-50 border-emerald-200' };
      case 'completed':
        return { label: 'Смена завершена', color: 'text-blue-700 bg-blue-50 border-blue-200' };
      default:
        return { label: 'Смена не начата', color: 'text-slate-600 bg-slate-100 border-slate-200' };
    }
  };

  const statusInfo = getStatusDisplay();

  return (
    <aside className="w-64 bg-white border-r border-slate-200/80 flex flex-col justify-between shrink-0 select-none shadow-[1px_0_4px_rgba(0,0,0,0.02)]">
      <div>
        <div className="px-6 py-6 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-bold text-slate-900 tracking-tight text-[15px] leading-tight">
                ITCO Dashboard
              </h1>
              <span className="text-[11px] font-medium text-slate-400 block mt-0.5">
                Рабочее место
              </span>
            </div>
          </div>
        </div>

        <nav className="p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  if (item.id === 'settings') {
                    onOpenSettings();
                  } else {
                    onSelectTab(item.id);
                  }
                }}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50/80 text-blue-700 font-semibold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon
                    className={`w-[18px] h-[18px] transition-colors ${
                      isActive ? 'text-blue-600' : 'text-slate-400'
                    }`}
                  />
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${item.badgeColor}`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="p-4 border-t border-slate-100">
        <div className={`p-3 rounded-xl border ${statusInfo.color}`}>
          <div className="flex items-center gap-2">
            <CircleDot className="w-4 h-4 shrink-0" />
            <span className="text-xs font-semibold">{statusInfo.label}</span>
          </div>
          {shift?.start_time && (
            <p className="text-[11px] text-slate-500 mt-1 pl-6">
              Начало: <span className="font-medium text-slate-700">{shift.start_time}</span>
            </p>
          )}
          {shift?.end_time && (
            <p className="text-[11px] text-slate-500 pl-6">
              Конец: <span className="font-medium text-slate-700">{shift.end_time}</span>
            </p>
          )}
        </div>

        {onLogout && (
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500">
            <div className="flex items-center gap-2 max-w-[130px] truncate" title={user?.name || user?.username || 'Пользователь'}>
              <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></div>
              <span className="font-medium text-slate-700 text-[12px] truncate">
                {user?.name || user?.username || 'Пользователь'}
              </span>
            </div>
            <button
              onClick={onLogout}
              className="flex items-center gap-1 text-slate-400 hover:text-rose-600 transition-colors py-1 px-2 rounded-lg hover:bg-rose-50 cursor-pointer shrink-0"
              title="Выйти из системы"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="text-[11px] font-medium">Выйти</span>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
};
