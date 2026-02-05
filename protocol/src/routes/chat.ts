import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { StreamChat, type PartialUpdateChannel } from 'stream-chat';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import db from '../lib/drizzle/drizzle';
import { users, userConnectionEvents } from '../schemas/database.schema';
import { eq, isNull, and, or, desc } from 'drizzle-orm';
import { sendConnectionRequestNotification, sendConnectionAcceptedNotification } from '../lib/notification-service';
import type { CustomChannelData, CustomChannelFilters, CustomChannelMember } from '../types/stream-chat';
import { IntroMakerGenerator } from '../agents/intent/stake/intro/intro-maker.generator';
import { discoverUsers } from '../lib/discover';

const router = Router();

const STREAM_API_KEY = process.env.STREAM_API_KEY || '';
const STREAM_SECRET = process.env.STREAM_SECRET || '';

// Helper: Check if users are connected
async function areUsersConnected(userId1: string, userId2: string): Promise<boolean> {
  const latestEvent = await db.select()
    .from(userConnectionEvents)
    .where(
      or(
        and(
          eq(userConnectionEvents.initiatorUserId, userId1),
          eq(userConnectionEvents.receiverUserId, userId2)
        ),
        and(
          eq(userConnectionEvents.initiatorUserId, userId2),
          eq(userConnectionEvents.receiverUserId, userId1)
        )
      )
    )
    .orderBy(desc(userConnectionEvents.createdAt))
    .limit(1);
  return latestEvent[0]?.eventType === 'ACCEPT';
}

// Helper: Get connection status between two users
async function getConnectionStatus(userId1: string, userId2: string): Promise<{ status: string | null; isInitiator: boolean }> {
  const latestEvent = await db.select()
    .from(userConnectionEvents)
    .where(
      or(
        and(
          eq(userConnectionEvents.initiatorUserId, userId1),
          eq(userConnectionEvents.receiverUserId, userId2)
        ),
        and(
          eq(userConnectionEvents.initiatorUserId, userId2),
          eq(userConnectionEvents.receiverUserId, userId1)
        )
      )
    )
    .orderBy(desc(userConnectionEvents.createdAt))
    .limit(1);
  
  return {
    status: latestEvent[0]?.eventType || null,
    isInitiator: latestEvent[0]?.initiatorUserId === userId1
  };
}

// Helper: Generate consistent channel ID
function generateChannelId(userId1: string, userId2: string): string {
  const sortedIds = [userId1, userId2].sort().join('_');
  if (sortedIds.length > 64) {
    let hash = 0;
    for (let i = 0; i < sortedIds.length; i++) {
      const char = sortedIds.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36).slice(0, 63);
  }
  return sortedIds;
}

// Generate Stream Chat token
router.post('/token',
  authenticatePrivy,
  [body('userId').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { userId } = req.body;

      // Verify user can only generate token for themselves
      if (req.user!.id !== userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const serverClient = StreamChat.getInstance(STREAM_API_KEY, STREAM_SECRET);
      const token = serverClient.createToken(userId);

      return res.json({ token });
    } catch (error) {
      console.error('Error generating Stream token:', error);
      return res.status(500).json({ error: 'Failed to generate token' });
    }
  }
);

// Upsert user in Stream Chat
router.post('/user',
  authenticatePrivy,
  [
    body('userId').isUUID(),
    body('userName').trim().isLength({ min: 1, max: 255 }),
    body('userAvatar').optional().isURL(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { userId, userName, userAvatar } = req.body;

      const serverClient = StreamChat.getInstance(STREAM_API_KEY, STREAM_SECRET);

      await serverClient.upsertUser({
        id: userId,
        name: userName,
        image: userAvatar || `https://api.dicebear.com/9.x/shapes/png?seed=${userId}`,
      });

      return res.json({ success: true });
    } catch (error) {
      console.error('Error upserting Stream user:', error);
      return res.status(500).json({ error: 'Failed to upsert user' });
    }
  }
);

