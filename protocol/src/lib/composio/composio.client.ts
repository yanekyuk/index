import { Composio } from '@composio/core';
import { LangchainProvider } from '@composio/langchain';

type ComposioLangchain = Composio<LangchainProvider>;

let client: ComposioLangchain | null = null;

/**
 * Returns the lazily-initialized Composio SDK client.
 * @returns The configured Composio client with LangChain provider
 * @throws If COMPOSIO_API_KEY environment variable is not set
 */
export function getComposioClient(): ComposioLangchain {
  if (!client) {
    const apiKey = process.env.COMPOSIO_API_KEY;
    if (!apiKey) {
      throw new Error('COMPOSIO_API_KEY is not set');
    }
    client = new Composio({ apiKey, provider: new LangchainProvider() });
  }
  return client;
}
