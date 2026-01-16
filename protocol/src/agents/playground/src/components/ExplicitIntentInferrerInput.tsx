import React from 'react';
import { GeneralInput } from './GeneralInput';

interface ExplicitIntentInferrerInputProps {
  inputVal: string;
  setInputVal: (val: string) => void;
  inputMode: 'raw' | 'structured';
}

const safeParse = (str: string) => {
  try { return JSON.parse(str); } catch { return {}; }
};

// EditableProfile removed.

export const ExplicitIntentInferrerInput: React.FC<ExplicitIntentInferrerInputProps> = ({
  inputVal,
  setInputVal,
  inputMode
}) => {
  if (inputMode === 'raw') {
    return null;
  }

  const parsed = safeParse(inputVal);
  const upstreamContent = parsed?.content || '';
  const upstreamProfile = parsed?.profile || null;

  // Local state for smooth editing
  const [profileStr, setProfileStr] = React.useState(upstreamProfile ? JSON.stringify(upstreamProfile, null, 2) : '');

  // Helper to deep compare JSON via stringify for sync
  const areStructurallyEqual = (obj1: any, obj2: any) => {
    return JSON.stringify(obj1) === JSON.stringify(obj2);
  };

  // Sync Profile: Upstream -> Local (structural check)
  React.useEffect(() => {
    try {
      const localParsed = JSON.parse(profileStr || 'null');
      if (!areStructurallyEqual(localParsed, upstreamProfile)) {
        // If profile is a string (markdown), use it directly; if object, stringify
        const newProfileStr = typeof upstreamProfile === 'string'
          ? upstreamProfile
          : (upstreamProfile ? JSON.stringify(upstreamProfile, null, 2) : '');
        setProfileStr(newProfileStr);
      }
    } catch (e) {
      // Local invalid, ignore unless forced by Ref change (below)
    }
  }, [upstreamProfile]);

  // Ref Pattern for specific overwrite logic (Injection)
  const prevProfileRef = React.useRef(upstreamProfile);
  React.useEffect(() => {
    if (!areStructurallyEqual(prevProfileRef.current, upstreamProfile)) {
      // If profile is a string (markdown), use it directly; if object, stringify
      const newProfileStr = typeof upstreamProfile === 'string'
        ? upstreamProfile
        : (upstreamProfile ? JSON.stringify(upstreamProfile, null, 2) : '');
      setProfileStr(newProfileStr);
    }
    prevProfileRef.current = upstreamProfile;
  }, [upstreamProfile]);

  const updateInput = (updates: any) => {
    const newVal = { ...parsed, ...updates };
    setInputVal(JSON.stringify(newVal, null, 2));
  };

  // View Modes
  const [contentViewMode, setContentViewMode] = React.useState<'edit' | 'preview'>('edit');
  const [profileViewMode, setProfileViewMode] = React.useState<'edit' | 'preview'>('edit');

  return (
    <div className="complex-form structured-mode" style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>

      {/* Content Section */}
      <div style={{ height: '300px', width: '100%', border: '1px solid #333', borderRadius: '4px', overflow: 'hidden' }}>
        <GeneralInput
          value={upstreamContent}
          onChange={(val) => updateInput({ content: val })}
          label="CONTENT"
          operations={['json2md']}
          viewMode={contentViewMode}
          onViewModeChange={setContentViewMode}
        />
      </div>

      {/* Profile Section */}
      <div style={{ height: '300px', width: '100%', border: '1px solid #333', borderRadius: '4px', overflow: 'hidden' }}>
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
          label="PROFILE"
          operations={['json2md']}
          viewMode={profileViewMode}
          onViewModeChange={setProfileViewMode}
        />
      </div>
    </div>
  );
};

