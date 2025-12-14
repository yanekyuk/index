import { Router, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import db from '../lib/db';
import { users, userConnectionEvents, intents, intentIndexes, indexMembers, indexes } from '../lib/schema';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { eq, isNull, and, or, desc, sql, inArray } from 'drizzle-orm';
import { sendConnectionRequestNotification, sendConnectionAcceptedNotification } from '../lib/notification-service';
import { validateAndGetAccessibleIndexIds } from '../lib/index-access';
import { ConnectionEvent, ConnectionsByUserResponse, CreateConnectionActionRequest } from '../types';



const router = Router();


// Export handler for testing
export const getConnectionsByUser = async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user!.id;
    const { type = 'inbox', indexIds } = req.body;

    // Use generic validation function
    const { validIndexIds, error } = await validateAndGetAccessibleIndexIds(userId, indexIds);
    if (error) {
      return res.status(error.status).json({
        error: error.message,
        invalidIds: error.invalidIds
      });
    }

    // If user has no accessible indexes, return empty results
    if (validIndexIds.length === 0) {
      return res.json({ connections: [] });
    }

    // Get all connection events involving this user
    const allEvents = await db.select({
      initiatorUserId: userConnectionEvents.initiatorUserId,
      receiverUserId: userConnectionEvents.receiverUserId,
      eventType: userConnectionEvents.eventType,
      createdAt: userConnectionEvents.createdAt,
    })
      .from(userConnectionEvents)
      .where(
        or(
          eq(userConnectionEvents.initiatorUserId, userId),
          eq(userConnectionEvents.receiverUserId, userId)
        )
      )
      .orderBy(desc(userConnectionEvents.createdAt));

    // Aggregate events by other user to get current state
    const connectionStates = new Map();

    for (const event of allEvents) {
      const otherUserId = event.initiatorUserId === userId ? event.receiverUserId : event.initiatorUserId;

      if (!connectionStates.has(otherUserId)) {
        connectionStates.set(otherUserId, {
          otherUserId,
          currentStatus: event.eventType,
          isInitiator: event.initiatorUserId === userId,
          lastUpdated: event.createdAt
        });
      }
    }

    // Filter by type
    let filteredConnections = Array.from(connectionStates.values()).filter(conn => {
      switch (type) {
        case 'inbox':
          // Show REQUEST or OWNER_APPROVE if user is RECEIVER
          return (conn.currentStatus === 'REQUEST' || conn.currentStatus === 'OWNER_APPROVE') && !conn.isInitiator;
        case 'pending':
          // Show REQUEST or OWNER_APPROVE if user is INITIATOR
          return (conn.currentStatus === 'REQUEST' || conn.currentStatus === 'OWNER_APPROVE') && conn.isInitiator;
        case 'history':
          return ['ACCEPT', 'DECLINE', 'SKIP', 'CANCEL', 'OWNER_DENY'].includes(conn.currentStatus);
        default:
          return true;
      }
    });

    if (filteredConnections.length === 0) {
      return res.json({ connections: [] });
    }

    // Pre-fetch check for visibility logic if fetching inbox
    // We need to know permissions of indexes shared between users if status is REQUEST
    if (type === 'inbox') {
      // IDs of potential connections
      const otherUserIds = filteredConnections.map(c => c.otherUserId);

      // Fetch all index memberships for these users + current user
      // We only care about indexes that are ALSO in validIndexIds (accessible to current user)
      const memberships = await db.select({
        userId: indexMembers.userId,
        indexId: indexMembers.indexId,
        requireApproval: sql<boolean>`(${indexes.permissions}->>'requireApproval')::boolean`
      })
        .from(indexMembers)
        .innerJoin(indexes, eq(indexMembers.indexId, indexes.id))
        .where(and(
          inArray(indexMembers.userId, [userId, ...otherUserIds]),
          inArray(indexMembers.indexId, validIndexIds)
        ));

      // Build map: userId -> Set of Index objects {id, requireApproval}
      const userIndexes = new Map<string, { id: string, requireApproval: boolean }[]>();

      memberships.forEach(m => {
        if (!userIndexes.has(m.userId)) userIndexes.set(m.userId, []);
        userIndexes.get(m.userId)?.push({
          id: m.indexId,
          requireApproval: m.requireApproval === true // explicit check for true
        });
      });

      const myIndexes = userIndexes.get(userId) || [];

      filteredConnections = filteredConnections.filter(conn => {
        // Logic:
        // 1. If status is OWNER_APPROVE, show it (admin already approved).
        if (conn.currentStatus === 'OWNER_APPROVE') return true;

        // 2. If status is REQUEST:
        if (conn.currentStatus === 'REQUEST') {
          const partnerIndexes = userIndexes.get(conn.otherUserId) || [];

          // Find shared indexes
          const sharedIndexes = myIndexes.filter(myIdx =>
            partnerIndexes.some(pIdx => pIdx.id === myIdx.id)
          );

          // If no shared indexes (weird, but possible if removed), don't show request?
          // Or standard behavior? Assume hidden if not explicit.
          if (sharedIndexes.length === 0) return false;

          // Check if ANY shared index is open (requireApproval != true).
          // If true, the request is visible immediately because the Open Index policy
          // allows connections without pre-approval.
          const hasOpenIndex = sharedIndexes.some(idx => !idx.requireApproval);

          if (hasOpenIndex) return true; // Visible immediately

          // If ALL shared indexes require approval, HIDE it (wait for OWNER_APPROVE)
          return false;
        }
        return true;
      });
    }

    // Get user details for filtered connections
    if (filteredConnections.length === 0) {
      return res.json({ connections: [] });
    }

    let otherUserIds = filteredConnections.map(conn => conn.otherUserId);

    // Verify they have intents in accessible indexes (redundant check? but good for safety if logic above missed something)
    // Actually intent index check is separate from member index check.
    const usersWithIntentsInIndexes = await db.select({ userId: intents.userId })
      .from(intents)
      .innerJoin(intentIndexes, eq(intents.id, intentIndexes.intentId))
      .where(and(
        inArray(intents.userId, otherUserIds),
        inArray(intentIndexes.indexId, validIndexIds),
        isNull(intents.archivedAt)
      ));

    const validUserIds = new Set(usersWithIntentsInIndexes.map(u => u.userId));
    otherUserIds = otherUserIds.filter(userId => validUserIds.has(userId));

    if (otherUserIds.length === 0) {
      return res.json({ connections: [] });
    }

    const otherUsers = await db.select({
      id: users.id,
      name: users.name,
      avatar: users.avatar
    })
      .from(users)
      .where(inArray(users.id, otherUserIds));

    // Generate connections array
    const connections = await Promise.all(
      filteredConnections.map(async (conn) => {
        // If filtered out by intent check
        if (!validUserIds.has(conn.otherUserId)) return null;

        const user = otherUsers.find(u => u.id === conn.otherUserId);
        if (!user) return null;

        return {
          user,
          status: conn.currentStatus,
          isInitiator: conn.isInitiator,
          lastUpdated: conn.lastUpdated
        };
      })
    );

    const validConnections = connections.filter(conn => conn !== null);

    return res.json({ connections: validConnections });
  } catch (error) {
    console.error('Get connections by user error:', error);
    return res.status(500).json({ error: 'Failed to fetch connections' });
  }
};

