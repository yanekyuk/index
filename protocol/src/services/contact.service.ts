import { log } from '../lib/log';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { enrichmentQueue } from '../queues/enrichment.queue';
import type { ContactSource } from '../schemas/database.schema';

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

    for (const contact of contacts) {
      try {
        // Normalize email
        const email = contact.email.toLowerCase().trim();
        if (!email || !email.includes('@')) {
          result.skipped++;
          continue;
        }

        // Skip self-import
        const owner = await this.db.getUser(ownerId);
        if (owner?.email.toLowerCase() === email) {
          result.skipped++;
          continue;
        }

        // Check if user exists
        let existingUser = await this.db.getUserByEmail(email);
        let isNew = false;

        if (!existingUser) {
          // Create ghost user
          const name = contact.name?.trim() || email.split('@')[0];
          const ghost = await this.db.createGhostUser({ name, email });
          existingUser = { id: ghost.id, name, email, isGhost: true };
          isNew = true;
          result.newGhosts++;

          // Enqueue enrichment job for new ghost
          await enrichmentQueue.addEnrichGhostJob({ userId: ghost.id });
          logger.verbose('[ContactService] Created ghost user and enqueued enrichment', {
            ghostId: ghost.id,
            email,
          });
        }

        // Upsert contact relationship
        await this.db.upsertContact({
          ownerId,
          userId: existingUser.id,
          source,
        });

        result.imported++;
        result.details.push({
          email,
          userId: existingUser.id,
          isNew,
        });
      } catch (err) {
        logger.error('[ContactService] Failed to import contact', {
          contact,
          error: err,
        });
        result.skipped++;
      }
    }

    logger.info('[ContactService] Import completed', {
      ownerId,
      ...result,
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
