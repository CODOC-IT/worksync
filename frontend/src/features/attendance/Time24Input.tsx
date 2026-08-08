import React, { useEffect, useRef, useState } from 'react';

// 24-hour (HH:mm) time input for the Attendance module.
//
// The browser's native <input type="time"> renders an AM/PM or otherwise
// locale-dependent picker (e.g. "04:12 AM" on en-US Chrome), which violates the
// Attendance UI requirement that every editable attendance time uses a 24-hour
// clock. This control is a plain masked text input that always displays/accepts
// "HH:mm" (00:00–23:59) with no AM/PM column, while preserving the exact string
// value contract the native input had ("" when cleared, otherwise "HH:mm").
//
// Behavior:
//   - typing digits auto-inserts the ':' after the hour pair;
//   - digits beyond HH:mm are dropped;
//   - ArrowUp / ArrowDown step the segment under the caret (hour 0-23 wrap,
//     minute 0-59 wrap);
//   - an incomplete draft is discarded on blur, resetting to the last valid value.

export const TIME24_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const isValid24hTime = (value: string): boolean => TIME24_PATTERN.test(value);

export const parse24hTime = (value: string): { hour: number; minute: number } | null => {
  if (!isValid24hTime(value)) return null;
  const [hour, minute] = value.split(':').map(Number);
  return { hour, minute };
};

export const format24hTime = (hour: number, minute: number): string =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

// Masks raw input into at most "HH:mm": keeps digits only and inserts the colon
// after the hour pair. Never shows or stores an AM/PM fragment.
export const normalize24hDraft = (raw: string): string => {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
};

export const isComplete24hTime = (draft: string): boolean => isValid24hTime(draft);

// Steps the segment under the caret. caret <= 2 edits the hour, otherwise the
// minute; both wrap (hour 0-23, minute 0-59) and an empty draft starts at 00:00.
export const adjust24hDraft = (draft: string, caret: number, delta: number): string => {
  const [rawHour = '', rawMinute = ''] = (draft || '').split(':');
  const hour = rawHour === '' ? 0 : Math.max(0, Math.min(23, Number(rawHour) || 0));
  const minute = rawMinute === '' ? 0 : Math.max(0, Math.min(59, Number(rawMinute) || 0));
  if (caret <= 2) {
    return format24hTime((hour + delta + 24) % 24, minute);
  }
  return format24hTime(hour, (minute + delta + 60) % 60);
};

export interface AttendanceTimeInputProps {
  value?: string;
  onChange: (value: string) => void;
  className?: string;
  'aria-label'?: string;
}

/**
 * Custom 24-hour (HH:mm) attendance time control. Never renders an AM/PM picker.
 */
export const AttendanceTimeInput: React.FC<AttendanceTimeInputProps> = ({
  value,
  onChange,
  className = '',
  'aria-label': ariaLabel
}) => {
  const [draft, setDraft] = useState<string>(() =>
    value && isValid24hTime(value) ? value : ''
  );
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focused) return;
    setDraft(value && isValid24hTime(value) ? value : '');
  }, [value, focused]);

  const commitDraft = (nextDraft: string) => {
    setDraft(nextDraft);
    if (nextDraft === '') {
      onChange('');
    } else if (isValid24hTime(nextDraft)) {
      onChange(nextDraft);
    }
  };

  const handleBlur = () => {
    setFocused(false);
    if (draft && !isValid24hTime(draft)) {
      setDraft(value && isValid24hTime(value) ? value : '');
    }
  };

  // Step the segment under the caret (hour when caret <= 2, minute otherwise).
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const caret = event.currentTarget.selectionStart ?? draft.length;
    commitDraft(adjust24hDraft(draft, caret, event.key === 'ArrowUp' ? 1 : -1));
  };

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      maxLength={5}
      placeholder="HH:mm"
      aria-label={ariaLabel}
      value={draft}
      onFocus={(event) => {
        setFocused(true);
        event.currentTarget.select();
      }}
      onBlur={handleBlur}
      onChange={(event) => commitDraft(normalize24hDraft(event.target.value))}
      onKeyDown={handleKeyDown}
      className={className || 'w-full px-3 py-2 rounded-lg bg-slate-950/70 border border-white/10 text-xs text-white focus:outline-none focus:border-cyan-500/50'}
      data-24h-time-input
    />
  );
};

export default AttendanceTimeInput;