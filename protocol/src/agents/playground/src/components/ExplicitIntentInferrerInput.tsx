import React from 'react';
import { X } from 'lucide-react';

interface ExplicitIntentInferrerInputProps {
  inputVal: string;
  setInputVal: (val: string) => void;
  inputMode: 'raw' | 'structured';
}

const safeParse = (str: string) => {
  try { return JSON.parse(str); } catch { return {}; }
};

// Editable profile form (Reused/Adapted from IntentManagerInput)
const EditableProfile: React.FC<{
  profile: any;
  onUpdate: (newProfile: any) => void;
  onRemove: () => void;
}> = ({ profile, onUpdate, onRemove }) => {
  const identity = profile?.identity || {};
  const attributes = profile?.attributes || {};

  const updateField = (section: string, field: string, value: any) => {
    const newProfile = {
      ...profile,
      [section]: { ...(profile?.[section] || {}), [field]: value }
    };
    onUpdate(newProfile);
  };

  return (
    <div style={{
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid #333',
      borderRadius: '4px',
      padding: '12px',
      boxSizing: 'border-box'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <span style={{ color: '#00ffff', fontSize: '0.8rem', fontWeight: 500 }}>PROFILE</span>
        <button
          onClick={onRemove}
          style={{ background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', padding: '2px' }}
        >
          <X size={14} />
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' }}>
        <input
          type="text"
          value={identity.name || ''}
          onChange={(e) => updateField('identity', 'name', e.target.value)}
          placeholder="Name..."
          style={{ background: 'transparent', border: 'none', borderBottom: '1px solid #333', color: '#e6e6e6', padding: '4px 0', outline: 'none', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' }}
        />
        <input
          type="text"
          value={identity.location || ''}
          onChange={(e) => updateField('identity', 'location', e.target.value)}
          placeholder="Location..."
          style={{ background: 'transparent', border: 'none', borderBottom: '1px solid #333', color: '#e6e6e6', padding: '4px 0', outline: 'none', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' }}
        />
        <textarea
          value={identity.bio || ''}
          onChange={(e) => updateField('identity', 'bio', e.target.value)}
          placeholder="Bio..."
          style={{ width: '100%', minHeight: '40px', background: 'rgba(255,255,255,0.02)', border: '1px dashed #333', color: '#e6e6e6', padding: '6px', resize: 'vertical', outline: 'none', fontFamily: 'monospace', fontSize: '0.8rem', boxSizing: 'border-box' }}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <input
          type="text"
          value={(identity.companies || []).join(', ')}
          onChange={(e) => {
            const companies = e.target.value.split(',').map(s => s.trim()).filter(s => s);
            updateField('identity', 'companies', companies);
          }}
          placeholder="Companies (comma-separated)..."
          style={{ background: 'transparent', border: 'none', borderBottom: '1px solid #333', color: '#e6e6e6', padding: '4px 0', outline: 'none', fontSize: '0.8rem', width: '100%', boxSizing: 'border-box' }}
        />
        <input
          type="text"
          value={(attributes.interests || []).join(', ')}
          onChange={(e) => {
            const interests = e.target.value.split(',').map(s => s.trim()).filter(s => s);
            updateField('attributes', 'interests', interests);
          }}
          placeholder="Interests (comma-separated)..."
          style={{ background: 'transparent', border: 'none', borderBottom: '1px solid #333', color: '#e6e6e6', padding: '4px 0', outline: 'none', fontSize: '0.8rem', width: '100%', boxSizing: 'border-box' }}
        />
      </div>
    </div>
  );
};

export const ExplicitIntentInferrerInput: React.FC<ExplicitIntentInferrerInputProps> = ({
  inputVal,
  setInputVal,
  inputMode
}) => {
  // If we are in raw mode, this component isn't mounted by App.tsx logic usually,
  // but if it is, we render nothing or just pass through.
  // The App.tsx handles switching views.
  if (inputMode === 'raw') return null;

  const parsed = safeParse(inputVal);
  const content = parsed?.content || '';
  const profile = parsed?.profile || null;

  const updateInput = (updates: any) => {
    const newVal = { ...parsed, ...updates };
    setInputVal(JSON.stringify(newVal, null, 2));
  };

  const hasProfile = profile?.identity;

  return (
    <div className="complex-form structured-mode" style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '100%', overflow: 'hidden' }}>

      {/* Content Section */}
      <div className="form-group">
        <div className="form-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <div className="label-col" style={{ marginBottom: '8px' }}>
            <label style={{ color: '#00ffff' }}>Content</label>
            <span className="desc-tooltip">Raw text to analyze (e.g. user message)</span>
          </div>
          <div className="input-col" style={{ width: '100%' }}>
            <textarea
              value={content}
              onChange={(e) => updateInput({ content: e.target.value })}
              placeholder="Enter text to extract intents from..."
              style={{
                width: '100%',
                minHeight: '80px',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid #333',
                borderRadius: '4px',
                color: '#e6e6e6',
                padding: '10px',
                resize: 'vertical',
                outline: 'none',
                fontFamily: 'monospace',
                fontSize: '0.85rem',
                boxSizing: 'border-box'
              }}
            />
          </div>
        </div>
      </div>

      {/* Profile Section */}
      <div className="form-group">
        <div className="form-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <div className="label-col" style={{ marginBottom: '8px' }}>
            <label style={{ color: '#00ffff' }}>Profile</label>
            <span className="desc-tooltip">Context for the analysis</span>
          </div>
          <div className="input-col" style={{ width: '100%', maxWidth: '100%', overflow: 'hidden' }}>
            {hasProfile ? (
              <EditableProfile
                profile={profile}
                onUpdate={(p) => updateInput({ profile: p })}
                onRemove={() => updateInput({ profile: null })}
              />
            ) : (
              <div style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px dashed #333',
                borderRadius: '4px',
                padding: '16px',
                textAlign: 'center',
                color: '#666',
                fontSize: '0.85rem'
              }}>
                Click a <span style={{ color: '#00ffff' }}>profile</span> from Context Memory to inject
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
