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
  const [selectedIssue, setSelectedIssue] = useState<TrackerIssue | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<TrackerStatus | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  const pendingUpdatesRef = React.useRef<Map<string, TrackerStatus>>(new Map());

  const applyIssuesWithPending = (incoming: TrackerIssue[]) => {
    return incoming.map((iss) => {
      const pending = pendingUpdatesRef.current.get(iss.key);
      return pending ? { ...iss, status: pending } : iss;
    });
  };

  const loadData = async () => {
    setIsLoading(true);
    try {
      const statusRes = await api.getTrackerStatus();
      setAuthStatus(statusRes);

      const issRes = await api.getTrackerIssues();
      const merged = applyIssuesWithPending(issRes || []);
      setIssues(merged);
      if (onIssuesUpdated) onIssuesUpdated(merged);
    } catch (err: any) {
      console.error('Error loading tracker data:', err);
      showToast('error', 'Ошибка загрузки трекера', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    // 1. Auto-sync silently on window focus
    const handleFocus = () => {
      api.syncTracker()
        .then((res) => {
          if (res && res.issues) {
            const merged = applyIssuesWithPending(res.issues);
            setIssues(merged);
            if (onIssuesUpdated) onIssuesUpdated(merged);
          }
        })
        .catch(() => {});
    };

    window.addEventListener('focus', handleFocus);

    // 2. Periodic background live polling every 12 seconds
    const interval = setInterval(() => {
      if (!document.hidden) {
        api.syncTracker()
          .then((res) => {
            if (res && res.issues) {
              const merged = applyIssuesWithPending(res.issues);
              setIssues(merged);
              if (onIssuesUpdated) onIssuesUpdated(merged);
            }
          })
          .catch(() => {});
      }
    }, 12000);

    return () => {
      window.removeEventListener('focus', handleFocus);
      clearInterval(interval);
    };
  }, []);

  const handleStatusChange = async (issueKey: string, targetStatus: TrackerStatus) => {
    const issueToUpdate = issues.find((i) => i.key === issueKey);
    if (!issueToUpdate || issueToUpdate.status === targetStatus) return;

    // Track optimistic pending change
    pendingUpdatesRef.current.set(issueKey, targetStatus);

    // Optimistic UI update - instant move
    const prevIssues = [...issues];
    const updatedIssues = issues.map((i) =>
      i.key === issueKey ? { ...i, status: targetStatus } : i
    );
    setIssues(updatedIssues);
    if (onIssuesUpdated) onIssuesUpdated(updatedIssues);
    if (selectedIssue && selectedIssue.key === issueKey) {
      setSelectedIssue({ ...selectedIssue, status: targetStatus });
    }

    try {
      const res = await api.updateTrackerIssueStatus(issueKey, targetStatus);
      if (res.success) {
        showToast('success', 'Статус обновлен', res.message);
      } else {
        pendingUpdatesRef.current.delete(issueKey);
        setIssues(prevIssues);
        if (onIssuesUpdated) onIssuesUpdated(prevIssues);
        showToast('error', 'Не удалось изменить статус', res.message);
      }
    } catch (err: any) {
      pendingUpdatesRef.current.delete(issueKey);
      setIssues(prevIssues);
      if (onIssuesUpdated) onIssuesUpdated(prevIssues);
      showToast('error', 'Ошибка смены статуса', err.message);
    } finally {
      setTimeout(() => {
        pendingUpdatesRef.current.delete(issueKey);
      }, 3500);
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
    <div className="flex-1 flex flex-col h-full p-4 sm:p-5 overflow-hidden">
      {/* Kanban Board with Drag & Drop */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden pb-1">
        <div className="flex gap-3.5 items-stretch w-full h-full min-w-0">
          {TRACKER_COLUMNS.map((col) => {
            const colIssues = issues.filter(
              (i) => i.status === col.key || (col.key === 'ready_for_testing' && (i.status as string) === 'testing')
            );
            const isDragOver = dragOverCol === col.key;

            return (
              <KanbanColumn
                key={col.key}
                column={col}
                issues={colIssues}
                isDragOver={isDragOver}
                draggingKey={draggingKey}
                updatingIssueKey={null}
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
        updatingIssueKey={null}
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
