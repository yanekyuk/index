import { useState, useEffect, useCallback, useRef } from 'react';
import { useIndexesState } from '@/contexts/IndexesContext';
import { useIndexService, Member } from '@/services/indexes';

export interface MentionableUser {
  id: string;
  display: string;
  avatar?: string | null;
}

interface UseMentionableUsersOptions {
  /** Whether to fetch users */
  enabled?: boolean;
}

interface UseMentionableUsersResult {
  users: MentionableUser[];
  isLoading: boolean;
  /** Search/filter users by query (for async data fetching) */
  searchUsers: (query: string, callback: (users: MentionableUser[]) => void) => void;
}

export function useMentionableUsers({
  enabled = true,
}: UseMentionableUsersOptions = {}): UseMentionableUsersResult {
  const [users, setUsers] = useState<MentionableUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { indexes } = useIndexesState();
  const indexService = useIndexService();
  const fetchedRef = useRef(false);
  const cacheRef = useRef<Map<string, MentionableUser>>(new Map());

  const fetchAllMembers = useCallback(async () => {
    if (!enabled || indexes.length === 0) {
      setUsers([]);
      return;
    }

    // Avoid duplicate fetches
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    setIsLoading(true);
    try {
      // Fetch members from all accessible indexes in parallel
      const memberPromises = indexes.map(index =>
        indexService.getMembers(index.id, { limit: 100 }).catch(() => ({ members: [] as Member[] }))
      );

      const results = await Promise.all(memberPromises);

      // Deduplicate users by ID
      const userMap = new Map<string, MentionableUser>();
      for (const result of results) {
        for (const member of result.members) {
          if (!userMap.has(member.id)) {
            userMap.set(member.id, {
              id: member.id,
              display: member.name,
              avatar: member.avatar,
            });
          }
        }
      }

      // Update cache
      cacheRef.current = userMap;
      setUsers(Array.from(userMap.values()));
    } catch (error) {
      console.error('Failed to fetch mentionable users:', error);
      setUsers([]);
    } finally {
      setIsLoading(false);
    }
  }, [enabled, indexes, indexService]);

  useEffect(() => {
    fetchedRef.current = false; // Reset when indexes change
    fetchAllMembers();
  }, [fetchAllMembers]);

  // Search function for react-mentions async data fetching
  const searchUsers = useCallback(
    (query: string, callback: (users: MentionableUser[]) => void) => {
      const lowerQuery = query.toLowerCase();
      const filtered = Array.from(cacheRef.current.values()).filter(user =>
        user.display.toLowerCase().includes(lowerQuery)
      );
      callback(filtered);
    },
    []
  );

  return {
    users,
    isLoading,
    searchUsers,
  };
}
