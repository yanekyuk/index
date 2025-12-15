import { Router, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import db from '../lib/db';
import { users, userConnectionEvents, indexes, indexMembers } from '../lib/schema';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { eq, isNull, and, or, desc, inArray, sql } from 'drizzle-orm';
import { checkIndexOwnership } from '../lib/index-access';
import { ConnectionEvent } from '../types';
import { sendConnectionRequestEmail } from '../lib/email/notification.sender'; // Use lower-level sender to bypass checks
import { synthesizeVibeCheck } from '../lib/synthesis';
import DOMPurify from 'isomorphic-dompurify';

const router = Router();

// Get pending connection requests for an index requiring approval
// Export handler for testing
export const getPendingConnections = async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user!.id;
    const { indexId } = req.params;

    // Verify user is index owner
    const ownerCheck = await checkIndexOwnership(indexId, userId);
    if (!ownerCheck.hasAccess) {
      return res.status(ownerCheck.status || 403).json({ error: ownerCheck.error || 'Only index owners can view pending connections' });
    }

    // Verify index has requireApproval enabled
    const indexData = await db.select()
      .from(indexes)
      .where(and(eq(indexes.id, indexId), isNull(indexes.deletedAt)))
      .limit(1);

    if (indexData.length === 0) {
      return res.status(404).json({ error: 'Index not found' });
    }

    const requiresApproval = (indexData[0].permissions as any)?.requireApproval;
    if (!requiresApproval) {
      return res.json({ connections: [] });
    }

    // Get all members of this index
    const indexMemberIds = await db.select({ userId: indexMembers.userId })
      .from(indexMembers)
      .where(eq(indexMembers.indexId, indexId))
      .then(rows => rows.map(r => r.userId));

    if (indexMemberIds.length === 0) {
      return res.json({ connections: [] });
    }

    // Get connection events of type REQUEST or ACCEPT where both users are index members
    // We want to find pairs that are either:
    // 1. Pending Request (REQUEST)
    // 2. Already Connected (ACCEPT) but NOT yet approved by THIS index admin (missing OWNER_APPROVE)
    const potentialEvents = await db.select({
      id: userConnectionEvents.id,
      initiatorUserId: userConnectionEvents.initiatorUserId,
      receiverUserId: userConnectionEvents.receiverUserId,
      eventType: userConnectionEvents.eventType,
      createdAt: userConnectionEvents.createdAt,
    })
      .from(userConnectionEvents)
      .where(and(
        inArray(userConnectionEvents.eventType, ['REQUEST', 'ACCEPT']),
        inArray(userConnectionEvents.initiatorUserId, indexMemberIds),
        inArray(userConnectionEvents.receiverUserId, indexMemberIds)
      ))
      .orderBy(desc(userConnectionEvents.createdAt));

    // For each candidate, check the full history to determine if it's "pending approval"
    const pendingConnections = [];
    const processedPairs = new Set<string>(); // prevent dupes (A-B and B-A)

    for (const event of potentialEvents) {
      const pairKey = [event.initiatorUserId, event.receiverUserId].sort().join(':');
      if (processedPairs.has(pairKey)) continue;
      processedPairs.add(pairKey);

      // Get full history for this pair
      const history = await db.select()
        .from(userConnectionEvents)
        .where(
          or(
            and(
              eq(userConnectionEvents.initiatorUserId, event.initiatorUserId),
              eq(userConnectionEvents.receiverUserId, event.receiverUserId)
            ),
            and(
              eq(userConnectionEvents.initiatorUserId, event.receiverUserId),
              eq(userConnectionEvents.receiverUserId, event.initiatorUserId)
            )
          )
        )
        .orderBy(desc(userConnectionEvents.createdAt));

      const latest = history[0];

      // If no history (weird), skip
      if (!latest) continue;

      // Check if explicitly approved by owner (OWNER_APPROVE exists in history)
      // Note: Ideally we'd link approval to specific index, but currently it's global connection state.
      // Assuming OWNER_APPROVE implies "approved by SOME admin". 
      // If we need per-index tracking, we need schema change. 
      // For now, based on instructions: "Admins of Index B should receive the connection request approval still."
      // We will assume if *latest* state is OWNER_APPROVE, it's pending user accept.
      // If OWNER_APPROVE exists *anywhere*, is it approved? 
      // Let's refine: We show it if:
      // 1. Current State is REQUEST.
      // 2. Current State is ACCEPT, but NO OWNER_APPROVE event exists in history (meaning it formed via open network).

      const isApproved = history.some(e => e.eventType === 'OWNER_APPROVE');
      const isDenied = history.some(e => e.eventType === 'OWNER_DENY' && e.createdAt > latest.createdAt); // Deny after latest? No, simply check latest state.

      let shouldShow = false;

      if (latest.eventType === 'REQUEST') {
        // It's a request. If NOT approved yet, show it.
        // (If it was approved, it would be OWNER_APPROVE state usually, unless User B hasn't accepted yet. 
        // If state is OWNER_APPROVE, admin doesn't need to approve again).
        if (!isApproved) shouldShow = true;
      } else if (latest.eventType === 'ACCEPT') {
        // It's a connection. Check if it lacks approval (Hybrid Not-Verified case).
        if (!isApproved) shouldShow = true;
      }

      if (shouldShow) {
        // Get user details
        const [initiator, receiver] = await Promise.all([
          db.select({
            id: users.id,
            name: users.name,
            avatar: users.avatar
          }).from(users).where(eq(users.id, event.initiatorUserId)).limit(1),
          db.select({
            id: users.id,
            name: users.name,
            avatar: users.avatar
          }).from(users).where(eq(users.id, event.receiverUserId)).limit(1)
        ]);

        if (initiator.length > 0 && receiver.length > 0) {
          pendingConnections.push({
            id: event.id, // ID of the event we found (req or accept)
            initiator: initiator[0],
            receiver: receiver[0],
            createdAt: event.createdAt,
            status: latest.eventType // Pass status so FE knows if it's "New Request" vs "Unverified Connection"
          });
        }
      }
    }

    return res.json({ connections: pendingConnections });
  } catch (error) {
    console.error('Get pending connections error:', error);
    return res.status(500).json({ error: 'Failed to fetch pending connections' });
  }
}


