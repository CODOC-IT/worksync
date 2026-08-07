// Shared, pure formatting helpers for notification copy-builders (projectApprovalRejectionCopy.ts,
// task edit approval copy, account change request notifications, ...). Extracted here rather than
// left duplicated in each module once a second caller needed the identical formatting.

/**
 * "08 Aug 2026, 2:45 PM" — day-month-year (unambiguous, locale-independent field order) plus a
 * 12-hour clock with an uppercase AM/PM marker. Two Intl calls rather than one combined format
 * string, so each half's formatting is controlled independently.
 */
export const formatDecidedOn = (date: Date): string => {
  const datePart = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const timePart = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${datePart}, ${timePart}`;
};
