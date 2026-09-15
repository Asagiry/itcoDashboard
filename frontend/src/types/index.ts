export type ShiftStatus = 'not_started' | 'in_progress' | 'completed';
export type ReportStatus = 'not_scheduled' | 'scheduled' | 'sending' | 'sent' | 'failed';

export interface Shift {
  id?: number;
  date: string;
  start_time: string | null;
  end_time: string | null;
  status: ShiftStatus;
  daily_report: string;
  raw_response_start?: string | null;
  raw_response_end?: string | null;
  report_status?: ReportStatus;
  report_scheduled_at?: string | null;
  report_sent_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface AppSettings {
  director_chat_url: string;
  director_message_template: string;
  daily_chat_url: string;
  auth_token: string;
  auth_header_name: string;
  custom_headers: string;
  token_info?: {
    has_token: boolean;
    is_jwt?: boolean;
    is_expired?: boolean;
    remaining_seconds?: number | null;
    expires_at?: string | null;
    issued_at?: string | null;
    skypeid?: string | null;
  };
  has_browser_profile?: boolean;
  auto_refresh_active?: boolean;
  account_name?: string;
  account_status?: 'active' | 'inactive';
  last_login_at?: string | null;
}

export interface StartShiftResponse {
  success: boolean;
  shift: Shift;
  message: string;
  teams_status_code?: number;
  teams_response?: string;
}

export interface EndShiftResponse {
  success: boolean;
  shift: Shift;
  message: string;
  teams_status_code?: number;
  teams_response?: string;
}

export interface TestTeamsResponse {
  success: boolean;
  status_code: number;
  url: string;
  response_body: string;
  error?: string | null;
}

export interface ParseCurlResponse {
  success: boolean;
  url?: string;
  auth_header_name?: string;
  auth_token?: string;
  headers: Record<string, string>;
  error?: string | null;
}

export interface TeamsChat {
  id: string;
  title: string;
  url: string;
  preview?: string;
}

export type NavTab = 'shift' | 'history' | 'excel' | 'settings';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  message?: string;
}

export interface SalaryStats {
  monthly_rate: number;
  shift_rate: number;
  hourly_rate: number;
  minute_rate: number;
  month_name: string;
  month_prefix: string;
  completed_shifts_count: number;
  completed_hours_total: number;
  completed_earned_total: number;
  today_minutes_worked: number;
  today_earned_live: number;
  total_month_earned_live: number;
  progress_percent: number;
  today_shift: Shift | null;
}

export interface AuthUser {
  username: string;
  name: string;
}

export interface LoginResponse {
  success: boolean;
  token: string;
  user: AuthUser;
}