// Get connections by user (aggregated current state)
router.post('/by-user',
  authenticatePrivy,
  [
    body('type').optional().isIn(['inbox', 'pending', 'history']),
    body('page').optional().isInt({ min: 1 }).toInt(),
    body('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
    body('indexIds').optional().isArray(),
    body('indexIds.*').optional().isUUID()
  ],
  getConnectionsByUser
);

// Create a connection action (REQUEST, SKIP, CANCEL, ACCEPT, DECLINE)
// Export handler for testing
export const createConnectionAction = async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user!.id;
    const { targetUserId, action } = req.body;

    // Prevent self-connections
    if (userId === targetUserId) {
      return res.status(400).json({ error: 'Cannot connect to yourself' });
    }

    const [targetUser, latestEvent] = await Promise.all([
      // Verify target user exists
      db.select()
        .from(users)
        .where(and(eq(users.id, targetUserId), isNull(users.deletedAt)))
        .limit(1),
      // Get the latest connection event
      db.select()
        .from(userConnectionEvents)
        .where(
          or(
            and(
              eq(userConnectionEvents.initiatorUserId, userId),
              eq(userConnectionEvents.receiverUserId, targetUserId)
            ),
            and(
              eq(userConnectionEvents.initiatorUserId, targetUserId),
              eq(userConnectionEvents.receiverUserId, userId)
            )
          )
        )
        .orderBy(desc(userConnectionEvents.createdAt))
        .limit(1)
    ]);

    if (targetUser.length === 0) {
      return res.status(404).json({ error: 'Target user not found' });
    }

    const currentState = latestEvent[0]?.eventType;

    // Validate action based on current state and user role
    const isInitiator = latestEvent[0]?.initiatorUserId === userId;
    const isReceiver = latestEvent[0]?.receiverUserId === userId;

    // Business logic for valid transitions
    let isValidAction = false;
    let newInitiatorId = userId;
    let newReceiverId = targetUserId;

    switch (action) {
      case 'REQUEST':
        // Can request if no prior connection or if previously declined/skipped
        isValidAction = !currentState ||
          currentState === 'DECLINE' ||
          currentState === 'SKIP' ||
          currentState === 'CANCEL';
        break;
      case 'SKIP':
        // Can skip if no prior connection (skipping a suggestion) or if receiving a request
        isValidAction = !currentState ||
          currentState === 'DECLINE' ||
          currentState === 'SKIP' ||
          currentState === 'CANCEL' ||
          (currentState === 'REQUEST' && isReceiver);
        break;
      case 'ACCEPT':
        // Can accept if receiving a request
        isValidAction = (currentState === 'REQUEST' || currentState === 'OWNER_APPROVE') && isReceiver;
        break;
      case 'DECLINE':
        // Can decline if receiving a request
        isValidAction = (currentState === 'REQUEST' || currentState === 'OWNER_APPROVE') && isReceiver;
        break;
      case 'CANCEL':
        // Can cancel if you initiated the request and it's still pending
        isValidAction = currentState === 'REQUEST' && isInitiator;
        break;
    }

    if (!isValidAction) {
      return res.status(400).json({
        error: `Cannot ${action.toLowerCase()} in current state: ${currentState}`
      });
    }

    // Create the new connection event
    const newEvent = await db.insert(userConnectionEvents)
      .values({
        initiatorUserId: newInitiatorId,
        receiverUserId: newReceiverId,
        eventType: action as any,
      })
      .returning();

    // Send appropriate emails asynchronously (fire-and-forget)
    if (action === 'REQUEST') {
      sendConnectionRequestNotification(userId, targetUserId).catch(console.error);
    } else if (action === 'ACCEPT') {
      sendConnectionAcceptedNotification(userId, targetUserId).catch(console.error);
    }

    return res.json({
      message: `Connection ${action.toLowerCase()} successful`,
      event: newEvent[0]
    });
  } catch (error) {
    console.error('Create connection action error:', error);
    return res.status(500).json({ error: 'Failed to create connection action' });
  }
};

