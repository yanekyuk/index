import React from 'react';
import { GeneralInput, type SelectOption } from './GeneralInput';
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
  const upstreamProfile = parsed?.profile || null;
  const upstreamOppContext = parsed?.opportunityContext || '';

  // Local state for smooth editing
  const [profileStr, setProfileStr] = React.useState(upstreamProfile ? JSON.stringify(upstreamProfile, null, 2) : '');
  const [oppContextStr, setOppContextStr] = React.useState(upstreamOppContext);

  const areStructurallyEqual = (obj1: any, obj2: any) => JSON.stringify(obj1) === JSON.stringify(obj2);

  // Sync Profile: Upstream -> Local
  const prevProfileRef = React.useRef(upstreamProfile);
  React.useEffect(() => {
    if (!areStructurallyEqual(prevProfileRef.current, upstreamProfile)) {
      const newProfileStr = typeof upstreamProfile === 'string'
        ? upstreamProfile
        : (upstreamProfile ? JSON.stringify(upstreamProfile, null, 2) : '');
      setProfileStr(newProfileStr);
    }
    prevProfileRef.current = upstreamProfile;
  }, [upstreamProfile]);

  // Sync Opportunity Context: Upstream -> Local
  const prevOppContextRef = React.useRef(upstreamOppContext);
  React.useEffect(() => {
    if (prevOppContextRef.current !== upstreamOppContext) {
      setOppContextStr(upstreamOppContext);
    }
    prevOppContextRef.current = upstreamOppContext;
  }, [upstreamOppContext]);

  const updateInput = (updates: any) => {
    const newVal = { ...parsed, ...updates };
    setInputVal(JSON.stringify(newVal, null, 2));
  };

  // View Modes
  const [profileViewMode, setProfileViewMode] = React.useState<'edit' | 'preview'>('edit');
  const [oppViewMode, setOppViewMode] = React.useState<'edit' | 'preview'>('edit');

  // Build opportunity select options based on current profile
  const opportunityOptions: SelectOption[] = React.useMemo(() => {
    const currentProfile = safeParse(profileStr);
    const activeUser = context.find(u => areStructurallyEqual(u.userProfile, currentProfile));
    const targetUsers = activeUser ? [activeUser] : context;

    return targetUsers.flatMap(u =>
      (u.opportunities || []).map((op: any, idx: number) => ({
        label: `${op.title || op.role || `Opportunity ${idx + 1}`} (${u.name})`,
        value: `${u.id}-${idx}`
      }))
    );
  }, [context, profileStr]);

  const handleOpportunitySelect = (selectedId: string) => {
    if (!selectedId) return;
    const [uId, idxStr] = selectedId.split('-');
    const idx = parseInt(idxStr, 10);
    const user = context.find(u => u.id === uId);
    if (user?.opportunities?.[idx]) {
      const op = user.opportunities[idx];
      const opContext = `Title: ${op.title || op.role}\nDescription: ${op.description}\nWhy Matched: ${op.reason || op.score}`;
      setOppContextStr(opContext);
      updateInput({ opportunityContext: opContext });
    }
  };

  return (
    <div className="complex-form structured-mode" style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      {/* Profile Section */}
      <div style={{ minHeight: '300px', width: '100%', border: '1px solid #333', borderRadius: '4px', overflow: 'hidden', marginBottom: '8px' }}>
        <GeneralInput
          value={profileStr}
          onChange={(val) => {
            setProfileStr(val);
            try {
              updateInput({ profile: JSON.parse(val) });
            } catch {
              updateInput({ profile: val });
            }
          }}
          label="USER PROFILE"
          badge="Context"
          operations={['json2md']}
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
          operations={context.length > 0 ? ['json2md', 'select'] : ['json2md']}
          selectOptions={opportunityOptions}
          onSelectChange={handleOpportunitySelect}
          viewMode={oppViewMode}
          onViewModeChange={setOppViewMode}
        />
      </div>
    </div>
  );
};
