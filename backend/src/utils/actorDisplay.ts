import { userStore } from '../store/userStore.js';

/** Resolve a human-readable actor without inventing a person name. */
export const actorDisplayName = (userId?: string | null): string => {
  if (!userId) return 'System';
  const user = userStore.findById(userId);
  return user?.name?.trim() || user?.email?.trim() || userId;
};

/**
 * Older notification messages were persisted with the literal `Someone` fallback.
 * Replace only that actor placeholder; unrelated uses of the word remain untouched.
 */
export const normalizeActorMessage = (message: string, actorName?: string | null): string => {
  if (!message) return message;
  const name = actorName?.trim();
  if (!name) return message.replace(/^Someone\b\s*/i, '');

  return message
    .replace(new RegExp(`^Someone\\b`, 'i'), name)
    .replace(new RegExp(`(${escapeRegExp(name)})\\s+Someone\\b`, 'gi'), '$1');
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&');
