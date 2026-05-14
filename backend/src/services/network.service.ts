import { eq } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import { log } from '../lib/log';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { generateMasterKey } from '../lib/experiment/master-key';
import { validateKey } from '../lib/keys';
import * as schema from '../schemas/database.schema';

const logger = log.service.from("NetworkService");

/**
 * NetworkService
 * 
 * Manages index/community operations.
 * Uses ChatDatabaseAdapter for database operations.
 * 
 * RESPONSIBILITIES:
 * - List indexes for users
 * - Get single index details
 * - Manage index memberships
 */
export class NetworkService {
  constructor(private adapter = new ChatDatabaseAdapter()) {}

  /**
   * Get all indexes that a user is a member of, including their personal index.
   */
  async getNetworksForUser(userId: string) {
    logger.verbose('[NetworkService] Getting networks for user', { userId });
    return this.adapter.getNetworksForUser(userId);
  }

  /**
   * Create a new index with the requesting user as owner.
   */
  async createNetwork(userId: string, data: { title: string; prompt?: string; imageUrl?: string | null; joinPolicy?: 'anyone' | 'invite_only'; allowGuestVibeCheck?: boolean }) {
    logger.verbose('[NetworkService] Creating index', { userId, title: data.title });
    const index = await this.adapter.createNetwork(data);
    // Add the creating user as the owner
    await this.adapter.addMemberToNetwork(index.id, userId, 'owner');
    // Fetch the full index details with user and member count
    const fullIndex = await this.adapter.getNetworkDetail(index.id, userId);
    if (!fullIndex) {
      throw new Error('Failed to create index');
    }
    return fullIndex;
  }

  /**
   * Create a new experiment network with a provisioned master key.
   * Returns the network and the raw master key (shown once; only the hash is stored).
   * @param userId - The creating user (becomes owner)
   * @param data - Title, prompt, and imageUrl for the network
   * @returns The created network detail and the plaintext master key
   */
  async createExperimentNetwork(userId: string, data: { title: string; prompt?: string; imageUrl?: string | null }): Promise<{ network: unknown; masterKey: string }> {
    logger.verbose('[NetworkService] Creating experiment network', { userId, title: data.title });

    // Generate master key
    const { key: masterKey, hash: masterKeyHash } = await generateMasterKey();

    // Create network with experiment flags
    const network = await this.adapter.createNetwork({
      title: data.title,
      prompt: data.prompt,
      imageUrl: data.imageUrl,
      joinPolicy: 'invite_only',
    });

    // Set experiment columns and remove invitation link (experiment networks
    // use master-key signup, not invitation codes)
    await db
      .update(schema.networks)
      .set({
        isExperiment: true,
        experimentMasterKeyHash: masterKeyHash,
        permissions: { joinPolicy: 'invite_only', invitationLink: null, allowGuestVibeCheck: false },
      })
      .where(eq(schema.networks.id, network.id));

    // Add creator as owner
    await this.adapter.addMemberToNetwork(network.id, userId, 'owner');

    const fullNetwork = await this.adapter.getNetworkDetail(network.id, userId);
    if (!fullNetwork) throw new Error('Failed to create experiment network');

    return { network: fullNetwork, masterKey };
  }

  /**
   * Get a public index by ID (no auth required). Returns null if not public.
   */
  async getPublicNetworkById(networkId: string) {
    logger.verbose('[NetworkService] Getting public index by id', { networkId });
    return this.adapter.getPublicIndexDetail(networkId);
  }

  /**
   * Get a single index by ID with owner info and member count.
   * Only members of the index can view it.
   */
  async getNetworkById(networkId: string, userId: string) {
    logger.verbose('[NetworkService] Getting index by id', { networkId });
    return this.adapter.getNetworkDetail(networkId, userId);
  }

  /**
   * Update index settings (title, prompt, permissions). Owner-only.
   * @throws Error if the index is a personal index.
   * @throws Error if attempting to change join policy on an experiment network.
   */
  async updateNetwork(networkId: string, userId: string, data: { title?: string; prompt?: string | null; imageUrl?: string | null; joinPolicy?: 'anyone' | 'invite_only'; allowGuestVibeCheck?: boolean }) {
    logger.verbose('[NetworkService] Updating index', { networkId, userId });
    await this.assertNotPersonal(networkId);
    if (data.joinPolicy !== undefined || data.allowGuestVibeCheck !== undefined) {
      await this.assertJoinPolicyNotLockedByExperiment(networkId);
    }
    return this.adapter.updateIndexSettings(networkId, userId, data);
  }

