import React from 'react';
import { ExternalLink, Paperclip, MessageSquare, Hexagon, Flag } from 'lucide-react';
import { TrackerIssue } from '../../types';
import { parseIssueAttachments } from './trackerConstants';

interface KanbanCardProps {
  issue: TrackerIssue;
  isUpdating: boolean;
  isDragging: boolean;
  userInitials: string;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onClick: () => void;
}

export const KanbanCard: React.FC<KanbanCardProps> = ({
  issue,
  isUpdating,
  isDragging,
  userInitials,
  onDragStart,
  onDragEnd,
  onClick,
}) => {
  const attachments = parseIssueAttachments(issue);
  const hasAttachments = attachments.length > 0 || !!(issue.attachments_count && issue.attachments_count > 0);
  const hasComments = !!(issue.comments_count && issue.comments_count > 0);

  const hasValidComponent =
    issue.component &&
    issue.component.trim() !== '' &&
    issue.component.trim().toLowerCase() !== 'no component';

  const hasTags = hasValidComponent || !!issue.milestone || !!issue.is_bug;

  return (
    <div
      draggable={true}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`group bg-white rounded-xl border p-4 shadow-2xs hover:border-blue-400 hover:shadow-xs transition-all cursor-grab active:cursor-grabbing flex flex-col justify-between h-[156px] min-h-[156px] max-h-[156px] select-none ${
        isDragging
          ? 'opacity-40 scale-95 border-blue-400 ring-2 ring-blue-400/40'
          : isUpdating
          ? 'border-blue-500 ring-2 ring-blue-500/20 opacity-70'
          : 'border-slate-200/80'
      }`}
    >
      {/* Top & Middle Content */}
      <div className="space-y-2 overflow-hidden">
        {/* Top Row: Larger Bold Task Key + External Link + Assignee */}
        <div className="flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-mono text-sm font-bold tracking-tight text-slate-900 group-hover:text-blue-600 transition-colors">
              {issue.key}
            </span>
            <a
              href={`https://tracker.itco.su/workbench/itco/tracker/${encodeURIComponent(issue.key)}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-slate-400 hover:text-blue-600 transition-colors p-0.5"
              title="Открыть в ITCO Tracker"
            >
              <ExternalLink className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100" />
            </a>
          </div>

          <div
            className="w-5 h-5 rounded-md bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center relative select-none shrink-0"
            title={`Назначено: ${issue.assignee || 'vepishin@it-co.ru'}`}
          >
            <span>{userInitials}</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 absolute -bottom-0.5 -right-0.5 ring-1 ring-white" />
          </div>
        </div>

        {/* Task Title */}
        <h4 className="text-[13px] font-semibold text-slate-800 leading-snug line-clamp-2">
          {issue.title}
        </h4>

        {/* Tags Row */}
        {hasTags && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[10px]">
            {hasValidComponent && (
              <span className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200/70 text-slate-600 flex items-center gap-1 font-medium">
                <Hexagon className="w-2.5 h-2.5 opacity-60" />
                <span>{issue.component}</span>
              </span>
            )}
            {issue.milestone && (
              <span
                className="px-2 py-0.5 rounded-md bg-blue-50/80 border border-blue-100 text-blue-700 flex items-center gap-1 font-medium truncate max-w-[140px]"
                title={issue.milestone}
              >
                <Flag className="w-2.5 h-2.5 opacity-60" />
                <span>{issue.milestone}</span>
              </span>
            )}
            {issue.is_bug && (
              <span className="px-1.5 py-0.5 rounded-md bg-rose-50 text-rose-600 border border-rose-200 font-bold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                BUG
              </span>
            )}
          </div>
        )}
      </div>

      {/* Bottom Meta Bar */}
      <div className="flex items-center justify-between text-[11px] pt-2 border-t border-slate-100 shrink-0">
        <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
          {issue.project_name || issue.project_key || 'МКС'}
        </span>

        <div className="flex items-center gap-2.5 text-slate-400">
          {hasAttachments && (
            <span
              className="flex items-center gap-1 text-[10px] font-medium text-slate-500"
              title="Прикреплённые скриншоты и файлы"
            >
              <Paperclip className="w-3 h-3 text-blue-500" />
              <span className="tabular-nums font-mono">
                {attachments.length || issue.attachments_count}
              </span>
            </span>
          )}

          {hasComments && (
            <span className="flex items-center gap-1 text-[10px] text-slate-500">
              <MessageSquare className="w-3 h-3" />
              <span className="tabular-nums font-mono">{issue.comments_count}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
