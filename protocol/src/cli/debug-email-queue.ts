
import dotenv from 'dotenv';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import path from 'path';

const envFile = `.env.development`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

async function checkQueue() {
    console.log('--- Checking Email Queue (Standalone) ---');

    // Connect to Redis
    const redisUrl = process.env.REDIS_URL;
    let redis: Redis;
    if (redisUrl) {
        redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
    } else {
        redis = new Redis({
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379'),
            maxRetriesPerRequest: null
        });
    }
    console.log(`Redis Config: ${process.env.REDIS_URL ? 'URL' : 'Host/Port'} (Host: ${process.env.REDIS_HOST || 'localhost'})`);

    const queue = new Queue('email-processing-queue', { connection: redis });

    const counts = await queue.getJobCounts('active', 'waiting', 'delayed', 'failed', 'completed', 'paused');
    console.log('Job Counts:', counts);

    const active = await queue.getActive();
    console.log(`Active Jobs (${active.length}):`, active.map(j => ({ id: j.id, name: j.name, data: j.data })));

    const waiting = await queue.getWaiting();
    console.log(`Waiting Jobs (${waiting.length}):`, waiting.map(j => ({ id: j.id, name: j.name })));

    const completed = await queue.getJobs(['completed'], 0, 4, false); // Get last 5
    console.log(`Last 5 Completed Jobs:`, completed.map(j => ({
        id: j.id,
        finishedOn: j.finishedOn ? new Date(j.finishedOn).toISOString() : 'N/A',
        processedOn: j.processedOn ? new Date(j.processedOn).toISOString() : 'N/A',
        returnvalue: j.returnvalue
    })));

    // Uncomment to force clean
    // if (active.length > 0) {
    //    console.log('Found active jobs... consider nuking if stuck.');
    // }

    await queue.close();
    await redis.quit();
    process.exit(0);
}

checkQueue().catch(console.error);