// Get pending connection requests for an index requiring approval
router.get('/:indexId/pending-connections',
  authenticatePrivy,
  [param('indexId').isUUID()],
  getPendingConnections
);

// Approve a connection request
// Export handler for testing
export const approveConnection = async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user!.id;
    const { indexId } = req.params;
    const { initiatorUserId, receiverUserId } = req.body;

    // Verify user is index owner
    const ownerCheck = await checkIndexOwnership(indexId, userId);
    if (!ownerCheck.hasAccess) {
      return res.status(ownerCheck.status || 403).json({ error: ownerCheck.error || 'Only index owners can approve connections' });
    }

    // Verify both users are members of this index
    const memberCheck = await db.select()
      .from(indexMembers)
      .where(and(
        eq(indexMembers.indexId, indexId),
        or(
          eq(indexMembers.userId, initiatorUserId),
          eq(indexMembers.userId, receiverUserId)
        )
      ));

    const memberIds = memberCheck.map(m => m.userId);
    if (!memberIds.includes(initiatorUserId) || !memberIds.includes(receiverUserId)) {
      return res.status(403).json({ error: 'Both users must be members of this index' });
    }

    // Verify connection request exists
    const latestEvent = await db.select()
      .from(userConnectionEvents)
      .where(
        or(
          and(
            eq(userConnectionEvents.initiatorUserId, initiatorUserId),
            eq(userConnectionEvents.receiverUserId, receiverUserId)
          ),
          and(
            eq(userConnectionEvents.initiatorUserId, receiverUserId),
            eq(userConnectionEvents.receiverUserId, initiatorUserId)
          )
        )
      )
      .orderBy(desc(userConnectionEvents.createdAt))
      .limit(1);

    if (!latestEvent[0]) {
      return res.status(400).json({ error: 'No connection history found' });
    }

    const currentState = latestEvent[0].eventType;
    if (currentState !== 'REQUEST' && currentState !== 'ACCEPT') {
      return res.status(400).json({ error: `Cannot approve connection in state: ${currentState}` });
    }

    // Insert OWNER_APPROVE event
    await db.insert(userConnectionEvents).values({
      initiatorUserId: latestEvent[0].initiatorUserId,
      receiverUserId: latestEvent[0].receiverUserId,
      eventType: 'OWNER_APPROVE',
    });

    // Prepare email data
    const [initiator, receiver] = await Promise.all([
      db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, initiatorUserId)).limit(1),
      db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, receiverUserId)).limit(1)
    ]);

    if (!initiator[0] || !receiver[0]) {
      return res.json({ message: 'Approval recorded, but failed to send emails (users not found).' });
    }

    // Generate Synthesis (Vibe Check)
    let synthesis = '';
    try {
      const { synthesis: synthesisMarkdown } = await synthesizeVibeCheck(
        receiverUserId,
        initiatorUserId,
        { vibeOptions: { characterLimit: 500 } }
      );
      // Strip links and sanitize
      const cleanMarkdown = synthesisMarkdown.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
      const markedMod = await import('marked');
      const parse = markedMod.parse || (markedMod as any).default?.parse || (markedMod as any).marked?.parse;
      if (parse) {
        const rawHtml = await parse(cleanMarkdown);
        synthesis = DOMPurify.sanitize(rawHtml);
      }
    } catch (err) {
      console.warn("Failed to synthesize vibe check for email", err);
      synthesis = "A new connection has been approved by the network admin.";
    }

    if (currentState === 'REQUEST') {
      // Standard Case: Request -> Owner Approve
      // Send "Connection Request Approved" email to User B (Receiver)
      await sendConnectionRequestEmail(
        receiver[0].email,
        initiator[0].name,
        receiver[0].name,
        synthesis,
        'New Connection Request Approved'
      ).catch(console.error);

    } else if (currentState === 'ACCEPT') {
      // Hybrid Case handling:
      // Users were already connected via an Open Index, but are now being approved for a Restricted Index.
      // We insert OWNER_APPROVE to mark this specific restricted context as "verified".
      // Then we immediately insert ACCEPT to restore the connected status, ensuring no service interruption.
      // Insert IMMEDIATE matching ACCEPT to preserve connection status
      await db.insert(userConnectionEvents).values({
        initiatorUserId: latestEvent[0].initiatorUserId, // Keep original initiator
        receiverUserId: latestEvent[0].receiverUserId,
        eventType: 'ACCEPT' as any,
      });

      // Send "Connection Verified" email to BOTH? Or Just Receiver?
      // User said: "they should still receive email... explicitly state admin approved this"
      // Let's send to Receiver (User B) as they are usually the gatekeeper.
      await sendConnectionRequestEmail(
        receiver[0].email,
        initiator[0].name,
        receiver[0].name,
        synthesis,
        'Connection Verified by Network Admin' // Distinct subject
      ).catch(console.error);

      // Optionally send to Initiator too? "Your connection with B has been verified by Index Admin"?
      // For now, stick to B receiving the 'inbox' style notification.
    }

    return res.json({
      message: 'Connection approved successfully.',
      action: currentState === 'ACCEPT' ? 'VERIFIED' : 'APPROVED'
    });
  } catch (error) {
    console.error('Approve connection error:', error);
    return res.status(500).json({ error: 'Failed to approve connection' });
  }
};

