import { useState, useEffect, useCallback, useRef } from 'react';
import { useIndexesState } from '@/contexts/IndexesContext';
import { useIndexService } from '@/services/indexes';

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
    if (!enabled) {
      setUsers([]);
      return;
    }

    // Avoid duplicate fetches
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    setIsLoading(true);
    try {
      const { members } = await indexService.getMyMembers();

      const userMap = new Map<string, MentionableUser>();
      for (const member of members) {
        if (!userMap.has(member.id)) {
          userMap.set(member.id, {
            id: member.id,
            display: member.name,
            avatar: member.avatar,
          });
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
  }, [enabled, indexService]);

  // Stable signature of index IDs so joins/leaves trigger refetch even when length is unchanged
  const indexesSignature =
    indexes.length === 0
      ? ''
      : [...indexes]
          .map((i) => i.id)
          .sort()
          .join(',');

  useEffect(() => {
    fetchedRef.current = false; // Reset when indexes change so we refetch after join/leave
    fetchAllMembers();
  }, [fetchAllMembers, indexesSignature]);

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
