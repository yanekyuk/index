'use client';

import { useState } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { LogOut, Users, Globe, Lock, User } from 'lucide-react';
import { Index } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { useIndexesState } from '@/contexts/IndexesContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useAuthenticatedAPI } from '@/lib/api';

interface JoinedNetworkPanelProps {
  index: Index;
  onLeft?: () => void;
}

export default function JoinedNetworkPanel({ index, onLeft }: JoinedNetworkPanelProps) {
  const { removeIndex } = useIndexesState();
  const { success, error } = useNotifications();
  const api = useAuthenticatedAPI();

  const [showLeaveConfirmation, setShowLeaveConfirmation] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  const handleLeaveNetwork = async () => {
    try {
      setIsLeaving(true);
      await api.post(`/indexes/${index.id}/leave`, {});
      removeIndex(index.id);
      success(`Left ${index.title}`);
      setShowLeaveConfirmation(false);
      onLeft?.();
    } catch (err) {
      console.error('Error leaving network:', err);
      error('Failed to leave network');
    } finally {
      setIsLeaving(false);
    }
  };

  const isPublic = index.permissions?.joinPolicy === 'anyone';

  return (
    <>
      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-medium text-gray-900 mb-3">Network Information</h3>
          <div className="space-y-2">
            <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-sm">
              {isPublic ? <Globe className="h-4 w-4 text-gray-400" /> : <Lock className="h-4 w-4 text-gray-400" />}
              <div>
                <p className="text-sm font-medium text-black">{isPublic ? 'Public Network' : 'Private Network'}</p>
                <p className="text-xs text-gray-500">{isPublic ? 'Anyone can join' : 'Invite only'}</p>
              </div>
            </div>

            {index._count?.members !== undefined && (
              <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-sm">
                <Users className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-sm font-medium text-black">{index._count.members} member{index._count.members !== 1 ? 's' : ''}</p>
                </div>
              </div>
            )}

            {index.user && (
              <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-sm">
                <User className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-sm font-medium text-black">Owner</p>
                  <p className="text-xs text-gray-500">{index.user.name}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="pt-6 border-t border-gray-200">
          <h3 className="text-sm font-medium text-gray-900 mb-3">Membership</h3>
          <div className="flex items-center justify-between p-3 border border-gray-200 rounded-sm">
            <div>
              <p className="text-sm font-medium text-black">Leave this network</p>
              <p className="text-xs text-gray-500">You can rejoin later if the network is public</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setShowLeaveConfirmation(true)} className="border-red-300 text-red-700 hover:bg-red-50">
              <LogOut className="h-4 w-4 mr-1" /> Leave
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog.Root open={showLeaveConfirmation} onOpenChange={setShowLeaveConfirmation}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 bg-black/50 z-[100]" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-sm shadow-lg p-6 w-full max-w-md z-[100] focus:outline-none">
            <AlertDialog.Title className="text-lg font-bold text-gray-900 mb-4">Leave &apos;{index.title}&apos;?</AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-gray-600 mb-4">
              You will lose access to this network. You can rejoin later if the network is public or if you receive a new invitation.
            </AlertDialog.Description>
            <div className="flex justify-end gap-3">
              <AlertDialog.Cancel asChild><Button variant="outline">Cancel</Button></AlertDialog.Cancel>
              <Button onClick={handleLeaveNetwork} disabled={isLeaving} className="bg-red-600 hover:bg-red-700 text-white">
                {isLeaving ? 'Leaving...' : 'Leave'}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}
