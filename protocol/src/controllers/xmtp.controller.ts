import { AuthGuard, type AuthenticatedUser } from "../guards/auth.guard";
import { log } from "../lib/log";
import {
  Controller,
  Get,
  Post,
  UseGuards,
} from "../lib/router/router.decorators";
import { and, inArray, eq, sql, desc } from "drizzle-orm";
import {
  getUserClient,
  getOrCreateDm,
  findExistingDm,
} from "../adapters/xmtp.adapter";
import { getPublicXmtpInfo } from "../services/wallet.service";
import { isText } from "@xmtp/node-sdk";
import db from "../lib/drizzle/drizzle";
import { users, opportunities, hiddenConversations } from "../schemas/database.schema";

function extractText(msg: { content: unknown }): string {
  if (isText(msg as any)) return msg.content as string;
  if (typeof msg.content === 'string') return msg.content;
  return '';
}

const logger = log.controller.from("xmtp");

@Controller("/xmtp")
export class XmtpController {
  @Get("/conversations")
  @UseGuards(AuthGuard)
  async listConversations(_req: Request, user: AuthenticatedUser) {
    const client = await getUserClient(user.id);
    if (!client) {
      return Response.json({ error: "XMTP client not available" }, { status: 503 });
    }

    await client.conversations.syncAll();
    const dms = await client.conversations.listDms();

    const allInboxIds = new Set<string>();
    const dmData: {
      dmId: string;
      peerInboxId: string | null;
      lastMessage: { content: string; sentAt: string } | null;
      updatedAt: string | null;
    }[] = [];

    const myInboxId = client.inboxId;

    const hiddenRows = await db
      .select({ conversationId: hiddenConversations.conversationId, hiddenAt: hiddenConversations.hiddenAt })
      .from(hiddenConversations)
      .where(eq(hiddenConversations.userId, user.id));
    const hiddenMap = new Map(hiddenRows.map((r) => [r.conversationId, r.hiddenAt]));

    for (const dm of dms) {
      const members = await dm.members();
      const peerMember = members.find((m) => m.inboxId !== myInboxId);
      const peerInboxId = peerMember?.inboxId ?? null;
      if (peerInboxId) allInboxIds.add(peerInboxId);

      const hiddenAt = hiddenMap.get(dm.id);
      const hiddenAtNs = hiddenAt ? BigInt(hiddenAt.getTime()) * BigInt(1_000_000) : null;

      const msgs = await dm.messages({ limit: 10 });
      const visibleMsgs = hiddenAtNs
        ? msgs.filter((m) => m.sentAtNs != null && BigInt(m.sentAtNs.toString()) > hiddenAtNs)
        : msgs;

      if (hiddenAt && visibleMsgs.length === 0) continue;

      const lastText = visibleMsgs.find((m) => extractText(m) !== '');
      dmData.push({
        dmId: dm.id,
        peerInboxId,
        lastMessage: lastText
          ? { content: extractText(lastText), sentAt: lastText.sentAtNs?.toString() ?? '' }
          : null,
        updatedAt: visibleMsgs[0]?.sentAtNs?.toString() ?? null,
      });
    }

    const inboxIdList = [...allInboxIds];
    const matchedUsers = inboxIdList.length
      ? await db
          .select({ id: users.id, name: users.name, avatar: users.avatar, xmtpInboxId: users.xmtpInboxId })
          .from(users)
          .where(inArray(users.xmtpInboxId, inboxIdList))
      : [];
    const inboxToUser = new Map<string, { id: string; name: string; avatar: string | null }>();
    for (const u of matchedUsers) {
      if (u.xmtpInboxId) inboxToUser.set(u.xmtpInboxId, { id: u.id, name: u.name, avatar: u.avatar });
    }

    const result = dmData.map((d) => {
      const peer = d.peerInboxId ? inboxToUser.get(d.peerInboxId) : null;
      return {
        groupId: d.dmId,
        name: peer?.name ?? 'Conversation',
        peerUserId: peer?.id ?? null,
        peerAvatar: peer?.avatar ?? null,
        lastMessage: d.lastMessage,
        updatedAt: d.updatedAt,
      };
    });

    return Response.json({ conversations: result });
  }

