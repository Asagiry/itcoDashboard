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
      className="fixed inset-0 z-[100] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div className="relative max-w-6xl max-h-[92vh] flex flex-col items-center">
        <button
          onClick={onClose}
          className="absolute -top-12 right-0 text-white/80 hover:text-white p-2 rounded-full bg-white/10 hover:bg-white/20 transition-all cursor-pointer shadow-lg backdrop-blur-xs"
          title="Закрыть (Esc)"
        >
          <X className="w-5 h-5" />
        </button>
        <img
          src={imageUrl}
          alt="Увеличенный скриншот"
          onClick={(e) => e.stopPropagation()}
          className="max-w-[92vw] max-h-[86vh] object-contain rounded-xl shadow-2xl border border-white/15 select-none"
        />
      </div>
    </div>
  );
};
