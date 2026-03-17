import { log } from '../lib/log';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { profileQueue } from '../queues/profile.queue';

const logger = log.service.from('ContactService');

/** Email prefixes that indicate automated/service accounts. */
const NON_HUMAN_PREFIXES = new Set([
  'noreply', 'no-reply', 'no_reply', 'donotreply', 'do-not-reply',
  'support', 'info', 'help', 'sales', 'marketing', 'hello',
  'notifications', 'notification', 'alerts', 'alert',
  'newsletter', 'newsletters', 'news', 'updates', 'update',
  'billing', 'invoices', 'receipts', 'orders',
  'admin', 'administrator', 'system', 'mailer', 'mailer-daemon',
  'daemon', 'postmaster', 'webmaster', 'hostmaster',
  'feedback', 'contact', 'team', 'service', 'services',
  'security', 'privacy', 'legal', 'compliance',
  'calendar', 'calendar-server', 'calendar-notification',
]);

/** Domain patterns that indicate automated/service emails. */
const NON_HUMAN_DOMAIN_PATTERNS = [
  /calendar-notification\.google\.com$/i,
  /accounts\.google\.com$/i,
  /notifications\..+\.com$/i,
  /noreply\..+$/i,
  /mailer\..+$/i,
  /^test\.(com|dev|local|internal)$/i,
];

/** Name patterns that indicate non-human contacts. */
const NON_HUMAN_NAME_PATTERNS = [
  /^no[ -_]?reply$/i,
  /support$/i,
  /team$/i,
  /^(the )?.+ (team|support|notifications|alerts)$/i,
];

/**
 * Determines if a contact appears to be a human (not a service/automated account).
 * @param email - The contact's email address
 * @param name - The contact's name (may be empty)
 * @returns true if the contact appears to be human
 */
export function isHumanContact(email: string, name: string): boolean {
  const [prefix, domain] = email.toLowerCase().split('@');

  if (NON_HUMAN_PREFIXES.has(prefix)) return false;

  if (NON_HUMAN_DOMAIN_PATTERNS.some(p => p.test(domain))) return false;

  if (name && NON_HUMAN_NAME_PATTERNS.some(p => p.test(name))) return false;

  return true;
}

/** Input for importing a single contact. */
export interface ContactInput {
  name: string;
  email: string;
}

/** Result of adding a single contact. */
export interface ContactResult {
  userId: string;
  isNew: boolean;
  isGhost: boolean;
}

/** Result of importing contacts in bulk. */
export interface ImportResult {
  imported: number;
  skipped: number;
  newContacts: number;
  existingContacts: number;
  details: Array<{ email: string; userId: string; isNew: boolean }>;
}

/**
 * ContactService
 *
 * Manages user contacts ("My Network") using index_members with 'contact' permission
 * on the owner's personal index.
 *
 * RESPONSIBILITIES:
 * - Add/remove contacts via index_members rows
 * - Create ghost users for contacts without existing accounts
 * - Enqueue enrichment jobs for new ghost users
 * - List and manage contacts
 */
export class ContactService {
  constructor(private db = new ChatDatabaseAdapter()) {}

  /**
   * Add a single contact by email.
   * Resolves user by email, creates a ghost if not found, upserts contact membership,
   * clears any reverse opt-out, and enqueues enrichment for new ghosts.
   *
   * @param ownerId - The user adding the contact
   * @param email - Email of the contact to add
   * @param options - Optional name and restore flag
   * @returns Result with userId, isNew, and isGhost flags
   */
  async addContact(
    ownerId: string,
    email: string,
    options: { name?: string; restore?: boolean } = {}
  ): Promise<ContactResult> {
    const normalizedEmail = email.toLowerCase().trim();
    const name = options.name?.trim() || normalizedEmail.split('@')[0];

    // Look up existing user
    let user = await this.db.getUserByEmail(normalizedEmail);
    let isNew = false;
    let isGhost = false;

    if (!user) {
      // Create ghost user (handles concurrency, creates profile)
      const { id: ghostId } = await this.db.createGhostUser({ name, email: normalizedEmail });

      // Re-query to get full user record
      user = await this.db.getUserByEmail(normalizedEmail);
      if (!user) {
        throw new Error(`Failed to create or find user for email: ${normalizedEmail}`);
      }
      isNew = user.id === ghostId;
      isGhost = true;
    } else {
      isGhost = user.isGhost;
    }

    // Upsert contact membership
    await this.db.upsertContactMembership(ownerId, user.id, { restore: options.restore });

    // Clear reverse opt-out
    await this.db.clearReverseOptOut(ownerId, user.id);

    // Enqueue enrichment for new ghosts
    if (isNew && isGhost) {
      await profileQueue.addEnrichUserJob({ userId: user.id });
      logger.info('[ContactService] Enrichment job enqueued for new ghost', { userId: user.id });
    }

    return { userId: user.id, isNew, isGhost };
  }

