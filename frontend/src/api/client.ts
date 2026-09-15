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

  sendReportNow: (): Promise<EndShiftResponse> =>
    fetchJson<EndShiftResponse>(`${API_BASE}/shifts/send-report-now`, {
      method: 'POST',
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

  testTeams: (chat_type: 'self' | 'director' | 'daily' = 'self', custom_message?: string): Promise<TestTeamsResponse> =>
    fetchJson<TestTeamsResponse>(`${API_BASE}/settings/test-teams`, {
      method: 'POST',
      body: JSON.stringify({ chat_type, custom_message }),
    }),

  parseCurl: (curl_command: string): Promise<ParseCurlResponse> =>
    fetchJson<ParseCurlResponse>(`${API_BASE}/settings/parse-curl`, {
      method: 'POST',
      body: JSON.stringify({ curl_command }),
    }),

  getTeamsChats: (force: boolean = false): Promise<{ success: boolean; chats: import('../types').TeamsChat[] }> =>
    fetchJson(`${API_BASE}/teams/chats${force ? '?force=true' : ''}`),

  getBrowserStatus: (): Promise<{ success: boolean; has_profile: boolean }> =>
    fetchJson(`${API_BASE}/auth/browser-status`),

  browserLogin: (): Promise<{ success: boolean; message: string; token_info?: any }> =>
    fetchJson(`${API_BASE}/auth/browser-login`, { method: 'POST' }),

  browserRefresh: (): Promise<{ success: boolean; message: string; token_info?: any }> =>
    fetchJson(`${API_BASE}/auth/browser-refresh`, { method: 'POST' }),

  teamsEmailStart: (email: string): Promise<{ success: boolean; message: string; session_id?: string; stage?: string }> =>
    fetchJson(`${API_BASE}/auth/teams-email/start`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  teamsEmailSubmit: (session_id: string, code: string): Promise<{ success: boolean; message: string; token_info?: any }> =>
    fetchJson(`${API_BASE}/auth/teams-email/submit-code`, {
      method: 'POST',
      body: JSON.stringify({ session_id, code, remember_me: true }),
    }),

  teamsEmailCancel: (session_id: string): Promise<{ success: boolean; message: string }> =>
    fetchJson(`${API_BASE}/auth/teams-email/cancel`, {
      method: 'POST',
      body: JSON.stringify({ session_id }),
    }),

  teamsEmailClick: (session_id: string, texts: string[]): Promise<{ success: boolean; message: string; page?: any; token_info?: any }> =>
    fetchJson(`${API_BASE}/auth/teams-email/click`, {
      method: 'POST',
      body: JSON.stringify({ session_id, texts }),
    }),

  updateShift: (date: string, payload: { start_time?: string; end_time?: string; duration_hours?: number; daily_report?: string; status?: string }): Promise<{ success: boolean; message: string; shift: Shift }> =>
    fetchJson(`${API_BASE}/shifts/${date}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteShift: (date: string): Promise<{ success: boolean; message: string }> =>
    fetchJson(`${API_BASE}/shifts/${date}`, {
      method: 'DELETE',
    }),

  resetAllData: (): Promise<{ success: boolean; message: string }> =>
    fetchJson(`${API_BASE}/shifts/reset-all-data`, {
      method: 'POST',
    }),

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

  // --- Tracker API Methods ---

  getTrackerStatus: (): Promise<import('../types').TrackerAuthStatus> =>
    fetchJson<import('../types').TrackerAuthStatus>(`${API_BASE}/tracker/status`),

  trackerLogin: (): Promise<{ success: boolean; message: string; account_name?: string }> =>
    fetchJson(`${API_BASE}/tracker/login`, { method: 'POST' }),

  trackerPasswordLogin: (email: string, password: string): Promise<import('../types').TrackerLoginResult> =>
    fetchJson<import('../types').TrackerLoginResult>(`${API_BASE}/tracker/auth/password-login`, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  getTrackerLogs: (): Promise<{ success: boolean; logs: import('../types').TrackerLogItem[] }> =>
    fetchJson(`${API_BASE}/tracker/logs`),

  trackerCodeStart: (email: string): Promise<{ success: boolean; message: string; session_id?: string }> =>
    fetchJson(`${API_BASE}/tracker/auth/code-start`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  trackerCodeSubmit: (session_id: string, code: string): Promise<{ success: boolean; message: string; account_name?: string }> =>
    fetchJson(`${API_BASE}/tracker/auth/code-submit`, {
      method: 'POST',
      body: JSON.stringify({ session_id, code }),
    }),

  trackerLogout: (): Promise<{ success: boolean; message: string }> =>
    fetchJson(`${API_BASE}/tracker/logout`, { method: 'POST' }),


  getTrackerProjects: (): Promise<import('../types').TrackerProject[]> =>
    fetchJson<import('../types').TrackerProject[]>(`${API_BASE}/tracker/projects`),

  getTrackerIssues: (projectKey?: string, status?: string, search?: string): Promise<import('../types').TrackerIssue[]> => {
    const params = new URLSearchParams();
    if (projectKey && projectKey !== 'all') params.append('project_key', projectKey);
    if (status && status !== 'all') params.append('status', status);
    if (search && search.trim()) params.append('search', search.trim());
    const query = params.toString();
    return fetchJson<import('../types').TrackerIssue[]>(`${API_BASE}/tracker/issues${query ? `?${query}` : ''}`);
  },

  syncTracker: (): Promise<import('../types').TrackerSyncResponse> =>
    fetchJson<import('../types').TrackerSyncResponse>(`${API_BASE}/tracker/sync`, { method: 'POST' }),

  updateTrackerIssueStatus: (issueKey: string, status: import('../types').TrackerStatus): Promise<{ success: boolean; message: string; issue?: import('../types').TrackerIssue }> =>
    fetchJson(`${API_BASE}/tracker/issues/${encodeURIComponent(issueKey)}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),
};

