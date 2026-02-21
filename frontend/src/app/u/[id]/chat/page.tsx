"use client";

import { Suspense, use, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuthContext } from "@/contexts/AuthContext";
import { useUsers } from "@/contexts/APIContext";
import { useStreamChat } from "@/contexts/StreamChatContext";
import { getAvatarUrl } from "@/lib/file-utils";
import { User } from "@/lib/types";
import ChatView from "@/components/chat/ChatView";

interface ChatPageProps {
  params: Promise<{
    id: string;
  }>;
}

function ChatPageFallback() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
    </div>
  );
}

function ChatPageContent({ params }: ChatPageProps) {
  const resolvedParams = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialChannelId = searchParams.get('channelId') ?? undefined;
  const { isAuthenticated, isLoading: authLoading } = useAuthContext();
  const usersService = useUsers();
  const { openChat, closeChat } = useStreamChat();

  const [profileData, setProfileData] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/');
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    const fetchData = async () => {
      if (!isAuthenticated || authLoading) return;

      try {
        setIsLoading(true);
        setError(null);
        const profile = await usersService.getUserProfile(resolvedParams.id);
        setProfileData(profile);
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
    router.push('/');
  };

  const handleBack = () => {
    router.push('/chat');
  };

  if (authLoading || isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <h2 className="text-xl font-bold text-red-600 mb-2 ">Error</h2>
        <p className="text-gray-600 mb-4 ">{error}</p>
        <button
          onClick={() => router.push('/')}
          className="px-4 py-2 bg-[#041729] text-white rounded hover:bg-[#0a2d4a] "
        >
          Go Back
        </button>
      </div>
    );
  }

  if (!profileData) return null;

  return (
    <ChatView
      userId={profileData.id}
      userName={profileData.name}
      userAvatar={profileData.avatar || undefined}
      userTitle={profileData.location || undefined}
      initialChannelId={initialChannelId}
      onClose={handleClose}
      onBack={handleBack}
    />
  );
}

export default function ChatPage(props: ChatPageProps) {
  return (
    <Suspense fallback={<ChatPageFallback />}>
      <ChatPageContent {...props} />
    </Suspense>
  );
}
