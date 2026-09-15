import { useEffect } from 'react';
import { Shift } from '../types';

function parseShiftHours(start?: string | null, end?: string | null): number {
  if (!start || !end) return 8.0;
  try {
    const [sh, sm, ss] = start.split(':').map(Number);
    const [eh, em, es] = end.split(':').map(Number);
    const s = (sh || 0) * 3600 + (sm || 0) * 60 + (ss || 0);
    const e = (eh || 0) * 3600 + (em || 0) * 60 + (es || 0);
    let diff = e - s;
    if (diff < 0) diff += 24 * 3600;
    return Math.round((diff / 3600) * 10) / 10;
  } catch {
    return 8.0;
  }
}

export function useDynamicTitle(shift: Shift | null, shiftRate: number = 1667.0) {
  useEffect(() => {
    if (!shift || shift.status === 'not_started') {
      document.title = 'ITCO Dashboard';
      return;
    }

    const secondRate = shiftRate / 28800.0;
    const hourlyRate = shiftRate / 8.0;

    if (shift.status === 'completed') {
      const hours = parseShiftHours(shift.start_time, shift.end_time);
      const earned = hours * hourlyRate;
      const whole = Math.floor(earned).toLocaleString('ru-RU');
      const cents = (earned % 1).toFixed(2).slice(2);
      document.title = `[Завершена | +${whole}.${cents} ₽] ITCO Dashboard`;
      return;
    }

    if (shift.status === 'in_progress' && shift.start_time) {
      const parts = shift.start_time.split(':').map(Number);
      const sh = parts[0] ?? 10;
      const sm = parts[1] ?? 0;
      const ss = parts[2] ?? 0;

      const startDate = new Date();
      startDate.setHours(sh, sm, ss, 0);

      const updateTitle = () => {
        const now = new Date();
        const diff = Math.max(0, now.getTime() - startDate.getTime());

        const totalSeconds = Math.floor(diff / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const tenths = Math.floor((diff % 1000) / 100);

        const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;

        const todayEarned = (diff / 1000) * secondRate;
        const whole = Math.floor(todayEarned).toLocaleString('ru-RU');
        const cents = (todayEarned % 1).toFixed(2).slice(2);
        const todayMoneyStr = `+${whole}.${cents} ₽`;

        document.title = `[${timeStr} | ${todayMoneyStr}] ITCO Dashboard`;
      };

      updateTitle();
      const interval = setInterval(updateTitle, 100);

      return () => {
        clearInterval(interval);
        document.title = 'ITCO Dashboard';
      };
    }
  }, [shift?.status, shift?.start_time, shift?.end_time, shiftRate]);
}
