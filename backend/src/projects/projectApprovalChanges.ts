import { UpdateProjectInput, ProjectDTO } from './project.types.js';

export type ProjectChangeValue = string | string[] | null;

export interface StoredProjectChange {
  fieldKey: keyof UpdateProjectInput;
  fieldLabel: string;
  oldValue: ProjectChangeValue;
  newValue: ProjectChangeValue;
}

export interface StoredProjectEditPayload {
  version: 1;
  changes: StoredProjectChange[];
  proposal: UpdateProjectInput;
}

export interface DisplayProjectChange extends StoredProjectChange {
  oldDisplayValue: ProjectChangeValue;
  newDisplayValue: ProjectChangeValue;
  added?: string[];
  removed?: string[];
}

export interface ProjectUserIdentity {
  id: string;
  name: string;
  role?: string;
  email?: string;
}

export const resolveProjectUserIdentity = (
  id: string,
  users: ProjectUserIdentity[]
): ProjectUserIdentity => users.find((user) => user.id === id) || {
  id,
  name: `Unknown user (ID: ${id})`
};

const FIELD_LABELS: Partial<Record<keyof UpdateProjectInput, string>> = {
  title: 'Project Name',
  description: 'Description',
  priority: 'Priority',
  startDate: 'Start Date',
  targetDate: 'Due Date',
  status: 'Status',
  teamLeadId: 'Project Lead',
  memberIds: 'Members',
  creationReason: 'Project Context'
};

const currentValue = (project: ProjectDTO, key: keyof UpdateProjectInput): ProjectChangeValue => {
  if (key === 'teamLeadId') return project.teamLeadId;
  if (key === 'memberIds') return [...project.memberIds].sort();
  if (key === 'creationReason') return project.creationReason || null;
  const value = project[key as keyof ProjectDTO];
  return value == null ? null : String(value);
};

const proposedValue = (key: keyof UpdateProjectInput, value: unknown): ProjectChangeValue => {
  if (key === 'memberIds') return [...(value as string[])].sort();
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || (key === 'description' || key === 'creationReason' ? '' : trimmed);
  }
  return value == null ? null : String(value);
};

const equal = (left: ProjectChangeValue, right: ProjectChangeValue): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

export const buildProjectEditPayload = (
  current: ProjectDTO,
  requested: UpdateProjectInput
): StoredProjectEditPayload => {
  const proposal: UpdateProjectInput = {};
  const changes: StoredProjectChange[] = [];

  for (const key of Object.keys(FIELD_LABELS) as (keyof UpdateProjectInput)[]) {
    if (requested[key] === undefined) continue;
    const oldValue = currentValue(current, key);
    const newValue = proposedValue(key, requested[key]);
    if (equal(oldValue, newValue)) continue;
    (proposal as Record<string, unknown>)[key] = newValue;
    changes.push({ fieldKey: key, fieldLabel: FIELD_LABELS[key]!, oldValue, newValue });
  }

  return { version: 1, changes, proposal };
};

export const parseProjectEditPayload = (value: string | null): StoredProjectEditPayload | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredProjectEditPayload>;
    if (parsed.version !== 1 || !Array.isArray(parsed.changes) || !parsed.proposal) return null;
    return parsed as StoredProjectEditPayload;
  } catch {
    return null;
  }
};

export const conflictingProjectFields = (
  current: ProjectDTO,
  payload: StoredProjectEditPayload
): string[] => payload.changes
  .filter((change) => !equal(currentValue(current, change.fieldKey), change.oldValue))
  .map((change) => change.fieldLabel);

export const enrichProjectEditPayload = (
  payload: StoredProjectEditPayload,
  resolveUserName: (id: string) => string
): Record<string, unknown> => ({
  ...payload,
  changes: payload.changes.map((change): DisplayProjectChange => {
    if (change.fieldKey === 'teamLeadId') {
      return {
        ...change,
        oldDisplayValue: typeof change.oldValue === 'string' ? resolveUserName(change.oldValue) : 'Not assigned',
        newDisplayValue: typeof change.newValue === 'string' ? resolveUserName(change.newValue) : 'Not assigned'
      };
    }
    if (change.fieldKey === 'memberIds') {
      const oldIds = Array.isArray(change.oldValue) ? change.oldValue : [];
      const newIds = Array.isArray(change.newValue) ? change.newValue : [];
      return {
        ...change,
        oldDisplayValue: oldIds.map(resolveUserName),
        newDisplayValue: newIds.map(resolveUserName),
        added: newIds.filter((id) => !oldIds.includes(id)).map(resolveUserName),
        removed: oldIds.filter((id) => !newIds.includes(id)).map(resolveUserName)
      };
    }
    return { ...change, oldDisplayValue: change.oldValue, newDisplayValue: change.newValue };
  })
});
