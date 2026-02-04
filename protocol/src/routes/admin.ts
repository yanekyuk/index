import { Router, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import db from '../lib/drizzle/drizzle';
import { indexMembers } from '../schemas/database.schema';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { eq, and, inArray } from 'drizzle-orm';
import { checkIndexAdminAccess } from '../lib/index-access';
import { opportunityService } from '../services/opportunity.service';

const router = Router();

// ============================================================================
// OPPORTUNITY DISCOVERY
// ============================================================================

/**
 * Discover opportunities for index members using a natural language prompt.
 * 
 * POST /admin/:indexId/opportunities
 * Body: { prompt: string, memberIds?: string[], limit?: number }
 * 
 * If memberIds is not provided, discovers for all index members.
 */
router.post('/:indexId/opportunities',
  authenticatePrivy,
  [
    param('indexId').isUUID(),
    body('prompt').isString().notEmpty().withMessage('Prompt is required'),
    body('memberIds').optional().isArray(),
    body('memberIds.*').optional().isUUID(),
    body('limit').optional().isInt({ min: 1, max: 50 })
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const { indexId } = req.params;
      const { prompt, memberIds: requestedMemberIds, limit } = req.body;

      // Verify user is index owner
      const adminCheck = await checkIndexAdminAccess(indexId, userId);
      if (!adminCheck.hasAccess) {
        return res.status(adminCheck.status || 403).json({ 
          error: adminCheck.error || 'Only index admins can discover opportunities' 
        });
      }

      // Get member IDs to process
      let memberIds: string[] = requestedMemberIds;
      
      if (!memberIds || memberIds.length === 0) {
        // If no specific members requested, get all index members
        const indexMemberRows = await db.select({ odaUserId: indexMembers.userId })
          .from(indexMembers)
          .where(eq(indexMembers.indexId, indexId));
        
        memberIds = indexMemberRows.map(r => r.odaUserId);
      } else {
        // Verify requested members are part of this index
        const validMembers = await db.select({ odaUserId: indexMembers.userId })
          .from(indexMembers)
          .where(and(
            eq(indexMembers.indexId, indexId),
            inArray(indexMembers.userId, memberIds)
          ));
        
        memberIds = validMembers.map(r => r.odaUserId);
      }

      if (memberIds.length === 0) {
        return res.json({ opportunities: [] });
      }

      // Call the generic service
      const opportunities = await opportunityService.discoverOpportunitiesWithPrompt({
        prompt,
        memberIds,
        indexId,
        limit: limit || 10
      });

      return res.json({ opportunities });
    } catch (error) {
      console.error('Discover opportunities error:', error);
      return res.status(500).json({ error: 'Failed to discover opportunities' });
    }
  }
);

export default router;