// Approve a connection request
router.post('/:indexId/approve-connection',
  authenticatePrivy,
  [
    param('indexId').isUUID(),
    body('initiatorUserId').isUUID(),
    body('receiverUserId').isUUID()
  ],
  approveConnection
);

// Deny a connection request
router.post('/:indexId/deny-connection',
  authenticatePrivy,
  [
    param('indexId').isUUID(),
    body('initiatorUserId').isUUID(),
    body('receiverUserId').isUUID()
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const { indexId } = req.params;
      const { initiatorUserId, receiverUserId } = req.body;

      // Verify user is index owner
      const ownerCheck = await checkIndexOwnership(indexId, userId);
      if (!ownerCheck.hasAccess) {
        return res.status(ownerCheck.status || 403).json({ error: ownerCheck.error || 'Only index owners can deny connections' });
      }

      // Verify both users are members of this index
      const memberCheck = await db.select()
        .from(indexMembers)
        .where(and(
          eq(indexMembers.indexId, indexId),
          or(
            eq(indexMembers.userId, initiatorUserId),
            eq(indexMembers.userId, receiverUserId)
          )
        ));

      const memberIds = memberCheck.map(m => m.userId);
      if (!memberIds.includes(initiatorUserId) || !memberIds.includes(receiverUserId)) {
        return res.status(403).json({ error: 'Both users must be members of this index' });
      }

      // Verify connection request exists and is still pending
      const latestEvent = await db.select()
        .from(userConnectionEvents)
        .where(
          or(
            and(
              eq(userConnectionEvents.initiatorUserId, initiatorUserId),
              eq(userConnectionEvents.receiverUserId, receiverUserId)
            ),
            and(
              eq(userConnectionEvents.initiatorUserId, receiverUserId),
              eq(userConnectionEvents.receiverUserId, initiatorUserId)
            )
          )
        )
        .orderBy(desc(userConnectionEvents.createdAt))
        .limit(1);

      if (!latestEvent[0] || latestEvent[0].eventType !== 'REQUEST') {
        return res.status(400).json({ error: 'No pending connection request found' });
      }

      // HYBRID LOGIC:
      // Check if there are other shared indexes that are "Auto Approved".
      // If so, we can't kill the connection globally with OWNER_DENY.
      // If not, we insert OWNER_DENY to cancel the request.

      const sharedIndexes = await db.select({
        id: indexes.id,
        permissions: indexes.permissions
      })
        .from(indexes)
        .innerJoin(indexMembers, eq(indexes.id, indexMembers.indexId))
        .where(and(
          eq(indexMembers.userId, initiatorUserId),
          sql`${indexes.id} IN (
              SELECT index_id FROM index_members WHERE user_id = ${receiverUserId}
          )`
        ));

      // Check if there are any indexes that DO NOT require approval (Auto Indices)
      const hasAutoIndices = sharedIndexes.some(i => !(i.permissions as any)?.requireApproval);

      if (hasAutoIndices) {
        // If they share an auto-index, the connection request is valid elsewhere.
        // We do NOT insert OWNER_DENY. We just effectively "ignore" it for this index context.
        return res.json({
          message: 'Connection denied for this index. Request remains active due to other shared indexes.',
          action: 'IGNORED'
        });
      }

      // If no auto indices, safe to block globally.
      const denyEvent = await db.insert(userConnectionEvents)
        .values({
          initiatorUserId: latestEvent[0].initiatorUserId,
          receiverUserId: latestEvent[0].receiverUserId,
          eventType: 'OWNER_DENY',
        })
        .returning();

      return res.json({
        message: 'Connection denied successfully',
        event: denyEvent[0]
      });
    } catch (error) {
      console.error('Deny connection error:', error);
      return res.status(500).json({ error: 'Failed to deny connection' });
    }
  }
);