// Create message request (Instagram-style first message)
router.post('/request',
  authenticatePrivy,
  [
    body('targetUserId').isUUID(),
    body('message').trim().isLength({ min: 1, max: 2000 }),
    body('targetUserName').trim().isLength({ min: 1, max: 255 }),
    body('targetUserAvatar').optional()
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const { targetUserId, message, targetUserName, targetUserAvatar } = req.body;

      // Prevent self-messaging
      if (userId === targetUserId) {
        return res.status(400).json({ error: 'Cannot send message request to yourself' });
      }

      // Verify target user exists
      const [targetUser] = await db.select()
        .from(users)
        .where(and(eq(users.id, targetUserId), isNull(users.deletedAt)))
        .limit(1);

      if (!targetUser) {
        return res.status(404).json({ error: 'Target user not found' });
      }

      // Get current user info
      const [currentUser] = await db.select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!currentUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Check connection status
      const connectionStatus = await getConnectionStatus(userId, targetUserId);
      
      // If already connected, just return channel info (they can message directly)
      if (connectionStatus.status === 'ACCEPT') {
        const channelId = generateChannelId(userId, targetUserId);
        return res.json({ 
          channelId, 
          pending: false,
          alreadyConnected: true 
        });
      }

      // If there's already a pending request from this user, don't allow another
      if (connectionStatus.status === 'REQUEST' && connectionStatus.isInitiator) {
        return res.status(400).json({ error: 'You already have a pending request to this user' });
      }

      // Create connection REQUEST event
      await db.insert(userConnectionEvents)
        .values({
          initiatorUserId: userId,
          receiverUserId: targetUserId,
          eventType: 'REQUEST',
        });

      // Create Stream Chat channel with pending state
      const serverClient = StreamChat.getInstance(STREAM_API_KEY, STREAM_SECRET);
      const channelId = generateChannelId(userId, targetUserId);

      // Ensure both users exist in Stream
      await serverClient.upsertUsers([
        {
          id: userId,
          name: currentUser.name,
          image: currentUser.avatar || `https://api.dicebear.com/9.x/shapes/png?seed=${userId}`,
        },
        {
          id: targetUserId,
          name: targetUserName || targetUser.name,
          image: targetUserAvatar || targetUser.avatar || `https://api.dicebear.com/9.x/shapes/png?seed=${targetUserId}`,
        }
      ]);

      // Create channel with pending metadata
      const channel = serverClient.channel('messaging', channelId, {
        members: [userId, targetUserId],
        created_by_id: userId,
        pending: true,
        requestedBy: userId,
      } as CustomChannelData);
      await channel.create();

      // Send the first message
      await channel.sendMessage({
        text: message,
        user_id: userId,
      });

      // Send notification email (fire-and-forget)
      sendConnectionRequestNotification(userId, targetUserId).catch(console.error);

      return res.json({ 
        channelId,
        pending: true
      });
    } catch (error) {
      console.error('Error creating message request:', error);
      return res.status(500).json({ error: 'Failed to create message request' });
    }
  }
);

// Respond to message request (accept/decline/skip)
router.post('/request/respond',
  authenticatePrivy,
  [
    body('channelId').isString(),
    body('action').isIn(['ACCEPT', 'DECLINE', 'SKIP'])
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const { channelId, action } = req.body;

      const serverClient = StreamChat.getInstance(STREAM_API_KEY, STREAM_SECRET);
      
      // Get channel
      const channels = await serverClient.queryChannels({ id: channelId });
      if (channels.length === 0) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      const channel = channels[0];
      const channelData = channel.data as CustomChannelData;

      // Verify this is a pending request
      if (!channelData?.pending) {
        return res.status(400).json({ error: 'This is not a pending message request' });
      }

      // Verify user is the recipient (not the requester)
      if (channelData.requestedBy === userId) {
        return res.status(403).json({ error: 'Cannot respond to your own request' });
      }

      // Verify user is a member
      const members = Object.keys(channel.state.members || {});
      if (!members.includes(userId)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Find the requester
      const requesterId = channelData.requestedBy;
      if (!requesterId) {
        return res.status(400).json({ error: 'Invalid channel: missing requester' });
      }

      // Create connection event
      await db.insert(userConnectionEvents)
        .values({
          initiatorUserId: userId,
          receiverUserId: requesterId,
          eventType: action as 'ACCEPT' | 'DECLINE' | 'SKIP',
        });

      if (action === 'ACCEPT') {
        // Update channel to remove pending state
        // Note: Stream Chat supports custom fields at runtime, but TypeScript types don't include them
        await channel.updatePartial({
          set: { pending: false },
          unset: ['requestedBy']
        } as unknown as PartialUpdateChannel);

        // Send acceptance notification
        sendConnectionAcceptedNotification(userId, requesterId).catch(console.error);

        return res.json({ 
          message: 'Message request accepted',
          channelId 
        });
      } else {
        // DECLINE or SKIP - hide or delete the channel
        // For now, just mark as not pending and let it be hidden
        // Note: Stream Chat supports custom fields at runtime, but TypeScript types don't include them
        await channel.updatePartial({
          set: { 
            pending: false, 
            declined: action === 'DECLINE',
            skipped: action === 'SKIP'
          }
        } as unknown as PartialUpdateChannel);

        return res.json({ 
          message: `Message request ${action.toLowerCase()}ed`,
          channelId 
        });
      }
    } catch (error) {
      console.error('Error responding to message request:', error);
      return res.status(500).json({ error: 'Failed to respond to message request' });
    }
  }
);

