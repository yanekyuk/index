import React from 'react';
import { GeneralInput } from './GeneralInput';

interface HydeGeneratorInputProps {
  inputVal: string;
  setInputVal: (val: string) => void;
  inputMode: 'raw' | 'structured';
}

/**
 * Input component for HyDE Generator agent.
 * Accepts UserProfile JSON. Supports json2md conversion for readability.
 */
export const HydeGeneratorInput: React.FC<HydeGeneratorInputProps> = ({
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
          label="USER PROFILE"
          badge="UserMemoryProfile"
          operations={['json2md']}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />
      </div>
    </div>
  );
};
