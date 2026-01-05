import React from 'react';
import { GeneralInput } from './GeneralInput';

interface IntroGeneratorInputProps {
  inputVal: string;
  setInputVal: (val: string) => void;
  inputMode: 'raw' | 'structured';
}

const safeParse = (str: string) => {
  try { return JSON.parse(str); } catch { return {}; }
};

export const IntroGeneratorInput: React.FC<IntroGeneratorInputProps> = ({
  inputVal,
  setInputVal,
  inputMode
}) => {
  if (inputMode === 'raw') {
    return null;
  }

  const parsed = safeParse(inputVal);
  const upstreamSender = parsed?.sender || {};
  const upstreamRecipient = parsed?.recipient || {};

  // Local state for smooth editing
  const [senderStr, setSenderStr] = React.useState(JSON.stringify(upstreamSender, null, 2));
  const [recipientStr, setRecipientStr] = React.useState(JSON.stringify(upstreamRecipient, null, 2));

  // Helper to deep compare JSON via stringify for sync
  const areStructurallyEqual = (obj1: any, obj2: any) => {
    return JSON.stringify(obj1) === JSON.stringify(obj2);
  };

  // Sync Sender: Upstream -> Local
  React.useEffect(() => {
    try {
      const currentLocal = JSON.parse(senderStr || '{}');
      if (!areStructurallyEqual(currentLocal, upstreamSender)) {
        setSenderStr(JSON.stringify(upstreamSender, null, 2));
      }
    } catch {
      // If local is invalid, but upstream changed significantly (e.g. injection), we might overwrite.
      // For now, rely on structural check of valid objects.
    }
  }, [upstreamSender]);

  // Sync Recipient: Upstream -> Local
  React.useEffect(() => {
    try {
      const currentLocal = JSON.parse(recipientStr || '{}');
      if (!areStructurallyEqual(currentLocal, upstreamRecipient)) {
        setRecipientStr(JSON.stringify(upstreamRecipient, null, 2));
      }
    } catch { }
  }, [upstreamRecipient]);


  const updateInput = (updates: any) => {
    const newVal = { ...parsed, ...updates };
    setInputVal(JSON.stringify(newVal, null, 2));
  };

  // View Modes
  const [senderViewMode, setSenderViewMode] = React.useState<'edit' | 'preview'>('edit');
  const [recipientViewMode, setRecipientViewMode] = React.useState<'edit' | 'preview'>('edit');

  return (
    <div className="complex-form structured-mode" style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>

      {/* Sender Section */}
      <div style={{ minHeight: '300px', width: '100%', border: '1px solid #333', borderRadius: '4px', overflow: 'hidden', marginBottom: '8px' }}>
        <GeneralInput
          value={senderStr}
          onChange={(val) => {
            setSenderStr(val);
            try {
              const p = JSON.parse(val);
              updateInput({ sender: p });
            } catch (e) {
              // Ignore invalid JSON while typing
            }
          }}
          label="SENDER (SOURCE)"
          badge="Source"
          operations={['json2md']}
          viewMode={senderViewMode}
          onViewModeChange={setSenderViewMode}
        />
      </div>

      {/* Recipient Section */}
      <div style={{ minHeight: '300px', width: '100%', border: '1px solid #333', borderRadius: '4px', overflow: 'hidden' }}>
        <GeneralInput
          value={recipientStr}
          onChange={(val) => {
            setRecipientStr(val);
            try {
              const p = JSON.parse(val);
              updateInput({ recipient: p });
            } catch (e) {
              // Ignore invalid JSON while typing
            }
          }}
          label="RECIPIENT (TARGET)"
          badge="Target"
          operations={['json2md']}
          viewMode={recipientViewMode}
          onViewModeChange={setRecipientViewMode}
        />
      </div>

    </div>
  );
};
