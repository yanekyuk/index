import { useState, useEffect, useCallback } from 'react';

export interface Suggestion {
  label: string;
  type: 'direct' | 'prompt';
  followupText?: string;
  prefill?: string;
}

// Static starter suggestions - shown on focus when no intent context
const STATIC_SUGGESTIONS: Suggestion[] = [
  { label: 'Find collaborators', type: 'direct', followupText: 'Find collaborators for my work' },
  { label: 'Looking for investors', type: 'direct', followupText: 'Looking for investors' },
  { label: 'Seeking co-founders', type: 'direct', followupText: 'Seeking co-founders' },
  { label: 'Need technical help with...', type: 'prompt', prefill: 'I need technical help with ' },
  { label: 'Want to connect with...', type: 'prompt', prefill: 'I want to connect with people who ' },
];

interface UseSuggestionsOptions {
  /** Intent ID for dynamic refinement suggestions */
  intentId?: string;
  /** Selected index ID to filter/contextualize suggestions */
  indexId?: string | null;
  /** Whether to fetch suggestions (e.g., on focus) */
  enabled?: boolean;
}

interface UseSuggestionsResult {
  suggestions: Suggestion[];
  isLoading: boolean;
  /** Refresh suggestions (e.g., after refinement) */
  refresh: () => Promise<void>;
}

export function useSuggestions({
  intentId,
  indexId,
  enabled = true,
}: UseSuggestionsOptions = {}): UseSuggestionsResult {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchSuggestions = useCallback(async () => {
    if (!enabled) {
      setSuggestions([]);
      return;
    }

    // If we have an intentId, fetch dynamic refinement suggestions (mocked for now)
    if (intentId) {
      setIsLoading(true);
      try {
        // TODO: Replace with actual API call when ready
        // Mock dynamic suggestions based on context
        await new Promise(resolve => setTimeout(resolve, 300)); // Simulate network delay
        
        const mockDynamicSuggestions: Suggestion[] = [
          { label: 'Add more details', type: 'prompt', prefill: 'I also want to mention that ' },
          { label: 'Be more specific', type: 'prompt', prefill: 'Specifically, I\'m looking for ' },
          { label: 'Add timeline', type: 'direct', followupText: 'This is urgent, within the next month' },
        ];
        
        setSuggestions(mockDynamicSuggestions);
      } catch (error) {
        console.error('Failed to fetch suggestions:', error);
        setSuggestions([]);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // No intentId - return static starter suggestions
    // Optionally filter/modify based on indexId if needed
    setSuggestions(STATIC_SUGGESTIONS);
  }, [intentId, indexId, enabled]);

  useEffect(() => {
    fetchSuggestions();
  }, [fetchSuggestions]);

  return {
    suggestions,
    isLoading,
    refresh: fetchSuggestions,
  };
}
