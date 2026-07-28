import React from 'react';
import { CalendarEntry, CalendarYearMonth, toDateKey } from './calendarRules';

export const YearGrid: React.FC<{
  months: CalendarYearMonth[];
  entriesByDate: Map<string, CalendarEntry[]>;
  todayKey: string;
  onSelectMonth: (month: number) => void;
}> = ({ months, entriesByDate, todayKey, onSelectMonth }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
    {months.map(({ month, label, dates }) => {
      const monthEntryCount = dates
        .filter((date) => date.getMonth() === month)
        .reduce((count, date) => count + (entriesByDate.get(toDateKey(date))?.length || 0), 0);

      return (
        <div
          key={month}
          onClick={() => onSelectMonth(month)}
          className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-slate-900/40 p-4 cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-slate-900/60"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-white">{label}</h3>
            {monthEntryCount > 0 && (
              <span className="text-[10px] font-mono text-cyan-400">
                {monthEntryCount} item{monthEntryCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {dates.map((date) => {
              const dateKey = toDateKey(date);
              const isCurrentMonth = date.getMonth() === month;
              const hasEntries = isCurrentMonth && (entriesByDate.get(dateKey)?.length || 0) > 0;
              const isToday = dateKey === todayKey;

              return (
                <div
                  key={dateKey}
                  className={`aspect-square rounded-sm flex flex-col items-center justify-center gap-0.5 text-[7px] font-mono ${
                    isToday ? 'bg-cyan-500/30 text-cyan-200 font-bold' : isCurrentMonth ? 'text-slate-500' : 'text-slate-800'
                  }`}
                >
                  <span>{isCurrentMonth ? date.getDate() : ''}</span>
                  {hasEntries && <span className="w-1 h-1 rounded-full bg-cyan-400" />}
                </div>
              );
            })}
          </div>
        </div>
      );
    })}
  </div>
);
