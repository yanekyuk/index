import React from 'react';
import { GeneralInput } from './GeneralInput';
import type { ContextItem } from '../lib/api';

interface ImplicitIntentInferrerInputProps {
  inputVal: string;
  setInputVal: (val: string) => void;
  inputMode: 'raw' | 'structured';
  context?: ContextItem[]; // To pick opportunities from
}

const safeParse = (str: string) => {
  try { return JSON.parse(str); } catch { return {}; }
};

export const ImplicitIntentInferrerInput: React.FC<ImplicitIntentInferrerInputProps> = ({
  inputVal,
  setInputVal,
  inputMode,
  context = []
}) => {
  if (inputMode === 'raw') {
    return null;
  }

  const parsed = safeParse(inputVal);
  // Default values
  const upstreamProfile = parsed.profile || {};
  const upstreamOppContext = parsed.opportunityContext || '';

  // Local state for smooth editing
  const [profileStr, setProfileStr] = React.useState(
    typeof upstreamProfile === 'string' ? upstreamProfile : JSON.stringify(upstreamProfile, null, 2)
  );
  const [oppContextStr, setOppContextStr] = React.useState(upstreamOppContext);

  // Helper to deep compare JSON via stringify for sync
  const areStructurallyEqual = (obj1: any, obj2: any) => {
    return JSON.stringify(obj1) === JSON.stringify(obj2);
  };

  // Sync Profile: Upstream -> Local
  React.useEffect(() => {
    try {
      // Check if upstream changed significantly
      const currentLocal = safeParse(profileStr);
      if (!areStructurallyEqual(currentLocal, upstreamProfile)) {
        const newStr = typeof upstreamProfile === 'string'
          ? upstreamProfile
          : JSON.stringify(upstreamProfile, null, 2);
        setProfileStr(newStr);
      }
    } catch { }
  }, [upstreamProfile]);

  // Sync Opportunity Context: Upstream -> Local
  React.useEffect(() => {
    if (upstreamOppContext !== oppContextStr) {
      setOppContextStr(upstreamOppContext);
    }
  }, [upstreamOppContext]);


  const updateInput = (updates: any) => {
    const newVal = { ...parsed, ...updates };
    setInputVal(JSON.stringify(newVal, null, 2));
  };

  // View Modes
  const [profileViewMode, setProfileViewMode] = React.useState<'edit' | 'preview'>('edit');
  const [oppViewMode, setOppViewMode] = React.useState<'edit' | 'preview'>('edit');

  return (
    <div className="complex-form structured-mode" style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>

      {/* Profile Section */}
      <div style={{ minHeight: '300px', width: '100%', border: '1px solid #333', borderRadius: '4px', overflow: 'hidden', marginBottom: '8px' }}>
        <GeneralInput
          value={profileStr}
          onChange={(val) => {
            setProfileStr(val);
            try {
              const p = JSON.parse(val);
              updateInput({ profile: p });
            } catch (e) {
              // If not JSON, maybe user wants it as string or it's partial
              // But ImplicitInferrer expects a string or object that becomes string.
              // Let's assume object if possible, else string.
              updateInput({ profile: val });
            }
          }}
          label="USER PROFILE"
          badge="Context"
          allowMarkdown={true}
          allowJson2Md={true}
          allowPreview={true}
          viewMode={profileViewMode}
          onViewModeChange={setProfileViewMode}
        />
      </div>

      {/* Opportunity Context Section */}
      <div style={{ minHeight: '300px', width: '100%', border: '1px solid #333', borderRadius: '4px', overflow: 'hidden' }}>
        <GeneralInput
          value={oppContextStr}
          onChange={(val) => {
            setOppContextStr(val);
            updateInput({ opportunityContext: val });
          }}
          label="OPPORTUNITY CONTEXT"
          badge="Reasoning"
          allowMarkdown={true}
          allowPreview={true}
          viewMode={oppViewMode}
          onViewModeChange={setOppViewMode}
          headerControls={
            /* Optional: Opportunity Picker from Context? */
            context.length > 0 ? (
              <select
                style={{ background: '#333', color: '#fff', border: 'none', padding: '2px 8px', fontSize: '0.8rem', maxWidth: '200px' }}
                onChange={(e) => {
                  const selectedId = e.target.value;
                  if (!selectedId) return;

                  // Parse "userId-index"
                  const [uId, idxStr] = selectedId.split('-');
                  const idx = parseInt(idxStr, 10);

                  const user = context.find(u => u.id === uId);
                  if (user && user.opportunities && user.opportunities[idx]) {
                    const op = user.opportunities[idx];
                    const opContext = `Title: ${op.title || op.role}\nDescription: ${op.description}\nWhy Matched: ${op.reason || op.score}`;

                    setOppContextStr(opContext);
                    updateInput({ opportunityContext: opContext });
                  }
                }}
              >
                <option value="">Select Opportunity...</option>
                {/* We need to flatten opportunities from all context users */}
                {context.flatMap(u => (u.opportunities || []).map((op: any, idx: number) => (
                  <option key={`${u.id}-${idx}`} value={`${u.id}-${idx}`}>
                    {op.title || op.role || `Opportunity ${idx + 1}`} ({u.name})
                  </option>
                )))}
              </select>
            ) : undefined
          }
        />
      </div>

    </div>
  );
};
