import React from 'react';
import { GeneralInput } from './GeneralInput';

interface ParallelFetcherInputProps {
  inputVal: string;
  setInputVal: (val: string) => void;
  inputMode: 'raw' | 'structured';
}

/**
 * Input component for Parallel Fetcher agent.
 * Accepts JSON search parameters - no markdown/preview needed.
 */
export const ParallelFetcherInput: React.FC<ParallelFetcherInputProps> = ({
  inputVal,
  setInputVal,
  inputMode
}) => {
  if (inputMode === 'raw') {
    return null;
  }

  return (
    <div className="complex-form structured-mode" style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      <div style={{ flex: 1, width: '100%', border: '1px solid #333', borderRadius: '4px', overflow: 'hidden' }}>
        <GeneralInput
          value={inputVal}
          onChange={setInputVal}
          label="SEARCH PARAMS"
          badge="JSON"
          operations={[]}
        />
      </div>
    </div>
  );
};
