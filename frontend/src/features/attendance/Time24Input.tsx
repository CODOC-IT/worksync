import React, { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';

// 24-hour (HH:mm) time input with picker for the Attendance module.
//
// The browser's native <input type="time"> renders an AM/PM or otherwise
// locale-dependent picker (e.g. "04:12 AM" on en-US Chrome), which violates the
// Attendance UI requirement that every editable attendance time uses a 24-hour
// clock. This control is a masked text input that always displays/accepts
// "HH:mm" (00:00–23:59) with no AM/PM column, preserving the exact string value
// contract the native input had ("" when cleared, otherwise "HH:mm").
//
// A visible clock icon/button on the right side of the field opens a custom
// 24-hour picker (Hour 00–23, Minute 00–59 — no AM/PM column). Typing is still
// fully supported:
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

export const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => hour);
export const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, minute) => minute);

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
 * Custom 24-hour (HH:mm) attendance time control with an explicit clock trigger
 * and popover picker. Never renders an AM/PM column.
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focused) return;
    setDraft(value && isValid24hTime(value) ? value : '');
  }, [value, focused]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onMouseDownOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPickerOpen(false);
    };
    document.addEventListener('mousedown', onMouseDownOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDownOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [pickerOpen]);

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
    if (event.key === 'Escape') {
      setPickerOpen(false);
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const caret = event.currentTarget.selectionStart ?? draft.length;
      commitDraft(adjust24hDraft(draft, caret, event.key === 'ArrowUp' ? 1 : -1));
    }
  };

  const parsed = parse24hTime(draft);
  const selectedHour = parsed ? parsed.hour : 0;
  const selectedMinute = parsed ? parsed.minute : 0;

  const defaultClass =
    'w-full px-3 py-2 rounded-lg bg-slate-950/70 border border-white/10 text-xs text-white focus:outline-none focus:border-cyan-500/50';

  return (
    <div
      ref={rootRef}
      className="relative"
      data-24h-time-input
    >
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        maxLength={5}
        placeholder="HH:mm"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={pickerOpen}
        value={draft}
        onFocus={(event) => {
          setFocused(true);
          event.currentTarget.select();
        }}
        onBlur={handleBlur}
        onChange={(event) => commitDraft(normalize24hDraft(event.target.value))}
        onKeyDown={handleKeyDown}
        className={`${className || defaultClass} ${'pr-9'}`}
      />
      <button
        type="button"
        aria-label="Open 24-hour time picker"
        aria-haspopup="dialog"
        aria-expanded={pickerOpen}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setFocused(false);
          setPickerOpen((open) => !open);
        }}
        className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center rounded-md p-1.5 text-slate-400 transition-colors hover:text-cyan-300 focus:outline-none focus:text-cyan-300"
      >
        <Clock size={14} />
      </button>

      {pickerOpen && (
        <div
          role="dialog"
          aria-label="24-hour time picker"
          className="absolute right-0 top-full z-50 mt-1.5 w-72 rounded-xl border border-white/10 bg-slate-950/95 p-3 shadow-2xl backdrop-blur-sm"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-300">
              24-Hour Time
            </span>
            <span className="rounded-md bg-cyan-500/15 px-2 py-0.5 font-mono text-xs font-bold text-cyan-300">
              {draft || '--:--'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Hour
              </p>
              <div className="max-h-48 space-y-0.5 overflow-y-auto pr-1">
                {HOUR_OPTIONS.map((hour) => {
                  const label = String(hour).padStart(2, '0');
                  const active = parsed && parsed.hour === hour;
                  return (
                    <button
                      key={hour}
                      type="button"
                      onClick={() => commitDraft(format24hTime(hour, selectedMinute))}
                      className={`block w-full rounded-md px-2 py-1 text-left font-mono text-[11px] transition-colors ${
                        active
                          ? 'bg-cyan-500/25 text-cyan-200 font-bold'
                          : 'text-slate-300 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Minute
              </p>
              <div className="max-h-48 space-y-0.5 overflow-y-auto pr-1">
                {MINUTE_OPTIONS.map((minute) => {
                  const label = String(minute).padStart(2, '0');
                  const active = parsed && parsed.minute === minute;
                  return (
                    <button
                      key={minute}
                      type="button"
                      onClick={() => commitDraft(format24hTime(selectedHour, minute))}
                      className={`block w-full rounded-md px-2 py-1 text-left font-mono text-[11px] transition-colors ${
                        active
                          ? 'bg-cyan-500/25 text-cyan-200 font-bold'
                          : 'text-slate-300 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <p className="mt-2 text-center text-[10px] text-slate-500">
            Hour {String(selectedHour).padStart(2, '0')} · Minute {String(selectedMinute).padStart(2, '0')}
          </p>
        </div>
      )}
    </div>
  );
};

export default AttendanceTimeInput;