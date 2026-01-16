import React from 'react';
import { GeneralInput } from './GeneralInput';

interface SynthesisGeneratorInputProps {
  inputVal: string;
  setInputVal: (val: string) => void;
  inputMode: 'raw' | 'structured';
}

const safeParse = (str: string) => {
  try { return JSON.parse(str); } catch { return {}; }
};

export const SynthesisGeneratorInput: React.FC<SynthesisGeneratorInputProps> = ({
  inputVal,
  setInputVal,
  inputMode
}) => {
  if (inputMode === 'raw') {
    return null;
  }

  const parsed = safeParse(inputVal);
  const upstreamSource = parsed?.source || {};
  const upstreamTarget = parsed?.target || {};
  const upstreamIntents = parsed?.intents || [];

  // Local state for smooth editing
  const [sourceStr, setSourceStr] = React.useState(JSON.stringify(upstreamSource, null, 2));
  const [targetStr, setTargetStr] = React.useState(JSON.stringify(upstreamTarget, null, 2));
  const [intentsStr, setIntentsStr] = React.useState(JSON.stringify(upstreamIntents, null, 2));


  // Helper to deep compare JSON via stringify for sync
  const areStructurallyEqual = (obj1: any, obj2: any) => {
    return JSON.stringify(obj1) === JSON.stringify(obj2);
  };

  // Sync Source
  React.useEffect(() => {
    try {
      const currentLocal = JSON.parse(sourceStr || '{}');
      if (!areStructurallyEqual(currentLocal, upstreamSource)) {
        setSourceStr(JSON.stringify(upstreamSource, null, 2));
      }
    } catch { }
  }, [upstreamSource]);

  // Sync Target
  React.useEffect(() => {
    try {
      const currentLocal = JSON.parse(targetStr || '{}');
      if (!areStructurallyEqual(currentLocal, upstreamTarget)) {
        setTargetStr(JSON.stringify(upstreamTarget, null, 2));
      }
    } catch { }
  }, [upstreamTarget]);

  // Sync Intents
  React.useEffect(() => {
    try {
      // intents might be string[] or string depending on user edit state
      const currentLocal = JSON.parse(intentsStr || '[]');
      if (!areStructurallyEqual(currentLocal, upstreamIntents)) {
        setIntentsStr(JSON.stringify(upstreamIntents, null, 2));
      }
    } catch { }
  }, [upstreamIntents]);


  const updateInput = (updates: any) => {
    const newVal = { ...parsed, ...updates };
    setInputVal(JSON.stringify(newVal, null, 2));
  };

  // View Modes
  const [sourceViewMode, setSourceViewMode] = React.useState<'edit' | 'preview'>('edit');
  const [targetViewMode, setTargetViewMode] = React.useState<'edit' | 'preview'>('edit');
  const [intentsViewMode, setIntentsViewMode] = React.useState<'edit' | 'preview'>('edit');

  return (
    <div className="complex-form structured-mode" style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>

      {/* Source Section */}
      <div style={{ minHeight: '300px', width: '100%', border: '1px solid #333', borderRadius: '4px', overflow: 'hidden', marginBottom: '8px' }}>
        <GeneralInput
          value={sourceStr}
          onChange={(val) => {
            setSourceStr(val);
            try {
              const p = JSON.parse(val);
              updateInput({ source: p });
            } catch { }
          }}
          label="SOURCE PROFILE"
          badge="Source"
          operations={['json2md']}
          viewMode={sourceViewMode}
          onViewModeChange={setSourceViewMode}
        />
      </div>

      {/* Target Section */}
      <div style={{ minHeight: '300px', width: '100%', border: '1px solid #333', borderRadius: '4px', overflow: 'hidden', marginBottom: '8px' }}>
        <GeneralInput
          value={targetStr}
          onChange={(val) => {
            setTargetStr(val);
            try {
              const p = JSON.parse(val);
              updateInput({ target: p });
            } catch { }
          }}
          label="TARGET PROFILE"
          badge="Target"
          operations={['json2md']}
          viewMode={targetViewMode}
          onViewModeChange={setTargetViewMode}
        />
      </div>

      {/* Intents Section */}
      <div style={{ minHeight: '200px', width: '100%', border: '1px solid #333', borderRadius: '4px', overflow: 'hidden' }}>
        <GeneralInput
          value={intentsStr}
          onChange={(val) => {
            setIntentsStr(val);
            try {
              const p = JSON.parse(val);
              updateInput({ intents: p });
            } catch { }
          }}
          label="SHARED INTENTS"
          badge="Reasoning"
          operations={['json2md']}
          viewMode={intentsViewMode}
          onViewModeChange={setIntentsViewMode}
        />
      </div>

    </div>
  );
};
