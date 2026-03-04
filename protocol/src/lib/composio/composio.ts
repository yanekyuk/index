import { Composio } from '@composio/core';
import { LangchainProvider } from '@composio/langchain';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { log } from '../log';

const logger = log.lib.from('composio');

type ComposioLangchain = Composio<LangchainProvider>;

/** Session interface returned by Composio.create(userId, options) */
export interface ComposioSession {
  tools(): Promise<StructuredToolInterface[]>;
  authorize(toolkit: string): Promise<{ redirectUrl: string; waitForConnection(timeout?: number): Promise<unknown> }>;
  toolkits(): Promise<{ items: Array<{ slug: string; name: string; connection?: { connectedAccount?: { id: string } } }> }>;
}

/** Options for creating a Composio session */
export interface ComposioSessionOptions {
  manageConnections?: boolean | { callbackUrl?: string };
}

let client: ComposioLangchain | null = null;

export function getComposioClient(): ComposioLangchain {
  if (!client) {
    const apiKey = process.env.COMPOSIO_API_KEY;
    if (!apiKey) logger.warn('COMPOSIO_API_KEY not set');
    client = new Composio({ apiKey, provider: new LangchainProvider() });
  }
  return client;
}

/**
 * Create a user session with Composio.
 * By default, enables in-chat authentication via COMPOSIO_MANAGE_CONNECTIONS meta-tool.
 * @param userId - User ID for the session
 * @param options - Session options (manageConnections config)
 */
export async function createUserSession(
  userId: string,
  options?: ComposioSessionOptions
): Promise<ComposioSession> {
  const composio = getComposioClient();
  
  const callbackUrl = process.env.COMPOSIO_CALLBACK_URL || process.env.FRONTEND_URL;
  
  const sessionOptions: ComposioSessionOptions = {
    manageConnections: callbackUrl 
      ? { callbackUrl } 
      : true,
    ...options,
  };

  logger.info('Creating Composio session', { userId, hasCallbackUrl: !!callbackUrl });

  type CreateFn = (userId: string, options?: ComposioSessionOptions) => Promise<ComposioSession>;
  return (composio as unknown as { create: CreateFn }).create(userId, sessionOptions);
}

export function setComposioClient(mock: ComposioLangchain | null) {
  client = mock;
}