// Create a connection action (REQUEST, SKIP, CANCEL, ACCEPT, DECLINE)
router.post('/actions',
  authenticatePrivy,
  [
    body('targetUserId').isUUID().withMessage('Target user ID must be a valid UUID'),
    body('action').isIn(['REQUEST', 'SKIP', 'CANCEL', 'ACCEPT', 'DECLINE'])
      .withMessage('Action must be one of: REQUEST, SKIP, CANCEL, ACCEPT, DECLINE')
  ],
  createConnectionAction
);

// Get connection status between current user and target user
router.get('/status/:targetUserId',
  authenticatePrivy,
  [param('targetUserId').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const { targetUserId } = req.params;

      if (userId === targetUserId) {
        return res.status(400).json({ error: 'Cannot check connection status with yourself' });
      }

      // Get latest connection event between these users
      const latestEvent = await db.select()
        .from(userConnectionEvents)
        .where(
          or(
            and(
              eq(userConnectionEvents.initiatorUserId, userId),
              eq(userConnectionEvents.receiverUserId, targetUserId)
            ),
            and(
              eq(userConnectionEvents.initiatorUserId, targetUserId),
              eq(userConnectionEvents.receiverUserId, userId)
            )
          )
        )
        .orderBy(desc(userConnectionEvents.createdAt))
        .limit(1);

      const status = latestEvent[0]?.eventType || 'none';
      const isInitiator = latestEvent[0]?.initiatorUserId === userId;

      return res.json({
        status,
        isInitiator,
        event: latestEvent[0] || null
      });
    } catch (error) {
      console.error('Get connection status error:', error);
      return res.status(500).json({ error: 'Failed to get connection status' });
    }
  }
);

export default router; 