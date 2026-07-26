// Converts between the frontend's prefixed string ids (`usr-4`, `prj-1`, `tsk-101`) and the
// integer primary keys used by the notify.*/iam.*/work.* Postgres tables. Mirrors the exact
// convention already established in frontend/src/features/tasks/taskRepository.ts
// (`frontendId()`), just in the opposite direction, so the two halves of the app agree on one
// id scheme without either side needing to know about the other's representation.

const parsePrefixedId = (prefix: string, value: string): number => {
  const match = new RegExp(`^${prefix}-(\\d+)$`).exec(value);
  if (!match) {
    throw new Error(`Invalid ${prefix}- id: "${value}"`);
  }
  return Number(match[1]);
};

export const toUserPk = (frontendId: string): number => parsePrefixedId('usr', frontendId);
export const toProjectPk = (frontendId: string): number => parsePrefixedId('prj', frontendId);
export const toTaskPk = (frontendId: string): number => parsePrefixedId('tsk', frontendId);

export const fromUserPk = (id: number): string => `usr-${id}`;
export const fromProjectPk = (id: number): string => `prj-${id}`;
export const fromTaskPk = (id: number): string => `tsk-${id}`;

// Safe variants for optional/nullable ids used when constructing a Notification row.
export const toUserPkOrNull = (frontendId?: string | null): number | null =>
  frontendId ? toUserPk(frontendId) : null;
export const toProjectPkOrNull = (frontendId?: string | null): number | null =>
  frontendId ? toProjectPk(frontendId) : null;
export const toTaskPkOrNull = (frontendId?: string | null): number | null =>
  frontendId ? toTaskPk(frontendId) : null;
