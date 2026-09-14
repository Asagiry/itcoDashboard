import {
  Shift,
  AppSettings,
  StartShiftResponse,
  EndShiftResponse,
  TestTeamsResponse,
  ParseCurlResponse,
  SalaryStats,
  LoginResponse,
  AuthUser
} from '../types';

const API_BASE = '/api';
export const AUTH_TOKEN_KEY = 'itco_auth_token';

export async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options?.headers as Record<string, string> || {}),
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    if (response.status === 401 && !url.includes('/api/auth/login')) {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      window.dispatchEvent(new Event('itco_unauthorized'));
    }

    let errorDetail = `Ошибка ${response.status}: ${response.statusText}`;
    try {
      const errJson = await response.json();
      if (errJson.detail) {
        errorDetail = errJson.detail;
      }
    } catch {}
    throw new Error(errorDetail);
  }

  return response.json();
}

export const api = {
  getTodayShift: (): Promise<Shift> => 
    fetchJson<Shift>(`${API_BASE}/shifts/today`),

  startShift: (): Promise<StartShiftResponse> => 
    fetchJson<StartShiftResponse>(`${API_BASE}/shifts/start`, { method: 'POST' }),

  saveDraft: (daily_report: string): Promise<{ success: boolean; shift: Shift }> =>
    fetchJson(`${API_BASE}/shifts/draft`, {
      method: 'POST',
      body: JSON.stringify({ daily_report }),
    }),

  endShift: (daily_report: string): Promise<EndShiftResponse> =>
    fetchJson<EndShiftResponse>(`${API_BASE}/shifts/end`, {
      method: 'POST',
      body: JSON.stringify({ daily_report }),
    }),

  getHistory: (limit: number = 100): Promise<Shift[]> =>
    fetchJson<Shift[]>(`${API_BASE}/shifts/history?limit=${limit}`),

  resetTodayShift: (): Promise<{ success: boolean; message: string; shift: Shift }> =>
    fetchJson(`${API_BASE}/shifts/reset-today`, { method: 'POST' }),

  getSalaryStats: (): Promise<SalaryStats> =>
    fetchJson<SalaryStats>(`${API_BASE}/shifts/salary-stats`),

  getSettings: (): Promise<AppSettings> =>
    fetchJson<AppSettings>(`${API_BASE}/settings`),

  saveSettings: (settings: AppSettings): Promise<{ success: boolean; message: string }> =>
    fetchJson(`${API_BASE}/settings`, {
      method: 'POST',
      body: JSON.stringify(settings),
    }),

  testTeams: (chat_type: 'director' | 'daily', custom_message?: string): Promise<TestTeamsResponse> =>
    fetchJson<TestTeamsResponse>(`${API_BASE}/settings/test-teams`, {
      method: 'POST',
      body: JSON.stringify({ chat_type, custom_message }),
    }),

  parseCurl: (curl_command: string): Promise<ParseCurlResponse> =>
    fetchJson<ParseCurlResponse>(`${API_BASE}/settings/parse-curl`, {
      method: 'POST',
      body: JSON.stringify({ curl_command }),
    }),

  getTeamsChats: (): Promise<{ success: boolean; chats: import('../types').TeamsChat[] }> =>
    fetchJson(`${API_BASE}/teams/chats`),

  getBrowserStatus: (): Promise<{ success: boolean; has_profile: boolean }> =>
    fetchJson(`${API_BASE}/auth/browser-status`),

  browserLogin: (): Promise<{ success: boolean; message: string; token_info?: any }> =>
    fetchJson(`${API_BASE}/auth/browser-login`, { method: 'POST' }),

  browserRefresh: (): Promise<{ success: boolean; message: string; token_info?: any }> =>
    fetchJson(`${API_BASE}/auth/browser-refresh`, { method: 'POST' }),

  login: (username: string, password: string): Promise<LoginResponse> =>
    fetchJson<LoginResponse>(`${API_BASE}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  getMe: (): Promise<{ success: boolean; user: AuthUser }> =>
    fetchJson(`${API_BASE}/auth/me`),

  logout: () => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    window.dispatchEvent(new Event('itco_unauthorized'));
  },
};
