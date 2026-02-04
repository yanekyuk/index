'use client';

import { useCallback, useState } from 'react';
import { Crown, Plus, Users } from 'lucide-react';
import ClientLayout from '@/components/ClientLayout';
import { ContentContainer } from '@/components/layout';
import CreateIndexModal from '@/components/modals/CreateIndexModal';
import IndexOwnerModal from '@/components/modals/IndexOwnerModal';
import MemberSettingsModal from '@/components/modals/MemberSettingsModal';
import { useAuthContext } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useIndexes } from '@/contexts/APIContext';
import { useIndexesState } from '@/contexts/IndexesContext';
import { Index as IndexType } from '@/lib/types';

export default function NetworksPage() {
  const { user } = useAuthContext();
  const { success, error } = useNotifications();
  const indexesService = useIndexes();
  const { indexes: rawIndexes, loading: indexesLoading, addIndex } = useIndexesState();

  const [createIndexModalOpen, setCreateIndexModalOpen] = useState(false);
  const [memberSettingsIndex, setMemberSettingsIndex] = useState<IndexType | null>(null);
  const [ownerModalIndex, setOwnerModalIndex] = useState<IndexType | null>(null);

  const handleCreateIndex = useCallback(async (indexData: { name: string; prompt?: string; joinPolicy?: 'anyone' | 'invite_only' }) => {
    try {
      const createRequest = {
        title: indexData.name,
        prompt: indexData.prompt,
        joinPolicy: indexData.joinPolicy
      };
      const newIndex = await indexesService.createIndex(createRequest);
      addIndex(newIndex);
      setCreateIndexModalOpen(false);
      success('Network created successfully');
    } catch (err) {
      console.error('Error creating network:', err);
      error('Failed to create network');
    }
  }, [indexesService, addIndex, success, error]);

  return (
    <ClientLayout>
      <div className="px-6 lg:px-8 py-6">
        <ContentContainer size="wide">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-black font-ibm-plex-mono">My Networks</h1>
            {user?.email?.endsWith('@index.network') && (
              <button
                onClick={() => setCreateIndexModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-ibm-plex-mono text-gray-700 hover:bg-gray-50 border border-gray-200 rounded transition-colors"
              >
                <Plus className="w-4 h-4" />
                Create Network
              </button>
            )}
          </div>

          {indexesLoading ? (
            <div className="px-4 py-8 text-center text-gray-500 text-sm font-ibm-plex-mono">
              Loading...
            </div>
          ) : rawIndexes && rawIndexes.length > 0 ? (
            <div className="border border-gray-200 rounded-sm overflow-hidden">
              {rawIndexes.map((index) => (
                <div
                  key={index.id}
                  className="group flex items-center justify-between px-4 py-3 border-b border-gray-200 last:border-b-0 hover:bg-gray-50 transition-colors"
                >
                  <span className="flex-1 text-sm font-ibm-plex-mono text-black truncate">
                    {index.title}
                  </span>
                  <div className="flex items-center gap-1">
                    {user?.id === index.user.id && (
                      <button
                        onClick={() => setOwnerModalIndex(index)}
                        className="p-1.5 rounded hover:bg-gray-200 transition-colors"
                        title="Admin Settings"
                      >
                        <Crown className="w-4 h-4 text-blue-600" />
                      </button>
                    )}
                    <button
                      onClick={() => setMemberSettingsIndex(index)}
                      className="p-1.5 rounded hover:bg-gray-200 transition-colors"
                      title="Member Settings"
                    >
                      <Users className="w-4 h-4 text-gray-600" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-gray-500 text-sm font-ibm-plex-mono border border-gray-200 rounded-sm">
              No networks yet
            </div>
          )}
        </ContentContainer>
      </div>

      <CreateIndexModal
        open={createIndexModalOpen}
        onOpenChange={setCreateIndexModalOpen}
        onSubmit={handleCreateIndex}
      />

      {memberSettingsIndex && (
        <MemberSettingsModal
          open={!!memberSettingsIndex}
          onOpenChange={(open) => !open && setMemberSettingsIndex(null)}
          index={memberSettingsIndex}
        />
      )}

      {ownerModalIndex && (
        <IndexOwnerModal
          open={!!ownerModalIndex}
          onOpenChange={(open) => !open && setOwnerModalIndex(null)}
          index={ownerModalIndex}
        />
      )}
    </ClientLayout>
  );
}
