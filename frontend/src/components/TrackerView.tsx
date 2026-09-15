import React, { useState, useEffect, useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { TrackerIssue, TrackerStatus, TrackerAuthStatus } from '../types';
import { api } from '../api/client';
import { TRACKER_COLUMNS } from './tracker/trackerConstants';
import { KanbanColumn } from './tracker/KanbanColumn';
import { TaskDetailModal } from './tracker/TaskDetailModal';
import { ImageLightbox } from './tracker/ImageLightbox';

interface TrackerViewProps {
  showToast: (type: 'success' | 'error' | 'info', title: string, message?: string) => void;
  onIssuesUpdated?: (issues: TrackerIssue[]) => void;
}

export const TrackerView: React.FC<TrackerViewProps> = ({ showToast, onIssuesUpdated }) => {
  const [authStatus, setAuthStatus] = useState<TrackerAuthStatus | null>(null);
  const [issues, setIssues] = useState<TrackerIssue[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [updatingIssueKey, setUpdatingIssueKey] = useState<string | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<TrackerIssue | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<TrackerStatus | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const statusRes = await api.getTrackerStatus();
      setAuthStatus(statusRes);

      const issRes = await api.getTrackerIssues();
      setIssues(issRes || []);
      if (onIssuesUpdated) onIssuesUpdated(issRes || []);
    } catch (err: any) {
      console.error('Error loading tracker data:', err);
      showToast('error', 'Ошибка загрузки трекера', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleStatusChange = async (issueKey: string, targetStatus: TrackerStatus) => {
    const issueToUpdate = issues.find((i) => i.key === issueKey);
    if (!issueToUpdate || issueToUpdate.status === targetStatus) return;

    // Optimistic UI update
    const prevIssues = [...issues];
    const updatedIssues = issues.map((i) =>
      i.key === issueKey ? { ...i, status: targetStatus } : i
    );
    setIssues(updatedIssues);
    if (onIssuesUpdated) onIssuesUpdated(updatedIssues);
    if (selectedIssue && selectedIssue.key === issueKey) {
      setSelectedIssue({ ...selectedIssue, status: targetStatus });
    }

    setUpdatingIssueKey(issueKey);
    try {
      const res = await api.updateTrackerIssueStatus(issueKey, targetStatus);
      if (res.success && res.issue) {
        showToast('success', 'Статус обновлен', res.message);
      } else {
        setIssues(prevIssues);
        if (onIssuesUpdated) onIssuesUpdated(prevIssues);
        showToast('error', 'Не удалось изменить статус', res.message);
      }
    } catch (err: any) {
      setIssues(prevIssues);
      if (onIssuesUpdated) onIssuesUpdated(prevIssues);
      showToast('error', 'Ошибка смены статуса', err.message);
    } finally {
      setUpdatingIssueKey(null);
    }
  };

  const userInitials = useMemo(() => {
    if (authStatus?.account_name && authStatus.account_name.includes('@')) {
      const uname = authStatus.account_name.split('@')[0];
      if (uname.length >= 2) {
        return (uname[0] + uname[1]).toUpperCase();
      }
    }
    return 'VE';
  }, [authStatus]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <RefreshCw className="w-6 h-6 text-slate-400 animate-spin mx-auto" />
          <p className="text-xs text-slate-500 font-medium">Загрузка задач трекера...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full p-5 overflow-hidden">
      {/* Kanban Board with Drag & Drop */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden pb-2">
        <div className="flex gap-4 items-start min-w-max h-full">
          {TRACKER_COLUMNS.map((col) => {
            const colIssues = issues.filter((i) => i.status === col.key);
            const isDragOver = dragOverCol === col.key;

            return (
              <KanbanColumn
                key={col.key}
                column={col}
                issues={colIssues}
                isDragOver={isDragOver}
                draggingKey={draggingKey}
                updatingIssueKey={updatingIssueKey}
                userInitials={userInitials}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }}
                onDragEnter={(e) => {
                  e.preventDefault();
                  setDragOverCol(col.key);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    if (dragOverCol === col.key) setDragOverCol(null);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverCol(null);
                  const issueKey = e.dataTransfer.getData('text/plain');
                  if (issueKey) {
                    handleStatusChange(issueKey, col.key);
                  }
                }}
                onCardDragStart={(key, e) => {
                  e.dataTransfer.setData('text/plain', key);
                  e.dataTransfer.effectAllowed = 'move';
                  setDraggingKey(key);
                }}
                onCardDragEnd={() => {
                  setDraggingKey(null);
                  setDragOverCol(null);
                }}
                onCardClick={(issue) => setSelectedIssue(issue)}
              />
            );
          })}
        </div>
      </div>

      {/* Task Details Modal */}
      <TaskDetailModal
        issue={selectedIssue}
        updatingIssueKey={updatingIssueKey}
        onClose={() => setSelectedIssue(null)}
        onStatusChange={handleStatusChange}
        onPreviewImage={(url) => setPreviewImageUrl(url)}
      />

      {/* Fullscreen Lightbox */}
      <ImageLightbox
        imageUrl={previewImageUrl}
        onClose={() => setPreviewImageUrl(null)}
      />
    </div>
  );
};
export default TrackerView;
