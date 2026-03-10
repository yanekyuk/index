import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface IndexFilterContextType {
  selectedIndexIds: string[];
  setSelectedIndexIds: (indexIds: string[]) => void;
  contactsOnly: boolean;
  setContactsOnly: (value: boolean) => void;
}

const IndexFilterContext = createContext<IndexFilterContextType | undefined>(undefined);

export function IndexFilterProvider({ children }: { children: ReactNode }) {
  const [selectedIndexIds, setSelectedIndexIds] = useState<string[]>([]);
  const [contactsOnly, setContactsOnlyState] = useState<boolean>(false);

  const handleSetSelectedIndexIds = useCallback((indexIds: string[]) => {
    setSelectedIndexIds(indexIds);
    if (indexIds.length > 0) {
      setContactsOnlyState(false);
    }
  }, []);

  const handleSetContactsOnly = useCallback((value: boolean) => {
    setContactsOnlyState(value);
    if (value) {
      setSelectedIndexIds([]);
    }
  }, []);

  return (
    <IndexFilterContext.Provider value={{
      selectedIndexIds,
      setSelectedIndexIds: handleSetSelectedIndexIds,
      contactsOnly,
      setContactsOnly: handleSetContactsOnly
    }}>
      {children}
    </IndexFilterContext.Provider>
  );
}

export function useIndexFilter() {
  const context = useContext(IndexFilterContext);
  if (context === undefined) {
    throw new Error('useIndexFilter must be used within an IndexFilterProvider');
  }
  return context;
}
