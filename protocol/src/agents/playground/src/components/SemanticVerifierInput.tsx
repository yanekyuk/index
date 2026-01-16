import React, { useEffect, useState } from 'react';
import { GeneralInput } from './GeneralInput';

interface SemanticVerifierInputProps {
  inputVal: string;
  setInputVal: (val: string) => void;
  inputMode: 'raw' | 'structured';
}

/**
 * Input component for Semantic Verifier agent.
 * Requires Content (Utterance) and Context (UserProfile).
 */
export const SemanticVerifierInput: React.FC<SemanticVerifierInputProps> = ({
  inputVal,
  setInputVal,
  inputMode
}) => {

  // Local state for the split fields
  const [content, setContent] = useState('');
  const [context, setContext] = useState('');

  // Sync from props (external inputVal) to local state on mount or external change
  useEffect(() => {
    try {
      const parsed = JSON.parse(inputVal);
      setContent(parsed.content || '');
      setContext(parsed.context ? (typeof parsed.context === 'string' ? parsed.context : JSON.stringify(parsed.context, null, 2)) : '{}');
    } catch (e) {
      // If not JSON, maybe just content?
      // setContent(inputVal); 
    }
  }, [inputVal]);

  // Sync from local state to props (inputVal)
  const updatePayload = (newContent: string, newContext: string) => {
    const payload = {
      content: newContent,
      context: newContext
    };
    setInputVal(JSON.stringify(payload, null, 2));
  };

  if (inputMode === 'raw') return null;

  return (
    <div className="complex-form structured-mode" style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', gap: '12px' }}>

      {/* Upper Half: Content Input */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', border: '1px solid #333', borderRadius: '4px', overflow: 'hidden' }}>
        <GeneralInput
          value={content}
          onChange={(val) => {
            setContent(val);
            updatePayload(val, context);
          }}
          label="USER UTTERANCE (CONTENT)"
          badge="String"
        />
      </div>

      {/* Lower Half: Context Input (JSON) */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', border: '1px solid #333', borderRadius: '4px', overflow: 'hidden' }}>
        <GeneralInput
          value={context}
          onChange={(val) => {
            setContext(val);
            updatePayload(content, val);
          }}
          label="USER PROFILE (CONTEXT)"
          badge="JSON"
          operations={['json2md']} // Allow previewing profile
        />
      </div>

    </div>
  );
};
