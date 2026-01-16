import React from 'react';
import { GeneralInput } from './GeneralInput';

interface IntentManagerInputProps {
  inputVal: string;
  setInputVal: (val: string) => void;
  inputMode: 'raw' | 'structured';
}

const safeParse = (str: string) => {
  try { return JSON.parse(str); } catch { return {}; }
};

export const IntentManagerInput: React.FC<IntentManagerInputProps> = ({
  inputVal,
  setInputVal,
  inputMode
}) => {
  if (inputMode === 'raw') {
    return null;
  }

  // Parse upstream state once per render
  const parsed = safeParse(inputVal);
  const upstreamContent = parsed?.content || '';
  const upstreamProfile = parsed?.profile || null;
  const upstreamIntents = parsed?.activeIntents || [];

  // Local state for smooth editing (allows invalid JSON / text formatting)
  const [profileStr, setProfileStr] = React.useState(upstreamProfile ? JSON.stringify(upstreamProfile, null, 2) : '');
  const [intentsStr, setIntentsStr] = React.useState(upstreamIntents ? JSON.stringify(upstreamIntents, null, 2) : '[]');

  // Helper to deep compare JSON via stringify for sync
  const areStructurallyEqual = (obj1: any, obj2: any) => {
    return JSON.stringify(obj1) === JSON.stringify(obj2);
  };

  // Sync Profile: Upstream -> Local (Only if structurally different, e.g. Injection)
  React.useEffect(() => {
    try {
      const localParsed = JSON.parse(profileStr || 'null');
      if (!areStructurallyEqual(localParsed, upstreamProfile)) {
        const newProfileStr = typeof upstreamProfile === 'string'
          ? upstreamProfile
          : (upstreamProfile ? JSON.stringify(upstreamProfile, null, 2) : '');
        setProfileStr(newProfileStr);
      }
    } catch (e) {
      // Local is invalid JSON, so it definitely doesn't match upstream (which is valid object).
      // However, if we are currently typing, we don't want to get overwritten by a stale upstream.
      // But upstream only changes if we committed a valid change OR injection happened.
      // If we committed, local==upstream.
      // If injection happened, upstream changed.
      // If upstream changed, we SHOULD overwrite local (Injection takes precedence).
      // But verify 'upstream changed' part.
      // We need to compare upstream with PREVIOUS upstream.
      // React useEffect dependency on `upstreamProfile` handles "Upstream Changed".
      // But we need to avoid the loop: Local Edit -> Parent Update -> Prop Change -> Local Overwrite.
      // The `if (!areStructurallyEqual)` check handles the Loop.
      // If I type `{"a": 1}` -> Update Parent `{a:1}` -> Prop `{a:1}`.
      // Local `{"a": 1}` == Prop `{a:1}`. No setProfileStr. Text preserved.

      // What if Local is `{"a":` (invalid)?
      // Parent is `{}` (old).
      // Prop `{}` received.
      // Local `{"a":` != Prop `{}`.
      // We would Overwrite! Bad.
      // We only want to overwrite if Upstream CHANGED.
      // We need a ref for previous upstream.
    }
  }, [upstreamProfile]);

  // Ref Pattern for specific overwrite logic
  const prevProfileRef = React.useRef(upstreamProfile);
  React.useEffect(() => {
    if (!areStructurallyEqual(prevProfileRef.current, upstreamProfile)) {
      // Upstream specifically changed (Injection or other agent)
      // We overwrite local state to match new upstream
      // If profile is a string (markdown), use it directly; if object, stringify it
      const newProfileStr = typeof upstreamProfile === 'string'
        ? upstreamProfile
        : (upstreamProfile ? JSON.stringify(upstreamProfile, null, 2) : '');
      setProfileStr(newProfileStr);
    }
    prevProfileRef.current = upstreamProfile;
  }, [upstreamProfile]);

  const prevIntentsRef = React.useRef(upstreamIntents);
  React.useEffect(() => {
    if (!areStructurallyEqual(prevIntentsRef.current, upstreamIntents)) {
      // If intents is a string (markdown), use it directly; if array, stringify it
      const newIntentsStr = typeof upstreamIntents === 'string'
        ? upstreamIntents
        : (upstreamIntents ? JSON.stringify(upstreamIntents, null, 2) : '[]');
      setIntentsStr(newIntentsStr);
    }
    prevIntentsRef.current = upstreamIntents;
  }, [upstreamIntents]);


  const updateInput = (updates: any) => {
    const newVal = { ...parsed, ...updates };
    setInputVal(JSON.stringify(newVal, null, 2));
  };

  // View Modes
  const [contentViewMode, setContentViewMode] = React.useState<'edit' | 'preview'>('edit');
  const [profileViewMode, setProfileViewMode] = React.useState<'edit' | 'preview'>('edit');
  const [intentsViewMode, setIntentsViewMode] = React.useState<'edit' | 'preview'>('edit');

  return (
    <div className="complex-form structured-mode" style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>

      {/* Content Section */}
      <div style={{ minHeight: '300px', width: '100%', border: '1px solid #333', borderRadius: '4px', overflow: 'hidden' }}>
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
      <div style={{ minHeight: '300px', width: '100%', border: '1px solid #333', borderRadius: '4px', overflow: 'hidden' }}>
        <GeneralInput
          value={profileStr}
          onChange={(val) => {
            setProfileStr(val);
            try {
              const p = JSON.parse(val);
              updateInput({ profile: p });
            } catch (e) {
              // Not JSON - likely already markdown, pass it through directly
              updateInput({ profile: val });
            }
          }}
          label="PROFILE"
          operations={['json2md']}
          viewMode={profileViewMode}
          onViewModeChange={setProfileViewMode}
        />
      </div>

      {/* Active Intents Section */}
      <div style={{ minHeight: '300px', width: '100%', border: '1px solid #333', borderRadius: '4px', overflow: 'hidden' }}>
        <GeneralInput
          value={intentsStr}
          onChange={(val) => {
            setIntentsStr(val);
            try {
              const intents = JSON.parse(val);
              updateInput({ activeIntents: intents });
            } catch (e) {
              // Not JSON - likely already markdown, pass it through directly
              updateInput({ activeIntents: val });
            }
          }}
          label="ACTIVE INTENTS"
          operations={['json2md']}
          viewMode={intentsViewMode}
          onViewModeChange={setIntentsViewMode}
        />
      </div>
    </div>
  );
};

