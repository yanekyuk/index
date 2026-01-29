'use client';

import { PropsWithChildren, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import Header from "@/components/Header";
import Sidebar from "@/components/Sidebar";
import ChatSidebar from "@/components/chat/ChatSidebar";
import ChatView from "@/components/chat/ChatView";
import { IndexFilterProvider } from "@/contexts/IndexFilterContext";
import { IndexesProvider } from "@/contexts/IndexesContext";
import { StreamChatProvider, useStreamChat } from "@/contexts/StreamChatContext";
import { useAuthContext } from "@/contexts/AuthContext";

export default function ClientWrapper({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const { isAuthenticated } = useAuthContext();

  // Define known routes to detect 404 pages
  const knownRoutes = useMemo(() => ['/', '/simulation', '/onboarding', '/l', '/i', '/u', '/index', '/admin', '/blog'], []);
  const isKnownRoute = knownRoutes.some(route =>
    pathname === route ||
    pathname?.startsWith(route + '/')
  );
  // Show sidebar only on app pages (exclude landing '/' for unauthenticated, onboarding, invitation, index join, and blog pages)
  // For authenticated users, '/' is the inbox so show sidebar there too
  const showSidebar = useMemo(() => {
    // Always hide on onboarding, invitation/index join pages, and blog
    if (pathname === '/onboarding' || pathname?.startsWith('/l/') || pathname?.startsWith('/index/') || pathname === '/blog' || pathname?.startsWith('/blog/')) {
      return false;
    }
    // Show on root if authenticated (inbox), otherwise hide (landing page)
    if (pathname === '/') {
      return isAuthenticated;
    }
    // Show on other app routes
    return knownRoutes.filter(route => route !== '/' && route !== '/onboarding' && route !== '/l' && route !== '/index' && route !== '/blog').some(route =>
      pathname === route || pathname?.startsWith(route + '/')
    );
  }, [pathname, knownRoutes, isAuthenticated]);

  // Hide header buttons on special pages (onboarding and invitation)
  const showHeaderButtons = useMemo(() =>
    pathname !== '/onboarding' && !pathname?.startsWith('/l/') && !pathname?.startsWith('/index/'), [pathname]);
  
  // Force public view (non-authenticated header) on blog pages
  const forcePublicView = useMemo(() =>
    pathname === '/blog' || pathname?.startsWith('/blog/'), [pathname]);

  // Disable sticky header with background on landing page (unauthenticated) and blog pages
  const isLandingOrBlog = useMemo(() =>
    (pathname === '/' && !isAuthenticated) || pathname === '/blog' || pathname?.startsWith('/blog/'), [pathname, isAuthenticated]);

  // Don't render header on 404 pages (unknown routes)
  if (!isKnownRoute && pathname) {
    return (
      <main>
        {children}
      </main>
    );
  }

  // Show right chat sidebar when authenticated and sidebar is visible
  const showChatSidebar = isAuthenticated && showSidebar;

  return (
    <IndexesProvider>
      <IndexFilterProvider>
        <StreamChatProvider>
          <ClientWrapperContent
            showSidebar={showSidebar}
            showChatSidebar={showChatSidebar}
            showHeaderButtons={showHeaderButtons}
            forcePublicView={forcePublicView}
            isLandingOrBlog={isLandingOrBlog}
            mobileSidebarOpen={mobileSidebarOpen}
            setMobileSidebarOpen={setMobileSidebarOpen}
          >
            {children}
          </ClientWrapperContent>
        </StreamChatProvider>
      </IndexFilterProvider>
    </IndexesProvider>
  );
}

function ClientWrapperContent({
  children,
  showSidebar,
  showChatSidebar,
  showHeaderButtons,
  forcePublicView,
  isLandingOrBlog,
  mobileSidebarOpen,
  setMobileSidebarOpen,
}: PropsWithChildren<{
  showSidebar: boolean;
  showChatSidebar: boolean;
  showHeaderButtons: boolean;
  forcePublicView: boolean;
  isLandingOrBlog: boolean;
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
}>) {
  const { activeChatId, openChats, clearActiveChat, closeChat } = useStreamChat();
  const [isScrolled, setIsScrolled] = useState(false);
  
  // Track scroll position for sticky header background
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 0);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);
  
  // Find the active chat details
  const activeChat = activeChatId ? openChats.find((c) => c.userId === activeChatId) : null;

  return (
    <div className="backdrop relative min-h-screen">
      <style jsx>{`
        .backdrop:after {
          content: "";
          position: fixed;
          left: 0;
          top: 0;
          bottom: 0;
          right: 0;
          background: url(/noise.jpg);
          opacity: .12;
          pointer-events: none;
          z-index: -1;
        }
      `}</style>

      {/* Header stays fixed at top (except on landing/blog pages) */}
      <div className={isLandingOrBlog ? 'z-40' : `sticky top-0 z-40 border border-gray-300  transition-colors ${isScrolled ? 'bg-white/50 backdrop-blur-3xl' : ''}`}>
        <div className="max-w-7xl mx-auto px-2">
          <Header
            showHeaderButtons={showHeaderButtons}
            forcePublicView={forcePublicView}
            onToggleSidebar={showSidebar ? () => setMobileSidebarOpen((v) => !v) : undefined}
            isSidebarOpen={showSidebar ? mobileSidebarOpen : undefined}
          />
        </div>
      </div>

      {/* Page content with sidebar */}
      <main>
        {isLandingOrBlog ? (
          // Full-width layout for landing and blog pages
          <div className="">
            {children}
          </div>
        ) : (
          <div className={`max-w-7xl mx-auto px-2 flex min-h-[calc(100vh-80px)] ${showSidebar ? 'flex-col lg:flex-row' : 'flex-col'}`}>
            {/* Left Sidebar - sticky */}
            {showSidebar && (
              <aside id="app-sidebar" className={`w-full lg:w-72 lg:flex-shrink-0 mb-8 lg:mb-0 ${mobileSidebarOpen ? 'block' : 'hidden'} lg:block lg:self-stretch lg:border-r lg:border-gray-300 lg:pr-4`}>
                <div className="lg:sticky lg:top-20 pt-10">
                  <Sidebar />
                </div>
              </aside>
            )}

            {/* Main content area - Show ChatView if active, otherwise show children */}
            <div className={`w-full pt-10 ${showSidebar ? 'lg:flex-1 lg:min-w-0' : ''} ${showChatSidebar ? 'lg:px-4' : ''}`}>
              {activeChat ? (
                <div className="h-full flex flex-col" style={{ minHeight: 'calc(100vh - 120px)' }}>
                  <ChatView
                    userId={activeChat.userId}
                    userName={activeChat.userName}
                    userAvatar={activeChat.userAvatar}
                    initialMessage={activeChat.initialMessage}
                    minimized={false}
                    onClose={() => {
                      closeChat(activeChat.userId);
                      clearActiveChat();
                    }}
                    onToggleMinimize={() => {}} // Not used in middle column layout
                  />
                </div>
              ) : (
                <div className="">
                  {children}
                </div>
              )}
            </div>

            {/* Right Chat Sidebar - sticky */}
            {showChatSidebar && (
              <aside className="hidden lg:block lg:w-72 lg:flex-shrink-0 lg:self-stretch lg:border-l lg:border-gray-300 lg:pl-4">
                <div className="lg:sticky lg:top-20 pt-10">
                  <ChatSidebar />
                </div>
              </aside>
            )}
          </div>
        )}
      </main>
    </div>
  );
} 
