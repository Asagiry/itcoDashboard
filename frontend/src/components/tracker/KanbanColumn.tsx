import React from 'react';
import { TrackerIssue } from '../../types';
import { ColumnDef } from './trackerConstants';
import { KanbanCard } from './KanbanCard';

interface KanbanColumnProps {
  column: ColumnDef;
  issues: TrackerIssue[];
  isDragOver: boolean;
  draggingKey: string | null;
  updatingIssueKey: string | null;
  userInitials: string;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnter: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onCardDragStart: (key: string, e: React.DragEvent) => void;
  onCardDragEnd: () => void;
  onCardClick: (issue: TrackerIssue) => void;
}

export const KanbanColumn: React.FC<KanbanColumnProps> = ({
  column,
  issues,
  isDragOver,
  draggingKey,
  updatingIssueKey,
  userInitials,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
  onCardDragStart,
  onCardDragEnd,
  onCardClick,
}) => {
  return (
    <div
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`w-[295px] min-w-[295px] max-w-[295px] rounded-2xl p-3 border flex flex-col flex-shrink-0 h-full max-h-[calc(100vh-42px)] transition-all ${
        isDragOver
          ? 'bg-blue-50/70 border-blue-400 ring-2 ring-blue-400/30 shadow-md'
          : 'bg-slate-100/60 border-slate-200/70 shadow-2xs'
      }`}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between px-1 mb-3 shrink-0 select-none">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${column.dotColor}`} />
          <span className="font-bold text-xs text-slate-800 tracking-tight">{column.title}</span>
        </div>
        <span className="px-2 py-0.5 rounded-full bg-white border border-slate-200/80 text-[11px] font-mono font-bold text-slate-600 shadow-2xs">
          {issues.length}
        </span>
      </div>

      {/* Cards List */}
      <div className="space-y-2.5 flex-1 overflow-y-auto pr-1 pb-2">
        {issues.length === 0 ? (
          <div
            className={`h-24 flex items-center justify-center border border-dashed rounded-xl transition-colors select-none ${
              isDragOver
                ? 'border-blue-400 bg-blue-100/40 text-blue-600 font-medium'
                : 'border-slate-200/90 bg-white/40 text-slate-400'
            }`}
          >
            <span className="text-[11px]">{isDragOver ? 'Перетащите сюда' : 'Нет задач'}</span>
          </div>
        ) : (
          issues.map((issue) => (
            <KanbanCard
              key={issue.id || issue.key}
              issue={issue}
              isUpdating={updatingIssueKey === issue.key}
              isDragging={draggingKey === issue.key}
              userInitials={userInitials}
              onDragStart={(e) => onCardDragStart(issue.key, e)}
              onDragEnd={onCardDragEnd}
              onClick={() => onCardClick(issue)}
            />
          ))
        )}
      </div>
    </div>
  );
};
