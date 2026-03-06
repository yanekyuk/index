import { getComposioClient } from '../lib/composio/composio.client';
import type {
  IntegrationAdapter,
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
 */
export class ComposioIntegrationAdapter implements IntegrationAdapter {
  /** @inheritdoc */
  async createSession(userId: string, options?: IntegrationSessionOptions): Promise<IntegrationSession> {
    const composio = getComposioClient();

    const callbackUrl = process.env.COMPOSIO_CALLBACK_URL || process.env.FRONTEND_URL;

    const sessionOptions: IntegrationSessionOptions = {
      manageConnections: callbackUrl
        ? { callbackUrl }
        : true,
      ...options,
    };

    logger.info('Creating integration session', { userId, hasCallbackUrl: !!callbackUrl });

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
}
