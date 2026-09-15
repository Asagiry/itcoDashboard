import React, { useState, useEffect } from 'react';
import { X, ExternalLink, Image as ImageIcon, ZoomIn } from 'lucide-react';
import { TrackerIssue, TrackerStatus } from '../../types';
import { api } from '../../api/client';
import { TRACKER_COLUMNS, parseIssueAttachments } from './trackerConstants';

interface TaskDetailModalProps {
  issue: TrackerIssue | null;
  updatingIssueKey: string | null;
  onClose: () => void;
  onStatusChange: (key: string, status: TrackerStatus) => void;
  onPreviewImage: (url: string) => void;
}

const renderInlineText = (text: string) => {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, pIdx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={pIdx} className="font-semibold text-slate-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={pIdx}>{part}</span>;
  });
};

const DescriptionRenderer: React.FC<{ content: string; onPreviewImage: (url: string) => void }> = ({
  content,
  onPreviewImage,
}) => {
  const paragraphs = content.split(/\n{2,}/);

  return (
    <div className="text-sm text-slate-700 space-y-4 leading-relaxed font-normal">
      {paragraphs.map((para, pIdx) => {
        const trimmed = para.trim();
        if (!trimmed) return null;

        const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
        const hasListOrImages = lines.some((l) => /^(\d+\.|[-*•]|!\[)/.test(l));

        if (hasListOrImages) {
          return (
            <div key={pIdx} className="space-y-1.5 my-1">
              {lines.map((line, lIdx) => {
                const imgMatch = line.match(/^!\[(.*?)\]\((.*?)\)$/);
                if (imgMatch) {
                  const alt = imgMatch[1] || 'Скриншот';
                  const src = imgMatch[2];
                  return (
                    <div key={lIdx} className="my-3">
                      <div
                        onClick={() => onPreviewImage(src)}
                        className="group relative inline-block max-w-full rounded-xl border border-slate-200 bg-slate-50/70 overflow-hidden shadow-2xs hover:border-blue-400 hover:shadow-md transition-all cursor-pointer"
                      >
                        <img
                          src={src}
                          alt={alt}
                          className="max-h-80 max-w-full object-contain rounded-lg p-1.5"
                          loading="lazy"
                        />
                        <div className="absolute inset-0 bg-slate-900/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 text-white text-xs font-semibold backdrop-blur-2xs">
                          <ZoomIn className="w-4 h-4" />
                          <span>Увеличить скриншот</span>
                        </div>
                      </div>
                    </div>
                  );
                }

                // Numbered list
                const numMatch = line.match(/^(\d+\.)\s+(.*)$/);
                if (numMatch) {
                  return (
                    <div key={lIdx} className="flex items-start gap-2.5 pl-1 text-slate-800">
                      <span className="font-semibold text-slate-500 tabular-nums shrink-0">{numMatch[1]}</span>
                      <span className="flex-1">{renderInlineText(numMatch[2])}</span>
                    </div>
                  );
                }

                // Bullet list
                if (/^[-*•]\s+/.test(line)) {
                  const text = line.replace(/^[-*•]\s+/, '');
                  return (
                    <div key={lIdx} className="flex items-start gap-2.5 pl-2 text-slate-800">
                      <span className="text-slate-400 font-bold shrink-0 select-none">•</span>
                      <span className="flex-1">{renderInlineText(text)}</span>
                    </div>
                  );
                }

                return (
                  <p key={lIdx} className="text-slate-800">
                    {renderInlineText(line)}
                  </p>
                );
              })}
            </div>
          );
        }

        return (
          <p key={pIdx} className="text-slate-800 leading-relaxed">
            {renderInlineText(trimmed)}
          </p>
        );
      })}
    </div>
  );
};

export const TaskDetailModal: React.FC<TaskDetailModalProps> = ({
  issue: initialIssue,
  updatingIssueKey,
  onClose,
  onStatusChange,
  onPreviewImage,
}) => {
  const [currentIssue, setCurrentIssue] = useState<TrackerIssue | null>(initialIssue);

  useEffect(() => {
    setCurrentIssue(initialIssue);
    if (initialIssue?.key) {
      api.getTrackerIssue(initialIssue.key)
        .then((fresh) => {
          if (fresh) setCurrentIssue(fresh);
        })
        .catch(() => {});
    }
  }, [initialIssue?.key]);

  const issue = currentIssue || initialIssue;
  if (!issue) return null;

  const attachments = parseIssueAttachments(issue);
  const curCol = TRACKER_COLUMNS.find((c) => c.key === issue.status) || TRACKER_COLUMNS[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/40 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-[880px] max-w-[94vw] h-[680px] max-h-[88vh] bg-white rounded-2xl shadow-2xl border border-slate-200/90 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Bar */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white">
          <div className="flex items-center gap-4">
            <button
              onClick={onClose}
              className="p-1.5 -ml-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              title="Закрыть"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Breadcrumb: [Red Icon] МКС > МКС-189 */}
            <div className="flex items-center gap-2 text-xs font-semibold">
              <div className="w-4 h-4 rounded-xs bg-[#e11d48] text-white flex items-center justify-center text-[9px] shadow-2xs font-bold">
                ⬡
              </div>
              <span className="text-slate-600">{issue.project_name || issue.project_key || 'МКС'}</span>
              <span className="text-slate-400 font-normal">›</span>
              <span className="font-mono text-slate-800 font-bold">{issue.key}</span>
            </div>
          </div>

          {/* Status Badge */}
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${curCol.pillBg}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${curCol.dotColor}`} />
            {curCol.title}
          </span>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-8 sm:p-10 space-y-7">
          {/* Title */}
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 leading-snug tracking-tight">
            {issue.title}
          </h2>

          {/* Description */}
          {issue.description && issue.description.trim() ? (
            <DescriptionRenderer content={issue.description} onPreviewImage={onPreviewImage} />
          ) : (
            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200/70 text-slate-600 space-y-3">
              <p className="text-xs leading-relaxed">
                Текст задачи и чек-листы синхронизируются из рабочего пространства Huly.
              </p>
              <a
                href={`https://tracker.itco.su/workbench/itco/tracker/${encodeURIComponent(issue.key)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-800 font-semibold text-xs"
              >
                <span>Открыть карточку в Huly Tracker</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}

          {/* Attachments Gallery */}
          {attachments.length > 0 && (
            <div className="pt-4 border-t border-slate-100 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                <ImageIcon className="w-4 h-4 text-blue-600" />
                <span>Прикрепленные скриншоты и изображения ({attachments.length})</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {attachments.map((imgUrl, idx) => (
                  <div
                    key={idx}
                    onClick={() => onPreviewImage(imgUrl)}
                    className="group relative bg-slate-50 border border-slate-200 rounded-xl overflow-hidden hover:border-blue-400 hover:shadow-md transition-all cursor-pointer flex flex-col items-center justify-center max-h-64"
                  >
                    <img
                      src={imgUrl}
                      alt={`Скриншот ${idx + 1}`}
                      className="w-full h-full max-h-56 object-contain p-2 rounded-lg"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-slate-900/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 text-white text-xs font-semibold backdrop-blur-2xs">
                      <ZoomIn className="w-4 h-4" />
                      <span>Увеличить скриншот</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/80 flex items-center justify-between shrink-0">
          <a
            href={`https://tracker.itco.su/workbench/itco/tracker/${encodeURIComponent(issue.key)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs"
          >
            <span>Открыть в Huly Tracker</span>
            <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
          </a>

          {/* Status buttons */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl p-1 shadow-2xs">
              <span className="text-[11px] text-slate-400 px-2 font-medium">Перевести:</span>
              {TRACKER_COLUMNS.map((c) => {
                const isCurrent = c.key === issue.status;
                return (
                  <button
                    key={c.key}
                    onClick={() => onStatusChange(issue.key, c.key)}
                    disabled={isCurrent || updatingIssueKey === issue.key}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                      isCurrent
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    } disabled:cursor-default`}
                  >
                    {c.title}
                  </button>
                );
              })}
            </div>

            <button
              onClick={onClose}
              className="px-4 py-2 border border-slate-200 hover:bg-white text-slate-700 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
            >
              Закрыть
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
