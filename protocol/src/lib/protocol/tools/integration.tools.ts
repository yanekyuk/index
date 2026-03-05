import { z } from 'zod';
import type { DefineTool, ToolDeps } from './tool.helpers';
import { success, error } from './tool.helpers';
import { createUserSession, getComposioClient } from '../../../lib/composio/composio';
import { contactService } from '../../../services/contact.service';
import { log } from '../../../lib/log';

const logger = log.lib.from('integration.tools');

interface GmailContact {
  names?: Array<{ displayName?: string }>;
  emailAddresses?: Array<{ value?: string }>;
}

interface GmailGetContactsResponse {
  successful: boolean;
  error?: string;
  data?: {
    connections?: GmailContact[];
    otherContacts?: GmailContact[];
    nextPageToken?: string;
  };
}

/**
 * Creates integration tools for the chat agent.
 * Exposes import_gmail_contacts for direct Gmail contact import with Composio auth.
 */
export function createIntegrationTools(defineTool: DefineTool, _deps: ToolDeps) {
  const import_gmail_contacts = defineTool({
    name: 'import_gmail_contacts',
    description: `Import contacts from the user's Gmail/Google account into their network.

If the user hasn't connected their Gmail account yet, returns an auth URL they need to visit first.

After successful import, contacts are added to the user's network as ghost users
(enriched with public profile data) and can be matched in opportunity discovery.

Returns import statistics or an auth URL if authentication is needed.`,
    querySchema: z.object({}),
    handler: async ({ context, query }) => {
      try {
        const session = await createUserSession(context.userId);
        const toolkits = await session.toolkits();
        
        const gmailToolkit = toolkits.items.find(t => t.slug === 'gmail');
        const isConnected = !!gmailToolkit?.connection?.connectedAccount?.id;
        
        if (!isConnected) {
          logger.info('Gmail not connected, returning auth URL', { userId: context.userId });
          const authRequest = await session.authorize('gmail');
          return success({
            requiresAuth: true,
            message: 'Please connect your Gmail account to import contacts.',
            authUrl: authRequest.redirectUrl,
          });
        }
        
        logger.info('Fetching Gmail contacts', { userId: context.userId });
        
        const composio = getComposioClient();
        const result = await (composio as unknown as {
          tools: {
            execute: (
              slug: string,
              opts: { userId: string; arguments: Record<string, unknown>; dangerouslySkipVersionCheck?: boolean }
            ) => Promise<GmailGetContactsResponse>;
          };
        }).tools.execute('GMAIL_GET_CONTACTS', {
          userId: context.userId,
          arguments: {
            resource_name: 'people/me',
            person_fields: 'names,emailAddresses',
            include_other_contacts: true,
          },
          dangerouslySkipVersionCheck: true,
        });
        
        if (!result.successful) {
          logger.error('Gmail contacts fetch failed', { userId: context.userId, error: result.error });
          return error(`Failed to fetch contacts: ${result.error}`);
        }
        
        const contacts: Array<{ name: string; email: string }> = [];
        
        const allContacts = [
          ...(result.data?.connections || []),
          ...(result.data?.otherContacts || []),
        ];
        
        for (const contact of allContacts) {
          const email = contact.emailAddresses?.[0]?.value;
          if (email) {
            const name = contact.names?.[0]?.displayName || email.split('@')[0];
            contacts.push({ name, email });
          }
        }
        
        logger.info('Parsed contacts from Gmail', { 
          userId: context.userId, 
          totalFetched: allContacts.length,
          validContacts: contacts.length,
        });
        
        if (contacts.length === 0) {
          return success({
            message: 'No contacts with valid name and email found in your Gmail account.',
            imported: 0,
            skipped: 0,
          });
        }
        
        const importResult = await contactService.importContacts(
          context.userId,
          contacts,
          'gmail'
        );
        
        logger.info('Gmail contacts imported', {
          userId: context.userId,
          imported: importResult.imported,
          skipped: importResult.skipped,
          newGhosts: importResult.newGhosts,
        });
        
        return success({
          message: `Imported ${importResult.imported} contacts from Gmail to your network.`,
          imported: importResult.imported,
          skipped: importResult.skipped,
          newGhosts: importResult.newGhosts,
        });
      } catch (err) {
        logger.error('import_gmail_contacts failed', { 
          userId: context.userId,
          error: err instanceof Error ? err.message : String(err),
        });
        return error(`Failed to import Gmail contacts: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  });

  return [import_gmail_contacts];
}
