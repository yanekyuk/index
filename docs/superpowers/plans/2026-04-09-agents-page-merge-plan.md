# Agents Page Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the Agent, Agents, and Settings sidebar entries into a single Agents entry with a new agent detail page at `/agents/:id` that consolidates agent info, API keys, negotiation insights, and MCP setup instructions.

**Architecture:** Remove the three separate sidebar entries (Agent, Agents, Settings) and replace with a single "Agents" entry. Create a new `/agents/:id` route with tabs (Overview, API Keys, Permissions). The Chat Orchestrator's Overview tab includes negotiation insights from the old `/agent` page. API Keys tab includes setup instructions from the old `/settings` page. Old routes redirect to `/agents`.

**Tech Stack:** React 19, React Router v7, Radix UI Tabs, TypeScript, existing service layer (`useAgents`, `useUsers`, `useApiKeys`)

---

### Task 1: Create Agent Detail Page

**Files:**
- Create: `frontend/src/app/agents/[id]/page.tsx`

- [ ] **Step 1: Create the agent detail page file**

Create `frontend/src/app/agents/[id]/page.tsx` with the following content. This page loads an agent by ID and renders three tabs: Overview, API Keys, Permissions. For the Chat Orchestrator system agent, the Overview tab shows negotiation insights. For all agents, API Keys shows key management + setup instructions, and Permissions shows deduplicated action badges.

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import * as Tabs from '@radix-ui/react-tabs';
import { ArrowLeft, Bot, Check, Copy, KeyRound, Loader2, Shield, Trash2 } from 'lucide-react';

import ClientLayout from '@/components/ClientLayout';
import { ContentContainer } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAgents } from '@/contexts/APIContext';
import { useApiKeys } from '@/contexts/APIContext';
import { useAuthContext } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useUsers } from '@/contexts/APIContext';
import UserAvatar from '@/components/UserAvatar';
import NegotiationHistory from '@/components/NegotiationHistory';
import type { Agent } from '@/services/agents';
import type { NegotiationInsights } from '@/services/users';

const SYSTEM_AGENT_IDS = {
  chatOrchestrator: '00000000-0000-0000-0000-000000000001',
} as const;

type TabValue = 'overview' | 'api-keys' | 'permissions';

function permissionLabel(action: string): string {
  switch (action) {
    case 'manage:profile': return 'Profile';
    case 'manage:intents': return 'Intents';
    case 'manage:networks': return 'Networks';
    case 'manage:contacts': return 'Contacts';
    case 'manage:negotiations': return 'Negotiations';
    default: return action;
  }
}

