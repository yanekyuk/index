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
import { Terminal, Cpu, Database, Play, Save, Loader } from 'lucide-react';


import { OpportunityEvaluatorInput } from './components/OpportunityEvaluatorInput';
import { IntentManagerInput } from './components/IntentManagerInput';
import { ExplicitIntentInferrerInput } from './components/ExplicitIntentInferrerInput';
import { ImplicitIntentInferrerInput } from './components/ImplicitIntentInferrerInput';
import { IntroGeneratorInput } from './components/IntroGeneratorInput';
import { SynthesisGeneratorInput } from './components/SynthesisGeneratorInput';
import { StakeEvaluatorInput } from './components/StakeEvaluatorInput';
import { ParallelFetcherInput } from './components/ParallelFetcherInput';
import { ProfileGeneratorInput } from './components/ProfileGeneratorInput';
import { HydeGeneratorInput } from './components/HydeGeneratorInput';
import { GeneralInput } from './components/GeneralInput';
import { SyntacticValidatorInput } from './components/SyntacticValidatorInput';
import { SemanticVerifierInput } from './components/SemanticVerifierInput';
import { PragmaticMonitorInput } from './components/PragmaticMonitorInput';

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



  // Track source context ID for intent-manager profile updates
  const [sourceProfileCtxId, setSourceProfileCtxId] = useState<string | null>(null); // Track which ctx item populated the profile

  // Flip-flop toggle for intro-generator: true = fill sender next, false = fill recipient next
  const [introFillSender, setIntroFillSender] = useState<boolean>(true);

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
  const categoryOrder = ['external', 'profile', 'opportunity', 'intent', 'intent_stakes', 'felicity'];
  const categorizedAgents = categoryOrder.map(cat => ({
    id: cat,
    name: cat === 'external' ? 'External Tools'
      : cat === 'intent_stakes' ? 'Intent Stake (WIP)'
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
    const specializedStructuredAgents = [
      'opportunity-evaluator',
      'intent-manager',
      'explicit-intent-detector',
      'implicit-inferrer',
      'intro-generator',
      'synthesis-generator',
      'stake-evaluator',
      'parallel-fetcher',
      'profile-generator',
      'parallel-fetcher',
      'profile-generator',
      'hyde-generator',
      'syntactic-validator',
      'semantic-verifier',
      'pragmatic-monitor'
    ];

    const hasSchema = (agent?.fields && agent.fields.length > 0) || specializedStructuredAgents.includes(id);
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
          if (selectedAgent?.inputType !== 'raw_text' && selectedAgent?.inputType !== 'any') {
            addLog(`Error: Invalid input: ${(lenientErr as any).message}`);
            setIsRunning(false);
            return;
          }
          // For raw_text, keep as string (payload is already inputVal)
        }
      }


      // Special Case: Opportunity Evaluator - Inject Candidates from Context
      if (selectedAgentId === 'opportunity-evaluator') {
        const potentialCandidates = context
          .filter(c => c.userProfile)
          .map(c => {
            const profile = { ...c.userProfile, userId: c.id };
            if (c.userProfileEmbedding) profile.embedding = c.userProfileEmbedding;
            return profile;
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

      let targetUserId = sourceProfileCtxId;

      // Logic to determine if we should create a new user or update existing
      // If we don't have a source (e.g. from Parallel Fetcher results?), we might prompt.
      // But usually we start from a user.

      const updateUser = (userId: string, updates: any) => {
        setContext(prev => prev.map(user => {
          if (user.id !== userId) return user;
          return { ...user, ...updates, timestamp: Date.now() };
        }));
      };

      if (!targetUserId) {
        // No source tracked. Prompt to create user (e.g. from Profile Generator output)
        if (selectedAgent?.id === 'profile-generator' || selectedAgent?.id === 'parallel-fetcher') {
          const defaultName = data.identity?.name || 'New User';
          const newName = prompt("Create new User Context with name:", defaultName);
          if (!newName) return;

          const newUser: ContextItem = {
            id: 'user_' + Date.now(),
            name: newName,
            activeIntents: [],
            timestamp: Date.now()
          };

          // If Profile Generator, populate profile
          if (selectedAgent.id === 'profile-generator') {
            newUser.userProfile = data.profile || data;
            if (data.embedding) newUser.userProfileEmbedding = data.embedding;
          }

          setContext(prev => [...prev, newUser]);
          setSourceProfileCtxId(newUser.id);
          addLog(`Created User Context: ${newName}`);
          return;
        }

        addLog('Error: No User Context tracked. To save, start by injecting a User or use Profile Generator.');
        return;
      }

      // Update Existing User
      if (selectedAgent?.id === 'parallel-fetcher') {
        updateUser(targetUserId, {
          parallelSearchResult: data
        });
        addLog(`Updated User Parallel Result`);
        return;
      }

      if (selectedAgent?.id === 'profile-generator') {
        updateUser(targetUserId, {
          userProfile: data.profile || data,
          userProfileEmbedding: data.embedding
        });
        addLog(`Updated User Profile`);
        return;
      }

      if (selectedAgent?.id === 'hyde-generator') {
        const description = data.description || (typeof data === 'string' ? data : JSON.stringify(data));
        updateUser(targetUserId, {
          hydeDescription: description,
          hydeDescriptionEmbedding: data.embedding
        });
        addLog(`Updated HyDE Description`);
        return;
      }

      if (selectedAgent?.id === 'intent-manager') {
        // Reconcile intents
        const actions = data?.actions || [];
        const user = context.find(c => c.id === targetUserId);
        if (user) {
          let activeIntents = [...(user.activeIntents || [])];

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

          updateUser(targetUserId, { activeIntents });
          addLog(`Updated Intents: +${created} ~${updated} -${expired}`);
        }
        return;
      }

      if (selectedAgent?.id === 'opportunity-evaluator') {
        const matches = data.matches || data.opportunities || data;
        const newOpportunities = Array.isArray(matches) ? matches : [matches];

        const existing = context.find(c => c.id === targetUserId)?.opportunities || [];
        updateUser(targetUserId, {
          opportunities: [...existing, ...newOpportunities]
        });
        addLog(`Saved ${newOpportunities.length} opportunities.`);
        return;
      }

      addLog('Output saved (No persistent update strategy for this agent).');

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

  /* Handlers */

  const injectContext = (ctxId: string, targetKey?: string) => {
    const user = context.find(c => c.id === ctxId);
    if (!user) return;

    // Track Source
    setSourceProfileCtxId(user.id);

    {/* Intent -> Context Logic */ }
    if (selectedAgent?.id === 'semantic-verifier') {
      const currentObj = JSON.parse(inputVal || '{}');
      const updates: any = {};

      if (user.userProfile) {
        updates.context = user.userProfile;
        addLog(`Injected Context for ${user.name}`);
      } else {
        addLog(`User ${user.name} has no Profile.`);
      }

      if (Object.keys(updates).length > 0) {
        const newObj = { ...currentObj, ...updates };
        setInputVal(JSON.stringify(newObj, null, 2));
      }
      return;
    }

    // 1. Parallel Fetcher: Injects Parallel Params
    if (selectedAgent?.id === 'parallel-fetcher') {
      if (user.parallelSearchParams) {
        setInputVal(JSON.stringify(user.parallelSearchParams, null, 2));
        addLog(`Injected Parallel Params for ${user.name}`);
      } else {
        addLog(`Error: No Parallel Params found for ${user.name}`);
      }
      return;
    }

    // 2. Profile Generator: Injects Parallel Result (Preferred) or Params (Synthetic)
    if (selectedAgent?.id === 'profile-generator') {
      if (user.parallelSearchResult) {
        setInputVal(JSON.stringify(user.parallelSearchResult, null, 2));
        addLog(`Injected Parallel Result for ${user.name}`);
        return;
      }

      if (user.parallelSearchParams) {
        // Mimic Parallel Fetcher Response structure to leverage json2md logic in runner
        const syntheticResponse = {
          search_id: 'context_synth_' + user.id,
          results: [
            {
              title: "Context Memory Data",
              url: "memory://user-context",
              content: JSON.stringify(user.parallelSearchParams, null, 2)
            }
          ]
        };
        setInputVal(JSON.stringify(syntheticResponse, null, 2));
        addLog(`Injected Parallel Params as Synthetic Response for ${user.name}`);
      } else {
        setInputVal(user.name); // Fallback to name
        addLog(`Injected Name for ${user.name}`);
      }
      return;
    }

    // 3. HyDE Generator: Injects Profile
    if (selectedAgent?.id === 'hyde-generator') {
      if (user.userProfile) {
        setInputVal(JSON.stringify(user.userProfile, null, 2));
        addLog(`Injected Profile for ${user.name}`);
      } else {
        addLog(`Error: No User Profile found for ${user.name}`);
      }
      return;
    }

    // 4. Opportunity Evaluator: Injects Source Profile + HyDE
    if (selectedAgent?.id === 'opportunity-evaluator') {
      const currentObj = JSON.parse(inputVal || '{}');

      // Injecting as Candidate (via Drag or TargetKey)
      if (targetKey === 'candidates') {
        if (user.userProfile) {
          // Inject userId for backend filtering
          const profileWithEmbed = { ...user.userProfile, userId: user.id };
          if (user.userProfileEmbedding) {
            profileWithEmbed.embedding = user.userProfileEmbedding;
          }
          const newCandidates = [...(currentObj.candidates || []), profileWithEmbed];
          const newObj = { ...currentObj, candidates: newCandidates };
          setInputVal(JSON.stringify(newObj, null, 2));
          addLog(`Added candidate: ${user.name}`);
        } else {
          addLog(`Error: User ${user.name} has no profile.`);
        }
        return;
      }

      // Injecting as Source (Default click behavior)
      const updates: any = {};

      if (user.userProfile) {
        // Do NOT inject embedding for Source Profile (clutters UI, not used for search)
        // Inject userId to ensure filtering works backend side
        updates.sourceProfile = { ...user.userProfile, userId: user.id };
      }

      if (user.hydeDescription) {
        updates.options = { ...currentObj.options || {}, hydeDescription: user.hydeDescription };
      }

      // Inject Existing Opportunities from Context
      if (user.opportunities && user.opportunities.length > 0) {
        const existingOps = user.opportunities
          .map((op: any) => `- Match with ${op.title?.replace('Match with ', '')} (ID: ${op.candidateId || 'Unknown'}) (Score: ${op.score}): ${op.description || 'No description'}`)
          .join('\n');

        updates.options = {
          ...(updates.options || currentObj.options || {}),
          existingOpportunities: existingOps
        };
        addLog(`Injected ${user.opportunities.length} existing opportunities.`);
      }

      if (Object.keys(updates).length > 0) {
        const newObj = { ...currentObj, ...updates };
        setInputVal(JSON.stringify(newObj, null, 2));
        addLog(`Injected Source Profile & Context for ${user.name}`);
      } else {
        addLog(`User ${user.name} has no Profile or HyDE description.`);
      }
      return;
    }

    // 5. Intent Manager: Injects Profile + Active Intents
    if (selectedAgent?.id === 'intent-manager') {
      const currentObj = JSON.parse(inputVal || '{}');
      const updates: any = {};

      if (user.userProfile) updates.profile = user.userProfile;
      if (user.activeIntents) updates.activeIntents = user.activeIntents;

      if (Object.keys(updates).length > 0) {
        const newObj = { ...currentObj, ...updates };
        setInputVal(JSON.stringify(newObj, null, 2));
        addLog(`Injected Profile & Intents for ${user.name}`);
      }
      return;
    }

    // 6. Explicit Intent Inferrer: Injects Profile
    if (selectedAgent?.id === 'explicit-intent-detector') {
      const currentObj = JSON.parse(inputVal || '{}');
      if (user.userProfile) {
        const newObj = { ...currentObj, profile: user.userProfile };
        setInputVal(JSON.stringify(newObj, null, 2));
        addLog(`Injected Profile for ${user.name}`);
      }
      return;
    }

    // 7. Implicit Intent Inferrer: Injects Profile + Opportunity Context
    if (selectedAgent?.id === 'implicit-inferrer') {
      const currentObj = JSON.parse(inputVal || '{}');
      const updates: any = {};

      if (user.userProfile) {
        updates.profile = user.userProfile;
      }

      // If the user has opportunities, let's try to inject the first one or prompt
      // The user likely wants to infer intent for ONE opportunity.
      // If we blindly inject all, it might be messy.
      // Let's inject the *last* opportunity found, as it's likely the most relevant "new" thing.
      if (user.opportunities && user.opportunities.length > 0) {
        const op = user.opportunities[user.opportunities.length - 1];
        // Format as string context
        const opContext = `Title: ${op.title}\nDescription: ${op.description}\nWhy Matched: ${op.reason || op.score}`;
        updates.opportunityContext = opContext;
      }

      if (Object.keys(updates).length > 0) {
        const newObj = { ...currentObj, ...updates };
        setInputVal(JSON.stringify(newObj, null, 2));
        addLog(`Injected Profile${updates.opportunityContext ? ' & Opportunity' : ''} for ${user.name}`);
      } else {
        addLog(`User ${user.name} has no Profile or Opportunities.`);
      }
      return;
    }

    // 8. Intro Generator: Injects Sender -> Recipient
    // Uses { name, reasonings[] } format expected by IntroGenerator agent
    if (selectedAgent?.id === 'intro-generator') {
      const currentObj = JSON.parse(inputVal || '{}');

      // Extract name from userProfile or fallback to context name
      const userName = user.userProfile?.identity?.name || user.name;

      // Flip-flop: alternate between sender and recipient on each click
      let updates: any = {};
      if (introFillSender) {
        updates.sender = { name: userName, reasonings: [] };
        addLog(`Injected Sender: ${userName}`);
      } else {
        updates.recipient = { name: userName, reasonings: [] };
        addLog(`Injected Recipient: ${userName}`);
      }

      // Toggle for next click
      setIntroFillSender(!introFillSender);

      const newObj = { ...currentObj, ...updates };
      setInputVal(JSON.stringify(newObj, null, 2));
      return;
    }

    // 9. Synthesis Generator: Injects Source -> Target
    if (selectedAgent?.id === 'synthesis-generator') {
      const currentObj = JSON.parse(inputVal || '{}');
      const updates: any = {};

      if (!currentObj.source || Object.keys(currentObj.source).length === 0) {
        updates.source = user.userProfile || { identity: { name: user.name } };
        addLog(`Injected Source: ${user.name}`);
      } else {
        updates.target = user.userProfile || { identity: { name: user.name } };
        addLog(`Injected Target: ${user.name}`);
      }

      if (Object.keys(updates).length > 0) {
        const newObj = { ...currentObj, ...updates };
        setInputVal(JSON.stringify(newObj, null, 2));
      }
      return;
    }

    // 10. Stake Evaluator: Injects Candidates
    if (selectedAgent?.id === 'stake-evaluator') {
      const currentObj = JSON.parse(inputVal || '{}');
      const updates: any = {};

      // Always inject as Candidate (unless we want to support Primary Intent injection, but that's ambiguous)
      // Wraps user in { user: ... } or { intent: ... } depending on what we have.
      // The agent input schema roughly expects candidates: { intent: { description: ... } }[] ?
      // Registry says: candidates: [ { intent: { description: ... } } ]

      // Let's check if user has active intents
      let newCandidate: any = null;

      if (user.activeIntents && user.activeIntents.length > 0) {
        // Use the first active intent? Or all?
        // Let's use the most recent active intent.
        const intent = user.activeIntents[user.activeIntents.length - 1]; // or [0]
        newCandidate = {
          user: { name: user.name }, // Metadata for UI
          intent: { description: intent.description }
        };
      } else if (user.userProfile) {
        // No intents, maybe use profile bio as loose intent?
        newCandidate = {
          user: { name: user.name },
          intent: { description: user.userProfile.identity?.bio || "No description" }
        };
      } else {
        newCandidate = {
          user: { name: user.name },
          intent: { description: "User has no profile or intents." }
        };
      }

      if (newCandidate) {
        updates.candidates = [...(currentObj.candidates || []), newCandidate];
        const newObj = { ...currentObj, ...updates };
        setInputVal(JSON.stringify(newObj, null, 2));
        addLog(`Added Candidate Stake: ${user.name}`);
      }
      return;
    }

    // Fallback for generic inputs
    if (selectedAgent?.inputType === 'any' || selectedAgent?.inputType === 'raw_text') {
      if (user.userProfile) {
        setInputVal(JSON.stringify(user.userProfile, null, 2));
      } else {
        setInputVal(JSON.stringify(user, null, 2));
      }
      return;
    }

    addLog(`No compatible injection strategy for ${selectedAgent?.id}`);
  };

  // --- Renderers ---

  const renderContextList = () => {
    // Show all users.
    // Maybe optionally filter if agent requires specific fields?
    // "filteredContext.length === 0" logic was nice.
    // For now, let's keep it simple: Show all.

    if (context.length === 0) {
      return <div className="empty-list">No users in memory.</div>
    }

    return (
      <>
        {context.map(c => (
          <div
            key={c.id}
            className="terminal-item context-item"
            draggable
            onClick={() => injectContext(c.id)}
            style={{ cursor: 'pointer', height: 'auto', flexDirection: 'column', alignItems: 'flex-start', padding: '8px' }}
            onDragStart={(e) => e.dataTransfer.setData('text/plain', c.id)}
          >
            <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: '8px' }}>
              <Database size={14} className="icon" />
              <span className="name" style={{ flex: 1, fontWeight: 'bold' }}>{c.name}</span>
              <button
                className="icon-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setContext(prev => prev.filter(item => item.id !== c.id));
                }}
                title="Remove User"
                style={{ color: '#00ffff', border: 'none', background: 'transparent', cursor: 'pointer' }}
              >
                ×
              </button>
            </div>

            {/* Field Indicators */}
            <div className="badges" style={{ display: 'flex', gap: '4px', marginTop: '4px', flexWrap: 'wrap' }}>
              {c.parallelSearchParams && <span style={{ fontSize: '0.7rem', background: '#333', padding: '2px 4px', borderRadius: '3px', color: '#888' }}>PARAMS</span>}
              {c.parallelSearchResult && <span style={{ fontSize: '0.7rem', background: '#444', padding: '2px 4px', borderRadius: '3px', border: '1px solid #666', color: '#ccc' }}>RESULT</span>}
              {c.userProfile && <span style={{ fontSize: '0.7rem', background: 'rgba(0, 255, 255, 0.2)', padding: '2px 4px', borderRadius: '3px', color: '#00ffff' }}>PROFILE</span>}
              {c.hydeDescription && <span style={{ fontSize: '0.7rem', background: 'rgba(255, 100, 255, 0.2)', padding: '2px 4px', borderRadius: '3px', color: '#ff66ff' }}>HyDE</span>}
              {c.activeIntents && c.activeIntents.length > 0 && <span style={{ fontSize: '0.7rem', background: 'rgba(255, 255, 0, 0.2)', padding: '2px 4px', borderRadius: '3px', color: '#ffff00' }}>INTENTS ({c.activeIntents.length})</span>}
              {c.opportunities && c.opportunities.length > 0 && <span style={{ fontSize: '0.7rem', background: 'rgba(50, 255, 50, 0.2)', padding: '2px 4px', borderRadius: '3px', color: '#33ff33' }}>OPPORTUNITIES ({c.opportunities.length})</span>}
            </div>
          </div>
        ))}

        {context.length > 0 && (
          <button
            className="text-btn"
            onClick={() => {
              setContext([]);
              localStorage.removeItem('playground_context');
              addLog('Memory cleared.');
            }}
            style={{ marginTop: '8px', width: '100%', textAlign: 'center', color: '#fa7a61' }}
          >
            Clear All Users
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

  const safeParse = (str: string) => {
    try { return JSON.parse(str); } catch { return {}; }
  };

  const renderStructuredContent = () => {
    return (
      <>
        {/* Specialized UI Mappings */}
        {
          selectedAgentId === 'opportunity-evaluator' && (
            <OpportunityEvaluatorInput
              inputVal={inputVal}
              setInputVal={setInputVal}
              inputMode={inputMode}
              context={context}
              onLog={addLog}
            />
          )
        }

        {
          selectedAgentId === 'intent-manager' && (
            <IntentManagerInput
              inputVal={inputVal}
              setInputVal={setInputVal}
              inputMode={inputMode}
            />
          )
        }

        {
          selectedAgentId === 'explicit-intent-detector' && (
            <ExplicitIntentInferrerInput
              inputVal={inputVal}
              setInputVal={setInputVal}
              inputMode={inputMode}
            />
          )
        }

        {
          selectedAgentId === 'implicit-inferrer' && (
            <ImplicitIntentInferrerInput
              inputVal={inputVal}
              setInputVal={setInputVal}
              inputMode={inputMode}
              context={context}
            />
          )
        }

        {
          selectedAgentId === 'intro-generator' && (
            <IntroGeneratorInput
              inputVal={inputVal}
              setInputVal={setInputVal}
              inputMode={inputMode}
            />
          )
        }

        {
          selectedAgentId === 'synthesis-generator' && (
            <SynthesisGeneratorInput
              inputVal={inputVal}
              setInputVal={setInputVal}
              inputMode={inputMode}
            />
          )
        }

        {
          selectedAgentId === 'stake-evaluator' && (
            <StakeEvaluatorInput
              inputVal={inputVal}
              setInputVal={setInputVal}
              inputMode={inputMode}
            />
          )
        }

        {
          selectedAgentId === 'parallel-fetcher' && (
            <ParallelFetcherInput
              inputVal={inputVal}
              setInputVal={setInputVal}
              inputMode={inputMode}
            />
          )
        }

        {
          selectedAgentId === 'profile-generator' && (
            <ProfileGeneratorInput
              inputVal={inputVal}
              setInputVal={setInputVal}
              inputMode={inputMode}
            />
          )
        }

        {
          selectedAgentId === 'hyde-generator' && (
            <HydeGeneratorInput
              inputVal={inputVal}
              setInputVal={setInputVal}
              inputMode={inputMode}
            />
          )
        }
        {
          selectedAgentId === 'hyde-generator' && (
            <HydeGeneratorInput
              inputVal={inputVal}
              setInputVal={setInputVal}
              inputMode={inputMode}
            />
          )
        }

        {
          selectedAgentId === 'syntactic-validator' && (
            <SyntacticValidatorInput
              inputVal={inputVal}
              setInputVal={setInputVal}
              inputMode={inputMode}
            />
          )
        }

        {
          selectedAgentId === 'semantic-verifier' && (
            <SemanticVerifierInput
              inputVal={inputVal}
              setInputVal={setInputVal}
              inputMode={inputMode}
            />
          )
        }

        {
          selectedAgentId === 'pragmatic-monitor' && (
            <PragmaticMonitorInput
              inputVal={inputVal}
              setInputVal={setInputVal}
              inputMode={inputMode}
            />
          )
        }

        {/* Fallback to Generic Structured or Raw */}
        {
          !['opportunity-evaluator', 'intent-manager', 'explicit-intent-detector', 'implicit-inferrer', 'intro-generator', 'synthesis-generator', 'stake-evaluator', 'parallel-fetcher', 'profile-generator', 'hyde-generator', 'syntactic-validator', 'semantic-verifier', 'pragmatic-monitor'].includes(selectedAgentId || '') && (
            inputMode === 'structured' && selectedAgent?.fields
              ? renderStructuredForm(selectedAgent.fields)
              : <textarea
                className="terminal-input"
                style={{ width: '100%', height: '100%', resize: 'none' }}
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                placeholder="// Raw JSON Input..."
              />
          )}
      </>
    );
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
            <GeneralInput
              value={inputVal}
              onChange={setInputVal}
              label="INPUT_BUFFER"
              badge={selectedAgent?.inputType}
              operations={[]}
              footerActions={
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
              }
            >
              {renderStructuredContent()}
            </GeneralInput>

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
};

export default App;
