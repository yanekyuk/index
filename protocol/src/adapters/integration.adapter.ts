import { getComposioClient, getAuthConfigMap } from '../lib/composio/composio.client';
import type {
  IntegrationAdapter,
  IntegrationConnection,
  IntegrationSession,
  IntegrationSessionOptions,
  ToolActionResponse,
} from '../lib/protocol/interfaces/integration.interface';
import { log } from '../lib/log';

const logger = log.lib.from('integration.adapter');

/**
 * Integration adapter backed by Composio.
 *
 * @remarks
 * Wraps the Composio SDK to provide session creation and tool execution.
 * The underlying client is lazily initialized from `lib/composio/composio.client.ts`.
 * Auth configs are auto-discovered from the Composio dashboard so existing
 * configurations are always preferred over auto-created managed ones.
 */
export class ComposioIntegrationAdapter implements IntegrationAdapter {
  /** @inheritdoc */
  async createSession(userId: string, options?: IntegrationSessionOptions): Promise<IntegrationSession> {
    const composio = getComposioClient();

    const baseUrl = process.env.FRONTEND_URL;
    const callbackUrl = baseUrl ? `${baseUrl.replace(/\/$/, '')}/oauth/callback` : undefined;
    const authConfigs = await getAuthConfigMap();

    const sessionOptions: IntegrationSessionOptions = {
      manageConnections: callbackUrl
        ? { callbackUrl }
        : true,
      ...(Object.keys(authConfigs).length > 0 && { authConfigs }),
      ...options,
    };

    logger.info('Creating integration session', {
      userId,
      hasCallbackUrl: !!callbackUrl,
      authConfigToolkits: Object.keys(authConfigs),
    });

    // Composio SDK's create() method exists at runtime but isn't exposed in @composio/core's public types.
    // Using a typed cast until the SDK exports proper session creation types.
    type CreateFn = (userId: string, options?: IntegrationSessionOptions) => Promise<IntegrationSession>;
    return (composio as unknown as { create: CreateFn }).create(userId, sessionOptions);
  }

  /** @inheritdoc */
  async executeToolAction(slug: string, userId: string, args: Record<string, unknown>): Promise<ToolActionResponse> {
    const composio = getComposioClient();

    // Composio SDK's tools.execute() types don't match runtime behavior at v0.6.3.
    // Using typed cast until SDK exports proper tool execution types.
    type ToolsExecute = {
      tools: {
        execute: (
          slug: string,
          opts: { userId: string; arguments: Record<string, unknown>; dangerouslySkipVersionCheck?: boolean }
        ) => Promise<ToolActionResponse>;
      };
    };

    return (composio as unknown as ToolsExecute).tools.execute(slug, {
      userId,
      arguments: args,
      dangerouslySkipVersionCheck: true,
    });
  }

  /** @inheritdoc */
  async listConnections(userId: string): Promise<IntegrationConnection[]> {
    const composio = getComposioClient();

    type ConnectedAccount = {
      id: string;
      toolkit?: { slug?: string };
      status?: string;
      created_at?: string;
    };
    type ListResult = { items: ConnectedAccount[] };
    type CA = { connectedAccounts: { list: (opts: { userIds: string[] }) => Promise<ListResult> } };

    const result = await (composio as unknown as CA).connectedAccounts.list({ userIds: [userId] });

    return result.items.map((item) => ({
      id: item.id,
      toolkit: item.toolkit?.slug ?? 'unknown',
      status: item.status ?? 'unknown',
      createdAt: item.created_at ?? new Date().toISOString(),
    }));
  }

  /** @inheritdoc */
  async getAuthUrl(userId: string, toolkit: string, callbackUrl?: string): Promise<{ redirectUrl: string }> {
    const session = await this.createSession(userId, callbackUrl ? { manageConnections: { callbackUrl } } : undefined);
    const result = await session.authorize(toolkit);
    return { redirectUrl: result.redirectUrl };
  }

  /** @inheritdoc */
  async disconnect(connectedAccountId: string): Promise<{ success: boolean }> {
    const composio = getComposioClient();

    type CA = { connectedAccounts: { delete: (id: string) => Promise<unknown> } };

    try {
      await (composio as unknown as CA).connectedAccounts.delete(connectedAccountId);
      return { success: true };
    } catch (err) {
      logger.error('Failed to disconnect account', {
        connectedAccountId,
        error: err instanceof Error ? err.message : String(err),
      });
      return { success: false };
    }
  }
}
