import { Router } from 'express';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { intentQueue as queue } from '../queues/intent.queue';
import { QueueStatusResponse, JobTypeCounts } from '../types';

const router = Router();

async function getJobCountsForUser(userId: string): Promise<QueueStatusResponse> {
  // Fetch active, waiting, and recent completed/failed jobs to filter for this user
  // We scan a reasonable number of jobs.
  const [active, waiting, completed, failed] = await Promise.all([
    queue.getJobs(['active'], 0, -1, true),
    queue.getJobs(['waiting'], 0, -1, true),
    queue.getJobs(['completed'], 0, 50, true),
    queue.getJobs(['failed'], 0, 50, true)
  ]);

  const allUserJobs = [...active, ...waiting, ...completed, ...failed].filter(job =>
    job.data && (job.data as any).userId === userId
  );

  const jobTypeCounts: { [jobType: string]: JobTypeCounts } = {};

  for (const job of allUserJobs) {
    const type = job.name;
    const status = await job.getState();

    if (!jobTypeCounts[type]) {
      jobTypeCounts[type] = { pending: 0, active: 0, completed: 0 };
    }

    if (status === 'waiting' || status === 'delayed') {
      jobTypeCounts[type].pending++;
    } else if (status === 'active') {
      jobTypeCounts[type].active++;
    } else if (status === 'completed') {
      jobTypeCounts[type].completed++;
    }
  }

  const totalPending = Object.values(jobTypeCounts).reduce((acc, curr) => acc + curr.pending, 0);

  return {
    jobCounts: jobTypeCounts,
    totalPending
  };
}

// GET /api/queue/status - Get queue status for authenticated user
router.get('/status', authenticatePrivy, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const status = await getJobCountsForUser(userId);

    res.json(status);
  } catch (error) {
    console.error('Error getting queue status:', error);
    res.status(500).json({ error: 'Failed to get queue status' });
  }
});

export default router;
