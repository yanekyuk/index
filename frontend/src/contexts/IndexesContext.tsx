import { createContext, useContext, ReactNode, useState, useEffect, useCallback, useRef } from 'react';
import { Index } from '@/lib/types';
import { useAuthContext } from '@/contexts/AuthContext';
import { useIndexesV2 } from '@/services/v2/indexes.service';
import { useIndexes as useIndexesAPI } from '@/contexts/APIContext';

interface IndexesContextType {
  indexes: Index[];
  loading: boolean;
  error: string | null;
  refreshIndexes: () => Promise<void>;
  addIndex: (index: Index) => void;
  updateIndex: (updatedIndex: Index) => void;
  removeIndex: (indexId: string) => void;
}

const IndexesContext = createContext<IndexesContextType | undefined>(undefined);

export function IndexesProvider({ children }: { children: ReactNode }) {
  const [indexes, setIndexes] = useState<Index[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const indexesV2 = useIndexesV2();
  const indexesAPI = useIndexesAPI();
  const { isAuthenticated } = useAuthContext();
  const hasFetchedRef = useRef(false);
  const hasDataRef = useRef(false);
  const pendingJoinProcessedRef = useRef(false);

  const refreshIndexes = useCallback(async () => {
    try {
      if (!hasDataRef.current) {
        setLoading(true);
      }
      setError(null);
      const response = await indexesV2.getIndexes();
      setIndexes(response.data ?? []);
      hasFetchedRef.current = true;
      hasDataRef.current = true;
    } catch (err) {
      console.error('Error fetching indexes:', err);
      setError('Failed to load indexes');
      setIndexes([]);
    } finally {
      setLoading(false);
    }
  }, [indexesV2]);

  const addIndex = useCallback((index: Index) => {
    setIndexes(prev => [index, ...prev]);
  }, []);

  const updateIndex = useCallback((updatedIndex: Index) => {
    setIndexes(prev => prev.map(index => 
      index.id === updatedIndex.id ? updatedIndex : index
    ));
  }, []);

  const removeIndex = useCallback((indexId: string) => {
    setIndexes(prev => prev.filter(index => index.id !== indexId));
  }, []);

  // Initial load - only fetch once when authenticated
  useEffect(() => {
    if (isAuthenticated && !hasFetchedRef.current) {
      refreshIndexes();
    } else if (!isAuthenticated) {
      setIndexes([]);
      setLoading(false);
      setError(null);
      hasFetchedRef.current = false;
      hasDataRef.current = false;
      pendingJoinProcessedRef.current = false;
    }
  }, [isAuthenticated, refreshIndexes]);

  // Handle pending index join after authentication
  useEffect(() => {
    if (!isAuthenticated || pendingJoinProcessedRef.current) return;

    const pendingIndexId = typeof window !== 'undefined' 
      ? localStorage.getItem('pending_index_join') 
      : null;
    
    if (!pendingIndexId) return;

    pendingJoinProcessedRef.current = true;
    localStorage.removeItem('pending_index_join');

    indexesAPI.joinIndex(pendingIndexId)
      .then(() => refreshIndexes())
      .catch((err) => console.error('Failed to auto-join pending index:', err));
  }, [isAuthenticated, indexesAPI, refreshIndexes]);

  return (
    <IndexesContext.Provider value={{
      indexes,
      loading,
      error,
      refreshIndexes,
      addIndex,
      updateIndex,
      removeIndex
    }}>
      {children}
    </IndexesContext.Provider>
  );
}

export function useIndexesState() {
  const context = useContext(IndexesContext);
  if (context === undefined) {
    throw new Error('useIndexesState must be used within an IndexesProvider');
  }
  return context;
}
