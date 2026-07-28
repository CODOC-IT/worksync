import { isEmailConfigured, sendNotificationEmail } from './notification.emailSender.js';
import { findEmailCandidates, markEmailProcessed, EmailCandidateRow } from './notification.repository.js';
import { DbPriority } from './notification.types.js';

// Email delivery for the Notification Module (docs/Notification_Module_Guide.md Section 10).
// Two priority tiers are email-eligible: Critical (sent immediately, one email per event) and
// High (batched into a periodic digest — see the scheduler in server.ts). Normal/Low never get
// emailed; everything still lives in the in-app Notification Center regardless of priority.
//
// `EmailedAtUtc` means "this row has been evaluated for email", not strictly "an email was
// sent" — a candidate whose recipient has the global Email preference off is still marked
// processed, so the job doesn't rescan it forever. See notification.repository.ts's
// EmailCandidateRow / markEmailProcessed for the same note.

const groupByRecipient = (rows: EmailCandidateRow[]): Map<number, EmailCandidateRow[]> => {
  const groups = new Map<number, EmailCandidateRow[]>();
  for (const row of rows) {
    const bucket = groups.get(row.recipientuserid) || [];
    bucket.push(row);
    groups.set(row.recipientuserid, bucket);
  }
  return groups;
};

// Processes every not-yet-emailed notification at the given priorities: sends one email per
// recipient (grouping their eligible items together) if their global Email preference is on,
// then marks every candidate row processed either way. Safe to call with no SMTP configured or
// no DATABASE_URL — both cases just no-op rather than throwing, since this runs from a
// background scheduler that must never crash the process.
export const processEmailCandidates = async (priorities: DbPriority[]): Promise<void> => {
  if (!isEmailConfigured()) return;

  let candidates: EmailCandidateRow[];
  try {
    candidates = await findEmailCandidates(priorities);
  } catch (error) {
    console.warn('[notification.email] Could not query email candidates (DB unavailable?).', error);
    return;
  }
  if (candidates.length === 0) return;

  const byRecipient = groupByRecipient(candidates);

  for (const [, rows] of byRecipient) {
    const eligible = rows.filter((row) => row.emailenabled);
    if (eligible.length > 0) {
      try {
        await sendNotificationEmail(
          rows[0].recipientemail,
          rows[0].recipientname,
          eligible.map((row) => ({
            title: row.title,
            message: row.safepreviewtext || row.title,
            priority: row.prioritycode
          }))
        );
      } catch (error) {
        console.warn(`[notification.email] Failed to send to ${rows[0].recipientemail}.`, error);
        // Don't mark these processed — leave them for the next run to retry.
        continue;
      }
    }

    await Promise.all(rows.map((row) => markEmailProcessed(row.recipientuserid, row.notificationid)));
  }
};
