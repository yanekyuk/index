import { Controller, Get } from '../lib/router/router.decorators';
import { resolveConnectLink } from '../services/connect-link.service';
import { opportunityService } from '../services/opportunity.service';

/** Route params when path has :code */
type RouteParams = Record<string, string>;

const EXPIRED_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Link Expired</title></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<div style="text-align:center"><h1 style="font-size:1.5rem">This link has expired</h1>
<p style="color:#666">Connect links are valid for 30 days. Check your latest notification for a fresh link.</p>
</div></body></html>`;

const APPROVED_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Introduction Approved</title></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<div style="text-align:center"><h1 style="font-size:1.5rem">Introduction approved</h1>
<p style="color:#666">You approved the introduction. Both parties will be connected shortly.</p>
</div></body></html>`;

/**
 * ConnectLinkController: opaque short-link dispatcher.
 *
 * Resolves a base62 short code minted by `connect-link.service.ts` and performs
 * the kind-appropriate side effect: `connect` accepts the opportunity and
 * redirects to Telegram (or web chat); `approve_introduction` flips the
 * introducer's approved flag and renders an inline HTML confirmation;
 * `outreach` redirects to a Telegram DM (or fallback chat URL) for an
 * already-accepted opportunity. Greeting is pulled from the connect-link row
 * and URI-encoded into the redirect target.
 *
 * No guard: authentication is via possession of the short code itself.
 */
@Controller('/c')
export class ConnectLinkController {
  /**
   * GET /c/:code — opaque short-link dispatcher.
   *
   * @param _req - The incoming request (unused; code is in path params).
   * @param _user - Unauthenticated route; no user context.
   * @param params - Path params, must contain `code`.
   * @returns A 302 redirect for connect/outreach kinds, an HTML 200 for
   *   approve_introduction, or an HTML 404 if the code is unknown/expired.
   */
  @Get('/:code')
  async resolve(_req: Request, _user: unknown, params?: RouteParams) {
    const code = params?.code;
    if (!code) return new Response('Missing code', { status: 400 });

    const link = await resolveConnectLink(code);
    if (!link) {
      return new Response(EXPIRED_HTML, { status: 404, headers: { 'Content-Type': 'text/html' } });
    }

    const frontendUrl = (process.env.FRONTEND_URL || process.env.APP_URL || 'https://index.network').replace(/\/+$/, '');
    const greeting = link.greeting
      ?? (await opportunityService.getGreetingForCard(link.opportunityId, link.userId));

    if (link.kind === 'connect') {
      const result = await opportunityService.startChat(link.opportunityId, link.userId);
      if ('error' in result) {
        return new Response(result.error, { status: result.status });
      }

      const handle = await opportunityService.getCounterpartTelegramHandle(result.counterpartUserId);
      const target = handle
        ? (greeting ? `https://t.me/${handle}?text=${encodeURIComponent(greeting)}` : `https://t.me/${handle}`)
        : (greeting
            ? `${frontendUrl}/u/${result.counterpartUserId}/chat?msg=${encodeURIComponent(greeting)}`
            : `${frontendUrl}/u/${result.counterpartUserId}/chat`);
      return Response.redirect(target, 302);
    }

    if (link.kind === 'approve_introduction') {
      const result = await opportunityService.approveIntroduction(link.opportunityId, link.userId);
      if ('error' in result) {
        return new Response(result.error, { status: result.status });
      }
      return new Response(APPROVED_HTML, { status: 200, headers: { 'Content-Type': 'text/html' } });
    }

    if (link.kind === 'outreach') {
      const handle = await opportunityService.getCounterpartTelegramHandleForOpp(link.opportunityId, link.userId);
      if (handle) {
        const target = greeting ? `https://t.me/${handle}?text=${encodeURIComponent(greeting)}` : `https://t.me/${handle}`;
        return Response.redirect(target, 302);
      }
      const conversationId = await opportunityService.getConversationIdForOpp(link.opportunityId, link.userId);
      const target = conversationId
        ? `${frontendUrl}/conversations/${conversationId}${greeting ? `?msg=${encodeURIComponent(greeting)}` : ''}`
        : frontendUrl;
      return Response.redirect(target, 302);
    }

    return new Response('Unknown link kind', { status: 400 });
  }
}
