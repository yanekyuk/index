import { log } from '../lib/log';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import type { ContactSource } from '../schemas/database.schema';
import { profileQueue } from '../queues/profile.queue';

const logger = log.service.from('ContactService');

/** Input for importing a single contact. */
export interface ContactInput {
  name: string;
  email: string;
}

/** Result of importing contacts. */
export interface ImportResult {
  imported: number;
  skipped: number;
  newGhosts: number;
  details: Array<{ email: string; userId: string; isNew: boolean }>;
}

/** Contact with user details. */
export interface Contact {
  id: string;
  userId: string;
  source: string;
  importedAt: Date;
  user: {
    id: string;
    name: string;
    email: string;
    avatar: string | null;
    isGhost: boolean;
  };
}

/**
 * ContactService
 *
 * Manages user contacts ("My Network") including importing from integrations,
 * creating ghost users for unknown contacts, and listing/removing contacts.
 *
 * RESPONSIBILITIES:
 * - Import contacts from integration output (Gmail, Calendar) or manual input
 * - Create ghost users for contacts without existing accounts
 * - Enqueue enrichment jobs for new ghost users
 * - List and manage contacts
 */
export class ContactService {
  constructor(private db = new ChatDatabaseAdapter()) {}

  /**
   * Import contacts into the user's network.
   * For each contact:
   * - If email exists in users table, link to existing user
   * - If email doesn't exist, create a ghost user
   * - Upsert the contact relationship
   * - Enqueue enrichment for new ghost users
   *
   * Uses bulk operations for performance.
   *
   * @param ownerId - The user importing contacts
   * @param contacts - Array of contact data (name, email)
   * @param source - Where contacts came from (gmail, google_calendar, manual)
   * @returns Import statistics and details
   */
  async importContacts(
    ownerId: string,
    contacts: ContactInput[],
    source: ContactSource
  ): Promise<ImportResult> {
    logger.info('[ContactService] Importing contacts', {
      ownerId,
      count: contacts.length,
      source,
    });

    const result: ImportResult = {
      imported: 0,
      skipped: 0,
      newGhosts: 0,
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
      seenEmails.add(email);
      validContacts.push({
        name: contact.name?.trim() || email.split('@')[0],
        email,
      });
    }

    if (validContacts.length === 0) {
      logger.info('[ContactService] No valid contacts to import', { ownerId });
      return result;
    }

    // Bulk lookup existing users by email
    const emails = validContacts.map(c => c.email);
    const existingUsers = await this.db.getUsersByEmails(emails);
    const existingByEmail = new Map(existingUsers.map(u => [u.email.toLowerCase(), u]));

    // Identify contacts that need ghost users
    const needGhosts: Array<{ name: string; email: string }> = [];
    for (const contact of validContacts) {
      if (!existingByEmail.has(contact.email)) {
        needGhosts.push(contact);
      }
    }

    // Atomically create ghosts + upsert all contacts in a single transaction
    const { newGhosts } = await this.db.importContactsBulk(
      ownerId,
      needGhosts,
      validContacts,
      existingByEmail,
      source
    );

    result.newGhosts = newGhosts.length;

    // Build result details (existingByEmail was updated inside the transaction with ghost IDs)
    for (const contact of validContacts) {
      const user = existingByEmail.get(contact.email);
      if (user) {
        result.details.push({
          email: contact.email,
          userId: user.id,
          isNew: !existingUsers.some(u => u.id === user.id),
        });
      }
    }
    result.imported = result.details.length;

    // Enqueue enrichment for all ghost contacts on every import.
    // Re-imports re-trigger profile generation so updated data or
    // previously failed enrichments are retried.
    const ghostDetails = result.details.filter(d => {
      const user = existingByEmail.get(d.email);
      return user?.isGhost === true;
    });
    if (ghostDetails.length > 0) {
      for (const ghost of ghostDetails) {
        await profileQueue.addEnrichGhostJob({ userId: ghost.userId });
      }
      logger.info('[ContactService] Enrichment jobs enqueued for ghost contacts', {
        ghostIds: ghostDetails.map(g => g.userId),
        count: ghostDetails.length,
      });
    }

    logger.info('[ContactService] Import completed', {
      ownerId,
      imported: result.imported,
      skipped: result.skipped,
      newGhosts: result.newGhosts,
    });

    return result;
  }

  /**
   * List all contacts for a user.
   *
   * @param ownerId - The user whose contacts to list
   * @returns Array of contacts with user details
   */
  async listContacts(ownerId: string): Promise<Contact[]> {
    logger.verbose('[ContactService] Listing contacts', { ownerId });
    return this.db.getContacts(ownerId);
  }

  /**
   * Remove a contact from the user's network (soft delete).
   *
   * @param ownerId - The user removing the contact
   * @param contactId - The contact record ID to remove
   */
  async removeContact(ownerId: string, contactId: string): Promise<void> {
    logger.info('[ContactService] Removing contact', { ownerId, contactId });
    await this.db.removeContact(ownerId, contactId);
  }

  /**
   * Add a single contact manually by email.
   *
   * @param ownerId - The user adding the contact
   * @param email - Email of the contact to add
   * @param name - Optional name for the contact
   * @returns The import result for the single contact
   */
  async addContact(
    ownerId: string,
    email: string,
    name?: string
  ): Promise<ImportResult> {
    return this.importContacts(
      ownerId,
      [{ name: name || '', email }],
      'manual'
    );
  }
}

export const contactService = new ContactService();
