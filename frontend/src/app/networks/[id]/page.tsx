'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ChevronLeft, Loader2, Globe, Lock, Users, LogOut } from 'lucide-react';
import * as Tabs from '@radix-ui/react-tabs';

import IndexAvatar from '@/components/IndexAvatar';
import ClientLayout from '@/components/ClientLayout';
import NetworkSettingsPanel from '@/components/NetworkSettingsPanel';
import NetworkOverviewPanel from '@/components/NetworkOverviewPanel';
import { ContentContainer } from '@/components/layout';
import { useAuthContext } from '@/contexts/AuthContext';
import { useIndexesState } from '@/contexts/IndexesContext';
import { useIndexes } from '@/contexts/APIContext';
import { Index } from '@/lib/types';

export default function NetworkDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuthContext();
  const { indexes } = useIndexesState();
  const indexesService = useIndexes();

  const networkId = params.id as string;
  const [network, setNetwork] = useState<Index | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'settings' | 'access' | 'integrations'>('overview');
  const [leaveRequested, setLeaveRequested] = useState(false);
  const isCheckingOwnership = useRef(false);

  const checkOwnership = useCallback(async (indexId: string, indexData?: Index) => {
    try {
      const memberSettings = await indexesService.getCurrentUserMemberSettings(indexId);
      return memberSettings.isOwner;
    } catch (err) {
      console.error('Error loading member settings:', err);
      return indexData?.user ? user?.id === indexData.user.id : false;
    }
  }, [indexesService, user?.id]);

  useEffect(() => {
    const loadNetwork = async () => {
      const existingNetwork = indexes?.find(idx => idx.id === networkId);
      if (existingNetwork) {
        const ownerStatus = await checkOwnership(networkId, existingNetwork);
        setNetwork(existingNetwork);
        setIsOwner(ownerStatus);
        setLoading(false);
        return;
      }

      try {
        const fetchedNetwork = await indexesService.getIndex(networkId);
        const ownerStatus = await checkOwnership(networkId, fetchedNetwork);
        setNetwork(fetchedNetwork);
        setIsOwner(ownerStatus);
      } catch (err) {
        console.error('Error loading network:', err);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };

    if (networkId) {
      loadNetwork();
    }
  }, [networkId, indexes, indexesService, checkOwnership]);

  useEffect(() => {
    const updateNetworkFromContext = async () => {
      if (network && indexes && !isCheckingOwnership.current) {
        const updated = indexes.find(idx => idx.id === network.id);
        if (updated && JSON.stringify(updated) !== JSON.stringify(network)) {
          isCheckingOwnership.current = true;
          try {
            let ownerStatus = isOwner;
            if (updated.user && user?.id) {
              ownerStatus = user.id === updated.user.id;
            } else {
              ownerStatus = await checkOwnership(network.id, updated);
            }
            setNetwork(updated);
            setIsOwner(ownerStatus);
          } finally {
            isCheckingOwnership.current = false;
          }
        }
      }
    };
    updateNetworkFromContext();
  }, [indexes, network, checkOwnership, user?.id, isOwner]);

  const handleDeleted = () => router.push('/networks');
  const handleLeft = () => router.push('/networks');

  const isPublic = network?.permissions?.joinPolicy === 'anyone';

  return (
    <ClientLayout>
      <div className="px-6 lg:px-8 py-8">
        <ContentContainer>

          {/* Back */}
          <button
            type="button"
            onClick={() => router.push('/networks')}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-black transition-colors mb-6"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Networks
          </button>

          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-5 h-5 animate-spin text-gray-300" />
            </div>
          ) : notFound ? (
            <div className="py-16 text-center">
              <p className="text-sm font-medium text-gray-700 mb-1">Network not found</p>
              <button onClick={() => router.push('/networks')} className="text-xs text-gray-400 hover:text-black transition-colors">
                Back to Networks
              </button>
            </div>
          ) : network ? (
            <>
              {/* Header */}
              <div className="flex items-start justify-between mb-8">
                <div className="flex items-start gap-4">
                  <div className="w-16 h-16 rounded-sm overflow-hidden shrink-0">
                    <IndexAvatar id={network.id} title={network.title} imageUrl={network.imageUrl} size={64} rounded="sm" />
                  </div>
                  <div>
                  <h1 className="text-2xl font-bold text-black font-ibm-plex-mono mb-3">
                    {network.title}
                  </h1>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1.5 text-xs text-gray-500">
                      {isPublic
                        ? <Globe className="w-3.5 h-3.5" />
                        : <Lock className="w-3.5 h-3.5" />}
                      {isPublic ? 'Public' : 'Private'}
                    </span>
                    {network._count?.members !== undefined && (
                      <span className="flex items-center gap-1.5 text-xs text-gray-500">
                        <Users className="w-3.5 h-3.5" />
                        {network._count.members} member{network._count.members !== 1 ? 's' : ''}
                      </span>
                    )}
                    {isOwner && (
                      <span className="text-xs px-1.5 py-0.5 bg-gray-900 text-white rounded-sm font-medium">
                        Owner
                      </span>
                    )}
                  </div>
                  </div>
                </div>
                {!isOwner && (
                  <button
                    onClick={() => setLeaveRequested(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-500 border border-red-200 rounded-sm hover:bg-red-50 hover:border-red-300 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Leave
                  </button>
                )}
              </div>

              {isOwner ? (
                <Tabs.Root value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
                  <Tabs.List className="flex border-b border-gray-200 mb-8">
                    {(['overview', 'settings', 'access', 'integrations'] as const).map((tab) => (
                      <Tabs.Trigger
                        key={tab}
                        value={tab}
                        className="px-4 py-2 text-sm text-gray-600 border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:text-black data-[state=active]:font-bold capitalize"
                      >
                        {tab}
                      </Tabs.Trigger>
                    ))}
                  </Tabs.List>

                  <Tabs.Content value="overview">
                    <NetworkOverviewPanel index={network} isOwner={isOwner} onLeft={handleLeft} onLeaveRequest={leaveRequested} onLeaveRequestHandled={() => setLeaveRequested(false)} />
                  </Tabs.Content>
                  <Tabs.Content value="settings">
                    <NetworkSettingsPanel index={network} onDeleted={handleDeleted} activeTab="settings" />
                  </Tabs.Content>
                  <Tabs.Content value="access">
                    <NetworkSettingsPanel index={network} onDeleted={handleDeleted} activeTab="access" />
                  </Tabs.Content>
                  <Tabs.Content value="integrations">
                    <NetworkSettingsPanel index={network} onDeleted={handleDeleted} activeTab="integrations" />
                  </Tabs.Content>
                </Tabs.Root>
              ) : (
                <NetworkOverviewPanel index={network} isOwner={isOwner} onLeft={handleLeft} onLeaveRequest={leaveRequested} onLeaveRequestHandled={() => setLeaveRequested(false)} />
              )}
            </>
          ) : null}

        </ContentContainer>
      </div>
    </ClientLayout>
  );
}
