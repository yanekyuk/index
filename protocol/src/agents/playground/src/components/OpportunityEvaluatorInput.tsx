import React from 'react';
import { GeneralInput } from './GeneralInput';
import { Search } from 'lucide-react';

// --- Types ---

// --- Types ---



import type { ContextItem } from '../lib/api';
import type { Profile } from '../lib/api'; // Ensure Profile is imported if used, it was used in map/filter

interface EvaluatorOptions {
  hydeDescription?: string;
  minScore?: number;
  [key: string]: unknown;
}

interface ParsedInput {
  sourceProfile?: Profile;
  candidates?: Profile[];
  options?: EvaluatorOptions;
}

interface OpportunityEvaluatorInputProps {
  inputVal: string;
  setInputVal: (val: string) => void;
  inputMode: 'raw' | 'structured';
  context: ContextItem[]; // Now uses shared UserContext type
  onLog?: (msg: string) => void;
}

const safeParse = (str: string): ParsedInput => {
  try { return JSON.parse(str); } catch { return {}; }
};

// --- Helper: Cosine Similarity ---
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  if (magnitudeA === 0 || magnitudeB === 0) return 0;
  return dotProduct / (magnitudeA * magnitudeB);
}



export const OpportunityEvaluatorInput: React.FC<OpportunityEvaluatorInputProps> = ({
  inputVal,
  setInputVal,
  inputMode,
  context,
  onLog
}) => {
  // RAW mode - falls through to default textarea (handled by parent)
  if (inputMode === 'raw') {
    return null;
  }

  // STRUCT mode - 4 inputs
  const parsed = safeParse(inputVal);
  const sourceProfile = parsed?.sourceProfile || null;
  const candidates = parsed?.candidates || [];
  const options = parsed?.options || {};
  const hydeDescription = options?.hydeDescription || '';
  const minScore = options?.minScore || 70;

  const updateInput = (updates: Partial<ParsedInput>) => {
    const newVal = { ...parsed, ...updates };
    setInputVal(JSON.stringify(newVal, null, 2));
  };

  const updateOptions = (optUpdates: Partial<EvaluatorOptions>) => {
    updateInput({ options: { ...options, ...optUpdates } });
  };

  /* Handlers */

  const handleEmbedSearch = async () => {
    // 1. Determine query text (HyDE Desc > Source Profile)
    let queryText = hydeDescription;
    let querySource = 'HyDE Description';

    if (!queryText && sourceProfile) {
      // Construct fallback text from profile
      const p = sourceProfile;
      const parts = [
        p.identity?.bio,
        p.narrative?.context,
        ...(p.attributes?.interests || []),
        ...(p.attributes?.skills || [])
      ];
      queryText = parts.filter(Boolean).join(' ');
      querySource = 'Source Profile (Fallback)';
    }

    if (!queryText) {
      alert('Cannot search: No HyDE Description or Source Profile text available.');
      return;
    }

    onLog?.(`[EmbedSearch] Source: ${querySource} (${queryText.length} chars)`);
    onLog?.('[EmbedSearch] Generating embedding for query...');

    try {
      // 2. Generate Embedding via API
      const response = await fetch('/api/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: queryText })
      });
      const data = await response.json();

      if (data.error) throw new Error(data.error);
      const queryVector = data.vector as number[];

      if (!queryVector || !Array.isArray(queryVector)) {
        throw new Error('Invalid vector response');
      }

      onLog?.('[EmbedSearch] Searching context...');

      // 3. Filter candidates from context
      const potentialCandidates = context
        .filter(c => c.userProfile) // Check if user has profile
        .map(c => {
          const profile = { ...c.userProfile, userId: c.id }; // Inject userId for Agent referencing
          // Attach embedding if available in context
          if (c.userProfileEmbedding) {
            profile.embedding = c.userProfileEmbedding;
          }
          return profile;
        })
        .filter(p => !sourceProfile || p.identity?.name !== sourceProfile.identity?.name) // Exclude self
        .filter(p => p.embedding && Array.isArray(p.embedding)) as (Profile & { embedding: number[], userId: string })[];

      onLog?.(`[EmbedSearch] Comparing query against ${potentialCandidates.length} Candidate Profiles (using existing embeddings).`);

      if (potentialCandidates.length === 0) {
        onLog?.('[EmbedSearch] No candidates with embeddings found in context.');
        return;
      }

      // 4. Score
      const scored = potentialCandidates.map(p => ({
        profile: p,
        score: cosineSimilarity(queryVector, p.embedding)
      }));

      // 5. Sort & Filter
      // Use minScore from options (0-100) mapped to 0-1 similarity
      const MIN_SIMILARITY = minScore / 100;

      const filtered = scored
        .filter(s => s.score >= MIN_SIMILARITY)
        .sort((a, b) => b.score - a.score);

      // 6. Update Input with top 10
      const topCandidatesWithScore = filtered.slice(0, 10);
      const topCandidates = topCandidatesWithScore.map(s => s.profile);

      updateInput({ candidates: topCandidates });
      onLog?.(`[EmbedSearch] Found ${topCandidates.length} candidates (Sim >= ${MIN_SIMILARITY}):`);
      topCandidatesWithScore.forEach((c, i) => {
        const name = c.profile.identity?.name || 'Unknown';
        onLog?.(`  ${i + 1}. ${name} (${(c.score * 100).toFixed(1)}%)`);
      });

    } catch (e: unknown) {
      console.error(e);
      const msg = e instanceof Error ? e.message : String(e);
      onLog?.(`[EmbedSearch] Error: ${msg}`);
    }
  };

  return (
    <div className="complex-form structured-mode" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', paddingRight: '8px' }}>

      {/* 1. Source Profile */}
      <div style={{ height: '300px', flexShrink: 0 }}>
        <JsonParamsInput
          label="SOURCE PROFILE"
          value={sourceProfile}
          onChange={(v) => updateInput({ sourceProfile: v as Profile })}
          height="100%"
        />
      </div>

      <div style={{ height: '150px', flexShrink: 0 }}>
        <GeneralInput
          label="EXISTING OPPORTUNITIES"
          value={options.existingOpportunities as string || ''}
          onChange={(val) => updateOptions({ existingOpportunities: val })}
        />
      </div>

      <div style={{ height: '150px', flexShrink: 0 }}>
        <GeneralInput
          label="HYDE DESCRIPTION"
          value={hydeDescription}
          onChange={(val) => updateOptions({ hydeDescription: val })}
        />
      </div>

      <div style={{ flexShrink: 0, padding: '0 4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span className="panel-label">MIN SCORE</span>
          <span style={{ color: '#00ffff', fontFamily: 'monospace' }}>{minScore}</span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={minScore}
          onChange={(e) => updateOptions({ minScore: parseInt(e.target.value) })}
          style={{ width: '100%', accentColor: '#00ffff', cursor: 'pointer' }}
        />
      </div>

      <div style={{ height: '300px', flexShrink: 0 }}>
        <JsonParamsInput
          label="CANDIDATES"
          // Display candidates WITHOUT embeddings to keep UI clean
          value={candidates.map(({ embedding, ...rest }) => rest)}
          onChange={(newVal) => {
            // MERGE logic: Restore embeddings from original candidates if available
            // Assume order preserved or try to match by ID? Order is safest for array edits.
            if (Array.isArray(newVal)) {
              const merged = (newVal as Profile[]).map((c, i) => {
                // Find original embedding if ID matches, else try index
                const original = candidates.find((oc) => oc.identity?.name === c.identity?.name) || candidates[i];
                return { ...c, embedding: original?.embedding };
              });
              updateInput({ candidates: merged });
            } else {
              updateInput({ candidates: newVal as Profile[] });
            }
          }}
          height="100%"
          headerControls={
            <button
              onClick={handleEmbedSearch}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                background: 'rgba(0, 255, 255, 0.1)',
                border: '1px solid #00ffff',
                color: '#00ffff',
                padding: '4px 8px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.75rem'
              }}
            >
              <Search size={14} /> Embed Search
            </button>
          }
          enableJson2Md={false}
        />
      </div>
    </div>
  );
};

// Helper for JSON/Object inputs (Source, Candidates) to handle valid/invalid states
const JsonParamsInput: React.FC<{
  label: string;
  value: unknown;
  onChange: (val: unknown) => void;
  height?: string;
  headerControls?: React.ReactNode;
  enableJson2Md?: boolean;
}> = ({ label, value, onChange, height, headerControls, enableJson2Md = true }) => {
  const [str, setStr] = React.useState(value ? JSON.stringify(value, null, 2) : '');

  React.useEffect(() => {
    try {
      const local = JSON.parse(str || 'null');
      if (JSON.stringify(local) !== JSON.stringify(value)) {
        setStr(value ? JSON.stringify(value, null, 2) : '');
      }
    } catch {
      if (value && JSON.stringify(value, null, 2) !== str) {
        setStr(JSON.stringify(value, null, 2));
      }
    }
  }, [value]);

  return (
    <div style={{ height: height || '100%', width: '100%' }}>
      <GeneralInput
        label={label}
        value={str}
        onChange={(val) => {
          setStr(val);
          try { onChange(JSON.parse(val)); } catch { /* invalid json */ }
        }}
        headerControls={headerControls}
        operations={enableJson2Md ? ['json2md'] : []}
      />
    </div>
  );
};
