'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ChevronLeft, Loader2 } from 'lucide-react';
import ClientLayout from '@/components/ClientLayout';
import NetworkSettingsPanel from '@/components/NetworkSettingsPanel';
import JoinedNetworkPanel from '@/components/JoinedNetworkPanel';
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
  const isCheckingOwnership = useRef(false);

  // Memoized function to check ownership
  const checkOwnership = useCallback(async (indexId: string, indexData?: Index) => {
    try {
      const memberSettings = await indexesService.getCurrentUserMemberSettings(indexId);
      return memberSettings.isOwner;
    } catch (err) {
      console.error('Error loading member settings:', err);
      // Fallback to checking user.id if available
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
            // First check if we can determine ownership from the data itself
            let ownerStatus = isOwner; // Default to current state
            
            if (updated.user && user?.id) {
              // If we have user data, use it directly
              ownerStatus = user.id === updated.user.id;
            } else {
              // Otherwise, make API call
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

  return (
    <ClientLayout>
      <div className="px-6 lg:px-8 py-6">
        <ContentContainer size="wide">
          <div className="flex items-center gap-3 mb-6">
            <button
              type="button"
              onClick={() => router.push('/networks')}
              className="p-1 -ml-1 rounded-md hover:bg-gray-100 text-gray-600 hover:text-black transition-colors shrink-0"
              aria-label="Back to networks"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <h1 className="text-2xl font-bold text-black font-ibm-plex-mono truncate">
              {loading ? 'Loading...' : network?.title || 'Network'}
            </h1>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : notFound ? (
            <div className="text-sm text-gray-500 py-12 text-center border border-dashed border-gray-200 rounded-sm">
              <p className="mb-3">Network not found</p>
              <button onClick={() => router.push('/networks')} className="text-blue-600 hover:underline text-xs">
                Back to Networks
              </button>
            </div>
          ) : network ? (
            isOwner ? (
              <NetworkSettingsPanel index={network} onDeleted={handleDeleted} />
            ) : (
              <JoinedNetworkPanel index={network} onLeft={handleLeft} />
            )
          ) : null}
        </ContentContainer>
      </div>
    </ClientLayout>
  );
}
