import { z } from 'zod';
import type { DefineTool, ToolDeps } from './tool.helpers';
import { success, error } from './tool.helpers';
import { contactService } from '../../../services/contact.service';
import { requestContext } from '../../request-context';
import { log } from '../../../lib/log';

const logger = log.lib.from('integration.tools');

/** A single contact entry returned by the Gmail People API. */
interface GmailContact {
  names?: Array<{ displayName?: string }>;
  emailAddresses?: Array<{ value?: string }>;
}

/**
 * Creates integration tools for the chat agent.
 *
 * Exposes `import_gmail_contacts` which authenticates via the integration adapter,
 * fetches all Gmail contacts (paginated), and imports them as ghost users into the network.
 *
 * @param defineTool - Tool definition helper injected by the tool registry.
 * @param deps - Shared tool dependencies including the integration adapter.
 * @returns An array of tool definitions to register with the chat agent.
 */
export function createIntegrationTools(defineTool: DefineTool, deps: ToolDeps) {
  const { integration } = deps;

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
        const session = await integration.createSession(context.userId);
        const toolkits = await session.toolkits();

        const gmailToolkit = toolkits.items.find(t => t.slug === 'gmail');
        const isConnected = !!gmailToolkit?.connection?.connectedAccount?.id;

        if (!isConnected) {
          logger.info('Gmail not connected, returning auth URL', { userId: context.userId });
          const originUrl = requestContext.getStore()?.originUrl;
          const callbackUrl = originUrl ? `${originUrl}/oauth/callback` : undefined;
          type AuthorizeFn = (toolkit: string, options?: { callbackUrl?: string }) => Promise<{ redirectUrl: string }>;
          const authRequest = await (session.authorize as unknown as AuthorizeFn)('gmail', callbackUrl ? { callbackUrl } : undefined);
          return success({
            requiresAuth: true,
            message: 'Please connect your Gmail account to import contacts.',
            authUrl: authRequest.redirectUrl,
          });
        }

        logger.info('Fetching Gmail contacts', { userId: context.userId });

        const contacts: Array<{ name: string; email: string }> = [];
        let nextPageToken: string | undefined;

        do {
          const result = await integration.executeToolAction('GMAIL_GET_CONTACTS', context.userId, {
            resource_name: 'people/me',
            person_fields: 'names,emailAddresses',
            include_other_contacts: true,
            ...(nextPageToken ? { pageToken: nextPageToken } : {}),
          });

          if (!result.successful) {
            logger.error('Gmail contacts fetch failed', { userId: context.userId, error: result.error });
            return error(`Failed to fetch contacts: ${result.error}`);
          }

          const data = result.data as { connections?: GmailContact[]; otherContacts?: GmailContact[]; nextPageToken?: string } | undefined;
          const allContacts = [
            ...(data?.connections || []),
            ...(data?.otherContacts || []),
          ];

          for (const contact of allContacts) {
            const email = contact.emailAddresses?.[0]?.value;
            if (email) {
              const name = contact.names?.[0]?.displayName || email.split('@')[0];
              contacts.push({ name, email });
            }
          }

          nextPageToken = data?.nextPageToken;
        } while (nextPageToken);

        logger.info('Parsed contacts from Gmail', {
          userId: context.userId,
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
          contacts
        );

        logger.info('Gmail contacts imported', {
          userId: context.userId,
          imported: importResult.imported,
          skipped: importResult.skipped,
          newContacts: importResult.newContacts,
          existingContacts: importResult.existingContacts,
        });

        return success({
          message: importResult.newContacts > 0
            ? `Imported ${importResult.imported} contacts from Gmail. ${importResult.newContacts} new, ${importResult.existingContacts} already in your network.`
            : `All ${importResult.imported} contacts from Gmail were already in your network. No new contacts added.`,
          imported: importResult.imported,
          newContacts: importResult.newContacts,
          existingContacts: importResult.existingContacts,
          skipped: importResult.skipped,
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
