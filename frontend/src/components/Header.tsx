import { Button } from "@/components/ui/button";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { UserPlus, LogIn, Settings, Library, User as UserIcon, ChevronDown, Crown, Users, Plus } from "lucide-react";
import { usePrivy } from '@privy-io/react-auth';
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { getAvatarUrl } from '@/lib/file-utils';
import { useIndexes } from '@/contexts/APIContext';
import { useIndexesState } from '@/contexts/IndexesContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useAuthContext } from '@/contexts/AuthContext';
import { useIndexFilter } from '@/contexts/IndexFilterContext';
import { Index as IndexType } from '@/lib/types';
import ProfileSettingsModal from '@/components/modals/ProfileSettingsModal';
import PreferencesModal from '@/components/modals/PreferencesModal';
import LibraryModal from '@/components/modals/LibraryModal';
import CreateIndexModal from '@/components/modals/CreateIndexModal';
import MemberSettingsModal from '@/components/modals/MemberSettingsModal';

interface HeaderProps {
  onToggleSidebar?: () => void;
  isSidebarOpen?: boolean;
  showHeaderButtons?: boolean;
  forcePublicView?: boolean;
}

export default function Header({ onToggleSidebar, isSidebarOpen, showHeaderButtons = true, forcePublicView = false }: HeaderProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { login, logout, authenticated, ready } = usePrivy();
  const { user, refetchUser } = useAuthContext();
  const [isAlpha, setIsAlpha] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [preferencesModalOpen, setPreferencesModalOpen] = useState(false);
  const [libraryModalOpen, setLibraryModalOpen] = useState(false);
  const [createIndexModalOpen, setCreateIndexModalOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [indexDropdownOpen, setIndexDropdownOpen] = useState(false);
  const [selectedIndexId, setSelectedIndexId] = useState<string>('all');
  const [memberSettingsIndex, setMemberSettingsIndex] = useState<IndexType | null>(null);
  const indexesService = useIndexes();
  const { indexes: rawIndexes, loading: indexesLoading, addIndex } = useIndexesState();
  const { setSelectedIndexIds } = useIndexFilter();
  const { success, error } = useNotifications();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const indexDropdownRef = useRef<HTMLDivElement>(null);

  // Check if we're in admin mode
  const isAdminMode = pathname?.startsWith('/admin/');

  // Get selected index name
  const selectedIndexName = useMemo(() => {
    if (selectedIndexId === 'all') return 'All Indexes';
    const found = rawIndexes?.find(idx => idx.id === selectedIndexId);
    return found?.title || 'All Indexes';
  }, [selectedIndexId, rawIndexes]);

  const handleIndexClick = (indexId: string) => {
    setSelectedIndexId(indexId);
    setIndexDropdownOpen(false);
    if (indexId === 'all') {
      setSelectedIndexIds([]);
    } else {
      setSelectedIndexIds([indexId]);
    }
  };

  // Memoize alpha parameter check to prevent unnecessary re-runs
  const alphaParam = searchParams.get('alpha');

  useEffect(() => {
    // Check if alpha parameter is in searchParams
    if (alphaParam !== null) {
      // Store in localStorage
      localStorage.setItem('alpha', alphaParam);
      setIsAlpha(alphaParam === 'true');
    } else {
      // Get from localStorage only once on mount
      const storedAlpha = localStorage.getItem('alpha');
      setIsAlpha(storedAlpha === 'true');
    }
  }, [alphaParam, pathname]);

  // Handle onboarding check when user data is available
  useEffect(() => {
    if (user?.id && authenticated && pathname !== '/onboarding') {
      // Check if user has completed onboarding using database field
      const hasCompletedOnboarding = user.onboarding?.completedAt;

      // Only redirect if user hasn't completed onboarding AND hasn't filled their intro
      if (!hasCompletedOnboarding) {
        router.push('/onboarding');
        return;
      }
      
      // Redirect to app from blog pages after login
      if (pathname === '/blog' || pathname?.startsWith('/blog/')) {
        router.push('/');
        return;
      }
    }
  }, [user?.id, user?.onboarding?.completedAt, user?.intro, authenticated, pathname, router]);

  const handleCreateIndex = useCallback(async (indexData: { name: string; prompt?: string; joinPolicy?: 'anyone' | 'invite_only' }) => {
    try {
      const createRequest = {
        title: indexData.name,
        prompt: indexData.prompt,
        joinPolicy: indexData.joinPolicy
      };

      const newIndex = await indexesService.createIndex(createRequest);
      addIndex(newIndex); // Update global state immediately
      setCreateIndexModalOpen(false);
      success('Index created successfully');
    } catch (err) {
      console.error('Error creating index:', err);
      error('Failed to create index');
    }
  }, [indexesService, addIndex, success, error]);


  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownOpen && dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
      if (indexDropdownOpen && indexDropdownRef.current && !indexDropdownRef.current.contains(event.target as Node)) {
        setIndexDropdownOpen(false);
      }
    };

    if (dropdownOpen || indexDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [dropdownOpen, indexDropdownOpen]);

  // Show loading state while Privy is initializing
  if (!ready) {
    return (
      <header className="w-full py-4 px-4 flex justify-between items-center">
        <div className="flex items-center">
          <Link href="/">
            <div className="relative mr-2 cursor-pointer">
              <Image
                src="/logos/logo-black-full.svg"
                alt="Index Network"
                width={200}
                height={36}
                className="object-contain"
              />
            </div>
          </Link>
        </div>
        <div className="animate-pulse bg-gray-200 h-10 w-20 rounded"></div>
      </header>
    );
  }

  return (
    <div>
      <header className="w-full pt-4 pb-4 px-0 flex justify-between items-center">
        <div className="flex items-center gap-2">
          {/* Mobile-only sidebar toggle */}
          {onToggleSidebar && (
            <button
              type="button"
              onClick={onToggleSidebar}
              aria-label="Toggle sidebar"
              aria-expanded={!!isSidebarOpen}
              aria-controls="app-sidebar"
              className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-sm border border-[#9f9f9f] bg-white text-[#1f1f1f] hover:bg-gray-50 dark:border-[#555] dark:bg-[#1f1f1f] dark:text-gray-100 dark:hover:bg-[#2a2a2a]"
            >
              {/* simple icon without adding deps */}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M3 12h12M3 18h18" />
              </svg>
            </button>
          )}
          <Link href="/">
            <div className="relative mr-2 cursor-pointer">
              <Image
                src="/logos/logo-black-full.svg"
                alt="Index Network"
                width={200}
                height={36}
                className="object-contain"
              />
            </div>
          </Link>

          {/* Index Dropdown - only show when authenticated and not in admin mode or forcePublicView */}
          {authenticated && !isAdminMode && !forcePublicView && (
            <div className="relative" ref={indexDropdownRef}>
              <button
                onClick={() => setIndexDropdownOpen(!indexDropdownOpen)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-ibm-plex-mono text-black border border-black rounded-[2px] hover:bg-gray-50 transition-colors"
              >
                <span className="max-w-[140px] truncate">{selectedIndexName}</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${indexDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {indexDropdownOpen && (
                <div className="absolute left-0 mt-1 w-64 bg-white border border-black shadow-[0px_1px_0px_#000000] rounded-[2px] z-50 max-h-80 overflow-y-auto">
                  {indexesLoading ? (
                    <div className="px-3 py-4 text-center text-gray-500 text-sm">Loading...</div>
                  ) : (
                    <div className="py-1">
                      {/* All Indexes option */}
                      <button
                        onClick={() => handleIndexClick('all')}
                        className={`w-full px-3 py-2 text-left text-sm font-ibm-plex-mono text-black flex items-center justify-between hover:bg-gray-50 ${selectedIndexId === 'all' ? 'bg-gray-100 font-medium' : ''
                          }`}
                      >
                        <span>All Indexes</span>
                      </button>

                      {/* Divider */}
                      {rawIndexes && rawIndexes.length > 0 && (
                        <div className="border-t border-gray-200 my-1" />
                      )}

                      {/* Index items */}
                      {rawIndexes?.map((index) => (
                        <div
                          key={index.id}
                          className={`group flex items-center justify-between px-3 py-2 hover:bg-gray-50 ${selectedIndexId === index.id ? 'bg-gray-100' : ''
                            }`}
                        >
                          <button
                            onClick={() => handleIndexClick(index.id)}
                            className={`flex-1 text-left text-sm font-ibm-plex-mono text-black truncate ${selectedIndexId === index.id ? 'font-medium' : ''
                              }`}
                          >
                            {index.title}
                          </button>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {user?.id === index.user.id && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setIndexDropdownOpen(false);
                                  router.push(`/admin/${index.id}`);
                                }}
                                className="p-1 rounded hover:bg-gray-200"
                                title="Admin"
                              >
                                <Crown className="w-3.5 h-3.5 text-blue-600" />
                              </button>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setIndexDropdownOpen(false);
                                setMemberSettingsIndex(index);
                              }}
                              className="p-1 rounded hover:bg-gray-200"
                              title="Member settings"
                            >
                              <Users className="w-3.5 h-3.5 text-gray-600" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        {showHeaderButtons && (
          (authenticated && !forcePublicView) ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setLibraryModalOpen(true)}
                className="flex items-center justify-center px-3 py-1 gap-2 bg-white border border-black rounded-[2px] hover:bg-gray-50 transition-colors h-[48px] w-[132px]"
              >
                <Library className="h-6 w-6 text-black" strokeWidth={2} />
                <span className="text-black font-medium font-ibm-plex-mono text-[16px] leading-[23px]">
                  Library
                </span>
              </button>

              <div className="relative" ref={dropdownRef}>
                <div
                  className="flex items-center justify-center px-3 py-2 gap-2 bg-white border border-black  rounded-[2px] cursor-pointer hover:bg-gray-50 transition-colors h-[48px] w-[80px]"
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                >
                  <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0">
                    <Image
                      src={getAvatarUrl(user)}
                      alt={user?.name || 'User'}
                      width={32}
                      height={32}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <svg
                    className={`w-4 h-4 text-black transition-transform ${dropdownOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>

                {dropdownOpen && (
                  <div className="absolute right-0 mt-2 w-64 bg-white border border-black shadow-[0px_1px_0px_#000000] rounded-[2px] z-50">
                    <div className="py-1">
                      <button
                        className="w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-50 flex items-center font-ibm-plex-mono text-sm"
                        onClick={() => {
                          setDropdownOpen(false);
                          setProfileModalOpen(true);
                        }}
                      >
                        <UserIcon className="h-4 w-4 mr-2" />
                        Profile
                      </button>
                      <button
                        className="w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-50 flex items-center font-ibm-plex-mono text-sm"
                        onClick={() => {
                          setDropdownOpen(false);
                          setPreferencesModalOpen(true);
                        }}
                      >
                        <Settings className="h-4 w-4 mr-2" />
                        Preferences
                      </button>
                      {user?.email?.endsWith('@index.network') && <button
                        className="w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-50 flex items-center font-ibm-plex-mono text-sm"
                        onClick={() => {
                          setDropdownOpen(false);
                          setCreateIndexModalOpen(true);
                        }}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Create Index
                      </button>}
                      <button
                        className="w-full px-4 py-2 text-left text-red-600 hover:bg-red-50 hover:text-red-700 flex items-center transition-colors font-ibm-plex-mono text-sm"
                        onClick={() => {
                          setDropdownOpen(false);
                          logout();
                        }}
                      >
                        <LogIn className="h-4 w-4 mr-2" />
                        Logout
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : isAlpha ? (
            <div className="flex items-center gap-12">
              <Link 
                href="/blog" 
                className="font-hanken text-sm text-black hover:text-gray-600 transition-colors font-medium uppercase"
              >
                Blog
              </Link>
              <button
                onClick={login}
                className="bg-black text-white rounded-[2px] px-5 py-3 font-semibold text-sm inline-flex items-center gap-2 transition-all hover:bg-[#333] hover:-translate-y-[1px] uppercase tracking-wider cursor-pointer"
              >
                Login
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-12">
              <Link 
                href="/blog" 
                className="font-hanken text-sm text-black hover:text-gray-600 transition-colors font-medium uppercase"
              >
                Blog
              </Link>
              <button
                onClick={() => window.open("https://forms.gle/nTNBKYC2gZZMnujh9", "_blank")}
                className="bg-black text-white rounded-[2px] px-5 py-3 font-semibold text-sm inline-flex items-center gap-2 transition-all hover:bg-[#333] hover:-translate-y-[1px] uppercase tracking-wider cursor-pointer"
              >
                <span className="lg:hidden">Join</span>
                <span className="hidden lg:inline">Join the waitlist</span>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </button>
            </div>
          )
        )}
      </header>

      {/* Profile Settings Modal */}
      <ProfileSettingsModal
        open={profileModalOpen}
        onOpenChange={setProfileModalOpen}
        user={user}
        onUserUpdate={async () => {
          // Refetch user data from AuthContext
          await refetchUser();
        }}
      />

      {/* Preferences Modal */}
      <PreferencesModal
        open={preferencesModalOpen}
        onOpenChange={setPreferencesModalOpen}
        user={user}
        onUserUpdate={async () => {
          // Refetch user data from AuthContext
          await refetchUser();
        }}
      />

      {/* Library Modal */}
      <LibraryModal
        open={libraryModalOpen}
        onOpenChange={setLibraryModalOpen}
      />

      {/* Create Index Modal */}
      <CreateIndexModal
        open={createIndexModalOpen}
        onOpenChange={setCreateIndexModalOpen}
        onSubmit={handleCreateIndex}
      />

      {/* Member Settings Modal */}
      {memberSettingsIndex && (
        <MemberSettingsModal
          open={!!memberSettingsIndex}
          onOpenChange={(open) => !open && setMemberSettingsIndex(null)}
          index={memberSettingsIndex}
        />
      )}
    </div>
  );
} 
