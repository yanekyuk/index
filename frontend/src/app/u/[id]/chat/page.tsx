"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuthContext } from "@/contexts/AuthContext";
import { useUsers } from "@/contexts/APIContext";
import { useStreamChat } from "@/contexts/StreamChatContext";
import { getAvatarUrl } from "@/lib/file-utils";
import { User } from "@/lib/types";
import ClientLayout from "@/components/ClientLayout";
import ChatView from "@/components/chat/ChatView";

interface ChatPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default function ChatPage({ params }: ChatPageProps) {
  const resolvedParams = use(params);
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuthContext();
  const usersService = useUsers();
  const { openChat, closeChat } = useStreamChat();

  const [profileData, setProfileData] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Redirect to landing if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/');
    }
  }, [authLoading, isAuthenticated, router]);

  // Fetch user profile
  useEffect(() => {
    const fetchData = async () => {
      if (!isAuthenticated || authLoading) return;

      try {
        setIsLoading(true);
        setError(null);
        const profile = await usersService.getUserProfile(resolvedParams.id);
        setProfileData(profile);
        
        // Register in open chats for sidebar highlighting
        openChat(profile.id, profile.name, getAvatarUrl(profile));
      } catch (err) {
        console.error('Failed to fetch profile:', err);
        setError('User not found');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [resolvedParams.id, isAuthenticated, authLoading, usersService, openChat]);

  const handleClose = () => {
    if (profileData) {
      closeChat(profileData.id);
    }
    router.back();
  };

  const handleBack = () => {
    router.back();
  };

  // Loading state
  if (authLoading || isLoading) {
    return (
      <ClientLayout>
        <div className="bg-white border border-gray-800 rounded-sm p-8">
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        </div>
      </ClientLayout>
    );
  }

  // Error state
  if (error) {
    return (
      <ClientLayout>
        <div className="bg-white border border-gray-800 rounded-sm p-8">
          <div className="text-center py-12">
            <h2 className="text-xl font-bold text-red-600 mb-2 font-ibm-plex-mono">Error</h2>
            <p className="text-gray-600 mb-4 font-ibm-plex-mono">{error}</p>
            <button
              onClick={() => router.back()}
              className="px-4 py-2 bg-black text-white rounded hover:bg-gray-800 font-ibm-plex-mono"
            >
              Go Back
            </button>
          </div>
        </div>
      </ClientLayout>
    );
  }

  if (!profileData) return null;

  return (
    <ClientLayout>
      <ChatView
        userId={profileData.id}
        userName={profileData.name}
        userAvatar={getAvatarUrl(profileData)}
        minimized={false}
        onClose={handleClose}
        onBack={handleBack}
      />
    </ClientLayout>
  );
}
