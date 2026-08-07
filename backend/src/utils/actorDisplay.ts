import { userStore } from '../store/userStore.js';

// Human-readable label for a role — the second-to-last resort in the fallback chain below (an
// actor whose user record has no name/username/email at all, which shouldn't be reachable in
// practice since iam.Users.Email is NOT NULL, but the chain stays complete rather than assuming
// that constraint can never be violated by a bad row).
const ROLE_LABELS: Record<string, string> = {
  Admin: 'Admin',
  Team_Lead: 'Team Lead',
  HR: 'HR',
  Team_Member: 'Team Member'
};

/**
 * Resolve a human-readable actor name: Display Name -> Username -> Email -> Role ->
 * "Unknown User". Never returns the raw `usr-<n>` id.
 *
 * Returning the raw id used to be the root cause of notifications reading "usr-45 assigned you
 * ...": `userStore.findById()` reads a synchronous in-memory cache (see userStore.ts) that can
 * miss for an actor who registered very recently or on a cold serverless instance, and the old
 * `|| userId` fallback let that internal id leak straight into user-facing text. A cache miss is
 * now treated the same as "no information available" — it ends the chain at "Unknown User"
 * rather than surfacing an id nobody but the database understands.
 *
 * (`iam.Users` has no separate "Full Name" column distinct from DisplayName — DisplayName is
 * already the concatenated full name at account-creation time, so `user.name` here serves both
 * the "Display Name" and "Full Name" steps of the fallback chain.)
 */
export const actorDisplayName = (userId?: string | null): string => {
  if (!userId) return 'System';
  const user = userStore.findById(userId);
  if (!user) return 'Unknown User';
  const name = user.name?.trim();
  if (name) return name;
  const username = user.username?.trim();
  if (username) return username;
  const email = user.email?.trim();
  if (email) return email;
  return ROLE_LABELS[user.role] || 'Unknown User';
};

// Both patterns that have ended up embedded at the START of a persisted notification message:
// the literal word "Someone" (this module's old placeholder, before an actor could always be
// resolved) and a raw "usr-<n>" id (leaked by actorDisplayName's old `|| userId` fallback on a
// userStore cache miss — see its comment above). Repaired identically: swapped for the actor's
// real, DB-resolved name. Applied on every read (see notification.mapper.ts's
// rowToNotificationDTO), so ALREADY-PERSISTED notifications self-heal the next time they're
// fetched, without needing a data backfill — not just newly-published ones.
const PLACEHOLDER_PATTERN = '(?:Someone|usr-\\d+)';

/**
 * Replace a leading actor-placeholder in `message` with `actorName`. Only touches the start of
 * the string (never a mid-sentence occurrence, which could be legitimate text) and, when a name
 * is known, only the placeholder token itself — the whitespace that followed it is left intact
 * so "usr-45 assigned you X" becomes "Bilal Ahmed assigned you X", not "Bilal Ahmedassigned...".
 */
export const normalizeActorMessage = (message: string, actorName?: string | null): string => {
  if (!message) return message;
  const name = actorName?.trim();
  if (!name) return message.replace(new RegExp(`^${PLACEHOLDER_PATTERN}\\b\\s*`, 'i'), '');

  return message
    .replace(new RegExp(`^${PLACEHOLDER_PATTERN}\\b`, 'i'), name)
    .replace(new RegExp(`(${escapeRegExp(name)})\\s+${PLACEHOLDER_PATTERN}\\b`, 'gi'), '$1');
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&');
