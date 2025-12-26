import { useEffect, useState } from 'react';
import {
  type Agent,
  type AgentField,
  type ContextItem,
  fetchAgents,
  fetchContextData,
  runAgent
} from './lib/api';
import './App.css';
import { Terminal, Cpu, Database, Play, Save, Loader, Code, LayoutTemplate } from 'lucide-react';
import { ParallelFetcherInput } from './components/ParallelFetcherInput';
import { ProfileGeneratorInput } from './components/ProfileGeneratorInput';
import { HydeGeneratorInput } from './components/HydeGeneratorInput';
import { OpportunityEvaluatorInput } from './components/OpportunityEvaluatorInput';
import { IntentManagerInput } from './components/IntentManagerInput';
import { ExplicitIntentInferrerInput } from './components/ExplicitIntentInferrerInput';

function App() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [context, setContext] = useState<ContextItem[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  // Input State
  const [inputVal, setInputVal] = useState<string>('');
  const [inputMode, setInputMode] = useState<'raw' | 'structured'>('raw');

  const [outputVal, setOutputVal] = useState<string>('');
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [logs, setLogs] = useState<string[]>([]);

  // Dropdown state for opportunity evaluator profile selection
  const [profileDropdown, setProfileDropdown] = useState<{ ctxId: string; x: number; y: number } | null>(null);

  // Track source context ID for intent-manager profile updates
  const [sourceProfileCtxId, setSourceProfileCtxId] = useState<string | null>(null); // Track which ctx item populated the profile

  // Init & Persistence
  useEffect(() => {
    fetchAgents().then(setAgents);

    // Load local storage first
    try {
      const localCtx = localStorage.getItem('playground_context');
      const initialContext = localCtx ? JSON.parse(localCtx) : [];

      // Then parse server context
      fetchContextData().then(serverData => {
        // Merge? Or just append server data if not present?
        // For now, let's keep it simple: Server Data + Local Generated Data
        // We can identify local data by some ID prefix or just merge by ID unique
        const combined = [...initialContext];

        // Add server items if they don't exist
        serverData.forEach(sItem => {
          if (!combined.find(c => c.id === sItem.id)) {
            combined.push(sItem);
          }
        });
        setContext(combined);
        addLog('System initialized. Context loaded.');
      });
    } catch (e) {
      // Fallback
      fetchContextData().then(data => {
        setContext(data);
        addLog('System initialized. Context loaded (No Local).');
      });
    }
  }, []);

  // Save context to local storage on change
  useEffect(() => {
    if (context.length > 0) {
      // Only save "generated" or dynamically added items? 
      // Or save everything? Saving everything is safer for persistence transparency.
      localStorage.setItem('playground_context', JSON.stringify(context));
    }
  }, [context]);

  const addLog = (msg: string) => {
    setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 50));
  };


  const selectedAgent = agents.find(a => a.id === selectedAgentId);

  // Categorize Agents: External > Profile > Opportunity > Others
  const categoryOrder = ['external', 'profile', 'opportunity', 'intent', 'intent_stakes'];
  const categorizedAgents = categoryOrder.map(cat => ({
    id: cat,
    name: cat === 'external' ? 'External Tools'
      : cat === 'intent_stakes' ? 'Intent Stake'
        : cat.charAt(0).toUpperCase() + cat.slice(1) + ' Agents',
    agents: agents.filter(a => a.category === cat)
  })).filter(g => g.agents.length > 0);

  // Catch any leftovers
  const leftoverAgents = agents.filter(a => !categoryOrder.includes(a.category));
  if (leftoverAgents.length > 0) {
    categorizedAgents.push({ id: 'other', name: 'Other Agents', agents: leftoverAgents });
  }


  const handleAgentSelect = (id: string) => {
    setSelectedAgentId(id);
    const agent = agents.find(a => a.id === id);

    // Default to Structured if fields exist, else Raw (or specialized)
    const hasSchema = agent?.fields && agent.fields.length > 0;
    setInputMode(hasSchema ? 'structured' : 'raw');

    if (agent?.defaultInput) {
      setInputVal(typeof agent.defaultInput === 'string' ? agent.defaultInput : JSON.stringify(agent.defaultInput, null, 2));
    } else {
      setInputVal('');
    }
    setOutputVal('');
    addLog(`Agent selected: ${agent?.name}`);
  };

  const handleRun = async () => {
    if (!selectedAgentId) return;
    setIsRunning(true);
    addLog(`Running agent: ${selectedAgentId}...`);
    try {
      // Try to parse input as JSON regardless of type
      let payload: any = inputVal;

      // Special Case: Parallel Fetcher "Objective" strategy (mapped to 'raw') is pure string
      if (selectedAgentId === 'parallel-fetcher' && inputMode === 'raw') {
        payload = inputVal;
      } else {
        try {
          payload = JSON.parse(inputVal);
        } catch (e) {
          // If strict JSON fails, try lenient evaluation (for trailing commas, etc.)
          // This is safe-ish in a local playground context.
          try {
            // Security-safe fallback: Clean common JSON errors (like trailing commas)
            // Regex: Find commas followed by closing braces/brackets, ignoring whitespace
            const cleaned = inputVal.replace(/,(\s*[}\]])/g, '$1');
            payload = JSON.parse(cleaned);
          } catch (lenientErr) {
            // If both fail, and it's not raw_text, error out
            if (selectedAgent?.inputType !== 'raw_text') {
              addLog(`Error: Invalid input: ${(lenientErr as any).message}`);
              setIsRunning(false);
              return;
            }
            // For raw_text, keep as string (payload is already inputVal)
          }
        }
      }

      // Special Case: Opportunity Evaluator - Inject Candidates from Context
      if (selectedAgentId === 'opportunity-evaluator') {
        const potentialCandidates = context
          .filter(c => c.type === 'profile' || (c.type === 'generated' && c.data?.identity))
          .map(c => {
            // Ensure it has the structure expected by the backend
            // For generated items, c.data might be { profile: {...}, embedding: [...] }
            // We want to flatten it to { ...profile, embedding: [...] }
            if (c.data?.profile) {
              return {
                ...c.data.profile,
                embedding: c.data.embedding || c.data.profile.embedding
              };
            }
            return c.data || c.value; // Fallback for pure profile items
          });

        // Merge into payload
        if (typeof payload === 'object') {
          payload = {
            ...payload,
            candidates: potentialCandidates
          };
        }
        addLog(`Injected ${potentialCandidates.length} candidates from local context.`);
      }

      const res = await runAgent(selectedAgentId, payload);
      setOutputVal(JSON.stringify(res, null, 2));
      addLog(`Execution successful.`);
    } catch (e: any) {
      setOutputVal("Error: " + e.message);
      addLog(`Execution failed: ${e.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  const handleSaveOutput = () => {
    if (!outputVal) return;
    try {
      const data = JSON.parse(outputVal);

      // Special behavior for Intent Manager: apply actions to profile's activeIntents
      if (selectedAgent?.id === 'intent-manager') {
        const actions = data?.actions || [];

        // Get the profile and activeIntents from current input
        // Note: Intent Manager input has { content, profile, activeIntents } at top level
        const inputObj = JSON.parse(inputVal || '{}');
        const inputProfile = inputObj?.profile;
        const inputActiveIntents = inputObj?.activeIntents || [];

        addLog(`Debug: inputProfile name = ${inputProfile?.identity?.name}, inputActiveIntents count = ${inputActiveIntents.length}, actions count = ${actions.length}`);

        if (!inputProfile?.identity?.name) {
          addLog('Error: No profile in input to update.');
          return;
        }

        // Find matching profile in context by tracked ID first, then by name
        const profileName = inputProfile.identity.name;
        let existingProfileIndex = -1;

        // First try to find by tracked context ID (most reliable)
        if (sourceProfileCtxId) {
          existingProfileIndex = context.findIndex((c: ContextItem) => c.id === sourceProfileCtxId);
        }

        // Fallback: find by name if ID not tracked or not found
        if (existingProfileIndex < 0) {
          existingProfileIndex = context.findIndex(
            (c: ContextItem) => c.type === 'profile' && c.data?.identity?.name === profileName
          );
        }

        addLog(`Debug: sourceProfileCtxId = ${sourceProfileCtxId}, existingProfileIndex = ${existingProfileIndex}`);

        // Get existing activeIntents:
        // - If profile exists in context, use its activeIntents
        // - Otherwise, use the activeIntents from the input form
        let activeIntents = [...(existingProfileIndex >= 0
          ? context[existingProfileIndex].data?.activeIntents || []
          : inputActiveIntents)];

        addLog(`Debug: starting activeIntents count = ${activeIntents.length}`);

        // Apply actions
        let created = 0, updated = 0, expired = 0;
        for (const action of actions) {
          if (action.type === 'create') {
            activeIntents.push({
              id: `intent-${Date.now()}-${created}`,
              description: action.payload,
              status: 'active',
              created_at: Date.now()
            });
            created++;
          } else if (action.type === 'update') {
            const idx = activeIntents.findIndex((i: any) => i.id === action.id);
            if (idx !== -1) {
              activeIntents[idx] = { ...activeIntents[idx], description: action.payload };
              updated++;
            }
          } else if (action.type === 'expire') {
            activeIntents = activeIntents.filter((i: any) => i.id !== action.id);
            expired++;
          }
        }

        addLog(`Debug: final activeIntents count = ${activeIntents.length}`);

        // Build updated profile with activeIntents merged in
        const updatedProfile = {
          ...inputProfile,
          activeIntents
        };

        // Update or create in context
        if (existingProfileIndex >= 0) {
          setContext(prev => prev.map((c, i) =>
            i === existingProfileIndex
              ? { ...c, data: updatedProfile, timestamp: Date.now() }
              : c
          ));
          addLog(`Updated "${profileName}" profile: +${created} created, ~${updated} updated, -${expired} expired.`);
        } else {
          const newItem: ContextItem = {
            id: 'profile_' + Date.now(),
            type: 'profile',
            name: profileName,
            timestamp: Date.now(),
            data: updatedProfile
          };
          setContext(prev => [newItem, ...prev]);
          addLog(`Created profile "${profileName}" with ${activeIntents.length} intents.`);
        }
        return;
      }

      // Infer Type
      let type: ContextItem['type'] = 'generated';
      if (selectedAgent?.category === 'profile') type = 'profile';
      if (selectedAgent?.id === 'hyde-generator') type = 'hyde';
      if (selectedAgent?.id === 'parallel-fetcher') type = 'parallel-search-response';

      // Default name based on agent
      const defaultName = selectedAgent?.id === 'parallel-fetcher'
        ? 'parallel-search-response'
        : `${selectedAgent?.name} Output`;

      // Prompt for custom name
      const customName = prompt('Enter a name for this save:', defaultName);
      if (customName === null) return; // User cancelled

      const newItem: ContextItem = {
        id: 'gen_' + Date.now(),
        type: type,
        name: customName || defaultName,
        timestamp: Date.now(),
        data: data
      };
      setContext(prev => [newItem, ...prev]);
      addLog(`Output saved as "${customName || defaultName}" [${type}].`);
    } catch (e) {
      addLog('Error: Cannot save non-JSON output.');
    }
  };

  // --- Helper: Nested Object Update ---
  const updateNestedValue = (obj: any, path: string, value: any): any => {
    const keys = path.split('.');
    const newObj = JSON.parse(JSON.stringify(obj)); // Deep clone simple way
    let current = newObj;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!current[key]) current[key] = {};
      current = current[key];
    }
    current[keys[keys.length - 1]] = value;
    return newObj;
  };

  const getNestedValue = (obj: any, path: string): any => {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
  };

  // --- Smart Input Helpers ---

  const injectContext = (ctxId: string, targetKey?: string) => {
    const item = context.find(c => c.id === ctxId);
    if (!item) return;

    let dataToInject = item.value ?? item.data;

    // Smart unpacking for profiles
    if ((item.type === 'profile' || item.type === 'generated') && dataToInject?.profile) {
      // Preserve embedding if it exists on the parent object
      const embedding = dataToInject.embedding;
      dataToInject = {
        ...dataToInject.profile,
        // Only add embedding if it exists and isn't already in the profile
        ...(embedding ? { embedding } : {})
      };
    }

    // Special handling for Opportunity Evaluator
    if (selectedAgent?.id === 'opportunity-evaluator' && inputMode === 'structured') {
      const currentObj = JSON.parse(inputVal || '{}');

      // If it's a hyde type, inject directly into options.hydeDescription
      if (item.type === 'hyde') {
        const hydeText = typeof dataToInject === 'string' ? dataToInject : (dataToInject?.description || JSON.stringify(dataToInject));
        const newObj = {
          ...currentObj,
          options: { ...currentObj.options, hydeDescription: hydeText }
        };
        setInputVal(JSON.stringify(newObj, null, 2));
        addLog(`Injected HyDE description.`);
        return;
      }

      // For profiles, use the targetKey to determine where to inject
      if (targetKey === 'sourceProfile') {
        const newObj = { ...currentObj, sourceProfile: dataToInject };
        setInputVal(JSON.stringify(newObj, null, 2));
        addLog(`Set source profile: ${item.name}`);
        return;
      }
      if (targetKey === 'candidates') {
        const newCandidates = [...(currentObj.candidates || []), dataToInject];
        const newObj = { ...currentObj, candidates: newCandidates };
        setInputVal(JSON.stringify(newObj, null, 2));
        addLog(`Added candidate: ${item.name}`);
        return;
      }
      // If no targetKey and it's a profile, the dropdown should have handled it
      return;
    }

    // Special handling for Intent Manager
    if (selectedAgent?.id === 'intent-manager' && inputMode === 'structured') {
      const currentObj = JSON.parse(inputVal || '{}');

      // If it's a profile type, set as profile and track the context ID
      if (item.type === 'profile') {
        const activeIntents = dataToInject.activeIntents || [];
        const newObj = {
          ...currentObj,
          profile: dataToInject,
          activeIntents: activeIntents
        };
        setInputVal(JSON.stringify(newObj, null, 2));
        setSourceProfileCtxId(item.id);  // Track source for save
        addLog(`Set profile: ${item.name} (${activeIntents.length} active intents)`);
        return;
      }

      // If it's an intent_manager_response, process actions and add created intents
      if (item.type === 'intent_manager_response') {
        const responseData = dataToInject;
        let intents = [...(currentObj.activeIntents || [])];

        // IntentManagerResponse has actions: [{type: 'create'|'update'|'expire', ...}]
        const actions = responseData?.actions || [];

        let createdCount = 0;
        let updatedCount = 0;
        let expiredCount = 0;

        for (const action of actions) {
          if (action.type === 'create') {
            // Add new intent
            intents.push({
              id: `intent-${Date.now()}-${createdCount}`,
              description: action.payload || '',
              status: 'active',
              created_at: Date.now()
            });
            createdCount++;
          } else if (action.type === 'update') {
            // Update existing intent by id
            const idx = intents.findIndex((i: any) => i.id === action.id);
            if (idx !== -1) {
              intents[idx] = { ...intents[idx], description: action.payload || intents[idx].description };
              updatedCount++;
            }
          } else if (action.type === 'expire') {
            // Remove intent by id (or mark as expired)
            intents = intents.filter((i: any) => i.id !== action.id);
            expiredCount++;
          }
        }

        const newObj = {
          ...currentObj,
          activeIntents: intents
        };
        setInputVal(JSON.stringify(newObj, null, 2));
        addLog(`Applied actions: +${createdCount} created, ~${updatedCount} updated, -${expiredCount} expired.`);
        return;
      }
      return;
    }

    // Special handling for Explicit Intent Inferrer
    // Requirement: Selecting profile should only populate profile field, preserving content.
    if (selectedAgent?.id === 'explicit-intent-detector') {
      // We only care about Profile injection
      if (item.type === 'profile' || (item.type === 'generated' && dataToInject?.profile)) {
        try {
          const currentObj = JSON.parse(inputVal || '{}');
          // If it's a generated object that contains 'profile', use that inner profile
          // The 'dataToInject' has already been smart-unpacked at top of function?
          // Line 352: if ((item.type === 'profile' || item.type === 'generated') && dataToInject?.profile) ...
          // Yes, dataToInject is already the profile object with embedding fused.

          const newObj = {
            ...currentObj,
            profile: dataToInject
          };
          setInputVal(JSON.stringify(newObj, null, 2));
          addLog(`Set profile for extraction: ${item.name}`);
          return;
        } catch (e) {
          // If parsing fails (bad raw input), just reset to profile-only or ignore
          // Let's reset to preserving content if possible, but if inputVal is invalid JSON, we can't safely merge.
          // Fallback: Just set the profile as the input? No, user wants structure.
          // Best effort:
          console.error("Failed to parse current input, overwriting with profile structure.");
          const newObj = {
            content: "",
            profile: dataToInject
          };
          setInputVal(JSON.stringify(newObj, null, 2));
          return;
        }
      }
      // If injecting other types (like raw text for content?), fall through to default logic
      // But usually context items are objects. If user drags "Text" item?
      // For now, only profile behavior was requested.
    }

    if (selectedAgent?.inputType === 'raw_text') {
      if (typeof dataToInject === 'object') {
        setInputVal(JSON.stringify(dataToInject, null, 2));
      } else {
        setInputVal(String(dataToInject));
      }
      return;
    }

    // JSON Modes
    try {
      let currentObj = JSON.parse(inputVal || '{}');
      if (targetKey) {
        // If using structured form, targetKey handles logic
        currentObj = updateNestedValue(currentObj, targetKey, dataToInject);
      } else {
        currentObj = dataToInject;
      }
      setInputVal(JSON.stringify(currentObj, null, 2));
      addLog(`Injected ${item.name}.`);
    } catch (e) {
      if (!targetKey) setInputVal(JSON.stringify(dataToInject, null, 2));
    }
  };

  // --- Renderers ---

  // --- Context Filtering ---
  const getRelevantContextTypes = (agent?: Agent): string[] => {
    if (!agent) return [];
    if (agent.id === 'parallel-fetcher') return ['ParallelSearchRequest'];
    if (agent.id === 'profile-generator') return ['json', 'text', 'parallel-search-response']; // Parallel Output or Raw Text
    if (agent.category === 'profile' || agent.id === 'hyde-generator') return ['profile'];
    if (agent.category === 'opportunity' || agent.id === 'opportunity-evaluator') return ['profile', 'hyde'];
    if (agent.id === 'intent-manager') return ['profile', 'intent_manager_response'];
    if (agent.category === 'intent') return ['profile', 'intent'];
    if (agent.category === 'intent_stakes') return ['profile', 'intent'];
    return []; // Show all if empty? Or default logic
  };

  const renderContextList = () => {
    const relevantTypes = getRelevantContextTypes(selectedAgent);

    // If no agent selected, show all. If agent selected, filter.
    const filteredContext = !selectedAgent ? context : context.filter(c => {
      if (relevantTypes.length === 0) return true; // No filter defined
      // Special case: generated items might be profiles.
      // But my previous save logic tries to type them correctly.
      // Fallback: always show 'generated' if we are unsure? No, user wants strictness.
      return relevantTypes.includes(c.type) || (c.type === 'generated' && relevantTypes.includes('json'));
    });

    if (filteredContext.length === 0) {
      return <div className="empty-list">No relevant context found.</div>
    }

    return (
      <>
        {/* Dropdown Menu for profile selection */}
        {profileDropdown && (
          <div
            style={{
              position: 'fixed',
              top: profileDropdown.y,
              left: profileDropdown.x,
              background: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: '4px',
              zIndex: 1000,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
            }}
          >
            <button
              onClick={() => {
                injectContext(profileDropdown.ctxId, 'sourceProfile');
                setProfileDropdown(null);
              }}
              style={{
                display: 'block',
                width: '100%',
                padding: '8px 16px',
                background: 'transparent',
                border: 'none',
                color: '#e6e6e6',
                cursor: 'pointer',
                textAlign: 'left',
                fontSize: '0.85rem'
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#333')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              Set as Source
            </button>
            <button
              onClick={() => {
                injectContext(profileDropdown.ctxId, 'candidates');
                setProfileDropdown(null);
              }}
              style={{
                display: 'block',
                width: '100%',
                padding: '8px 16px',
                background: 'transparent',
                border: 'none',
                color: '#e6e6e6',
                cursor: 'pointer',
                textAlign: 'left',
                fontSize: '0.85rem'
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#333')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              Add to Candidates
            </button>
          </div>
        )}
        {/* Click outside to close dropdown */}
        {profileDropdown && (
          <div
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }}
            onClick={() => setProfileDropdown(null)}
          />
        )}
        {filteredContext.map(c => (
          <div
            key={c.id}
            className="terminal-item context-item"
            draggable
            onClick={(e) => {
              // For opportunity-evaluator + profile type, show dropdown
              if (selectedAgent?.id === 'opportunity-evaluator' && inputMode === 'structured' && c.type === 'profile') {
                setProfileDropdown({ ctxId: c.id, x: e.clientX, y: e.clientY });
              } else {
                injectContext(c.id);
              }
            }}
            style={{ cursor: 'pointer' }}
            onDragStart={(e) => e.dataTransfer.setData('text/plain', c.id)}
          >
            <Database size={14} className="icon" />
            <div className="info">
              <span className="name">{c.name}</span>
              <span className="type" style={{ color: '#00ffff' }}>{c.type}</span>
            </div>
            <button
              className="icon-btn"
              onClick={(e) => {
                e.stopPropagation();
                setContext(prev => prev.filter(item => item.id !== c.id));
              }}
              title="Remove from Context"
              style={{
                color: '#00ffff',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '4px',
                fontSize: '1rem',
                lineHeight: '1'
              }}
            >
              ×
            </button>
          </div>
        ))}
        {filteredContext.length > 0 && (
          <button
            className="text-btn"
            onClick={() => {
              setContext([]);
              localStorage.removeItem('playground_context');
              addLog('Context memory cleared.');
            }}
            style={{
              marginTop: '8px',
              width: '100%',
              textAlign: 'center',
              color: '#fa7a61'
            }}
          >
            Clear All Context
          </button>
        )}
      </>
    );
  };


  // --- Visual Previews ---
  const renderComplexPreview = (type: string, value: any) => {
    if (!value) return null;

    // 1. Parallel Result Preview
    if ((type === 'json' || type === 'parallel-search-response') && value.results && Array.isArray(value.results)) {
      return (
        <div className="preview-box">
          <div className="preview-header">
            <span>Parallel Results ({value.results.length})</span>
          </div>
          <div className="preview-list">
            {value.results.map((r: any, i: number) => (
              <div key={i} className="preview-card result-card">
                <div className="card-title">{r.title}</div>
                <div className="card-sub"><a href={r.url} target="_blank" rel="noopener noreferrer">{r.url}</a></div>
                <div className="card-body">{r.content || r.snippet || 'No content'}</div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    // 2. Profile Preview
    if ((type === 'profile' || type === 'hyde' || (type === 'json' && value.identity)) && value.identity) {
      const p = value; // Assume full profile object
      return (
        <div className="preview-box profile-preview">
          <div className="preview-header">Profile: {p.identity.name}</div>
          <div className="card-body">
            <div><strong>Bio:</strong> {p.identity.bio}</div>
            {p.identity.location && <div><strong>Loc:</strong> {p.identity.location}</div>}
            {p.identity.companies && <div><strong>Works:</strong> {p.identity.companies.join(', ')}</div>}

            {/* Narrative Section */}
            {p.narrative && (
              <div style={{ marginTop: '6px', borderTop: '1px solid #333', paddingTop: '4px' }}>
                <strong>Narrative:</strong>
                <div style={{ opacity: 0.8 }}>{p.narrative.context?.substring(0, 100)}...</div>
              </div>
            )}

            {/* Attributes Section */}
            {p.attributes && (
              <div style={{ marginTop: '4px' }}>
                <strong>Interests:</strong> {p.attributes.interests?.slice(0, 3).join(', ')}...
              </div>
            )}
          </div>
        </div>
      );
    }

    // 3. Array Preview
    if (type === 'profile_array' && Array.isArray(value)) {
      return (
        <div className="preview-box">
          <div className="preview-header">Profiles ({value.length})</div>
          <div className="preview-list">
            {value.map((p: any, i: number) => (
              <div key={i} className="preview-card">
                <div className="card-title">{p.identity?.name || 'Unknown'}</div>
                <div className="card-sub">{p.identity?.bio?.substring(0, 50)}...</div>
                <button className="remove-btn" onClick={() => {
                  // We need a way to bubble up removal. 
                  // For now, simple display. Removal needs state access.
                }}>×</button>
              </div>
            ))}
          </div>
        </div>
      )
    }

    return null;
  };

  const renderStructuredForm = (fields: AgentField[]) => {
    const currentObj = safeParse(inputVal);

    // Banner for Compatible but Non-Matching Input (e.g. Parallel Result in Profile Gen)
    const hasParallelResults = currentObj && currentObj.results && Array.isArray(currentObj.results);

    return (
      <div className="complex-form structured-mode">
        {hasParallelResults && (
          <div className="info-banner">
            <span>ℹ️ Parallel Search Result Loaded.</span>
            <span className="sub">Agent will process this raw data directly.</span>
          </div>
        )}

        {fields.map(field => {
          let val = getNestedValue(currentObj, field.key);

          // Fallback: If root object IS the parallel result, use it for the 'parallel_result' field
          if (!val && field.key === 'parallel_result' && hasParallelResults) {
            val = currentObj;
          }

          // Fallback: If root object IS a Profile (has identity), uses it for 'profile' field
          if (!val && field.key === 'profile' && currentObj.identity) {
            val = currentObj;
          }

          // Special Handling for 'profile' type: Render as flattened rows (like Parallel params)
          if (field.type === 'profile') {
            const pVal = val || {};
            const identity = pVal.identity || {};

            const renderRow = (label: string, subKey: string, placeholder: string) => (
              <div className="form-row" key={subKey}>
                <label>{label}</label>
                <input
                  type="text"
                  value={identity[subKey] || ''}
                  onChange={(e) => {
                    const newIdentity = { ...identity, [subKey]: e.target.value };
                    // If companies, split string
                    if (subKey === 'companies' && typeof e.target.value === 'string') {
                      // Actually, let's keep it simple string for input here, but strictly it's array.
                      // Ideally we parse it on blur or change. 
                      // For strictness:
                      // const arr = e.target.value.split(',').map(s=>s.trim());
                      // newIdentity.companies = arr;
                      // BUT input value needs to be string.
                    }
                    // Let's handle 'companies' specifically below if needed, or just let users type one company?
                    // User wants "UserProfile properties".

                    const newVal = { ...pVal, identity: newIdentity };
                    const newObj = updateNestedValue(currentObj, field.key, newVal);
                    setInputVal(JSON.stringify(newObj, null, 2));
                  }}
                  placeholder={placeholder}
                />
              </div>
            );

            // Companies array handling
            const companiesStr = Array.isArray(identity.companies) ? identity.companies.join(', ') : (identity.companies || '');

            return (
              <div key={field.key} className="profile-section">
                <div className="section-label" style={{
                  color: '#8b949e',
                  fontSize: '0.7rem',
                  marginBottom: '8px',
                  textTransform: 'uppercase',
                  marginTop: '12px'
                }}>-- {field.label} --</div>

                {renderRow('Name:', 'name', 'Enter name...')}

                <div className="form-row">
                  <label>Bio:</label>
                  <textarea
                    className="terminal-input"
                    style={{ minHeight: '60px', resize: 'vertical' }}
                    value={identity.bio || ''}
                    onChange={(e) => {
                      const newIdentity = { ...identity, bio: e.target.value };
                      const newVal = { ...pVal, identity: newIdentity };
                      const newObj = updateNestedValue(currentObj, field.key, newVal);
                      setInputVal(JSON.stringify(newObj, null, 2));
                    }}
                    placeholder="Enter bio..."
                  />
                </div>

                {renderRow('Location:', 'location', 'Istanbul, TR')}

                <div className="form-row">
                  <label>Companies:</label>
                  <input
                    type="text"
                    value={companiesStr}
                    onChange={(e) => {
                      const arr = e.target.value.split(',').map((s: string) => s.trim()); // naive live update?
                      // Better to store string in local state? No, direct update.
                      const newIdentity = { ...identity, companies: arr };
                      const newVal = { ...pVal, identity: newIdentity };
                      const newObj = updateNestedValue(currentObj, field.key, newVal);
                      setInputVal(JSON.stringify(newObj, null, 2));
                    }}
                    placeholder="Comma separated..."
                  />
                </div>
              </div>
            );
          }

          return (
            <div key={field.key} className="form-group">
              <div className="form-row">
                <div className="label-col">
                  <label>{field.label}</label>
                  {field.description && <span className="desc-tooltip">{field.description}</span>}
                </div>

                <div className="input-col">
                  {/* String / Number Input */}
                  {(field.type === 'string' || field.type === 'number') && (
                    <input
                      type={field.type === 'number' ? 'number' : 'text'}
                      value={val || ''}
                      onChange={(e) => {
                        const v = field.type === 'number' ? parseFloat(e.target.value) : e.target.value;
                        const newVal = updateNestedValue(currentObj, field.key, v);
                        setInputVal(JSON.stringify(newVal, null, 2));
                      }}
                      placeholder={`Enter ${field.label}...`}
                    />
                  )}

                  {/* JSON Input (Textarea + Injector) */}
                  {field.type === 'json' && (
                    <div className="json-field-wrapper">
                      <div className="controls">
                        {/* Removed in-form inject, rely on sidebar? or keep generic? 
                               User said "Only use context_memory for automatically filling fields".
                               Maybe keep it for JSON as it's raw editing.
                           */}
                        <small style={{ color: '#666' }}>Use sidebar to inject.</small>
                      </div>
                      {renderComplexPreview('json', val) || (
                        <textarea
                          value={typeof val === 'object' ? JSON.stringify(val, null, 2) : val || ''}
                          onChange={(e) => {
                            try {
                              const v = JSON.parse(e.target.value);
                              const newVal = updateNestedValue(currentObj, field.key, v);
                              setInputVal(JSON.stringify(newVal, null, 2));
                            } catch { }
                          }}
                          className="mini-textarea"
                          placeholder="Enter JSON..."
                        />
                      )}
                    </div>
                  )}

                  {/* Hyde - (Profile handled above) */}
                  {field.type === 'hyde' && (
                    <div className="profile-subform">
                      {/* Name */}
                      <div className="sub-form-row">
                        <label>Name:</label>
                        <input
                          type="text"
                          placeholder="Enter name..."
                          value={val?.identity?.name || ''}
                          onChange={(e) => {
                            const p = val || { identity: {} };
                            if (!p.identity) p.identity = {};
                            p.identity.name = e.target.value;
                            const newVal = updateNestedValue(currentObj, field.key, p);
                            setInputVal(JSON.stringify(newVal, null, 2));
                          }}
                          className="sub-input"
                        />
                      </div>

                      {/* Bio */}
                      <div className="sub-form-row">
                        <label>Bio:</label>
                        <input
                          type="text"
                          placeholder="Enter bio..."
                          value={val?.identity?.bio || ''}
                          onChange={(e) => {
                            const p = val || { identity: {} };
                            if (!p.identity) p.identity = {};
                            p.identity.bio = e.target.value;
                            const newVal = updateNestedValue(currentObj, field.key, p);
                            setInputVal(JSON.stringify(newVal, null, 2));
                          }}
                          className="sub-input"
                        />
                      </div>

                      {/* Location */}
                      <div className="sub-form-row">
                        <label>Location:</label>
                        <input
                          type="text"
                          placeholder="Enter location..."
                          value={val?.identity?.location || ''}
                          onChange={(e) => {
                            const p = val || { identity: {} };
                            if (!p.identity) p.identity = {};
                            p.identity.location = e.target.value;
                            const newVal = updateNestedValue(currentObj, field.key, p);
                            setInputVal(JSON.stringify(newVal, null, 2));
                          }}
                          className="sub-input"
                        />
                      </div>

                      {/* Companies */}
                      <div className="sub-form-row">
                        <label>Companies:</label>
                        <input
                          type="text"
                          placeholder="Enter companies..."
                          value={val?.identity?.companies?.join(', ') || ''}
                          onChange={(e) => {
                            const p = val || { identity: {} };
                            if (!p.identity) p.identity = {};
                            p.identity.companies = e.target.value.split(',').map((s: string) => s.trim()).filter((s: string) => s);
                            const newVal = updateNestedValue(currentObj, field.key, p);
                            setInputVal(JSON.stringify(newVal, null, 2));
                          }}
                          className="sub-input"
                        />
                      </div>

                      {/* Read-only Narrative/Attributes Preview if present */}
                      {(val?.narrative || val?.attributes) && renderComplexPreview(field.type, val)}
                    </div>
                  )}


                  {/* Array Multi-Select Helper */}
                  {field.type === 'profile_array' && (
                    <div className="array-controls">
                      {renderComplexPreview('profile_array', val)}
                      {!val || val.length === 0 ? <div className="placeholder-text" style={{ fontSize: '0.8rem', color: '#666' }}>Inject profiles from sidebar...</div> : null}
                      <button className="icon-btn text-btn" onClick={() => {
                        const newVal = updateNestedValue(currentObj, field.key, []);
                        setInputVal(JSON.stringify(newVal, null, 2));
                      }}>Clear All</button>
                    </div>
                  )}

                  {/* String Array Helper */}
                  {field.type === 'string_array' && (
                    <div className="array-controls" style={{ display: 'flex', flexDirection: 'column', marginTop: '0', gap: '8px' }}>
                      <div className="preview-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                        {(Array.isArray(val) ? val : []).map((s: string, i: number) => (
                          <div key={i} className="" style={{
                            display: 'flex',
                            alignItems: 'center',
                            padding: '6px 0',
                            gap: '12px',
                            borderBottom: '1px solid #1a1a1a'
                          }}>
                            {/* Cyan Index */}
                            <span style={{
                              color: '#00ffff',
                              fontFamily: 'monospace',
                              fontSize: '0.85rem',
                              minWidth: '20px',
                              textAlign: 'right'
                            }}>
                              {(i + 1).toString().padStart(2, '0')}
                            </span>

                            {/* Editable Input */}
                            <input
                              type="text"
                              spellCheck={false}
                              style={{
                                flex: 1,
                                background: 'transparent',
                                border: 'none',
                                color: '#e6e6e6',
                                outline: 'none',
                                fontSize: '0.9rem',
                                fontFamily: 'inherit'
                              }}
                              value={s}
                              onChange={(e) => {
                                const arr = [...(Array.isArray(val) ? val : [])];
                                arr[i] = e.target.value;
                                const newVal = updateNestedValue(currentObj, field.key, arr);
                                setInputVal(JSON.stringify(newVal, null, 2));
                              }}
                            />

                            {/* X Button (Right Aligned) */}
                            <button
                              className="icon-btn"
                              style={{
                                marginLeft: 'auto',
                                color: '#00ffff',
                                background: 'transparent',
                                border: 'none',
                                cursor: 'pointer',
                                padding: '4px',
                                fontSize: '1.2rem',
                                lineHeight: '1'
                              }}
                              onClick={() => {
                                const arr = Array.isArray(val) ? [...val] : [];
                                arr.splice(i, 1);
                                const newVal = updateNestedValue(currentObj, field.key, arr);
                                setInputVal(JSON.stringify(newVal, null, 2));
                              }}
                              title="Remove Item"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="add-row" style={{ display: 'flex', gap: '12px', alignItems: 'center', paddingLeft: '0' }}>
                        <span style={{
                          color: '#333',
                          fontFamily: 'monospace',
                          fontSize: '0.85rem',
                          minWidth: '20px',
                          textAlign: 'right'
                        }}>
                          +
                        </span>
                        <input
                          type="text"
                          className="sub-input"
                          placeholder="Add item (Type & Enter)..."
                          style={{
                            border: '1px dashed #333',
                            background: 'rgba(255,255,255,0.02)',
                            flex: 1
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const target = e.currentTarget;
                              if (!target.value) return;
                              const arr = Array.isArray(val) ? [...val] : [];
                              arr.push(target.value);
                              const newVal = updateNestedValue(currentObj, field.key, arr);
                              setInputVal(JSON.stringify(newVal, null, 2));
                              target.value = '';
                            }
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>



    );
  };

  const renderInputArea = () => {
    if (!selectedAgent) return null;

    // 1. Profile Generator - use component
    if (selectedAgent.id === 'profile-generator') {
      return <ProfileGeneratorInput inputVal={inputVal} setInputVal={setInputVal} inputMode={inputMode} />;
    }


    // 2. Opportunity Evaluator - use component for structured mode
    if (selectedAgent.id === 'opportunity-evaluator' && inputMode === 'structured') {
      return <OpportunityEvaluatorInput inputVal={inputVal} setInputVal={setInputVal} inputMode={inputMode} context={context} />;
    }

    // 3. HyDE Generator - STRUCT mode uses component, RAW mode falls through to default textarea
    if (selectedAgent.id === 'hyde-generator' && inputMode === 'structured') {
      return <HydeGeneratorInput inputVal={inputVal} setInputVal={setInputVal} inputMode={inputMode} />;
    }

    // 4. Intent Manager - use component for structured mode
    if (selectedAgent.id === 'intent-manager' && inputMode === 'structured') {
      return <IntentManagerInput inputVal={inputVal} setInputVal={setInputVal} inputMode={inputMode} />;
    }

    // 5. Explicit Intent Inferrer - use component for structured mode
    if (selectedAgent.id === 'explicit-intent-detector' && inputMode === 'structured') {
      return <ExplicitIntentInferrerInput inputVal={inputVal} setInputVal={setInputVal} inputMode={inputMode} />;
    }

    // 3. Parallel Fetcher - use component
    if (selectedAgent.id === 'parallel-fetcher') {
      return <ParallelFetcherInput inputVal={inputVal} setInputVal={setInputVal} inputMode={inputMode} />;
    }

    if (selectedAgent.inputType === 'parallel_params' && inputMode === 'structured') {
      return renderParallelInput();
    }

    if (inputMode === 'structured' && selectedAgent.fields) {
      return renderStructuredForm(selectedAgent.fields);
    }

    return (
      <textarea
        className="terminal-input"
        value={inputVal}
        onChange={(e) => setInputVal(e.target.value)}
      />
    );
  };

  const renderParallelInput = () => {
    const parsed = safeParse(inputVal);
    return (
      <div className="complex-form">
        {['name', 'email', 'linkedin', 'twitter', 'website', 'location', 'company', 'github'].map(field => (
          <div key={field} className="form-row">
            <label>{field}:</label>
            <input
              type="text"
              value={parsed[field] || ''}
              onChange={(e) => {
                const newObj = { ...parsed, [field]: e.target.value };
                setInputVal(JSON.stringify(newObj, null, 2));
              }}
              placeholder={`Enter ${field}...`}
            />
          </div>
        ))}
      </div>
    );
  };

  const safeParse = (str: string) => {
    try { return JSON.parse(str); } catch { return {}; }
  };

  const generateQueryFromParams = (params: any) => {
    const name = params.name || 'Unknown';
    let query = `Find information about the person named ${name}.`;
    if (params.email) query += `\nEmail: ${params.email}`;
    if (params.linkedin) query += `\nLinkedIn: ${params.linkedin}`;
    if (params.twitter) query += `\nTwitter: ${params.twitter}`;
    if (params.github) query += `\nGitHub: ${params.github}`;
    if (params.websites && Array.isArray(params.websites) && params.websites.length > 0) {
      query += `\nWebsites: ${params.websites.join(', ')}`;
    }
    return query;
  };


  return (
    <div className="terminal-layout">
      {/* HEADER */}
      <header className="terminal-header">
        <div className="brand">
          <Terminal size={20} />
          <span>AGENT_PROTOCOL // OPEN_PLAYGROUND</span>
        </div>
        <div className="status">
          <div className={`ind ${isRunning ? 'busy' : 'idle'}`} />
          {isRunning ? 'EXECUTING' : 'IDLE'}
        </div>
      </header>

      <div className="terminal-body">
        {/* LEFT SIDEBAR: AGENTS & CONTEXT */}
        <div className="panel sidebar">
          <div className="panel-section agents-section">
            <div className="panel-title">AVAILABLE_AGENTS</div>
            <div className="list-content">
              {categorizedAgents.map(group => (
                <div key={group.id} className="agent-group">
                  <div className="group-header">-- {group.name.toUpperCase()} --</div>
                  {group.agents.map(a => (
                    <div
                      key={a.id}
                      className={`terminal-item agent-item ${selectedAgentId === a.id ? 'active' : ''}`}
                      onClick={() => !a.disabled && handleAgentSelect(a.id)}
                      style={a.disabled ? { opacity: 0.5, cursor: 'not-allowed', pointerEvents: 'none' } : {}}
                      title={a.disabled ? 'This agent is currently disabled' : ''}
                    >
                      <Cpu size={14} className="icon" />
                      <div className="info">
                        <span className="name">{a.name}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="panel-section context-section">
            <div className="panel-title">CONTEXT_MEMORY</div>
            <div className="list-content context-list">
              {renderContextList()}
            </div>
          </div>
        </div>

        {/* WORKSPACE RIGHT */}
        <div className="workspace">
          {/* TOP: INPUT | OUTPUT */}
          <div className="workspace-top">
            <div className="panel input-panel">
              {/* INPUT HEADER */}
              <div className="panel-header">
                <div className="title-group">
                  <span className="panel-label">INPUT_BUFFER</span>
                  {selectedAgent && (
                    <span className="badge">
                      {selectedAgent.id === 'parallel-fetcher' ? 'ParallelSearchRequest' :
                        selectedAgent.id === 'profile-generator' ? 'String' :
                          selectedAgent.id === 'hyde-generator' ? 'UserMemoryProfile' :
                            selectedAgent.inputType}
                    </span>
                  )}
                </div>
                {/* MODE TOGGLE */}
                {selectedAgent && (
                  <div className="mode-toggle">
                    {selectedAgent.id === 'parallel-fetcher' ? (
                      <>
                        <button
                          className={`mode-btn ${inputMode === 'raw' ? 'active' : ''}`}
                          onClick={() => {
                            // Convert current Struct to String
                            const currentObj = safeParse(inputVal);
                            const query = generateQueryFromParams(currentObj);
                            setInputVal(query);
                            setInputMode('raw');
                          }}
                        >
                          OBJECTIVE
                        </button>
                        <button
                          className={`mode-btn ${inputMode === 'structured' ? 'active' : ''}`}
                          onClick={() => {
                            // Revert to Default Struct (Can't easily parse string back to struct)
                            const def = selectedAgent.defaultInput;
                            setInputVal(JSON.stringify(def, null, 2));
                            setInputMode('structured');
                          }}
                        >
                          STRUCT
                        </button>
                      </>
                    ) : selectedAgent.id === 'profile-generator' ? (
                      <>
                        <button
                          className={`mode-btn ${inputMode === 'structured' ? 'active' : ''}`}
                          onClick={() => {
                            setInputMode('structured');
                          }}
                        >
                          FROM_PARALLEL
                        </button>
                        <button
                          className={`mode-btn ${inputMode === 'raw' ? 'active' : ''}`}
                          onClick={() => {
                            // Switch to raw mode with default text
                            if (inputMode !== 'raw') {
                              setInputVal(selectedAgent.defaultInput || '');
                            }
                            setInputMode('raw');
                          }}
                        >
                          RAW
                        </button>
                      </>
                    ) : selectedAgent.id === 'hyde-generator' ? (
                      <>
                        <button
                          className={`mode-btn ${inputMode === 'structured' ? 'active' : ''}`}
                          onClick={() => {
                            setInputMode('structured');
                          }}
                        >
                          STRUCT
                        </button>
                        <button
                          className={`mode-btn ${inputMode === 'raw' ? 'active' : ''}`}
                          onClick={() => {
                            setInputMode('raw');
                          }}
                        >
                          RAW
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className={`mode-btn ${inputMode === 'structured' ? 'active' : ''}`}
                          onClick={() => setInputMode('structured')}
                          disabled={!selectedAgent.fields && selectedAgent.inputType !== 'parallel_params'}
                          title={!selectedAgent.fields ? "No schema available" : "Structured View"}
                        >
                          <LayoutTemplate size={14} /> STRUCT
                        </button>
                        <button
                          className={`mode-btn ${inputMode === 'raw' ? 'active' : ''}`}
                          onClick={() => setInputMode('raw')}
                        >
                          <Code size={14} /> RAW
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="input-content">
                {renderInputArea()}
              </div>

              {selectedAgent && (
                <div className="actions-bar">
                  <button
                    className={`term-btn ${isRunning ? 'loading' : ''}`}
                    onClick={handleRun}
                    disabled={isRunning}
                    style={{
                      background: 'transparent',
                      color: '#00ffff',
                      border: '1px solid #00ffff',
                      padding: '8px 16px',
                      cursor: isRunning ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontFamily: 'inherit',
                      fontSize: '0.85rem'
                    }}
                  >
                    {isRunning ? <Loader size={16} className="spin" /> : <Play size={16} />}
                    {isRunning ? 'EXECUTING...' : 'EXECUTE'}
                  </button>
                </div>
              )}
            </div>

            <div className="panel output-panel">
              <div className="panel-header">
                <div className="title-group">
                  <span className="panel-label">OUTPUT_STREAM</span>
                  {selectedAgent?.id === 'parallel-fetcher' && (
                    <>
                      <span className="badge">ParallelSearchResponse</span>
                      <span className="desc-tooltip" title={JSON.stringify({
                        search_id: "uuid",
                        results: [{ title: "Page Title", url: "https://example.com", excerpts: ["content snippet..."] }]
                      }, null, 2)}>
                        ?
                      </span>
                    </>
                  )}
                  {selectedAgent?.id === 'profile-generator' && (
                    <span className="badge">UserMemoryProfile</span>
                  )}
                  {selectedAgent?.id === 'hyde-generator' && (
                    <span className="badge">String</span>
                  )}
                </div>
                <button
                  className="icon-btn"
                  onClick={handleSaveOutput}
                  title="Save to Memory"
                  style={{
                    background: 'transparent',
                    color: '#00ffff',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '4px'
                  }}
                >
                  <Save size={16} />
                </button>
              </div>
              <textarea readOnly value={outputVal} className="terminal-output" />
            </div>
          </div>

          {/* BOTTOM: CONSOLE */}
          <div className="panel console-panel">
            <div className="panel-title">SYSTEM_CONSOLE</div>
            <div className="logs-content">
              {logs.map((L, i) => <div key={i} className="log-line">{L}</div>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
