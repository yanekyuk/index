
import db from '../lib/db';
import { users, indexes, indexMembers, userConnectionEvents, intents, intentIndexes } from '../lib/schema';
import { getConnectionsByUser } from '../routes/connections';
import { approveConnection } from '../routes/admin';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

// Mock Request/Response
const mockReq = (user: any, body: any = {}, params: any = {}) => ({
    user,
    body,
    params,
    header: () => '',
} as any);

const mockRes = () => {
    const res: any = {};
    res.status = (code: number) => {
        res.statusCode = code;
        return res;
    };
    res.json = (data: any) => {
        res.data = data;
        return res;
    };
    return res;
};

async function verifyHybridInbox() {
    console.log('🧪 Starting Hybrid Inbox Verification...');

    // 1. Setup Data
    const timestamp = Date.now();
    const emailA = `userA_${timestamp}@test.com`;
    const emailB = `userB_${timestamp}@test.com`;

    // Create Users
    const [userA] = await db.insert(users).values({
        id: uuidv4(),
        email: emailA,
        name: 'User A',
    } as any).returning();

    const [userB] = await db.insert(users).values({
        id: uuidv4(),
        email: emailB,
        name: 'User B',
    } as any).returning();

    console.log('✅ Created Users:', userA.id, userB.id);

    // Create Restricted Index
    const [restrictedIndex] = await db.insert(indexes).values({
        id: uuidv4(),
        title: 'Restricted Index',
        permissions: { requireApproval: true, joinPolicy: 'invite_only', allowGuestVibeCheck: false, invitationLink: null },
        createdBy: userA.id // User A is owner/admin
    } as any).returning();

    console.log('✅ Created Restricted Index:', restrictedIndex.id);

    // Add Users to Restricted Index
    await db.insert(indexMembers).values([
        { indexId: restrictedIndex.id, userId: userA.id, roles: ['owner'] },
        { indexId: restrictedIndex.id, userId: userB.id, roles: ['member'] }
    ] as any);

    // Create Intents for both users (needed for filtering) only in Restricted Index first
    const [intentA] = await db.insert(intents).values({
        id: uuidv4(),
        userId: userA.id,
        summary: 'Intent A'
    } as any).returning();
    await db.insert(intentIndexes).values({ intentId: intentA.id, indexId: restrictedIndex.id });

    const [intentB] = await db.insert(intents).values({
        id: uuidv4(),
        userId: userB.id,
        summary: 'Intent B'
    } as any).returning();
    await db.insert(intentIndexes).values({ intentId: intentB.id, indexId: restrictedIndex.id });


    // 2. Scenario 1: ONLY Shared Restricted Index
    console.log('\n--- Scenario 1: Only Shared Restricted Index ---');

    // User A requests connection to User B
    await db.insert(userConnectionEvents).values({
        initiatorUserId: userA.id,
        receiverUserId: userB.id,
        eventType: 'REQUEST'
    } as any);
    console.log('✅ User A requested connection to User B');

    // Verify Inbox for User B
    const req1 = mockReq({ id: userB.id }, { type: 'inbox' });
    const res1 = mockRes();

    await getConnectionsByUser(req1, res1);

    if (res1.data.connections.length === 0) {
        console.log('✅ PASS: Request is HIDDEN in inbox (Require Approval is Active)');
    } else {
        console.error('❌ FAIL: Request is VISIBLE in inbox but should be hidden!', res1.data);
    }


    // 3. Scenario 2: Shared Open Index Added
    console.log('\n--- Scenario 2: Shared Open Index Added ---');

    // Create Open Index
    const [openIndex] = await db.insert(indexes).values({
        id: uuidv4(),
        title: 'Open Index',
        permissions: { requireApproval: false, joinPolicy: 'anyone', allowGuestVibeCheck: false, invitationLink: null },
        createdBy: userA.id
    } as any).returning();

    // Add Users to Open Index
    await db.insert(indexMembers).values([
        { indexId: openIndex.id, userId: userA.id, roles: ['owner'] },
        { indexId: openIndex.id, userId: userB.id, roles: ['member'] }
    ] as any);

    // Update Intents to be in Open Index too so they show up
    await db.insert(intentIndexes).values([
        { intentId: intentA.id, indexId: openIndex.id },
        { intentId: intentB.id, indexId: openIndex.id }
    ] as any);

    // Verify Inbox for User B
    const req2 = mockReq({ id: userB.id }, { type: 'inbox' });
    const res2 = mockRes();

    await getConnectionsByUser(req2, res2);

    if (res2.data.connections.length === 1 && res2.data.connections[0].user.id === userA.id) {
        console.log('✅ PASS: Request is VISIBLE (Shared Open Index takes precedence)');
    } else {
        console.error('❌ FAIL: Request is NOT visible or wrong count (Should be visible due to open index)', res2.data);
    }

    // 4. Scenario 3: Admin Approval
    console.log('\n--- Scenario 3: Admin Approval (Back to Restricted Only) ---');

    // Remove Open Index membership/intents to revert state
    await db.delete(intentIndexes).where(eq(intentIndexes.indexId, openIndex.id));
    await db.delete(indexMembers).where(eq(indexMembers.indexId, openIndex.id));

    // Verify it's hidden again
    const req3 = mockReq({ id: userB.id }, { type: 'inbox' });
    const res3 = mockRes();
    await getConnectionsByUser(req3, res3);

    if (res3.data.connections.length === 0) {
        console.log('✅ verified hidden again before approval');
    } else {
        console.error('❌ Failed to revert to hidden state');
    }

    // Admin (User A) approves the request
    const reqApprove = mockReq({ id: userA.id }, { // User A is admin of restricted index
        initiatorUserId: userA.id,
        receiverUserId: userB.id
    }, { indexId: restrictedIndex.id });
    const resApprove = mockRes();

    await approveConnection(reqApprove, resApprove);
    console.log('✅ Admin Action Result:', resApprove.data);

    // Verify Inbox for User B - Should be visible as OWNER_APPROVE
    const req4 = mockReq({ id: userB.id }, { type: 'inbox' });
    const res4 = mockRes();

    await getConnectionsByUser(req4, res4);

    if (res4.data.connections.length === 1 && res4.data.connections[0].status === 'OWNER_APPROVE') {
        console.log('✅ PASS: Request is VISIBLE after Admin Approval (Status: OWNER_APPROVE)');
    } else {
        console.error('❌ FAIL: Request not visible or wrong status after approval', res4.data);
    }

    console.log('\n🏁 Verification Complete');
    process.exit(0);
}

verifyHybridInbox().catch(console.error);