  /**
   * Update index permissions. Owner-only.
   * @throws Error if attempting to change join policy on an experiment network.
   */
  async updatePermissions(networkId: string, userId: string, data: { joinPolicy?: 'anyone' | 'invite_only'; allowGuestVibeCheck?: boolean }) {
    await this.assertNotPersonal(networkId);
    if (data.joinPolicy !== undefined || data.allowGuestVibeCheck !== undefined) {
      await this.assertJoinPolicyNotLockedByExperiment(networkId);
    }
    logger.verbose('[NetworkService] Updating permissions', { networkId, userId });
    return this.adapter.updateIndexSettings(networkId, userId, data);
  }

  /**
   * Search users within the caller's personal index members,
   * optionally excluding existing members of a target index.
   */
  async searchPersonalNetworkMembers(userId: string, q: string, excludeIndexId?: string) {
    return this.adapter.searchPersonalNetworkMembers(userId, q, excludeIndexId);
  }

  /**
   * Add a member to an index. Only owners/admins can add members.
   * @throws Error if the index is a personal index.
   */
  async addMember(networkId: string, userId: string, requestingUserId: string, role: 'admin' | 'member' = 'member') {
    logger.verbose('[NetworkService] Adding member', { networkId, userId, role });
    await this.assertNotPersonal(networkId);
    return this.adapter.addMemberForOwnerOrAdmin(networkId, userId, requestingUserId, role);
  }

  /**
   * Remove a member from an index. Owner-only.
   * @throws Error if the index is a personal index.
   */
  async removeMember(networkId: string, memberId: string, userId: string) {
    logger.verbose('[NetworkService] Removing member', { networkId, memberId, userId });
    await this.assertNotPersonal(networkId);
    return this.adapter.removeMemberForOwner(networkId, memberId, userId);
  }

  /**
   * Soft-delete an index. Owner-only.
   * @throws Error if the index is a personal index.
   */
  async deleteNetwork(networkId: string, userId: string) {
    logger.verbose('[NetworkService] Deleting index', { networkId, userId });
    await this.assertNotPersonal(networkId);

    // Check if this is an experiment network
    const [network] = await db
      .select({ isExperiment: schema.networks.isExperiment })
      .from(schema.networks)
      .where(eq(schema.networks.id, networkId))
      .limit(1);

    if (network?.isExperiment) {
      // Verify ownership first
      const isOwner = await this.adapter.isIndexOwner(networkId, userId);
      if (!isOwner) throw new Error('Access denied: Not an owner of this index');
      await this.adapter.softDeleteExperimentNetwork(networkId);
    } else {
      await this.adapter.deleteIndexForOwner(networkId, userId);
    }
  }

  /**
   * Get members of an index. Only owners can call this.
   */
  async getMembersForOwner(networkId: string, userId: string) {
    logger.verbose('[NetworkService] Getting members for owner', { networkId, userId });
    const raw = await this.adapter.getNetworkMembersForOwner(networkId, userId);
    return raw.map(m => ({
      id: m.userId,
      name: m.name,
      intro: m.intro,
      email: m.email,
      avatar: m.avatar,
      isGhost: m.isGhost ?? false,
      permissions: m.permissions,
      createdAt: m.joinedAt,
    }));
  }

  /**
   * Get all members from every index the signed-in user is a member of (deduplicated).
   * Used for mentionable users / @mentions.
   */
  async getMembersFromMyNetworks(userId: string) {
    logger.verbose('[NetworkService] Getting members from user indexes', { userId });
    const raw = await this.adapter.getMembersFromUserIndexes(userId);
    return raw.map(m => ({
      id: m.userId,
      name: m.name,
      avatar: m.avatar,
    }));
  }

  /**
   * Get non-personal indexes shared between the current user and a target user.
   * @param currentUserId - Authenticated user ID.
   * @param targetUserId - Profile user ID to compare memberships with.
   * @returns Shared non-personal indexes with member counts.
   */
  async getSharedNetworks(currentUserId: string, targetUserId: string) {
    logger.verbose('[NetworkService] Getting shared indexes', { currentUserId, targetUserId });
    return this.adapter.getSharedNetworks(currentUserId, targetUserId);
  }

  /**
   * Get public indexes that the user has not joined (for discovery).
   */
  async getPublicNetworks(userId: string) {
    logger.verbose('[NetworkService] Getting public indexes for user', { userId });
    return this.adapter.getPublicIndexesNotJoined(userId);
  }

