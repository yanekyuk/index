'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthContext } from '@/contexts/AuthContext';
import ClientLayout from '@/components/ClientLayout';
import ChatSidebar from '@/components/chat/ChatSidebar';

export default function ConversationsPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuthContext();

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/');
    }
  }, [authLoading, isAuthenticated, router]);

  if (authLoading || !isAuthenticated) {
    return null;
  }

  return (
    <ClientLayout>
      <div className="pb-0 flex flex-col flex-1 min-h-0 w-full">
        <div className="space-y-4 rounded-lg mb-4 flex flex-col flex-1 min-h-0">
          <div className="w-full bg-white border border-gray-800 rounded-sm shadow-lg flex flex-col flex-shrink-0 p-4">
            <h1 className="font-bold text-lg text-gray-900 font-ibm-plex-mono">
              Conversations
            </h1>
            <p className="text-sm text-gray-500 font-ibm-plex-mono mt-1">
              Your direct messages and message requests
            </p>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            <ChatSidebar />
          </div>
        </div>
      </div>
    </ClientLayout>
  );
}