  @Get("/chat-context")
  @UseGuards(AuthGuard)
  async getChatContext(req: Request, user: AuthenticatedUser) {
    const url = new URL(req.url, 'http://localhost');
    const peerUserId = url.searchParams.get('peerUserId');
    if (!peerUserId) {
      return Response.json({ error: "peerUserId query param is required" }, { status: 400 });
    }

    let groupId: string | null = null;
    try {
      groupId = await findExistingDm(user.id, peerUserId);
    } catch {
      // Wallet/client not ready yet
    }

    const rows = await db
      .select()
      .from(opportunities)
      .where(
        and(
          sql`${opportunities.actors} @> ${JSON.stringify([{ userId: user.id }])}::jsonb`,
          sql`${opportunities.actors} @> ${JSON.stringify([{ userId: peerUserId }])}::jsonb`,
          eq(opportunities.status, 'accepted'),
        )
      )
      .orderBy(desc(opportunities.updatedAt));

    const peerUser = await db.select({ name: users.name, avatar: users.avatar }).from(users).where(eq(users.id, peerUserId)).limit(1);
    const peer = peerUser[0];

    const opportunityCards = rows.map((opp) => ({
      opportunityId: opp.id,
      headline: (opp.interpretation as any)?.reasoning?.substring(0, 80) ?? 'Connection opportunity',
      summary: (opp.interpretation as any)?.reasoning ?? '',
      peerName: peer?.name ?? 'Someone',
      peerAvatar: peer?.avatar ?? null,
      acceptedAt: opp.updatedAt?.toISOString() ?? null,
    }));

    return Response.json({ groupId, opportunities: opportunityCards });
  }

  @Post("/messages")
  @UseGuards(AuthGuard)
  async getMessages(req: Request, user: AuthenticatedUser) {
    let body: { groupId?: string; limit?: number };
    try {
      body = (await req.json()) as { groupId?: string; limit?: number };
    } catch {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }

    if (!body.groupId) {
      return Response.json({ error: "groupId is required" }, { status: 400 });
    }

    const client = await getUserClient(user.id);
    if (!client) {
      return Response.json({ error: "XMTP client not available" }, { status: 503 });
    }

    await client.conversations.syncAll();
    const conversation = await client.conversations.getConversationById(body.groupId);
    if (!conversation) {
      return Response.json({ error: "Conversation not found" }, { status: 404 });
    }

    await conversation.sync();
    const allMessages = await conversation.messages({ limit: body.limit ?? 50 });

    const [hidden] = await db
      .select({ hiddenAt: hiddenConversations.hiddenAt })
      .from(hiddenConversations)
      .where(and(eq(hiddenConversations.userId, user.id), eq(hiddenConversations.conversationId, body.groupId)))
      .limit(1);

    const hiddenAtNs = hidden?.hiddenAt ? BigInt(hidden.hiddenAt.getTime()) * BigInt(1_000_000) : null;
    const messages = hiddenAtNs
      ? allMessages.filter((m) => m.sentAtNs != null && BigInt(m.sentAtNs.toString()) > hiddenAtNs)
      : allMessages;

    return Response.json({
      messages: messages.map((m) => ({
        id: m.id,
        senderInboxId: m.senderInboxId,
        content: extractText(m),
        sentAt: m.sentAtNs?.toString(),
      })),
    });
  }

