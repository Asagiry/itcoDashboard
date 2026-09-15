import {
  Circle,
  Clock,
  FlaskConical,
  CheckCircle2
} from 'lucide-react';
import { TrackerIssue, TrackerStatus } from '../../types';

export interface ColumnDef {
  key: TrackerStatus;
  title: string;
  dotColor: string;
  pillBg: string;
  pillText: string;
  icon: any;
}

export const TRACKER_COLUMNS: ColumnDef[] = [
  {
    key: 'todo',
    title: 'Todo',
    dotColor: 'bg-slate-400',
    pillBg: 'bg-slate-100 text-slate-700',
    pillText: 'text-slate-700',
    icon: Circle,
  },
  {
    key: 'in_progress',
    title: 'In progress',
    dotColor: 'bg-blue-500',
    pillBg: 'bg-blue-50 text-blue-800 border border-blue-200/60',
    pillText: 'text-blue-800',
    icon: Clock,
  },
  {
    key: 'review',
    title: 'review',
    dotColor: 'bg-purple-500',
    pillBg: 'bg-purple-50 text-purple-900 border border-purple-200/50',
    pillText: 'text-purple-900',
    icon: Clock,
  },
  {
    key: 'ready_for_testing',
    title: 'ready for testing',
    dotColor: 'bg-indigo-500',
    pillBg: 'bg-indigo-50 text-indigo-900 border border-indigo-200/60',
    pillText: 'text-indigo-900',
    icon: FlaskConical,
  },
  {
    key: 'testing',
    title: 'Testing',
    dotColor: 'bg-amber-500',
    pillBg: 'bg-amber-50 text-amber-900 border border-amber-200/60',
    pillText: 'text-amber-900',
    icon: Clock,
  },
  {
    key: 'ready_to_merge',
    title: 'Ready for merge',
    dotColor: 'bg-emerald-500',
    pillBg: 'bg-emerald-50 text-emerald-900 border border-emerald-200/60',
    pillText: 'text-emerald-900',
    icon: CheckCircle2,
  },
];

export const parseIssueAttachments = (issue: TrackerIssue): string[] => {
  if (issue.attachments && Array.isArray(issue.attachments) && issue.attachments.length > 0) {
    return issue.attachments;
  }
  if (issue.attachments_json) {
    try {
      const parsed = JSON.parse(issue.attachments_json);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {}
  }
  return [];
};
