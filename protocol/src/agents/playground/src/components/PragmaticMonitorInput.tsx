import React, { useEffect, useState } from 'react';
import { GeneralInput } from './GeneralInput';

interface PragmaticMonitorInputProps {
  inputVal: string;
  setInputVal: (val: string) => void;
  inputMode: 'raw' | 'structured';
}

/**
 * Input component for Pragmatic Monitor agent.
 * Requires Target Intent and Subsequent Discourse.
 */
export const PragmaticMonitorInput: React.FC<PragmaticMonitorInputProps> = ({
  inputVal,
  setInputVal,
  inputMode
}) => {

  const [targetIntent, setTargetIntent] = useState('');
  const [subsequentDiscourse, setSubsequentDiscourse] = useState('');

  useEffect(() => {
    try {
      const parsed = JSON.parse(inputVal);
      setTargetIntent(parsed.target_intent || '');
      setSubsequentDiscourse(parsed.subsequent_discourse || '');
    } catch (e) {
      // ignore
    }
  }, [inputVal]);

  const updatePayload = (tIntent: string, sDiscourse: string) => {
    const payload = {
      target_intent: tIntent,
      subsequent_discourse: sDiscourse
    };
    setInputVal(JSON.stringify(payload, null, 2));
  };

  if (inputMode === 'raw') return null;

  return (
    <div className="complex-form structured-mode" style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', gap: '12px' }}>

      {/* Target Intent */}
      <div style={{ height: '30%', display: 'flex', flexDirection: 'column', border: '1px solid #333', borderRadius: '4px', overflow: 'hidden' }}>
        <GeneralInput
          value={targetIntent}
          onChange={(val) => {
            setTargetIntent(val);
            updatePayload(val, subsequentDiscourse);
          }}
          label="TARGET INTENT"
          badge="Past Promise"
        />
      </div>

      {/* Subsequent Discourse */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', border: '1px solid #333', borderRadius: '4px', overflow: 'hidden' }}>
        <GeneralInput
          value={subsequentDiscourse}
          onChange={(val) => {
            setSubsequentDiscourse(val);
            updatePayload(targetIntent, val);
          }}
          label="SUBSEQUENT DISCOURSE"
          badge="Recent Activity"
        />
      </div>

    </div>
  );
};