  @Post("/send")
  @UseGuards(AuthGuard)
  async sendMessage(req: Request, user: AuthenticatedUser) {
    let body: { groupId?: string; peerUserId?: string; text?: string };
    try {
      body = (await req.json()) as { groupId?: string; peerUserId?: string; text?: string };
    } catch {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }

    if (!body.text?.trim()) {
      return Response.json({ error: "text is required" }, { status: 400 });
    }
    if (!body.groupId && !body.peerUserId) {
      return Response.json({ error: "groupId or peerUserId is required" }, { status: 400 });
    }

    const client = await getUserClient(user.id);
    if (!client) {
      return Response.json({ error: "XMTP client not available" }, { status: 503 });
    }

    let resolvedGroupId = body.groupId ?? null;

    if (!resolvedGroupId && body.peerUserId) {
      resolvedGroupId = await getOrCreateDm(user.id, body.peerUserId);
      if (!resolvedGroupId) {
        return Response.json({ error: "Could not create DM" }, { status: 500 });
      }
    }

    await client.conversations.syncAll();
    const conversation = await client.conversations.getConversationById(resolvedGroupId!);
    if (!conversation) {
      return Response.json({ error: "Conversation not found" }, { status: 404 });
    }

    await conversation.sendText(body.text.trim());
    return Response.json({ success: true, groupId: resolvedGroupId });
  }

  @Post("/conversations/delete")
  @UseGuards(AuthGuard)
  async deleteConversation(req: Request, user: AuthenticatedUser) {
    let body: { conversationId?: string };
    try {
      body = (await req.json()) as { conversationId?: string };
    } catch {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }

    if (!body.conversationId) {
      return Response.json({ error: "conversationId is required" }, { status: 400 });
    }

    await db
      .insert(hiddenConversations)
      .values({ userId: user.id, conversationId: body.conversationId })
      .onConflictDoUpdate({
        target: [hiddenConversations.userId, hiddenConversations.conversationId],
        set: { hiddenAt: new Date() },
      });

    return Response.json({ success: true });
  }

  @Post("/peer-info")
  @UseGuards(AuthGuard)
  async peerInfo(req: Request, _user: AuthenticatedUser) {
    let body: { userId?: string };
    try {
      body = (await req.json()) as { userId?: string };
    } catch {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }

    if (!body.userId) {
      return Response.json({ error: "userId is required" }, { status: 400 });
    }

    const info = await getPublicXmtpInfo(body.userId);
    if (!info) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    return Response.json(info);
  }

  @Get("/stream")
  @UseGuards(AuthGuard)
  async streamMessages(_req: Request, user: AuthenticatedUser) {
    const client = await getUserClient(user.id);
    if (!client) {
      return Response.json({ error: "XMTP client not available" }, { status: 503 });
    }

    try {
      await client.conversations.syncAll();
    } catch (err) {
      logger.warn('[streamMessages] syncAll failed, continuing', {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const encoder = new TextEncoder();
    const keepAlive = `: keepalive\n\n`;

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "identity", inboxId: client.inboxId })}\n\n`));

        const interval = setInterval(() => {
          try { controller.enqueue(encoder.encode(keepAlive)); } catch { clearInterval(interval); }
        }, 15_000);

        client.conversations
          .streamAllMessages({
            onError: (error) => {
              logger.warn('[streamMessages] Stream onError', {
                userId: user.id,
                error: error instanceof Error ? error.message : String(error),
              });
            },
            onFail: () => {
              logger.warn('[streamMessages] Stream onFail — exhausted retries', { userId: user.id });
              clearInterval(interval);
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "Stream failed" })}\n\n`));
              controller.close();
            },
          })
          .then(async (messageStream) => {
            try {
              for await (const message of messageStream) {
                const event = {
                  type: "message",
                  id: message.id,
                  groupId: message.conversationId,
                  senderInboxId: message.senderInboxId,
                  content: extractText(message),
                  sentAt: message.sentAtNs?.toString(),
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
              }
            } catch (err) {
              logger.error('[streamMessages] for-await error', {
                userId: user.id,
                error: err instanceof Error ? err.message : String(err),
              });
            } finally {
              clearInterval(interval);
              controller.close();
            }
          })
          .catch((err) => {
            logger.error('[streamMessages] streamAllMessages creation failed', {
              userId: user.id,
              error: err instanceof Error ? err.message : String(err),
            });
            clearInterval(interval);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "Stream init failed" })}\n\n`));
            controller.close();
          });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }
}