// Get pending connection count for an index
router.get('/:indexId/pending-count',
  authenticatePrivy,
  [param('indexId').isUUID()],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const { indexId } = req.params;

      // Verify user is index owner
      const ownerCheck = await checkIndexOwnership(indexId, userId);
      if (!ownerCheck.hasAccess) {
        return res.json({ count: 0 });
      }

      // Verify index has requireApproval enabled
      const indexData = await db.select()
        .from(indexes)
        .where(and(eq(indexes.id, indexId), isNull(indexes.deletedAt)))
        .limit(1);

      if (indexData.length === 0 || !(indexData[0].permissions as any)?.requireApproval) {
        return res.json({ count: 0 });
      }

      // Get all members of this index
      const indexMemberIds = await db.select({ userId: indexMembers.userId })
        .from(indexMembers)
        .where(eq(indexMembers.indexId, indexId))
        .then(rows => rows.map(r => r.userId));

      if (indexMemberIds.length === 0) {
        return res.json({ count: 0 });
      }

      // Get REQUEST events where both users are index members and count those still pending
      const requestEvents = await db.select({
        id: userConnectionEvents.id,
        initiatorUserId: userConnectionEvents.initiatorUserId,
        receiverUserId: userConnectionEvents.receiverUserId,
      })
        .from(userConnectionEvents)
        .where(and(
          eq(userConnectionEvents.eventType, 'REQUEST'),
          inArray(userConnectionEvents.initiatorUserId, indexMemberIds),
          inArray(userConnectionEvents.receiverUserId, indexMemberIds)
        ));

      let pendingCount = 0;

      for (const event of requestEvents) {
        const subsequentEvents = await db.select()
          .from(userConnectionEvents)
          .where(
            and(
              or(
                and(
                  eq(userConnectionEvents.initiatorUserId, event.initiatorUserId),
                  eq(userConnectionEvents.receiverUserId, event.receiverUserId)
                ),
                and(
                  eq(userConnectionEvents.initiatorUserId, event.receiverUserId),
                  eq(userConnectionEvents.receiverUserId, event.initiatorUserId)
                )
              )
            )
          )
          .orderBy(desc(userConnectionEvents.createdAt))
          .limit(1);

        if (subsequentEvents[0]?.eventType === 'REQUEST' && subsequentEvents[0].id === event.id) {
          pendingCount++;
        }
      }

      return res.json({ count: pendingCount });
    } catch (error) {
      console.error('Get pending count error:', error);
      return res.status(500).json({ error: 'Failed to get pending count' });
    }
  }
);

export default router;

