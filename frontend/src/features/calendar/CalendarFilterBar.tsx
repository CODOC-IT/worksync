import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { ALL_CALENDAR_KINDS, CalendarEntryKind, CalendarEntryOrigin, PersonalFilterKind, entryToneClasses } from './calendarRules';

type OriginFilter = 'all' | CalendarEntryOrigin;

const ORIGIN_OPTIONS: { value: OriginFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'project', label: 'Projects' },
  { value: 'task', label: 'Tasks' }
];

// 'My Led Projects' is inserted into this list only when the caller says the current user
// actually leads at least one project -- Team Lead is not a role, so this can't be a static list
// gated by currentRole the way ORIGIN_OPTIONS is.
const buildPersonalFilterOptions = (showLedProjectsFilter: boolean): PersonalFilterKind[] => [
  'My Assigned Tasks',
  'My Assigned Projects',
  ...(showLedProjectsFilter ? (['My Led Projects'] as const) : []),
  'My Deadlines'
];

interface CalendarFilterBarProps {
  originFilter: OriginFilter;
  onOriginFilterChange: (value: OriginFilter) => void;
  activeKinds: Set<CalendarEntryKind>;
  onActiveKindsChange: (kinds: Set<CalendarEntryKind>) => void;
  // Admin/HR never get any personal filter (full-visibility roles, "mine" has no meaning for
  // them); showLedProjectsFilter is separate because it depends on project.teamLeadId data, not
  // on currentRole, per this system's "Team Lead is not a role" data model.
  showPersonalFilters: boolean;
  showLedProjectsFilter: boolean;
  activePersonalFilters: Set<PersonalFilterKind>;
  onTogglePersonalFilter: (filter: PersonalFilterKind) => void;
}

export const CalendarFilterBar: React.FC<CalendarFilterBarProps> = ({
  originFilter,
  onOriginFilterChange,
  activeKinds,
  onActiveKindsChange,
  showPersonalFilters,
  showLedProjectsFilter,
  activePersonalFilters,
  onTogglePersonalFilter
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropdownOpen) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDropdownOpen(false);
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [dropdownOpen]);

  const allSelected = activeKinds.size === ALL_CALENDAR_KINDS.length;

  const toggleKind = (kind: CalendarEntryKind) => {
    const next = new Set(activeKinds);
    if (next.has(kind)) {
      next.delete(kind);
    } else {
      next.add(kind);
    }
    onActiveKindsChange(next);
  };

  const toggleAll = () => {
    onActiveKindsChange(allSelected ? new Set() : new Set(ALL_CALENDAR_KINDS));
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Project vs Task origin toggle */}
      <div className="flex items-center gap-1 p-1 rounded-xl border border-white/10 bg-slate-900/50">
        {ORIGIN_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onOriginFilterChange(option.value)}
            className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-xs font-semibold transition ${
              originFilter === option.value
                ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* Personal filters -- independent toggles (any combination may be active at once, same
          union semantics as the Kind checkboxes below), hidden entirely for Admin/HR. 'My Led
          Projects' is further gated on showLedProjectsFilter (whether this user leads at least
          one project) rather than any role, since Team Lead isn't a role in this system. */}
      {showPersonalFilters && (
        <div className="flex flex-wrap items-center gap-1.5">
          {buildPersonalFilterOptions(showLedProjectsFilter).map(
            (filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => onTogglePersonalFilter(filter)}
                className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-xl text-[10px] sm:text-xs font-semibold border transition ${
                  activePersonalFilters.has(filter)
                    ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border-white/10 bg-slate-900/50'
                }`}
              >
                {filter}
              </button>
            )
          )}
        </div>
      )}

      {/* Kind multi-select dropdown */}
      <div ref={containerRef} className="relative">
        <button
          type="button"
          onClick={() => setDropdownOpen((prev) => !prev)}
          className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-slate-900/50 px-2.5 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-semibold text-slate-300 hover:text-white hover:bg-white/5 transition"
        >
          <div className="flex items-center gap-1.5">
            {ALL_CALENDAR_KINDS.filter((kind) => activeKinds.has(kind)).map((kind) => (
              <span key={kind} className={`w-1.5 h-1.5 rounded-full ${entryToneClasses(kind).dotClass}`} />
            ))}
          </div>
          Kinds
          <ChevronDown size={12} className={`transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
        </button>

        {dropdownOpen && (
          <div className="absolute left-0 z-20 mt-2 w-48 rounded-xl border border-white/10 bg-slate-900/95 p-2 shadow-lg">
            <button
              type="button"
              onClick={toggleAll}
              className="w-full rounded-lg px-2 py-1.5 text-left text-[11px] font-semibold text-cyan-300 hover:bg-white/5"
            >
              {allSelected ? 'Clear all' : 'Select all'}
            </button>
            <div className="my-1 border-t border-white/5" />
            {ALL_CALENDAR_KINDS.map((kind) => {
              const tone = entryToneClasses(kind);
              const checked = activeKinds.has(kind);
              return (
                <label
                  key={kind}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] text-slate-300 hover:bg-white/5 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleKind(kind)}
                    className="accent-cyan-500"
                  />
                  <span className={`w-2 h-2 rounded-full shrink-0 ${tone.dotClass}`} />
                  {kind}
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
