import type { ProjectApprovalRequest } from '../../types';

export interface ProjectEditDisplayChange {
  fieldKey: string;
  fieldLabel: string;
  oldDisplayValue: unknown;
  newDisplayValue: unknown;
  added?: string[];
  removed?: string[];
}

export const projectEditChanges = (request: ProjectApprovalRequest): ProjectEditDisplayChange[] => {
  const changes = request.requestedChanges?.changes;
  if (!Array.isArray(changes)) return [];
  return changes.filter((change): change is ProjectEditDisplayChange => Boolean(
    change && typeof change === 'object' && typeof change.fieldKey === 'string' && typeof change.fieldLabel === 'string'
  ));
};

export const formatProjectChangeValue = (fieldKey: string, value: unknown): string => {
  if (value == null || value === '') return 'Not provided';
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : 'None';
  if ((fieldKey === 'startDate' || fieldKey === 'targetDate') && typeof value === 'string') {
    const date = new Date(`${value.slice(0, 10)}T00:00:00`);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }
  }
  if (typeof value === 'object') return 'Not provided';
  return String(value);
};
