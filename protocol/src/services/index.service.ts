import { log } from '../lib/log';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';

const logger = log.service.from("IndexService");

/**
 * IndexService
 * 
 * Manages index/community operations.
 * Uses ChatDatabaseAdapter for database operations.
 * 
 * RESPONSIBILITIES:
 * - List indexes for users
 * - Get single index details
 * - Manage index memberships
 */
export class IndexService {
  constructor(private adapter = new ChatDatabaseAdapter()) {}

  /**
   * Get all indexes that a user is a member of, including their personal index.
   */
  async getIndexesForUser(userId: string) {
    logger.info('[IndexService] Getting indexes for user', { userId });
    return this.adapter.getIndexesForUser(userId);
  }

  /**
   * Create a new index with the requesting user as owner.
   */
  async createIndex(userId: string, data: { title: string; prompt?: string; joinPolicy?: 'anyone' | 'invite_only'; allowGuestVibeCheck?: boolean }) {
    logger.info('[IndexService] Creating index', { userId, title: data.title });
    const index = await this.adapter.createIndex(data);
    // Add the creating user as the owner
    await this.adapter.addMemberToIndex(index.id, userId, 'owner');
    // Fetch the full index details with user and member count
    const fullIndex = await this.adapter.getIndexDetail(index.id, userId);
    if (!fullIndex) {
      throw new Error('Failed to create index');
    }
    return fullIndex;
  }

  /**
   * Get a single index by ID with owner info and member count.
   * Only members of the index can view it.
   */
  async getIndexById(indexId: string, userId: string) {
    logger.info('[IndexService] Getting index by id', { indexId });
    return this.adapter.getIndexDetail(indexId, userId);
  }

  /**
   * Update index settings (title, prompt, permissions). Owner-only.
   */
  async updateIndex(indexId: string, userId: string, data: { title?: string; prompt?: string | null; joinPolicy?: 'anyone' | 'invite_only'; allowGuestVibeCheck?: boolean }) {
    logger.info('[IndexService] Updating index', { indexId, userId });
    return this.adapter.updateIndexSettings(indexId, userId, data);
  }

  /**
   * Update index permissions. Owner-only.
   */
  async updatePermissions(indexId: string, userId: string, data: { joinPolicy?: 'anyone' | 'invite_only'; allowGuestVibeCheck?: boolean }) {
    logger.info('[IndexService] Updating permissions', { indexId, userId });
    return this.adapter.updateIndexSettings(indexId, userId, data);
  }

  /**
   * Search users within the caller's personal index members,
   * optionally excluding existing members of a target index.
   */
  async searchPersonalIndexMembers(userId: string, q: string, excludeIndexId?: string) {
    return this.adapter.searchPersonalIndexMembers(userId, q, excludeIndexId);
  }

  /**
   * Add a member to an index. Only owners/admins can add members.
   */
  async addMember(indexId: string, userId: string, requestingUserId: string, role: 'admin' | 'member' = 'member') {
    logger.info('[IndexService] Adding member', { indexId, userId, role });
    return this.adapter.addMemberForOwnerOrAdmin(indexId, userId, requestingUserId, role);
  }

  /**
   * Remove a member from an index. Owner-only.
   */
  async removeMember(indexId: string, memberId: string, userId: string) {
    logger.info('[IndexService] Removing member', { indexId, memberId, userId });
    return this.adapter.removeMemberForOwner(indexId, memberId, userId);
  }

  /**
   * Soft-delete an index. Owner-only.
   */
  async deleteIndex(indexId: string, userId: string) {
    logger.info('[IndexService] Deleting index', { indexId, userId });
    return this.adapter.deleteIndexForOwner(indexId, userId);
  }

  /**
   * Get members of an index. Only owners can call this.
   */
  async getMembersForOwner(indexId: string, userId: string) {
    logger.info('[IndexService] Getting members for owner', { indexId, userId });
    const raw = await this.adapter.getIndexMembersForOwner(indexId, userId);
    return raw.map(m => ({
      id: m.userId,
      name: m.name,
      email: m.email,
      avatar: m.avatar,
      permissions: m.permissions,
      createdAt: m.joinedAt,
    }));
  }

  /**
   * Get public indexes that the user has not joined (for discovery).
   */
  async getPublicIndexes(userId: string) {
    logger.info('[IndexService] Getting public indexes for user', { userId });
    return this.adapter.getPublicIndexesNotJoined(userId);
  }

  /**
   * Join a public index.
   */
  async joinPublicIndex(indexId: string, userId: string) {
    logger.info('[IndexService] Joining public index', { indexId, userId });
    await this.adapter.joinPublicIndex(indexId, userId);
    return this.adapter.getIndexDetail(indexId, userId);
  }

  /**
   * Leave an index. Members (non-owners) can leave.
   */
  async leaveIndex(indexId: string, userId: string) {
    logger.info('[IndexService] Leaving index', { indexId, userId });
    await this.adapter.leaveIndex(indexId, userId);
  }

  /**
   * Get current user's member settings (permissions and ownership status).
   */
  async getMemberSettings(indexId: string, userId: string) {
    logger.info('[IndexService] Getting member settings', { indexId, userId });
    const settings = await this.adapter.getMemberSettings(indexId, userId);
    if (!settings) {
      throw new Error('Not a member of this index');
    }
    return settings;
  }
}

export const indexService = new IndexService();
