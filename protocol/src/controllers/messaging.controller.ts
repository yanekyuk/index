import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { Controller, Get, Post, UseGuards } from '../lib/router/router.decorators';
import type { MessagingService } from '../services/messaging.service';
import { log } from '../lib/log';

const logger = log.controller.from('messaging');

/**
 * HTTP controller for messaging endpoints.
 * Thin layer: parses requests, delegates to MessagingService, formats responses.
 */
@Controller('/xmtp')
export class MessagingController {
  constructor(private readonly messagingService: MessagingService) {}

  @Get('/conversations')
  @UseGuards(AuthGuard)
  async listConversations(_req: Request, user: AuthenticatedUser) {
    try {
      const conversations = await this.messagingService.listConversations(user.id);
      return Response.json({ conversations });
    } catch (err: any) {
      logger.error('[listConversations] Error', { userId: user.id, error: err.message });
      return Response.json({ error: err.message }, { status: 503 });
    }
  }

  @Post('/messages')
  @UseGuards(AuthGuard)
  async getMessages(req: Request, user: AuthenticatedUser) {
    let body: { groupId?: string; limit?: number };
    try {
      body = (await req.json()) as { groupId?: string; limit?: number };
    } catch {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    if (!body.groupId) {
      return Response.json({ error: 'groupId is required' }, { status: 400 });
    }

    try {
      const messages = await this.messagingService.getMessages(user.id, body.groupId, body.limit);
      return Response.json({ messages });
    } catch (err: any) {
      if (err.message === 'Conversation not found') {
        return Response.json({ error: err.message }, { status: 404 });
      }
      logger.error('[getMessages] Error', { userId: user.id, error: err.message });
      return Response.json({ error: err.message }, { status: 503 });
    }
  }

  @Post('/send')
  @UseGuards(AuthGuard)
  async sendMessage(req: Request, user: AuthenticatedUser) {
    let body: { groupId?: string; peerUserId?: string; text?: string };
    try {
      body = (await req.json()) as { groupId?: string; peerUserId?: string; text?: string };
    } catch {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    if (!body.text?.trim()) {
      return Response.json({ error: 'text is required' }, { status: 400 });
    }
    if (!body.groupId && !body.peerUserId) {
      return Response.json({ error: 'groupId or peerUserId is required' }, { status: 400 });
    }

    try {
      const groupId = await this.messagingService.sendMessage(user.id, {
        groupId: body.groupId,
        peerUserId: body.peerUserId,
        text: body.text.trim(),
      });
      return Response.json({ success: true, groupId });
    } catch (err: any) {
      logger.error('[sendMessage] Error', { userId: user.id, error: err.message });
      return Response.json({ error: err.message }, { status: 500 });
    }
  }

  @Post('/conversations/delete')
  @UseGuards(AuthGuard)
  async deleteConversation(req: Request, user: AuthenticatedUser) {
    let body: { conversationId?: string };
    try {
      body = (await req.json()) as { conversationId?: string };
    } catch {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    if (!body.conversationId) {
      return Response.json({ error: 'conversationId is required' }, { status: 400 });
    }

    await this.messagingService.hideConversation(user.id, body.conversationId);
    return Response.json({ success: true });
  }

  @Post('/find-dm')
  @UseGuards(AuthGuard)
  async findDm(req: Request, user: AuthenticatedUser) {
    let body: { peerUserId?: string };
    try {
      body = (await req.json()) as { peerUserId?: string };
    } catch {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    if (!body.peerUserId) {
      return Response.json({ error: 'peerUserId is required' }, { status: 400 });
    }

    const groupId = await this.messagingService.findExistingDm(user.id, body.peerUserId);
    return Response.json({ groupId });
  }

  @Post('/peer-info')
  @UseGuards(AuthGuard)
  async peerInfo(req: Request, _user: AuthenticatedUser) {
    let body: { userId?: string };
    try {
      body = (await req.json()) as { userId?: string };
    } catch {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    if (!body.userId) {
      return Response.json({ error: 'userId is required' }, { status: 400 });
    }

    const info = await this.messagingService.getPeerInfo(body.userId);
    if (!info) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    return Response.json(info);
  }

  @Get('/stream')
  @UseGuards(AuthGuard)
  async streamMessages(_req: Request, user: AuthenticatedUser) {
    try {
      const { stream, inboxId } = await this.messagingService.streamMessages(user.id);

      const encoder = new TextEncoder();
      const identityEvent = `data: ${JSON.stringify({ type: 'identity', inboxId })}\n\n`;

      const wrappedStream = new ReadableStream({
        start(controller) {
          const tryEnqueue = (chunk: Uint8Array) => { try { controller.enqueue(chunk); } catch {} };
          const tryClose = () => { try { controller.close(); } catch {} };

          tryEnqueue(encoder.encode(identityEvent));
          const reader = stream.getReader();
          function pump() {
            reader.read().then(({ done, value }) => {
              if (done) { tryClose(); return; }
              tryEnqueue(value);
              pump();
            }).catch(() => tryClose());
          }
          pump();
        },
      });

      return new Response(wrappedStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    } catch (err: any) {
      logger.error('[streamMessages] Error', { userId: user.id, error: err.message });
      return Response.json({ error: err.message }, { status: 503 });
    }
  }
}