  /**
   * Import contacts in bulk.
   * Filters non-human contacts, deduplicates, then calls addContact for each.
   *
   * @param ownerId - The user importing contacts
   * @param contacts - Array of contact data (name, email)
   * @returns Import statistics and details
   */
  async importContacts(
    ownerId: string,
    contacts: ContactInput[]
  ): Promise<ImportResult> {
    logger.info('[ContactService] Importing contacts', {
      ownerId,
      count: contacts.length,
    });

    const result: ImportResult = {
      imported: 0,
      skipped: 0,
      newContacts: 0,
      existingContacts: 0,
      details: [],
    };

    // Fetch owner once
    const owner = await this.db.getUser(ownerId);
    const ownerEmail = owner?.email.toLowerCase();

    // Normalize, filter, and deduplicate contacts
    const seenEmails = new Set<string>();
    const validContacts: Array<{ name: string; email: string }> = [];
    for (const contact of contacts) {
      const email = contact.email.toLowerCase().trim();
      if (!email || !email.includes('@')) {
        result.skipped++;
        continue;
      }
      if (ownerEmail === email) {
        result.skipped++;
        continue;
      }
      if (seenEmails.has(email)) {
        result.skipped++;
        continue;
      }
      const name = contact.name?.trim() || '';
      if (!isHumanContact(email, name)) {
        logger.debug('[ContactService] Skipped non-human contact', { domain: email.split('@')[1] });
        result.skipped++;
        continue;
      }
      seenEmails.add(email);
      validContacts.push({
        name: name || email.split('@')[0],
        email,
      });
    }

    if (validContacts.length === 0) {
      logger.info('[ContactService] No valid contacts to import', { ownerId });
      return result;
    }

    // Process each contact with restore=false (skip soft-deleted)
    for (const contact of validContacts) {
      try {
        const contactResult = await this.addContact(ownerId, contact.email, {
          name: contact.name,
          restore: false,
        });

        result.details.push({
          email: contact.email,
          userId: contactResult.userId,
          isNew: contactResult.isNew,
        });
        result.imported++;
        if (contactResult.isNew) {
          result.newContacts++;
        } else {
          result.existingContacts++;
        }
      } catch (error) {
        logger.error('[ContactService] Failed to add contact', {
          email: contact.email,
          error: error instanceof Error ? error.message : String(error),
        });
        result.skipped++;
      }
    }

    logger.info('[ContactService] Import completed', {
      ownerId,
      imported: result.imported,
      skipped: result.skipped,
      newContacts: result.newContacts,
      existingContacts: result.existingContacts,
    });

    return result;
  }

  /**
   * List all contacts for a user.
   *
   * @param ownerId - The user whose contacts to list
   * @returns Array of contacts with user details
   */
  async listContacts(ownerId: string): Promise<Array<{
    userId: string;
    user: { id: string; name: string; email: string; avatar: string | null; isGhost: boolean };
  }>> {
    return this.db.getContactMembers(ownerId);
  }

  /**
   * Remove a contact from the user's network (hard delete from index_members).
   *
   * @param ownerId - The user removing the contact
   * @param contactUserId - The contact user ID to remove
   */
  async removeContact(ownerId: string, contactUserId: string): Promise<void> {
    logger.info('[ContactService] Removing contact', { ownerId, contactUserId });
    await this.db.hardDeleteContactMembership(ownerId, contactUserId);
  }
}

export const contactService = new ContactService();
