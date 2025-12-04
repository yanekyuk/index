'use client';

import { use, useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import ClientLayout from '@/components/ClientLayout';
import { useIndexes } from '@/contexts/APIContext';
import { Member, GetMembersResponse } from '@/services/indexes';
import { Search, Filter, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getAvatarUrl } from '@/lib/file-utils';

export default function DirectoryPage({ params }: { params: Promise<{ indexId: string }> }) {
  const { indexId } = use(params);
  const indexesService = useIndexes();

  // State
  const [members, setMembers] = useState<Member[]>([]);
  const [metadataKeys, setMetadataKeys] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [metadataFilters, setMetadataFilters] = useState<Record<string, string[]>>({});
  const [showFilters, setShowFilters] = useState(false);
  const [availableMetadataValues, setAvailableMetadataValues] = useState<Record<string, Set<string>>>({});
  const [totalCount, setTotalCount] = useState(0);
  const [expandedIntros, setExpandedIntros] = useState<Set<string>>(new Set());
  
  // Refs
  const sentinelRef = useRef<HTMLDivElement>(null);
  const isInitialLoadRef = useRef(true);

  // Fetch members - initial load or reset
  const fetchMembers = useCallback(async (page: number = 1, append: boolean = false) => {
    try {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        isInitialLoadRef.current = true;
      }

      const response: GetMembersResponse = await indexesService.getMembers(indexId, {
        searchQuery: searchQuery || undefined,
        page,
        limit: 20,
        metadataFilters: Object.keys(metadataFilters).length > 0 ? metadataFilters : undefined
      });

      if (append) {
        // Append new members to existing list
        setMembers(prev => [...prev, ...response.members]);
      } else {
        // Replace members (new search/filter)
        setMembers(response.members);
      }

      // Update metadata keys (only on initial load or when filters change)
      if (!append) {
        setMetadataKeys(response.metadataKeys);
      }

      // Update pagination state
      setHasMore(response.pagination.page < response.pagination.totalPages);
      setTotalCount(response.pagination.total);

      // Build available values for each metadata key (accumulate across all loaded members)
      if (append) {
        setAvailableMetadataValues(prev => {
          const updated = { ...prev };
          response.members.forEach(member => {
            if (member.metadata) {
              Object.entries(member.metadata).forEach(([key, value]) => {
                if (!updated[key]) {
                  updated[key] = new Set();
                }
                if (Array.isArray(value)) {
                  value.forEach(v => updated[key].add(v));
                } else {
                  updated[key].add(value);
                }
              });
            }
          });
          return updated;
        });
      } else {
        const valuesMap: Record<string, Set<string>> = {};
        response.members.forEach(member => {
          if (member.metadata) {
            Object.entries(member.metadata).forEach(([key, value]) => {
              if (!valuesMap[key]) {
                valuesMap[key] = new Set();
              }
              if (Array.isArray(value)) {
                value.forEach(v => valuesMap[key].add(v));
              } else {
                valuesMap[key].add(value);
              }
            });
          }
        });
        setAvailableMetadataValues(valuesMap);
      }
    } catch (error) {
      console.error('Failed to fetch members:', error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
      isInitialLoadRef.current = false;
    }
  }, [indexesService, indexId, searchQuery, metadataFilters]);

  // Load more members
  const loadMore = useCallback(() => {
    if (!loadingMore && hasMore) {
      const nextPage = currentPage + 1;
      setCurrentPage(nextPage);
      fetchMembers(nextPage, true);
    }
  }, [currentPage, hasMore, loadingMore, fetchMembers]);

  // Debounced search - reset and fetch first page
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setCurrentPage(1);
      setMembers([]);
      setHasMore(true);
      fetchMembers(1, false);
    }, 300);

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  // Reset and fetch when filters change
  useEffect(() => {
    setCurrentPage(1);
    setMembers([]);
    setHasMore(true);
    fetchMembers(1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metadataFilters]);

  // Initial load on mount
  useEffect(() => {
    fetchMembers(1, false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Intersection Observer for infinite scroll
  useEffect(() => {
    if (!sentinelRef.current || !hasMore || loading || loadingMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      {
        rootMargin: '100px', // Start loading 100px before reaching the bottom
      }
    );

    observer.observe(sentinelRef.current);

    return () => {
      observer.disconnect();
    };
  }, [hasMore, loading, loadingMore, loadMore]);

  // Toggle metadata filter
  const toggleMetadataFilter = (key: string, value: string) => {
    setMetadataFilters(prev => {
      const current = prev[key] || [];
      const newValues = current.includes(value)
        ? current.filter(v => v !== value)
        : [...current, value];
      
      if (newValues.length === 0) {
        const rest = { ...prev };
        delete rest[key];
        return rest;
      }
      
      return { ...prev, [key]: newValues };
    });
  };

  // Clear all filters
  const clearFilters = () => {
    setMetadataFilters({});
  };

  // Get active filter count
  const activeFilterCount = Object.values(metadataFilters).reduce((sum, values) => sum + values.length, 0);

  // Toggle intro expansion
  const toggleIntro = (memberId: string) => {
    setExpandedIntros(prev => {
      const newSet = new Set(prev);
      if (newSet.has(memberId)) {
        newSet.delete(memberId);
      } else {
        newSet.add(memberId);
      }
      return newSet;
    });
  };

  // Check if intro should be truncated (more than ~150 characters or 3 lines)
  const shouldTruncateIntro = (intro: string): boolean => {
    return intro.length > 150 || intro.split('\n').length > 3;
  };

  // Helper function to format X/Twitter URL
  const formatXUrl = (value: string | null | undefined): string | null => {
    if (!value) return null;
    if (value.startsWith('http://') || value.startsWith('https://')) return value;
    if (value.startsWith('@')) return `https://x.com/${value.slice(1)}`;
    return `https://x.com/${value}`;
  };

  // Helper function to format LinkedIn URL
  const formatLinkedInUrl = (value: string | null | undefined): string | null => {
    if (!value) return null;
    if (value.startsWith('http://') || value.startsWith('https://')) return value;
    if (value.startsWith('/')) return `https://linkedin.com${value}`;
    if (value.startsWith('linkedin.com/') || value.startsWith('www.linkedin.com/')) {
      return `https://${value}`;
    }
    return `https://linkedin.com/in/${value}`;
  };

  // Helper function to format GitHub URL
  const formatGitHubUrl = (value: string | null | undefined): string | null => {
    if (!value) return null;
    if (value.startsWith('http://') || value.startsWith('https://')) return value;
    if (value.startsWith('@')) return `https://github.com/${value.slice(1)}`;
    return `https://github.com/${value}`;
  };

  // Render metadata value as tag
  const renderMetadataTag = (key: string, value: string | string[], index: number) => {
    const colors = [
      'bg-blue-100 text-blue-700',
      'bg-green-100 text-green-700',
      'bg-purple-100 text-purple-700',
      'bg-orange-100 text-orange-700',
      'bg-pink-100 text-pink-700',
      'bg-indigo-100 text-indigo-700'
    ];
    const colorClass = colors[index % colors.length];
    
    const displayValue = Array.isArray(value) ? value.join(', ') : value;
    
    return (
      <span
        key={`${key}-${index}`}
        className={`inline-block px-2 py-1 rounded text-xs font-medium ${colorClass} mr-1 mb-1`}
        title={`${key}: ${displayValue}`}
      >
        {displayValue}
      </span>
    );
  };

  // Render member card
  const renderMemberCard = (member: Member) => {
    const metadataEntries = member.metadata ? Object.entries(member.metadata) : [];
    const visibleMetadata = metadataEntries.slice(0, 4);
    const hiddenCount = metadataEntries.length - 4;

    return (
      <div
        key={member.id}
        className="bg-white border border-b-2 border-gray-800"
      >
        <div className="p-6 space-y-6">
          {/* Header: Avatar + Name + Email + Social Links */}
          <div className="flex items-start gap-4">
            <Image
              src={getAvatarUrl(member)}
              alt={member.name}
              width={80}
              height={80}
              className="rounded-full flex-shrink-0"
            />
            <div className="flex-1 pt-2">
              <h3 className="text-2xl font-bold text-gray-900 font-ibm-plex-mono mb-1">
                {member.name}
              </h3>
              <p className="text-sm text-gray-500 font-ibm-plex-mono mb-1">
                {member.email}
              </p>
              {member.location !== null && 
               member.location !== undefined && 
               member.location.trim() && 
               member.location.trim().toLowerCase() !== 'null' && (
                <p className="text-sm text-gray-500 font-ibm-plex-mono">
                  📍 {member.location}
                </p>
              )}
            </div>
            {/* Social Icons - Top Right */}
            {member.socials && (
              (formatXUrl(member.socials.x) || formatLinkedInUrl(member.socials.linkedin) || formatGitHubUrl(member.socials.github) || (member.socials.websites && member.socials.websites.length > 0 && member.socials.websites[0]))
            ) && (
              <div className="flex items-center gap-3 pt-2">
                {formatXUrl(member.socials.x) && (
                  <a
                    href={formatXUrl(member.socials.x)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-700 hover:text-black transition-colors"
                    title="X (Twitter)"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                    </svg>
                  </a>
                )}
                {formatLinkedInUrl(member.socials.linkedin) && (
                  <a
                    href={formatLinkedInUrl(member.socials.linkedin)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-700 hover:text-black transition-colors"
                    title="LinkedIn"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                    </svg>
                  </a>
                )}
                {formatGitHubUrl(member.socials.github) && (
                  <a
                    href={formatGitHubUrl(member.socials.github)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-700 hover:text-black transition-colors"
                    title="GitHub"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                    </svg>
                  </a>
                )}
                {member.socials.websites && member.socials.websites.length > 0 && member.socials.websites[0] && (
                  <a
                    href={member.socials.websites[0].startsWith('http://') || member.socials.websites[0].startsWith('https://') 
                      ? member.socials.websites[0] 
                      : `https://${member.socials.websites[0]}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-700 hover:text-black transition-colors"
                    title="Website"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/>
                      <line x1="2" y1="12" x2="22" y2="12"/>
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                    </svg>
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Intro Section */}
          {member.intro && (
            <div>

              <p 
                className={`text-sm text-gray-700 leading-relaxed font-ibm-plex-mono whitespace-pre-wrap ${
                  !expandedIntros.has(member.id) && shouldTruncateIntro(member.intro) 
                    ? 'line-clamp-3' 
                    : ''
                }`}
              >
                {member.intro}
              </p>
              {shouldTruncateIntro(member.intro) && (
                <button
                  onClick={() => toggleIntro(member.id)}
                  className="text-xs text-gray-600 hover:text-gray-900 font-ibm-plex-mono mt-1 underline"
                >
                  {expandedIntros.has(member.id) ? 'Read less' : 'Read more'}
                </button>
              )}
            </div>
          )}

          {/* Metadata Tags */}
          {metadataEntries.length > 0 && (
            <div className="flex flex-wrap items-center">
              {visibleMetadata.map(([key, value], index) => renderMetadataTag(key, value, index))}
              {hiddenCount > 0 && (
                <span className="text-xs text-gray-500 font-ibm-plex-mono">+{hiddenCount} more</span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <ClientLayout>
      <div className="w-full border border-gray-800 rounded-md px-2 sm:px-4 py-4 sm:py-8" style={{
        backgroundImage: 'url(/grid.png)',
        backgroundColor: 'white',
        backgroundSize: '888px'
      }}>
        {/* Directory Container */}
        <div className="bg-white border border-b-2 border-gray-800 mb-6">
          <div className="py-4 px-2 sm:px-4">
            {/* Header */}
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-900 font-ibm-plex-mono mb-2">
                Directory
              </h2>
              <p className="text-sm text-gray-500 font-ibm-plex-mono">
                {totalCount} {totalCount === 1 ? 'member' : 'members'}
              </p>
            </div>

            {/* Search and Filter Bar */}
            <div className="mb-6 flex gap-3">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                <Input
                  type="text"
                  placeholder="Search members..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Button
                variant="outline"
                onClick={() => setShowFilters(!showFilters)}
                className="relative"
              >
                <Filter size={18} className="mr-2" />
                Filters
                {activeFilterCount > 0 && (
                  <span className="ml-2 bg-blue-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            </div>

            {/* Filter Panel */}
            {showFilters && metadataKeys.length > 0 && (
              <div className="border-t border-gray-200 pt-4">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-bold text-gray-900 font-ibm-plex-mono">Filters</h3>
                  {activeFilterCount > 0 && (
                    <button
                      onClick={clearFilters}
                      className="text-sm text-gray-600 hover:text-gray-900 font-ibm-plex-mono flex items-center gap-1 transition-opacity hover:opacity-80"
                    >
                      <X size={14} />
                      Clear all
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {metadataKeys.map(key => {
                    const values = Array.from(availableMetadataValues[key] || []);
                    return (
                      <div key={key} className="space-y-2">
                        <label className="text-sm font-bold text-gray-900 font-ibm-plex-mono capitalize">
                          {key.replace(/_/g, ' ')}
                        </label>
                        <div className="space-y-1">
                          {values.map(value => (
                            <label key={value} className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={metadataFilters[key]?.includes(value) || false}
                                onChange={() => toggleMetadataFilter(key, value)}
                                className="rounded border-gray-800 text-gray-900 focus:ring-gray-900"
                              />
                              <span className="text-sm text-gray-700 font-ibm-plex-mono">{value}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
          </div>
        )}

        {/* Empty State */}
        {!loading && members.length === 0 && (
          <div className="flex flex-col justify-center items-center py-12">
            <p 
              className="text-sm text-gray-500 font-ibm-plex-mono"
              style={{
                background: 'white',
                padding: '2px 48px',
                border: '1px solid black',
                borderBottom: '2px solid black',
                borderRadius: '3px'
              }}
            >
              {searchQuery || activeFilterCount > 0 ? 'No members found' : 'No members yet'}
            </p>
          </div>
        )}

        {/* Member Grid */}
        {!loading && members.length > 0 && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-2 mb-6">
              {members.map(renderMemberCard)}
            </div>

            {/* Loading More Indicator */}
            {loadingMore && (
              <div className="flex justify-center items-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900"></div>
              </div>
            )}

            {/* Sentinel for infinite scroll */}
            {hasMore && !loadingMore && (
              <div ref={sentinelRef} className="h-1" />
            )}

            {/* End of list indicator */}
            {!hasMore && members.length > 0 && (
              <div className="flex justify-center items-center py-8">
                <p 
                  className="text-sm text-gray-500 font-ibm-plex-mono"
                  style={{
                    background: 'white',
                    padding: '2px 48px',
                    border: '1px solid black',
                    borderBottom: '2px solid black',
                    borderRadius: '3px'
                  }}
                >
                  All members loaded
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </ClientLayout>
  );
}
