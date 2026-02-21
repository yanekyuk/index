"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageCircle } from "lucide-react";
import { useAuthContext } from "@/contexts/AuthContext";
import { useUsers } from "@/contexts/APIContext";
import UserAvatar from "@/components/UserAvatar";
import { User } from "@/lib/types";
import ClientLayout from "@/components/ClientLayout";
import { ContentContainer } from "@/components/layout";

interface UserProfilePageProps {
  params: Promise<{
    id: string;
  }>;
}

export default function UserProfilePage({ params }: UserProfilePageProps) {
  const resolvedParams = use(params);
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuthContext();
  const usersService = useUsers();

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

      } catch (err) {
        console.error('Failed to fetch profile:', err);
        setError('User not found');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [resolvedParams.id, isAuthenticated, authLoading, usersService]);

  // Loading state
  if (authLoading || isLoading) {
    return (
      <ClientLayout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      </ClientLayout>
    );
  }

  // Error state
  if (error) {
    return (
      <ClientLayout>
        <div className="text-center py-12">
          <h2 className="text-xl font-bold text-red-600 mb-2 font-ibm-plex-mono">Error</h2>
          <p className="text-gray-600 mb-4 font-ibm-plex-mono">{error}</p>
          <button
            onClick={() => router.back()}
            className="px-4 py-2 bg-[#041729] text-white rounded hover:bg-[#0a2d4a] font-ibm-plex-mono"
          >
            Go Back
          </button>
        </div>
      </ClientLayout>
    );
  }

  if (!profileData) return null;

  return (
    <ClientLayout>
      <div className="px-6 lg:px-8 py-6">
        <ContentContainer className="space-y-8">
          {/* Header with back button */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="text-gray-600 hover:text-black transition-colors text-xl"
            >
              ←
            </button>
            <h1 className="font-ibm-plex-mono text-2xl font-bold text-black">{profileData.name}</h1>
          </div>
            {/* Avatar, Name, and Social Icons */}
            <div className="flex items-start gap-4">
              <UserAvatar
                id={profileData.id}
                name={profileData.name}
                avatar={profileData.avatar}
                size={80}
              />
              <div className="flex-1 pt-2">
                {profileData.location && (
                  <p className="text-sm text-gray-500 font-ibm-plex-mono">
                    {profileData.location}
                  </p>
                )}
              </div>

              {/* Social Icons */}
              {profileData.socials && (
                profileData.socials.x || profileData.socials.linkedin || profileData.socials.github || (profileData.socials.websites && profileData.socials.websites.length > 0)
              ) && (
                <div className="flex items-center gap-3 pt-2">
                  {profileData.socials.x && (
                    <a
                      href={`https://x.com/${profileData.socials.x.replace('@', '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-700 hover:text-black transition-colors"
                    >
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                      </svg>
                    </a>
                  )}
                  {profileData.socials.linkedin && (
                    <a
                      href={`https://linkedin.com/in/${profileData.socials.linkedin}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-700 hover:text-black transition-colors"
                    >
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                      </svg>
                    </a>
                  )}
                  {profileData.socials.github && (
                    <a
                      href={`https://github.com/${profileData.socials.github}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-700 hover:text-black transition-colors"
                    >
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                      </svg>
                    </a>
                  )}
                  {profileData.socials.websites?.map((website, index) => (
                    <a
                      key={index}
                      href={website.startsWith('http') ? website : `https://${website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-700 hover:text-black transition-colors"
                    >
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="2" y1="12" x2="22" y2="12"/>
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                      </svg>
                    </a>
                  ))}
                </div>
              )}
            </div>

            {/* Message CTA Button */}
            <button
              onClick={() => router.push(`/u/${resolvedParams.id}/chat`)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#041729] text-white rounded-sm hover:bg-[#0a2d4a] transition-colors font-ibm-plex-mono text-sm font-medium"
            >
              <MessageCircle className="w-4 h-4" />
              Message
            </button>

            {/* Intro Section */}
            {profileData.intro && (
              <div>
                <h3 className="text-base font-bold text-gray-900 mb-3 font-ibm-plex-mono">
                  Intro
                </h3>
                <p className="text-sm text-gray-700 leading-relaxed font-ibm-plex-mono whitespace-pre-wrap">
                  {profileData.intro}
                </p>
              </div>
            )}
        </ContentContainer>
      </div>
    </ClientLayout>
  );
}
