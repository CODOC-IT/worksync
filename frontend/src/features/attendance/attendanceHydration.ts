import type { AttendanceRecord, BreakType } from '../../types';
import { formatAttendanceTime } from './attendanceTime.js';

export interface PersistedActiveBreak {
  userId: string;
  breakType: BreakType;
  startedAtUtc: string;
}

export const mapAttendanceApiRecords = (rows: any[]): AttendanceRecord[] =>
  rows.map((row) => ({
    id: `att-${row.userId}-${row.date}`,
    userId: row.userId,
    date: row.date,
    checkIn: row.checkIn ? formatAttendanceTime(row.checkIn, row.timeZone) : '',
    checkOut: row.checkOut ? formatAttendanceTime(row.checkOut, row.timeZone) : undefined,
    totalHours: row.totalHours || 0,
    status: (row.status === 'Leave' ? 'On Leave' : row.status || 'Present') as AttendanceRecord['status'],
    breaks: Array.isArray(row.breaks) ? row.breaks : []
  }));

export const restoreActiveBreak = (
  persisted: PersistedActiveBreak | null | undefined,
  currentUserId: string,
  nowMs = Date.now()
) => {
  if (!persisted || persisted.userId !== currentUserId || !persisted.startedAtUtc) return null;
  const startedAtUtc = new Date(persisted.startedAtUtc).toISOString();
  return {
    isBreaking: true as const,
    userId: currentUserId,
    breakType: persisted.breakType || 'Other',
    startTime: formatAttendanceTime(startedAtUtc),
    elapsedSeconds: Math.max(0, Math.floor((nowMs - new Date(startedAtUtc).getTime()) / 1000)),
    startedAtUtc
  };
};

