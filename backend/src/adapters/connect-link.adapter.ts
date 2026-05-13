// eslint-disable-next-line boundaries/dependencies -- connect-link.service is DB-access-only (adapter-level logic); the minting function lives there for now to remain accessible to the controller via the service layer
import type { ConnectLinkKind } from '../services/connect-link.service';
// eslint-disable-next-line boundaries/dependencies -- same as above
import { mintConnectLink as mintConnectLinkSvc, buildConnectShortUrl } from '../services/connect-link.service';

/**
 * Public origin used to build short connect-links. Production must set one
 * of BASE_URL / API_BASE_URL / APP_URL; the localhost fallback is dev-only
 * and matches the documented default in backend/.env.example.
 */
export const apiBaseUrl = (
  process.env.BASE_URL ||
  process.env.API_BASE_URL ||
  process.env.APP_URL ||
  'http://localhost:3001'
).replace(/\/+$/, '');

/**
 * Mints a short connect-link URL for the given recipient/opportunity/kind
 * tuple, delegating to the connect-link service for code generation and
 * prepending the resolved API base URL.
 */
export const mintConnectLink = async ({
  userId,
  opportunityId,
  kind,
  greeting,
}: {
  userId: string;
  opportunityId: string;
  kind: ConnectLinkKind;
  greeting?: string | null;
}): Promise<{ url: string }> => {
  const { code } = await mintConnectLinkSvc({ userId, opportunityId, kind, greeting });
  return { url: buildConnectShortUrl(apiBaseUrl, code) };
};
