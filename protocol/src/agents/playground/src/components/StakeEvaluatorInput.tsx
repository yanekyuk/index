import React from 'react';
import { GeneralInput } from './GeneralInput';
import type { ContextItem } from '../lib/api';

interface StakeEvaluatorInputProps {
  inputVal: string;
  setInputVal: (val: string) => void;
  inputMode: 'raw' | 'structured';
  context?: ContextItem[]; // For context injection reference if needed
}

const safeParse = (str: string) => {
  try { return JSON.parse(str); } catch { return {}; }
};

export const StakeEvaluatorInput: React.FC<StakeEvaluatorInputProps> = ({
  inputVal,
  setInputVal,
  inputMode
}) => {
  if (inputMode === 'raw') {
    return null;
  }

  const parsed = safeParse(inputVal);
  const upstreamPrimaryIntent = parsed?.primaryIntent || {};
  const upstreamCandidates = parsed?.candidates || [];

  // Local state
  const [primaryIntentStr, setPrimaryIntentStr] = React.useState(JSON.stringify(upstreamPrimaryIntent, null, 2));

  // Helpers
  const areStructurallyEqual = (obj1: any, obj2: any) => {
    return JSON.stringify(obj1) === JSON.stringify(obj2);
  };

  // Sync Primary Intent
  React.useEffect(() => {
    try {
      const currentLocal = JSON.parse(primaryIntentStr || '{}');
      if (!areStructurallyEqual(currentLocal, upstreamPrimaryIntent)) {
        setPrimaryIntentStr(JSON.stringify(upstreamPrimaryIntent, null, 2));
      }
    } catch { }
  }, [upstreamPrimaryIntent]);


  const updateInput = (updates: any) => {
    const newVal = { ...parsed, ...updates };
    setInputVal(JSON.stringify(newVal, null, 2));
  };

  const removeCandidate = (idx: number) => {
    const newCandidates = [...upstreamCandidates];
    newCandidates.splice(idx, 1);
    updateInput({ candidates: newCandidates });
  };

  // View Modes
  const [primaryViewMode, setPrimaryViewMode] = React.useState<'edit' | 'preview'>('edit');

  return (
    <div className="complex-form structured-mode" style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>

      {/* Primary Intent Section */}
      <div style={{ minHeight: '200px', width: '100%', border: '1px solid #333', borderRadius: '4px', overflow: 'hidden', marginBottom: '8px' }}>
        <GeneralInput
          value={primaryIntentStr}
          onChange={(val) => {
            setPrimaryIntentStr(val);
            try {
              const p = JSON.parse(val);
              updateInput({ primaryIntent: p });
            } catch {
              // If simple string update, maybe user typed description?
              // Agent expects { description: string } usually, or just object.
            }
          }}
          label="PRIMARY INTENT"
          badge="Evaluator"
          operations={['json2md']}
          viewMode={primaryViewMode}
          onViewModeChange={setPrimaryViewMode}
        />
      </div>

      {/* Candidates List Section */}
      <div style={{ flex: 1, minHeight: '300px', display: 'flex', flexDirection: 'column', border: '1px solid #333', borderRadius: '4px', overflow: 'hidden' }}>
        <div style={{
          padding: '8px',
          background: '#222',
          borderBottom: '1px solid #333',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          color: '#8b949e',
          fontSize: '0.75rem',
          fontWeight: 600
        }}>
          <span>CANDIDATES ({upstreamCandidates.length})</span>
          <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>Drag Context Users Here</span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px', background: '#0d1117' }}>
          {upstreamCandidates.length === 0 ? (
            <div style={{ color: '#444', fontStyle: 'italic', textAlign: 'center', marginTop: '20px' }}>
              No candidates. Inject from sidebar.
            </div>
          ) : (
            upstreamCandidates.map((c: any, i: number) => (
              <div key={i} style={{
                background: '#161b22', border: '1px solid #30363d', borderRadius: '6px', padding: '8px', marginBottom: '8px',
                display: 'flex', flexDirection: 'column', gap: '4px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  {/* Attempt to show User Name if available in candidate object */}
                  <span style={{ fontWeight: 'bold', color: '#58a6ff' }}>
                    {c.user?.name || `Candidate ${i + 1}`}
                  </span>
                  <button
                    onClick={() => removeCandidate(i)}
                    style={{ background: 'transparent', border: 'none', color: '#ff7b72', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}
                  >
                    ×
                  </button>
                </div>

                {/* Intent Description Preview */}
                <div style={{ fontSize: '0.85rem', color: '#c9d1d9', background: '#0d1117', padding: '4px', borderRadius: '4px', marginTop: '4px' }}>
                  {c.intent?.description || JSON.stringify(c.intent || c)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

    </div>
  );
};
