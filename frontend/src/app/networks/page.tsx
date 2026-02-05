'use client';

import { useCallback, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import * as Tabs from '@radix-ui/react-tabs';
import { Plus, Crown, Globe, Users, ChevronRight, Loader2 } from 'lucide-react';
import ClientLayout from '@/components/ClientLayout';
import CreateIndexModal from '@/components/modals/CreateIndexModal';
import { ContentContainer } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { useAuthContext } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useIndexes } from '@/contexts/APIContext';
import { useIndexesState } from '@/contexts/IndexesContext';
import { Index as IndexType } from '@/lib/types';

export default function NetworksPage() {
  const router = useRouter();
  const { user } = useAuthContext();
  const { success, error } = useNotifications();
  const indexesService = useIndexes();
  const { indexes: rawIndexes, loading: indexesLoading, addIndex } = useIndexesState();

  const [activeTab, setActiveTab] = useState<'my-networks' | 'discover'>('my-networks');
  const [createIndexModalOpen, setCreateIndexModalOpen] = useState(false);

  const [publicNetworks, setPublicNetworks] = useState<(IndexType & { isMember?: boolean })[]>([]);
  const [loadingPublic, setLoadingPublic] = useState(false);
  const [joiningNetwork, setJoiningNetwork] = useState<string | null>(null);

  const allNetworks = rawIndexes || [];

  useEffect(() => {
    if (activeTab === 'discover') {
      loadPublicNetworks();
    }
  }, [activeTab]);

  const loadPublicNetworks = async () => {
    try {
      setLoadingPublic(true);
      const response = await indexesService.discoverPublicIndexes(1, 50);
      setPublicNetworks(response.data);
    } catch (err) {
      console.error('Error loading public networks:', err);
    } finally {
      setLoadingPublic(false);
    }
  };

  const handleJoinNetwork = async (networkId: string) => {
    try {
      setJoiningNetwork(networkId);
      const result = await indexesService.joinIndex(networkId);
      if (result.alreadyMember) {
        success('You are already a member of this network');
      } else {
        addIndex(result.index);
        success('Joined network successfully');
      }
      await loadPublicNetworks();
    } catch (err) {
      console.error('Error joining network:', err);
      error('Failed to join network');
    } finally {
      setJoiningNetwork(null);
    }
  };

  const handleCreateIndex = useCallback(async (indexData: { name: string; prompt?: string; joinPolicy?: 'anyone' | 'invite_only' }) => {
    try {
      const newIndex = await indexesService.createIndex({
        title: indexData.name,
        prompt: indexData.prompt,
        joinPolicy: indexData.joinPolicy
      });
      addIndex(newIndex);
      setCreateIndexModalOpen(false);
      router.push(`/networks/${newIndex.id}`);
      success('Network created successfully');
    } catch (err) {
      console.error('Error creating network:', err);
      error('Failed to create network');
    }
  }, [indexesService, addIndex, router, success, error]);

  return (
    <ClientLayout>
      <div className="px-6 lg:px-8 py-6">
        <ContentContainer size="wide">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-black font-ibm-plex-mono">Networks</h1>
            {user?.email?.endsWith('@index.network') && (
              <button
                onClick={() => setCreateIndexModalOpen(true)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 border border-gray-200 rounded-sm transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Create</span>
              </button>
            )}
          </div>

          <Tabs.Root value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
            <Tabs.List className="flex border-b border-gray-200 mb-6">
              <Tabs.Trigger
                value="my-networks"
                className="px-4 py-2 text-sm text-gray-600 border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:text-black data-[state=active]:font-bold"
              >
                My Networks
                {allNetworks.length > 0 && <span className="ml-2 text-xs text-gray-500">({allNetworks.length})</span>}
              </Tabs.Trigger>
              <Tabs.Trigger
                value="discover"
                className="px-4 py-2 text-sm text-gray-600 border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:text-black data-[state=active]:font-bold"
              >
                Discover
              </Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="my-networks" className="w-full">
              {indexesLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                </div>
              ) : allNetworks.length > 0 ? (
                <div className="space-y-2">
                  {allNetworks.map((network) => {
                    const isOwner = user?.id === network.user.id;
                    return (
                      <button
                        key={network.id}
                        onClick={() => router.push(`/networks/${network.id}`)}
                        className="w-full group flex items-center gap-3 p-3 border border-gray-200 rounded-sm hover:border-gray-300 transition-colors text-left"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-sm font-medium text-black truncate">{network.title}</span>
                            {isOwner && <Crown className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-500">
                            <span className="flex items-center gap-1">
                              <Users className="w-3 h-3" />
                              {network._count?.members || 0}
                            </span>
                            <span>{isOwner ? 'Owner' : 'Member'}</span>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-600 transition-colors flex-shrink-0" />
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="text-sm text-gray-500 py-12 text-center border border-dashed border-gray-200 rounded-sm">
                  <p className="mb-2">No networks yet</p>
                  <p className="text-xs text-gray-400">Join a network from the Discover tab</p>
                </div>
              )}
            </Tabs.Content>

            <Tabs.Content value="discover" className="w-full">
              <div className="mb-4 text-sm text-gray-600">
                Browse and join public networks to connect with others.
              </div>

              {loadingPublic ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                </div>
              ) : publicNetworks.length > 0 ? (
                <div className="space-y-2">
                  {publicNetworks.map((network) => (
                    <div
                      key={network.id}
                      className="flex items-center gap-3 p-3 border border-gray-200 rounded-sm hover:border-gray-300 transition-colors"
                    >
                      <Globe className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-black truncate">{network.title}</div>
                        <div className="text-xs text-gray-500">
                          {network._count?.members || 0} members
                        </div>
                      </div>
                      {network.isMember ? (
                        <span className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded-sm">Joined</span>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleJoinNetwork(network.id)}
                          disabled={joiningNetwork === network.id}
                          className="text-xs h-7"
                        >
                          {joiningNetwork === network.id ? 'Joining...' : 'Join'}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-gray-500 py-12 text-center border border-dashed border-gray-200 rounded-sm">
                  No public networks available
                </div>
              )}
            </Tabs.Content>
          </Tabs.Root>
        </ContentContainer>
      </div>

      <CreateIndexModal
        open={createIndexModalOpen}
        onOpenChange={setCreateIndexModalOpen}
        onSubmit={handleCreateIndex}
      />
    </ClientLayout>
  );
}
