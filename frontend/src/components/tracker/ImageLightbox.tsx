import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ImageLightboxProps {
  imageUrl: string | null;
  onClose: () => void;
}

export const ImageLightbox: React.FC<ImageLightboxProps> = ({ imageUrl, onClose }) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!imageUrl) return null;

  return (
    <div
      className="fixed inset-0 z-60 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div className="relative max-w-5xl max-h-[90vh] flex flex-col items-center">
        <button
          onClick={onClose}
          className="absolute -top-10 right-0 text-white/80 hover:text-white p-1 rounded-lg cursor-pointer transition-colors"
          title="Закрыть (Esc)"
        >
          <X className="w-6 h-6" />
        </button>
        <img
          src={imageUrl}
          alt="Увеличенный скриншот"
          onClick={(e) => e.stopPropagation()}
          className="max-w-full max-h-[85vh] object-contain rounded-2xl shadow-2xl border border-white/10"
        />
      </div>
    </div>
  );
};
