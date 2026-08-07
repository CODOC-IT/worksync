import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Search, ChevronDown, X } from 'lucide-react';

interface Option {
  value: string;
  label: string;
  sublabel?: string;
  disabled?: boolean;
}

interface SearchableSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  emptyMessage?: string;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  disabled = false,
  emptyMessage = 'No options available',
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOption = options.find((o) => o.value === value);

  const filteredOptions = useMemo(
    () => options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase())),
    [options, search]
  );

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const handleSelect = (opt: Option) => {
    if (opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
    setSearch('');
  };

  return (
    <div ref={containerRef} data-searchable-select className="relative">
      <button
        type="button"
        onClick={() => { if (!disabled) setOpen(!open); }}
        disabled={disabled}
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
          disabled
            ? 'bg-black/20 border border-white/5 text-slate-500 cursor-not-allowed'
            : 'bg-black/40 border border-white/10 text-slate-200 hover:border-purple-500/40 hover:shadow-[0_0_10px_rgba(168,85,247,0.1)] cursor-pointer'
        } ${open ? 'border-purple-500/50 ring-1 ring-purple-500/30' : ''}`}
      >
        <span className={`flex-1 text-left truncate ${!selectedOption ? 'text-slate-500' : ''}`}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full glass-panel border border-purple-500/30 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100" style={{ background: 'rgba(15, 18, 28, 0.97)' }}>
          <div className="p-2 border-b border-white/10">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="w-full pl-8 pr-2 py-2 rounded-md bg-black/60 border border-white/10 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500/50"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          <div className="max-h-60 overflow-y-auto py-1">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-4 text-sm text-slate-500 text-center">{emptyMessage}</div>
            ) : (
              filteredOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleSelect(opt)}
                  disabled={opt.disabled}
                  className={`w-full text-left px-3 py-2.5 text-sm transition-colors flex items-center justify-between gap-2 ${opt.disabled
                    ? 'cursor-not-allowed text-slate-500 opacity-60'
                    : opt.value === value
                      ? 'bg-purple-500/20 text-purple-200 border-l-2 border-purple-400'
                      : 'text-slate-300 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <span className="block truncate">{opt.label}</span>
                    {opt.sublabel && (
                      <span className="block text-xs text-slate-500 truncate mt-0.5">{opt.sublabel}</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
