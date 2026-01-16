import React from 'react';
import { GeneralInput } from './GeneralInput';

interface SyntacticValidatorInputProps {
  inputVal: string;
  setInputVal: (val: string) => void;
  inputMode: 'raw' | 'structured';
}

/**
 * Input component for Syntactic Validator agent.
 * Accepts raw text for validation.
 */
export const SyntacticValidatorInput: React.FC<SyntacticValidatorInputProps> = ({
  inputVal,
  setInputVal,
  inputMode
}) => {
  if (inputMode === 'raw') {
    return null; // Should not happen if configured correctly, or fallback to textarea in App
  }

  return (
    <div className="complex-form structured-mode" style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      <div style={{ flex: 1, width: '100%', border: '1px solid #333', borderRadius: '4px', overflow: 'hidden' }}>
        <GeneralInput
          value={inputVal}
          onChange={setInputVal}
          label="USER TEXT"
          badge="String"
          viewMode="edit"
        />
      </div>
    </div>
  );
};