// Get pending message requests for current user
router.get('/requests',
  authenticatePrivy,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;

      const serverClient = StreamChat.getInstance(STREAM_API_KEY, STREAM_SECRET);

      // Query channels where:
      // - User is a member
      // - Channel is pending
      // Note: $ne is not supported for custom fields, so we filter client-side
      const allPendingChannels = await serverClient.queryChannels({
        type: 'messaging',
        members: { $in: [userId] },
        pending: true
      } as CustomChannelFilters, { created_at: -1 });

      // Filter out channels where user is the requester
      const channels = allPendingChannels.filter(ch => {
        const data = ch.data as CustomChannelData;
        // User should NOT be the requester (they should see incoming requests)
        if (data.requestedBy === userId) return false;
        return true;
      });

      const requests = channels.map(ch => {
        const data = ch.data as CustomChannelData;
        const members = Object.values(ch.state.members || {}) as CustomChannelMember[];
        const requester = members.find((m) => m.user_id === data.requestedBy);
        const lastMessage = ch.state.messages?.[ch.state.messages.length - 1];

        return {
          channelId: ch.id,
          requester: requester ? {
            id: requester.user_id,
            name: requester.user?.name,
            avatar: requester.user?.image
          } : null,
          firstMessage: lastMessage?.text || null,
          createdAt: ch.data?.created_at
        };
      });

      return res.json({ requests });
    } catch (error) {
      console.error('Error fetching message requests:', error);
      return res.status(500).json({ error: 'Failed to fetch message requests' });
    }
  }
);

// Check if user can message another user directly (or needs to send request)
router.get('/can-message/:targetUserId',
  authenticatePrivy,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { targetUserId } = req.params;

      if (userId === targetUserId) {
        return res.status(400).json({ error: 'Cannot check messaging with yourself' });
      }

      const connected = await areUsersConnected(userId, targetUserId);
      const connectionStatus = await getConnectionStatus(userId, targetUserId);

      return res.json({
        canMessageDirectly: connected,
        connectionStatus: connectionStatus.status,
        isInitiator: connectionStatus.isInitiator,
        requiresRequest: !connected && connectionStatus.status !== 'REQUEST'
      });
    } catch (error) {
      console.error('Error checking message permission:', error);
      return res.status(500).json({ error: 'Failed to check message permission' });
    }
  }
);

// Generate suggested intro message for starting a conversation
router.post('/suggest-intro',
  authenticatePrivy,
  [
    body('targetUserId').isUUID(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const { targetUserId } = req.body;

      // Prevent self-messaging
      if (userId === targetUserId) {
        return res.status(400).json({ error: 'Cannot generate intro for yourself' });
      }

      // Get user info
      const [currentUser, targetUser] = await Promise.all([
        db.select().from(users).where(eq(users.id, userId)).limit(1),
        db.select().from(users).where(eq(users.id, targetUserId)).limit(1)
      ]);

      if (!currentUser[0] || !targetUser[0]) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Fetch mutual intents/stakes between the two users
      const { results } = await discoverUsers({
        authenticatedUserId: userId,
        userIds: [targetUserId],
        excludeDiscovered: false,
        limit: 1
      });

      const senderReasonings: string[] = [];
      const recipientReasonings: string[] = [];

      if (results.length > 0 && results[0].intents.length > 0) {
        // Extract reasonings from discovered intents
        for (const intentData of results[0].intents.slice(0, 3)) {
          const text = intentData.intent.summary || intentData.intent.payload;
          senderReasonings.push(text);
          // Also include the stake reasonings if available
          if (intentData.reasonings.length > 0) {
            recipientReasonings.push(...intentData.reasonings.slice(0, 2));
          } else {
            recipientReasonings.push(text);
          }
        }
      }

      // Skip intro generation if no context available
      if (senderReasonings.length === 0) {
        return res.json({
          message: `Hi ${targetUser[0].name}, I'd love to connect!`,
          generatedAt: new Date().toISOString()
        });
      }

      // Generate intro using agent
      const introMaker = new IntroMakerGenerator();

      const result = await introMaker.run({
        sender: {
          name: currentUser[0].name,
          reasonings: senderReasonings.slice(0, 3)
        },
        recipient: {
          name: targetUser[0].name,
          reasonings: recipientReasonings.slice(0, 3)
        }
      });

      return res.json({
        message: result.message,
        generatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error generating intro message:', error);
      return res.status(500).json({ error: 'Failed to generate intro message' });
    }
  }
);

export default router;