  /**
   * Get an index by its invitation share code (public, no auth required).
   * @param code - The invitation share code from the URL
   * @returns The index with owner info and member count, or null if not found
   */
  async getNetworkByShareCode(code: string) {
    logger.verbose('[NetworkService] Getting index by share code');
    return this.adapter.getNetworkByShareCode(code);
  }

  /**
   * Accept an invitation to join an index using the invitation code.
   * @param code - The invitation share code
   * @param userId - The authenticated user accepting the invitation
   * @returns The index, membership info, and whether user was already a member
   * @throws Error if the invitation code is invalid or the index is not found
   */
  async acceptInvitation(code: string, userId: string) {
    logger.verbose('[NetworkService] Accepting invitation', { userId });
    return this.adapter.acceptIndexInvitation(code, userId);
  }

  /**
   * Join a public index.
   */
  async joinPublicNetwork(networkId: string, userId: string) {
    logger.verbose('[NetworkService] Joining public index', { networkId, userId });
    await this.adapter.joinPublicNetwork(networkId, userId);
    return this.adapter.getNetworkDetail(networkId, userId);
  }

  /**
   * Leave an index. Members (non-owners) can leave.
   * @throws Error if the index is a personal index.
   */
  async leaveNetwork(networkId: string, userId: string) {
    logger.verbose('[NetworkService] Leaving index', { networkId, userId });
    await this.assertNotPersonal(networkId);
    await this.adapter.leaveNetwork(networkId, userId);
  }

  /**
   * Get current user's member settings (permissions and ownership status).
   */
  async getMemberSettings(networkId: string, userId: string) {
    logger.verbose('[NetworkService] Getting member settings', { networkId, userId });
    const settings = await this.adapter.getMemberSettings(networkId, userId);
    if (!settings) {
      throw new Error('Not a member of this index');
    }
    return settings;
  }

  /**
   * Get current user's intents in an index. Members only.
   */
  async getMyIntentsInNetwork(networkId: string, userId: string) {
    logger.verbose('[NetworkService] Getting my intents in index', { networkId, userId });
    const intents = await this.adapter.getNetworkIntentsForMember(networkId, userId);
    return intents.filter((i) => i.userId === userId);
  }

  /**
   * Resolve an index identifier (UUID or key) to a UUID.
   * @param idOrKey - UUID or human-readable key
   * @returns The index UUID, or null if not found
   */
  async resolveIndexId(idOrKey: string): Promise<string | null> {
    logger.verbose('[NetworkService] Resolving network ID or key', { idOrKey });
    return this.adapter.resolveIndexId(idOrKey);
  }

  /**
   * Update a network's key. Owner-only.
   * @param networkId - The network ID
   * @param userId - The requesting user ID (must be owner)
   * @param key - The new key value
   * @returns Updated network or error object
   */
  async updateKey(networkId: string, userId: string, key: string): Promise<{ index: unknown } | { error: string; status: number }> {
    const validation = validateKey(key);
    if (!validation.valid) {
      return { error: validation.error!, status: 400 };
    }

    const existing = await this.adapter.networkKeyExists(key);
    if (existing) {
      return { error: 'Key is already taken', status: 409 };
    }

    // Verify ownership
    try {
      const detail = await this.adapter.getNetworkDetail(networkId, userId);
      if (!detail) {
        return { error: 'Index not found', status: 404 };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Access denied')) {
        return { error: 'Access denied: only the owner can update the key', status: 403 };
      }
      throw err;
    }

    const updated = await this.adapter.updateIndexKey(networkId, key);
    if (!updated) {
      return { error: 'Index not found', status: 404 };
    }

    return { index: updated };
  }

  /**
   * Assert that an index is not a personal index.
   * @throws Error if the index is personal.
   */
  private async assertNotPersonal(networkId: string): Promise<void> {
    const isPersonal = await this.adapter.isPersonalNetwork(networkId);
    if (isPersonal) {
      throw new Error('Access denied: personal indexes cannot be modified directly.');
    }
  }

  /**
   * Assert that join policy fields cannot be changed on experiment networks.
   * Experiment networks enforce `joinPolicy: 'invite_only'` and `allowGuestVibeCheck: false` permanently.
   * @throws Error if the network is an experiment network.
   */
  private async assertJoinPolicyNotLockedByExperiment(networkId: string): Promise<void> {
    const [network] = await db
      .select({ isExperiment: schema.networks.isExperiment })
      .from(schema.networks)
      .where(eq(schema.networks.id, networkId))
      .limit(1);
    if (network?.isExperiment) {
      throw new Error('Cannot modify join policy on experiment networks');
    }
  }
}

export const networkService = new NetworkService();
