'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthContext } from '@/contexts/AuthContext';
import ClientLayout from '@/components/ClientLayout';

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
        <div className="flex-1 flex items-center justify-center min-h-0">
          <p className="text-gray-500 text-sm font-ibm-plex-mono">
            Select a conversation from the list
          </p>
        </div>
      </div>
    </ClientLayout>
  );
}
