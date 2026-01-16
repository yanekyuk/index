import React from 'react';
import { GeneralInput } from './GeneralInput';

interface ProfileGeneratorInputProps {
  inputVal: string;
  setInputVal: (val: string) => void;
  inputMode: 'raw' | 'structured';
}

/**
 * Input component for Profile Generator agent.
 * Accepts ParallelSearchResult JSON or raw text describing a person.
 * Supports json2md conversion and markdown preview.
 */
export const ProfileGeneratorInput: React.FC<ProfileGeneratorInputProps> = ({
  inputVal,
  setInputVal,
  inputMode
}) => {
  if (inputMode === 'raw') {
    return null;
  }

  const [viewMode, setViewMode] = React.useState<'edit' | 'preview'>('edit');

  return (
    <div className="complex-form structured-mode" style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      <div style={{ flex: 1, width: '100%', border: '1px solid #333', borderRadius: '4px', overflow: 'hidden' }}>
        <GeneralInput
          value={inputVal}
          onChange={setInputVal}
          label="PROFILE INPUT"
          badge="ParallelSearchResult | String"
          operations={['json2md']}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />
      </div>
    </div>
  );
};
