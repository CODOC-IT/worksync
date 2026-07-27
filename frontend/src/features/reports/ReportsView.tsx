import React from 'react';
import { BarChart3 } from 'lucide-react';

export const ReportsView: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="glass-panel p-6 border-cyan-500/30">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
            <BarChart3 size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">System Reports & Analytics</h1>
            <p className="text-xs text-slate-400">View performance metrics and team analytics</p>
          </div>
        </div>
      </div>
    </div>
  );
};
