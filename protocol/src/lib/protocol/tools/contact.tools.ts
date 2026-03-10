import { z } from 'zod';
import type { DefineTool, ToolDeps } from './tool.helpers';
import { success, error } from './tool.helpers';
import { contactService } from '../../../services/contact.service';
import type { ContactSource } from '../../../schemas/database.schema';

/**
 * Creates contact management tools for the chat agent.
 * Enables importing, listing, and managing the user's network.
 */
export function createContactTools(defineTool: DefineTool, _deps: ToolDeps) {
  const VALID_SOURCES: ContactSource[] = ['gmail', 'google_calendar', 'manual'];

  const import_contacts = defineTool({
    name: 'import_contacts',
    description: `Import contacts into the user's network from any integration or manual input.

Each contact needs a name and email. Contacts without existing accounts become "ghost users"
that are enriched with public profile data and can be matched in opportunity discovery.

The source parameter indicates where the contacts came from:
- 'gmail' - Contacts from Gmail
- 'google_calendar' - Contacts from Google Calendar  
- 'manual' - Manually provided or other integrations (Slack, Notion, etc.)

Returns import statistics including how many were imported, skipped, and how many new ghost users were created.`,
    querySchema: z.object({
      contacts: z.array(z.object({
        name: z.string().describe('Contact name'),
        email: z.string().describe('Contact email address'),
      })).describe('Array of contacts to import'),
      source: z.string().describe('Source of the contacts (gmail, google_calendar, slack, notion, etc.)'),
    }),
    handler: async ({ context, query }) => {
      try {
        const normalizedSource: ContactSource = VALID_SOURCES.includes(query.source as ContactSource)
          ? (query.source as ContactSource)
          : 'manual';

        const result = await contactService.importContacts(
          context.userId,
          query.contacts,
          normalizedSource
        );
        return success({
          message: `Imported ${result.imported} contacts from ${query.source} to your network.`,
          imported: result.imported,
          skipped: result.skipped,
          newContacts: result.newContacts,
          existingContacts: result.existingContacts,
          source: query.source,
        });
      } catch (err) {
        return error(`Failed to import contacts: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  });

  const list_contacts = defineTool({
    name: 'list_contacts',
    description: `List the user's network contacts. Returns all imported contacts with their details.
Each contact includes userId, source (gmail, google_calendar, manual), import date, and user info.
Ghost users (contacts without accounts) are marked with isGhost: true.
Use the userId field with read_user_profiles to look up a contact's full profile.`,
    querySchema: z.object({
      limit: z.number().optional().describe('Maximum number of contacts to return (default: all)'),
    }),
    handler: async ({ context, query }) => {
      try {
        let contacts = await contactService.listContacts(context.userId);
        
        if (query.limit && query.limit > 0) {
          contacts = contacts.slice(0, query.limit);
        }

        return success({
          count: contacts.length,
          contacts: contacts.map(c => ({
            id: c.id,
            userId: c.user.id,
            name: c.user.name,
            email: c.user.email,
            avatar: c.user.avatar,
            isGhost: c.user.isGhost,
            source: c.source,
            importedAt: c.importedAt.toISOString(),
          })),
        });
      } catch (err) {
        return error(`Failed to list contacts: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  });

  const add_contact = defineTool({
    name: 'add_contact',
    description: `Manually add a single contact to the user's network by email.
Use this when the user wants to add a specific person to their network.
If no account exists for that email, a ghost user is created and enriched with public data.`,
    querySchema: z.object({
      email: z.string().describe('Email address of the contact to add'),
      name: z.string().optional().describe('Name of the contact (optional, will use email prefix if not provided)'),
    }),
    handler: async ({ context, query }) => {
      try {
        const result = await contactService.addContact(
          context.userId,
          query.email,
          query.name
        );

        if (result.imported === 0) {
          return success({
            added: false,
            message: result.skipped > 0 
              ? 'Contact was skipped (invalid email or self-import).'
              : 'No contact was added.',
          });
        }

        const detail = result.details[0];
        return success({
          added: true,
          message: detail.isNew 
            ? `Added ${query.name || query.email} to your network. Their profile is being enriched.`
            : `Added ${query.name || query.email} to your network.`,
          userId: detail.userId,
          isNewGhost: detail.isNew,
        });
      } catch (err) {
        return error(`Failed to add contact: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  });

  const remove_contact = defineTool({
    name: 'remove_contact',
    description: `Remove a contact from the user's network. 
Use the contact id from list_contacts. This soft-deletes the contact relationship.`,
    querySchema: z.object({
      contactId: z.string().describe('The contact record ID to remove (from list_contacts)'),
    }),
    handler: async ({ context, query }) => {
      try {
        await contactService.removeContact(context.userId, query.contactId);
        return success({ removed: true, message: 'Contact removed from your network.' });
      } catch (err) {
        return error(`Failed to remove contact: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  });

  return [import_contacts, list_contacts, add_contact, remove_contact];
}
