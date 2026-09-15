import React from 'react';
import { ExternalLink } from 'lucide-react';
import { TrackerIssue } from '../../types';

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
  return (
    <div
      draggable={true}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`group bg-white rounded-xl border p-4 shadow-2xs hover:border-blue-400 hover:shadow-xs transition-all cursor-grab active:cursor-grabbing flex flex-col justify-between min-h-[120px] select-none ${
        isDragging
          ? 'opacity-40 scale-95 border-blue-400 ring-2 ring-blue-400/40'
          : isUpdating
          ? 'border-blue-500 ring-2 ring-blue-500/20 opacity-70'
          : 'border-slate-200/80'
      }`}
    >
      {/* Top Row: Task Key + External Link + Assignee Avatar */}
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
          title={`Назначено мне: ${issue.assignee || 'vepishin@it-co.ru'}`}
        >
          <span>{userInitials}</span>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 absolute -bottom-0.5 -right-0.5 ring-1 ring-white" />
        </div>
      </div>

      {/* Task Title */}
      <h4 className="text-[13px] font-semibold text-slate-800 leading-snug line-clamp-3 my-2">
        {issue.title}
      </h4>

      {/* Bottom Meta Bar */}
      <div className="flex items-center justify-between text-[11px] pt-2 border-t border-slate-100 shrink-0">
        <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
          {issue.project_name || issue.project_key || 'МКС'}
        </span>
        <span className="text-[10px] text-slate-400 font-medium">
          {issue.assignee || 'vepishin@it-co.ru'}
        </span>
      </div>
    </div>
  );
};