function maskKey(start: string): string {
  return start ? `${start}${'*'.repeat(24)}` : 'Unavailable';
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function SetupInstructions({ apiKey }: { apiKey?: string }) {
  const [expanded, setExpanded] = useState(false);
  const placeholder = apiKey || 'YOUR_API_KEY';
  const mcpUrl = `${window.location.origin}/api/mcp`;

  const claudeConfig = JSON.stringify({
    mcpServers: {
      'index-network': {
        type: 'http',
        url: mcpUrl,
        headers: { 'x-api-key': placeholder },
      },
    },
  }, null, 2);

  const hermesConfig = `mcp_servers:
  - name: index-network
    url: ${mcpUrl}
    headers:
      x-api-key: ${placeholder}`;

  return (
    <div className="border border-gray-200 rounded-sm mt-4">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
      >
        {expanded ? '▼' : '▶'} Setup Instructions
      </button>
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-100">
          <div className="pt-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Claude Code / OpenCode</p>
            <pre className="bg-gray-50 border border-gray-200 rounded-sm p-3 text-xs text-gray-700 overflow-x-auto font-mono">{claudeConfig}</pre>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Hermes Agent</p>
            <pre className="bg-gray-50 border border-gray-200 rounded-sm p-3 text-xs text-gray-700 overflow-x-auto font-mono">{hermesConfig}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, icon, sublabel }: { label: string; value: string | number; icon: React.ReactNode; sublabel?: string }) {
  return (
    <div className="p-4 rounded-md border border-gray-100 bg-white">
      <div className="flex items-center gap-2 mb-2">{icon}<span className="text-xs text-gray-500 uppercase tracking-wide">{label}</span></div>
      <div className="text-2xl font-bold text-gray-900 font-ibm-plex-mono">{value}</div>
      {sublabel && <div className="text-xs text-gray-400 mt-1">{sublabel}</div>}
    </div>
  );
}

const ROLE_LABELS: Record<string, string> = { Helper: 'Helper', Seeker: 'Seeker', Peer: 'Peer' };

function OverviewTab({ agent, userId }: { agent: Agent; userId: string }) {
  const isChatOrchestrator = agent.id === SYSTEM_AGENT_IDS.chatOrchestrator;
  const usersService = useUsers();
  const [insights, setInsights] = useState<NegotiationInsights | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isChatOrchestrator) return;
    let cancelled = false;
    setLoading(true);
    usersService
      .getNegotiationInsights(userId)
      .then((result) => { if (!cancelled) setInsights(result); })
      .catch(() => { if (!cancelled) setInsights(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isChatOrchestrator, userId, usersService]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">{agent.name}</h3>
        {agent.description && <p className="text-sm text-gray-500">{agent.description}</p>}
        <div className="flex items-center gap-2 mt-2">
          <span className={`text-xs px-2 py-0.5 rounded-full ${agent.type === 'system' ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700'}`}>{agent.type}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${agent.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{agent.status}</span>
        </div>
      </div>

      {isChatOrchestrator && (
        <>
          {loading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
          ) : insights ? (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard label="Total" value={insights.stats.totalCount} icon={<handshake className="w-4 h-4 text-gray-400" />} sublabel={`${insights.stats.opportunityCount} opportunities`} />
                <StatCard label="Opportunity rate" value={`${Math.round((insights.stats.opportunityCount / (insights.stats.opportunityCount + insights.stats.noOpportunityCount || 1)) * 100)}%`} icon={<trendingup className="w-4 h-4 text-gray-400" />} sublabel={`${insights.stats.noOpportunityCount} no opportunity`} />
                <StatCard label="Avg score" value={insights.stats.avgScore ?? '—'} icon={<sparkles className="w-4 h-4 text-gray-400" />} sublabel="Successful negotiations" />
                <StatCard label="In progress" value={insights.stats.inProgressCount} icon={<clock className="w-4 h-4 text-gray-400" />} sublabel="Active right now" />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="p-4 rounded-md border border-gray-100 bg-white">
                  <h3 className="text-xs text-gray-500 uppercase tracking-wide mb-3">Your roles</h3>
                  {Object.entries(insights.stats.roleDistribution).length === 0 ? (
                    <p className="text-sm text-gray-400">No role data yet</p>
                  ) : (
                    <div className="space-y-2">
                      {Object.entries(insights.stats.roleDistribution).sort((a, b) => b[1] - a[1]).map(([role, count]) => {
                        const pct = Math.round((count / (insights.stats.opportunityCount || 1)) * 100);
                        return (
                          <div key={role}>
                            <div className="flex justify-between text-sm mb-1">
                              <span className="text-gray-700">{ROLE_LABELS[role] ?? role}</span>
                              <span className="text-gray-500 font-ibm-plex-mono">{count} ({pct}%)</span>
                            </div>
                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-gray-900 rounded-full transition-all" style={{ width: `${pct}%` }} /></div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="p-4 rounded-md border border-gray-100 bg-white">
                  <h3 className="text-xs text-gray-500 uppercase tracking-wide mb-3">Top counterparties</h3>
                  {insights.stats.topCounterparties.length === 0 ? (
                    <p className="text-sm text-gray-400">No counterparty data yet</p>
                  ) : (
                    <div className="space-y-2.5">
                      {insights.stats.topCounterparties.map((cp) => (
                        <div key={cp.id} className="flex items-center gap-3">
                          <UserAvatar id={cp.id} name={cp.name} avatar={cp.avatar} size={28} />
                          <span className="text-sm text-gray-700 flex-1 truncate">{cp.name}</span>
                          <span className="text-xs text-gray-400 font-ibm-plex-mono">{cp.count} {cp.count === 1 ? 'negotiation' : 'negotiations'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {insights.summary && <p className="text-sm text-gray-600 leading-relaxed">{insights.summary}</p>}
            </div>
          ) : (
            <div className="text-sm text-gray-500 font-ibm-plex-mono py-8 text-center border border-dashed border-gray-200 rounded-lg">No negotiation activity yet</div>
          )}
        </>
      )}
    </div>
  );
}

function ApiKeysTab({ agent }: { agent: Agent }) {
  const agentsService = useAgents();
  const apiKeysService = useApiKeys();
  const { success, error } = useNotifications();
  const [keys, setKeys] = useState<Awaited<ReturnType<typeof apiKeysService.list>>>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<{ agentId: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiKeysService.list()
      .then((result) => { if (!cancelled) setKeys(result); })
      .catch(() => { if (!cancelled) setKeys([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [apiKeysService]);

  const agentKeys = keys.filter((key) => typeof key.metadata?.agentId === 'string' && key.metadata.agentId === agent.id);
  const createdKeyForAgent = newlyCreatedKey?.agentId === agent.id ? newlyCreatedKey.key : null;

  async function handleGenerateKey() {
    setCreating(true);
    try {
      const result = await agentsService.createToken(agent.id, `${agent.name} API Key`);
      setNewlyCreatedKey({ agentId: agent.id, key: result.key });
      const updated = await apiKeysService.list();
      setKeys(updated);
      success('API key created');
    } catch (err) {
      error('Failed to create API key', err instanceof Error ? err.message : undefined);
    } finally {
      setCreating(false);
    }
  }

  async function handleRevokeKey(tokenId: string) {
    if (!window.confirm(`Revoke this API key? Any agents using it will immediately lose access.`)) return;
    setDeleting(tokenId);
    try {
      await agentsService.revokeToken(agent.id, tokenId);
      setNewlyCreatedKey((current) => (current?.agentId === agent.id ? null : current));
      const updated = await apiKeysService.list();
      setKeys(updated);
      success('API key revoked');
    } catch (err) {
      error('Failed to revoke API key', err instanceof Error ? err.message : undefined);
    } finally {
      setDeleting(null);
    }
  }

  async function handleCopyKey(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { error('Failed to copy key'); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-gray-500">Create API keys to connect external agents to this Index agent.</p>
        <Button onClick={handleGenerateKey} disabled={creating || agent.type === 'system'}>
          {creating ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
          Generate Key
        </Button>
      </div>

      {agent.type === 'system' && (
        <p className="text-xs text-gray-400">System agents use automatically managed keys.</p>
      )}

      {createdKeyForAgent && (
        <div className="bg-amber-50 border border-amber-200 rounded-sm p-3">
          <p className="text-sm font-medium text-amber-800 mb-2">Copy this API key now. It will not be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white border border-amber-200 rounded-sm px-3 py-2 text-sm font-mono text-gray-900 break-all select-all">{createdKeyForAgent}</code>
            <Button variant="outline" size="sm" onClick={() => handleCopyKey(createdKeyForAgent)}>
              {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
          <SetupInstructions apiKey={createdKeyForAgent} />
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
      ) : agentKeys.length === 0 ? (
        !createdKeyForAgent && (
          <div className="text-center py-8 border border-dashed border-gray-200 rounded-sm">
            <p className="text-sm text-gray-500">No API keys for this agent yet.</p>
          </div>
        )
      ) : (
        <div className="border border-gray-200 rounded-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs uppercase tracking-wider">Key</th>
                <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs uppercase tracking-wider">Created</th>
                <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs uppercase tracking-wider">Last Used</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 text-xs uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {agentKeys.map((key) => (
                <tr key={key.id} className="border-b border-gray-100 last:border-b-0">
                  <td className="px-4 py-2 text-gray-900">{key.name || 'Unnamed'}</td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-500">{maskKey(key.start)}</td>
                  <td className="px-4 py-2 text-gray-500">{formatDate(key.createdAt)}</td>
                  <td className="px-4 py-2 text-gray-500">{formatDate(key.lastUsedAt)}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => handleRevokeKey(key.id)} disabled={deleting === key.id} className="text-gray-400 hover:text-red-500 transition-colors p-1" title="Revoke key" aria-label="Revoke key">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!createdKeyForAgent && agentKeys.length > 0 && <SetupInstructions />}
    </div>
  );
}

function PermissionsTab({ agent }: { agent: Agent }) {
  const actions = [...new Set(agent.permissions.flatMap((p) => p.actions))];
  return (
    <div>
      <p className="text-sm text-gray-500 mb-3">Permissions granted to this agent.</p>
      {actions.length === 0 ? (
        <p className="text-sm text-gray-400">No permissions granted.</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {actions.map((action) => (
            <span key={action} className="px-2 py-1 text-xs rounded bg-gray-100 text-gray-600">{permissionLabel(action)}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AgentDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { isAuthenticated, isLoading: authLoading, user } = useAuthContext();
  const agentsService = useAgents();
  const { error } = useNotifications();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabValue>('overview');

  useEffect(() => {
    if (!authLoading && !isAuthenticated) navigate('/');
  }, [authLoading, isAuthenticated, navigate]);

  useEffect(() => {
    if (!isAuthenticated || !id) return;
    let cancelled = false;
    setLoading(true);
    agentsService.get(id)
      .then((result) => { if (!cancelled) setAgent(result); })
      .catch((err) => { if (!cancelled) error('Failed to load agent', err instanceof Error ? err.message : undefined); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isAuthenticated, id, agentsService, error]);

  if (authLoading || !isAuthenticated) {
    return <ClientLayout><div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-gray-400" /></div></ClientLayout>;
  }

  if (loading) {
    return <ClientLayout><div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-gray-400" /></div></ClientLayout>;
  }

  if (!agent) {
    return <ClientLayout><ContentContainer><p className="text-sm text-gray-500">Agent not found.</p></ContentContainer></ClientLayout>;
  }

  return (
    <ClientLayout>
      <div className="px-6 lg:px-8 py-8">
        <ContentContainer>
          <button onClick={() => navigate('/agents')} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4">
            <ArrowLeft className="w-4 h-4" />Back to Agents
          </button>

          <div className="flex items-center gap-3 mb-6">
            <Bot className="w-6 h-6 text-gray-700" />
            <h1 className="text-2xl font-bold text-black font-ibm-plex-mono">{agent.name}</h1>
          </div>

          <Tabs.Root value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)}>
            <Tabs.List className="flex border-b border-gray-200 mb-6">
              <Tabs.Trigger value="overview" className="px-4 py-2 text-sm text-gray-600 border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:text-black data-[state=active]:font-bold">Overview</Tabs.Trigger>
              <Tabs.Trigger value="api-keys" className="px-4 py-2 text-sm text-gray-600 border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:text-black data-[state=active]:font-bold flex items-center gap-1.5"><KeyRound className="w-4 h-4" />API Keys</Tabs.Trigger>
              <Tabs.Trigger value="permissions" className="px-4 py-2 text-sm text-gray-600 border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:text-black data-[state=active]:font-bold flex items-center gap-1.5"><Shield className="w-4 h-4" />Permissions</Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="overview"><OverviewTab agent={agent} userId={user?.id ?? ''} /></Tabs.Content>
            <Tabs.Content value="api-keys"><ApiKeysTab agent={agent} /></Tabs.Content>
            <Tabs.Content value="permissions"><PermissionsTab agent={agent} /></Tabs.Content>
          </Tabs.Root>
        </ContentContainer>
      </div>
    </ClientLayout>
  );
}

export const Component = AgentDetailPage;
```

Wait — the OverviewTab has JSX with lowercase component references for the lucide icons used inline. Let me fix that — they need to be actual imported components. The `StatCard` component already uses `icon` as React.ReactNode, but the OverviewTab passes `<handshake className=.../>` with lowercase. These should use the imported PascalCase components. Let me correct: the imports at the top already have `Handshake`, `Sparkles`, `Clock`, `TrendingUp` — the JSX inside `OverviewTab` should use those.

Let me write the corrected full file:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import * as Tabs from '@radix-ui/react-tabs';
import { ArrowLeft, Bot, Check, Copy, Handshake, KeyRound, Loader2, Shield, Sparkles, Clock, Trash2, TrendingUp } from 'lucide-react';

import ClientLayout from '@/components/ClientLayout';
import { ContentContainer } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { useAgents, useApiKeys } from '@/contexts/APIContext';
import { useAuthContext } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useUsers } from '@/contexts/APIContext';
import UserAvatar from '@/components/UserAvatar';
import type { Agent } from '@/services/agents';
import type { NegotiationInsights } from '@/services/users';
```

And in the OverviewTab JSX, use the PascalCase imports:

```tsx
<StatCard label="Total" value={insights.stats.totalCount} icon={<Handshake className="w-4 h-4 text-gray-400" />} sublabel={`${insights.stats.opportunityCount} opportunities`} />
<StatCard label="Opportunity rate" value={`${opportunityRate}%`} icon={<TrendingUp className="w-4 h-4 text-gray-400" />} sublabel={`${insights.stats.noOpportunityCount} no opportunity`} />
<StatCard label="Avg score" value={insights.stats.avgScore ?? '—'} icon={<Sparkles className="w-4 h-4 text-gray-400" />} sublabel="Successful negotiations" />
<StatCard label="In progress" value={insights.stats.inProgressCount} icon={<Clock className="w-4 h-4 text-gray-400" />} sublabel="Active right now" />
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd frontend && bun run lint 2>&1 | grep "agents/\[id\]"` — expect no errors specific to this file.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/agents/\[id\]/page.tsx
git commit -m "feat: add agent detail page with overview, API keys, and permissions tabs"
```

---

### Task 2: Update Agent List Page to Link to Detail

**Files:**
- Modify: `frontend/src/app/agents/page.tsx`

- [ ] **Step 1: Make system agent cards clickable**

In `frontend/src/app/agents/page.tsx`, wrap each system agent card's outer `<div>` with a `<Link to={`/agents/${agent.id}`}>`. Also add `cursor-pointer` to the card className. Import `Link` from `react-router`.

Change the system agents section from:

```tsx
<div className="border border-gray-200 rounded-sm p-4 bg-white">
```

to:

```tsx
<Link to={`/agents/${agent.id}`} className="block border border-gray-200 rounded-sm p-4 bg-white hover:bg-gray-50 transition-colors cursor-pointer">
```

And close with `</Link>` instead of `</div>`.

- [ ] **Step 2: Make personal agent cards clickable**

Similarly, wrap each personal agent card's outer `<div>` with a `<Link to={`/agents/${agent.id}`}>`.

- [ ] **Step 3: Add Link import**

Add `import { Link } from 'react-router';` to the imports at the top of the file.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/agents/page.tsx
git commit -m "feat: make agent cards link to agent detail page"
```

---

### Task 3: Update Routes

**Files:**
- Modify: `frontend/src/routes.tsx`
- Modify: `frontend/src/components/ClientWrapper.tsx`

- [ ] **Step 1: Add agent detail route and remove old routes**

In `frontend/src/routes.tsx`:

1. Add after the `/agents` route:
```tsx
{
  path: "/agents/:id",
  lazy: () => import("@/app/agents/[id]/page"),
},
```

2. Remove the `/agent/:tab?` route.

3. Remove the `/settings` route.

4. Add redirect routes for `/agent` and `/settings`:
```tsx
{
  path: "/agent",
  element: <Navigate to="/agents" replace />,
},
{
  path: "/agent/:tab?",
  element: <Navigate to="/agents" replace />,
},
{
  path: "/settings",
  element: <Navigate to="/agents" replace />,
},
```

Also add `import { Navigate } from 'react-router';` to the imports.

- [ ] **Step 2: Update ClientWrapper app routes**

In `frontend/src/components/ClientWrapper.tsx`, update the `appRoutes` array:

Remove `/agent` and `/settings`. The `/agents` entry already covers `/agents/:id` because of the `pathname?.startsWith(route + '/')` check.

Change:
```tsx
const appRoutes = ['/', '/d', '/i', '/u', '/library', '/networks', '/mynetwork', '/chat', '/profile', '/agent', '/agents', '/settings'];
```

To:
```tsx
const appRoutes = ['/', '/d', '/i', '/u', '/library', '/networks', '/mynetwork', '/chat', '/profile', '/agents'];
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/routes.tsx frontend/src/components/ClientWrapper.tsx
git commit -m "feat: add /agents/:id route, remove /agent and /settings routes, add redirects"
```

---

### Task 4: Update Sidebar

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`

- [ ] **Step 1: Remove old dropdown entries and add single Agents entry**

In `frontend/src/components/Sidebar.tsx`:

1. Remove the `Settings` import from lucide-react. Remove `KeyRound` if only used in the old Agents entry (but the agents page also uses it, so keep it IF it's still imported there — actually check: the agents page imports its own `KeyRound`). For the sidebar, remove `Settings` and `KeyRound` from the import. Keep `Bot`.

Wait — check whether `KeyRound` is still used elsewhere in Sidebar. Looking at the code: `KeyRound` is used for the "Agents" dropdown entry and nowhere else in Sidebar. `Settings` is used for the "Settings" entry. `Bot` is used for the "Agent" entry and will now be used for the consolidated "Agents" entry.

Change the lucide import to remove `Settings` and keep `KeyRound` removed too (but keep `Bot`):
```tsx
import { Compass, MessagesSquare, ChevronDown, User as UserIcon, LogOut, Library, History, Network, Bot } from 'lucide-react';
```

2. Remove the three dropdown entries (Agent, Agents, Settings) and replace with a single Agents entry using `Bot` icon:

Remove these three buttons:
```tsx
<button ...Agent...>
<button ...Agents (KeyRound)...>
<button ...Settings...>
```

Add a single button:
```tsx
<button
  className={`w-full px-4 py-2 text-left flex items-center gap-2.5 text-sm transition-colors ${
    isAgentsView ? 'text-black font-medium bg-gray-50' : 'text-gray-700 hover:bg-gray-50'
  }`}
  onClick={() => { setUserDropdownOpen(false); navigate('/agents'); }}
>
  <Bot className="h-4 w-4 text-gray-400 flex-shrink-0" />
  Agents
</button>
```

Place it after the Profile button and before the Logout divider.

3. Remove the `isAgentView` and `isSettingsView` variables since they're no longer used. Keep `isAgentsView`.

Change:
```tsx
const isAgentView = pathname === '/agent' || pathname?.startsWith('/agent/');
const isAgentsView = pathname?.startsWith('/agents');
const isSettingsView = pathname?.startsWith('/settings');
```

To:
```tsx
const isAgentsView = pathname?.startsWith('/agents');
```

And update `isHomeView` to remove `isAgentView` and `isSettingsView`:
```tsx
const isHomeView = !isMessagesView && !isLibraryView && !isNetworksView && !isHistoryView && !isProfileView && !isAgentsView && !isMyNetworkView;
```

Also remove `isAgentView` and `isSettingsView` checks from any remaining references in the component (there are none besides the dropdown buttons).

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/Sidebar.tsx
git commit -m "feat: consolidate Agent/Agents/Settings sidebar entries into single Agents entry"
```

---

### Task 5: Delete Old Pages

**Files:**
- Delete: `frontend/src/app/agent/page.tsx`
- Delete: `frontend/src/app/settings/page.tsx`
- Delete: `frontend/src/app/settings/api-keys.tsx`

- [ ] **Step 1: Delete old page files**

```bash
rm frontend/src/app/agent/page.tsx
rm frontend/src/app/settings/page.tsx
rm frontend/src/app/settings/api-keys.tsx
rmdir frontend/src/app/agent
rmdir frontend/src/app/settings
```

- [ ] **Step 2: Verify build**

Run: `cd frontend && bun run build 2>&1 | tail -20` — expect no errors. If there are import errors for deleted files, fix them.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove /agent and /settings pages (merged into /agents/:id)"
```

---

### Task 6: Lint and Verify

- [ ] **Step 1: Run frontend lint**

Run: `cd frontend && bun run lint`

Fix any lint errors in the changed files.

- [ ] **Step 2: Run backend tests to confirm no regressions**

Run: `cd backend && bun test tests/agent.service.test.ts tests/mcp.test.ts src/services/tests/agent-delivery.service.spec.ts`

- [ ] **Step 3: Final commit if lint fixes were needed**

```bash
git add -A
git commit -m "fix: lint and test fixes from agents page merge"
```