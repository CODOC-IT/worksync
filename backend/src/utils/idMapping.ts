// Converts between the frontend's prefixed string ids (`usr-4`, `prj-1`, `tsk-101`) and the
// integer primary keys used by the notify.*/iam.*/work.* Postgres tables. Mirrors the exact
// convention already established in frontend/src/features/tasks/taskRepository.ts
// (`frontendId()`), just in the opposite direction, so the two halves of the app agree on one
// id scheme without either side needing to know about the other's representation.

const PG_INT_MAX = 2147483647;

const PARSE_INT_OVERFLOW = (prefix: string, value: string, parsed: number) =>
  `ID "${value}" resolves to ${parsed} which exceeds PostgreSQL integer range ` +
  `(max ${PG_INT_MAX}). This is a legacy file-store user ID. ` +
  `Log out and back in to get a proper sequential ID.`;

// Legacy file-store users that were created with Date.now() timestamps as IDs.
// These exceed PostgreSQL's int4 range (2^31-1) and must be remapped to their
// sequential DB equivalents.
const LEGACY_USER_ID_MAP: Record<string, number> = {
  'usr-1785174364751': 9,
  'usr-1785175630332': 10,
  'usr-1785176626968': 11,
};

const parsePrefixedId = (prefix: string, value: string): number => {
  const match = new RegExp(`^${prefix}-(\\d+)$`).exec(value);
  if (!match) {
    throw new Error(`Invalid ${prefix}- id: "${value}"`);
  }
  const num = Number(match[1]);
  if (num > PG_INT_MAX) {
    throw new Error(PARSE_INT_OVERFLOW(prefix, value, num));
  }
  return num;
};

export const toUserPk = (frontendId: string): number => {
  if (LEGACY_USER_ID_MAP[frontendId]) {
    return LEGACY_USER_ID_MAP[frontendId];
  }
  return parsePrefixedId('usr', frontendId);
};
export const toProjectPk = (frontendId: string): number => parsePrefixedId('prj', frontendId);
export const toTaskPk = (frontendId: string): number => parsePrefixedId('tsk', frontendId);
export const toThreadPk = (frontendId: string): number => parsePrefixedId('dsc', frontendId);
export const toCommentPk = (frontendId: string): number => parsePrefixedId('cmt', frontendId);

export const fromUserPk = (id: number): string => `usr-${id}`;
export const fromProjectPk = (id: number): string => `prj-${id}`;
export const fromTaskPk = (id: number): string => `tsk-${id}`;
export const fromThreadPk = (id: number): string => `dsc-${id}`;
export const fromCommentPk = (id: number): string => `cmt-${id}`;

// Safe variants for optional/nullable ids used when constructing a Notification row.
export const toUserPkOrNull = (frontendId?: string | null): number | null =>
  frontendId ? toUserPk(frontendId) : null;
export const toProjectPkOrNull = (frontendId?: string | null): number | null =>
  frontendId ? toProjectPk(frontendId) : null;
export const toTaskPkOrNull = (frontendId?: string | null): number | null =>
  frontendId ? toTaskPk(frontendId) : null;
