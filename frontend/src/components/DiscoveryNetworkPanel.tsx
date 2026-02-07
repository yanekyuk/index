'use client';

import { useState, useEffect } from 'react';
import { Loader2, Users, Globe, User } from 'lucide-react';
import { Index } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { useIndexesState } from '@/contexts/IndexesContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useIndexesV2 } from '@/services/v2/indexes.service';
import { useRouter } from 'next/navigation';

export default function DiscoveryNetworkPanel() {
  const { addIndex } = useIndexesState();
  const { success, error } = useNotifications();
  const indexesV2 = useIndexesV2();
  const router = useRouter();

  const [publicIndexes, setPublicIndexes] = useState<Index[]>([]);
  const [loading, setLoading] = useState(true);
  const [joiningIndexId, setJoiningIndexId] = useState<string | null>(null);

  useEffect(() => {
    loadPublicIndexes();
  }, []);

  const loadPublicIndexes = async () => {
    try {
      setLoading(true);
      const response = await indexesV2.getPublicIndexes();
      setPublicIndexes(response.data ?? []);
    } catch (err) {
      console.error('Error loading public indexes:', err);
      error('Failed to load public networks');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinIndex = async (index: Index) => {
    try {
      setJoiningIndexId(index.id);
      const joinedIndex = await indexesV2.joinPublicIndex(index.id);
      addIndex(joinedIndex);
      success(`Joined ${index.title}`);
      setPublicIndexes(prev => prev.filter(idx => idx.id !== index.id));
    } catch (err: any) {
      console.error('Error joining index:', err);
      error(err?.message || 'Failed to join network');
    } finally {
      setJoiningIndexId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (publicIndexes.length === 0) {
    return (
      <div className="text-center py-12">
        <Globe className="h-12 w-12 text-gray-300 mx-auto mb-4" />
        <p className="text-sm text-gray-500">No public networks available</p>
        <p className="text-xs text-gray-400 mt-1">Check back later or create your own network</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 mb-4">
        Discover and join public networks from the community.
      </p>

      <div className="space-y-3">
        {publicIndexes.map((index) => (
          <div
            key={index.id}
            className="border border-gray-200 rounded-sm p-4 hover:border-gray-300 transition-colors"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <h4 className="text-base font-semibold text-black truncate">
                    {index.title}
                  </h4>
                  <Globe className="h-4 w-4 text-gray-400 flex-shrink-0" />
                </div>

                {index.prompt && (
                  <p className="text-sm text-gray-600 mb-3 line-clamp-2">
                    {index.prompt}
                  </p>
                )}

                <div className="flex items-center gap-4 text-xs text-gray-500">
                  {index._count?.members !== undefined && (
                    <div className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      <span>{index._count.members} member{index._count.members !== 1 ? 's' : ''}</span>
                    </div>
                  )}

                  {index.user && (
                    <div className="flex items-center gap-1">
                      <User className="h-3.5 w-3.5" />
                      <span>{index.user.name}</span>
                    </div>
                  )}
                </div>
              </div>

              <Button
                onClick={() => handleJoinIndex(index)}
                disabled={joiningIndexId === index.id}
                size="sm"
                className="flex-shrink-0"
              >
                {joiningIndexId === index.id ? 'Joining...' : 'Join'}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
