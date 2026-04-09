import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router";
import * as Tabs from "@radix-ui/react-tabs";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import {
  Loader2,
  ArrowLeft,
  Bot,
  Handshake,
  Sparkles,
  TrendingUp,
  Clock,
  KeyRound,
  Shield,
  Plus,
  Trash2,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useAuthContext } from "@/contexts/AuthContext";
import { useAgents, useUsers } from "@/contexts/APIContext";
import { useNotifications } from "@/contexts/NotificationContext";
import ClientLayout from "@/components/ClientLayout";
import { ContentContainer } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import UserAvatar from "@/components/UserAvatar";
import NegotiationHistory from "@/components/NegotiationHistory";
import type { Agent, AgentTokenInfo } from "@/services/agents";
import type { NegotiationInsights } from "@/services/users";

const SYSTEM_AGENT_IDS = {
  chatOrchestrator: "00000000-0000-0000-0000-000000000001",
} as const;

type TabValue = "overview" | "api-keys" | "permissions";

const PERMISSION_LABELS: Record<string, string> = {
  "manage:profile": "Profile",
  "manage:intents": "Intents",
  "manage:networks": "Networks",
  "manage:contacts": "Contacts",
  "manage:opportunities": "Opportunities",
  "manage:negotiations": "Negotiations",
};

const ROLE_LABELS: Record<string, string> = {
  Helper: "Helper",
  Seeker: "Seeker",
  Peer: "Peer",
};

function StatCard({
  label,
  value,
  icon,
  sublabel,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  sublabel?: string;
}) {
  return (
    <div className="p-4 rounded-md border border-gray-100 bg-white">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-gray-500 uppercase tracking-wide">
          {label}
        </span>
      </div>
      <div className="text-2xl font-bold text-gray-900 font-ibm-plex-mono">
        {value}
      </div>
      {sublabel && (
        <div className="text-xs text-gray-400 mt-1">{sublabel}</div>
      )}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="p-4 rounded-md border border-gray-100 bg-white animate-pulse">
      <div className="h-3 bg-gray-200 rounded w-20 mb-3" />
      <div className="h-7 bg-gray-200 rounded w-12 mb-1" />
      <div className="h-3 bg-gray-200 rounded w-16" />
    </div>
  );
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function maskKey(start: string): string {
  return start ? `${start}${"*".repeat(24)}` : "Unavailable";
}

function OverviewTab({
  agent,
  userId,
}: {
  agent: Agent;
  userId: string;
}) {
  const isChatOrchestrator = agent.id === SYSTEM_AGENT_IDS.chatOrchestrator;

  if (isChatOrchestrator) {
    return <NegotiationInsightsTab userId={userId} />;
  }

  return (
    <div className="space-y-6">
      <div className="p-4 rounded-md border border-gray-100 bg-white">
        <div className="flex items-center gap-2 mb-3">
          <Bot className="w-4 h-4 text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            Agent Info
          </h3>
        </div>
        <dl className="space-y-3">
          <div>
            <dt className="text-xs text-gray-400 uppercase tracking-wide">Name</dt>
            <dd className="text-sm font-medium text-gray-900">{agent.name}</dd>
          </div>
          {agent.description && (
            <div>
              <dt className="text-xs text-gray-400 uppercase tracking-wide">Description</dt>
              <dd className="text-sm text-gray-700">{agent.description}</dd>
            </div>
          )}
          <div>
            <dt className="text-xs text-gray-400 uppercase tracking-wide">Type</dt>
            <dd>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                agent.type === "system" ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-600"
              }`}>
                {agent.type}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-400 uppercase tracking-wide">Status</dt>
            <dd>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                agent.status === "active" ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"
              }`}>
                {agent.status}
              </span>
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function NegotiationInsightsTab({ userId }: { userId: string }) {
  const usersService = useUsers();
  const [data, setData] = useState<NegotiationInsights | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    usersService
      .getNegotiationInsights(userId)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId, usersService]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <div className="p-5 rounded-md bg-gray-50 border border-gray-100 animate-pulse">
          <div className="h-3 bg-gray-200 rounded w-3/4 mb-2" />
          <div className="h-3 bg-gray-200 rounded w-full mb-2" />
          <div className="h-3 bg-gray-200 rounded w-1/2" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-sm text-gray-500 font-ibm-plex-mono py-12 text-center border border-dashed border-gray-200 rounded-lg">
        <p>No negotiation activity yet</p>
      </div>
    );
  }

  const { stats, summary } = data;
  const opportunityRate =
    stats.totalCount > 0
      ? Math.round(
          (stats.opportunityCount /
            (stats.opportunityCount + stats.noOpportunityCount || 1)) *
            100,
        )
      : 0;

  const roleEntries = Object.entries(stats.roleDistribution);
  const topRole =
    roleEntries.length > 0
      ? roleEntries.sort((a, b) => b[1] - a[1])[0]
      : null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Total"
          value={stats.totalCount}
          icon={<Handshake className="w-4 h-4 text-gray-400" />}
          sublabel={`${stats.opportunityCount} opportunities`}
        />
        <StatCard
          label="Opportunity rate"
          value={`${opportunityRate}%`}
          icon={<TrendingUp className="w-4 h-4 text-gray-400" />}
          sublabel={`${stats.noOpportunityCount} no opportunity`}
        />
        <StatCard
          label="Avg score"
          value={stats.avgScore ?? "\u2014"}
          icon={<Sparkles className="w-4 h-4 text-gray-400" />}
          sublabel="Successful negotiations"
        />
        <StatCard
          label="In progress"
          value={stats.inProgressCount}
          icon={<Clock className="w-4 h-4 text-gray-400" />}
          sublabel="Active right now"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="p-4 rounded-md border border-gray-100 bg-white">
          <h3 className="text-xs text-gray-500 uppercase tracking-wide mb-3">
            Your roles
          </h3>
          {roleEntries.length === 0 ? (
            <p className="text-sm text-gray-400">No role data yet</p>
          ) : (
            <div className="space-y-2">
              {roleEntries
                .sort((a, b) => b[1] - a[1])
                .map(([role, count]) => {
                  const pct = Math.round(
                    (count / (stats.opportunityCount || 1)) * 100,
                  );
                  return (
                    <div key={role}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-700">
                          {ROLE_LABELS[role] ?? role}
                        </span>
                        <span className="text-gray-500 font-ibm-plex-mono">
                          {count} ({pct}%)
                        </span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gray-900 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              {topRole && (
                <p className="text-xs text-gray-400 mt-2">
                  You're most often matched as{" "}
                  <span className="font-medium text-gray-600">
                    {ROLE_LABELS[topRole[0]] ?? topRole[0]}
                  </span>
                </p>
              )}
            </div>
          )}
        </div>

        <div className="p-4 rounded-md border border-gray-100 bg-white">
          <h3 className="text-xs text-gray-500 uppercase tracking-wide mb-3">
            Top counterparties
          </h3>
          {stats.topCounterparties.length === 0 ? (
            <p className="text-sm text-gray-400">No counterparty data yet</p>
          ) : (
            <div className="space-y-2.5">
              {stats.topCounterparties.map((cp) => (
                <div key={cp.id} className="flex items-center gap-3">
                  <UserAvatar
                    id={cp.id}
                    name={cp.name}
                    avatar={cp.avatar}
                    size={28}
                  />
                  <span className="text-sm text-gray-700 flex-1 truncate">
                    {cp.name}
                  </span>
                  <span className="text-xs text-gray-400 font-ibm-plex-mono">
                    {cp.count} {cp.count === 1 ? "negotiation" : "negotiations"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {summary && (
        <p className="text-sm text-gray-600 leading-relaxed">{summary}</p>
      )}
    </div>
  );
}

function SetupInstructions({ apiKey }: { apiKey?: string }) {
  const [expanded, setExpanded] = useState(false);
  const placeholder = apiKey || "YOUR_API_KEY";

  const mcpUrl = `${window.location.origin}/api/mcp`;

  const claudeConfig = JSON.stringify(
    {
      mcpServers: {
        "index-network": {
          type: "http",
          url: mcpUrl,
          headers: {
            "x-api-key": placeholder,
          },
        },
      },
    },
    null,
    2,
  );

  const hermesConfig = `mcp_servers:
  - name: index-network
    url: ${mcpUrl}
    headers:
      x-api-key: ${placeholder}`;

  return (
    <div className="border border-gray-200 rounded-sm">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
      >
        {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        Setup Instructions
      </button>
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-100">
          <div className="pt-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Claude Code / OpenCode
            </p>
            <pre className="bg-gray-50 border border-gray-200 rounded-sm p-3 text-xs text-gray-700 overflow-x-auto font-mono">
              {claudeConfig}
            </pre>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Hermes Agent
            </p>
            <pre className="bg-gray-50 border border-gray-200 rounded-sm p-3 text-xs text-gray-700 overflow-x-auto font-mono">
              {hermesConfig}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function ApiKeysTab({ agent }: { agent: Agent }) {
  const agentsService = useAgents();
  const { success, error } = useNotifications();

  const [keys, setKeys] = useState<AgentTokenInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AgentTokenInfo | null>(null);
  const [deleting, setDeleting] = useState(false);

  const isSystem = agent.type === "system";

  const fetchKeys = useCallback(async () => {
    try {
      const agentKeys = await agentsService.listTokens(agent.id);
      setKeys(agentKeys);
    } catch {
      error("Failed to load API keys");
    } finally {
      setLoading(false);
    }
  }, [agentsService, agent.id, error]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;

    setCreating(true);
    try {
      const result = await agentsService.createToken(agent.id, newKeyName.trim());
      setCreatedKey(result.key);
      setNewKeyName("");
      setShowCreateForm(false);
      await fetchKeys();
      success("API key created");
    } catch {
      error("Failed to create API key");
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      error("Failed to copy to clipboard");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await agentsService.revokeToken(agent.id, deleteTarget.id);
      setDeleteTarget(null);
      await fetchKeys();
      success("API key revoked");
    } catch {
      error("Failed to revoke API key");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-black font-ibm-plex-mono">API Keys</h2>
          <p className="text-sm text-gray-500 mt-1">
            Manage agent-linked API keys for authenticating with the Index Network.
          </p>
        </div>
        {!isSystem && !showCreateForm && !createdKey && (
          <Button size="sm" onClick={() => setShowCreateForm(true)}>
            <Plus className="w-4 h-4 mr-1" />
            Generate Key
          </Button>
        )}
      </div>

      {isSystem && (
        <div className="p-3 bg-gray-50 border border-gray-200 rounded-sm text-sm text-gray-600">
          System agents use built-in authentication. API key generation is not available.
        </div>
      )}

      {createdKey && (
        <div className="bg-amber-50 border border-amber-200 rounded-sm p-4">
          <p className="text-sm font-medium text-amber-800 mb-2">
            Copy your API key now. It won't be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white border border-amber-200 rounded-sm px-3 py-2 text-sm font-mono text-gray-900 break-all select-all">
              {createdKey}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleCopy(createdKey)}
              className="flex-shrink-0"
              aria-label="Copy API key"
            >
              {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
          <div className="mt-3">
            <SetupInstructions apiKey={createdKey} />
          </div>
          <button
            onClick={() => { setCreatedKey(null); setCopied(false); }}
            className="mt-3 text-sm text-amber-700 hover:text-amber-900 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {!isSystem && showCreateForm && (
        <form onSubmit={handleCreate} className="flex items-end gap-3 p-4 border border-gray-200 rounded-sm bg-gray-50">
          <div className="flex-1">
            <label htmlFor="key-name" className="text-sm font-medium text-gray-700 block mb-1.5">
              Key Name
            </label>
            <Input
              id="key-name"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="e.g. Claude Code, Hermes Agent"
              autoFocus
              disabled={creating}
            />
          </div>
          <Button type="submit" disabled={creating || !newKeyName.trim()} size="default">
            {creating ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            {creating ? "Creating..." : "Create"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => { setShowCreateForm(false); setNewKeyName(""); }}
            disabled={creating}
          >
            Cancel
          </Button>
        </form>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : keys.length === 0 && !createdKey ? (
        <div className="text-center py-12 border border-dashed border-gray-200 rounded-sm">
          <KeyRound className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">No API keys for this agent yet.</p>
          {!isSystem && (
            <p className="text-xs text-gray-400 mt-1">Generate one to connect external tools to this agent.</p>
          )}
        </div>
      ) : (
        <div className="border border-gray-200 rounded-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2.5 font-medium text-gray-500 text-xs uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-500 text-xs uppercase tracking-wider">Key</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-500 text-xs uppercase tracking-wider">Created</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-500 text-xs uppercase tracking-wider">Last Used</th>
                {!isSystem && (
                  <th className="text-right px-4 py-2.5 font-medium text-gray-500 text-xs uppercase tracking-wider">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{key.name || "Unnamed"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{maskKey(key.start)}</td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(key.createdAt)}</td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(key.lastUsedAt)}</td>
                  {!isSystem && (
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setDeleteTarget(key)}
                        className="text-gray-400 hover:text-red-500 transition-colors p-1"
                        title="Revoke key"
                        aria-label="Revoke key"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!createdKey && keys.length > 0 && <SetupInstructions />}

      <AlertDialog.Root open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 bg-black/50 z-[100]" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-sm shadow-lg p-6 w-full max-w-md z-[100] focus:outline-none">
            <AlertDialog.Title className="text-lg font-bold text-gray-900 mb-2">
              Revoke API Key
            </AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-gray-600 mb-6">
              Are you sure you want to revoke <strong>{deleteTarget?.name || "this key"}</strong>?
              Any services using this key will immediately lose access.
            </AlertDialog.Description>
            <div className="flex justify-end gap-3">
              <AlertDialog.Cancel asChild>
                <Button variant="outline" disabled={deleting}>Cancel</Button>
              </AlertDialog.Cancel>
              <Button
                onClick={handleDelete}
                disabled={deleting}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {deleting ? "Revoking..." : "Revoke Key"}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}

function PermissionsTab({ agent }: { agent: Agent }) {
  const actions = [...new Set(agent.permissions.flatMap((p) => p.actions))];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-black font-ibm-plex-mono">Permissions</h2>
        <p className="text-sm text-gray-500 mt-1">
          Actions this agent is authorized to perform on your behalf.
        </p>
      </div>

      {actions.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-gray-200 rounded-sm">
          <Shield className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">No permissions granted.</p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <span
              key={action}
              className="px-3 py-1.5 text-sm rounded-sm bg-gray-100 text-gray-700 font-medium"
            >
              {PERMISSION_LABELS[action] ?? action}
            </span>
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

  const [activeTab, setActiveTab] = useState<TabValue>("overview");

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate("/");
    }
  }, [authLoading, isAuthenticated, navigate]);

  useEffect(() => {
    if (!id || !isAuthenticated) return;
    let cancelled = false;

    agentsService
      .get(id)
      .then((result) => {
        if (!cancelled) setAgent(result);
      })
      .catch((err) => {
        if (!cancelled) {
          error("Failed to load agent", err instanceof Error ? err.message : undefined);
          navigate("/agents");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, agentsService, isAuthenticated, error, navigate]);

  if (authLoading || !isAuthenticated || loading) {
    return (
      <ClientLayout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      </ClientLayout>
    );
  }

  if (!agent) {
    return (
      <ClientLayout>
        <div className="px-6 lg:px-8 py-6">
          <ContentContainer>
            <div className="text-center py-12">
              <p className="text-sm text-gray-500">Agent not found.</p>
            </div>
          </ContentContainer>
        </div>
      </ClientLayout>
    );
  }

  const isChatOrchestrator = agent.id === SYSTEM_AGENT_IDS.chatOrchestrator;

  return (
    <ClientLayout>
      <div className="px-6 lg:px-8 py-6 pb-32 flex-1">
        <ContentContainer>
          <button
            onClick={() => navigate("/agents")}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 transition-colors mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Agents
          </button>

          <div className="flex items-center gap-3 mb-6">
            <h1 className="text-2xl font-bold text-black font-ibm-plex-mono">
              {agent.name}
            </h1>
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              agent.type === "system" ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-600"
            }`}>
              {agent.type}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              agent.status === "active" ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"
            }`}>
              {agent.status}
            </span>
          </div>

          <Tabs.Root value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)}>
            <Tabs.List className="flex border-b border-gray-200 mb-6">
              <Tabs.Trigger
                value="overview"
                className="px-4 py-2 text-sm text-gray-600 border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:text-black data-[state=active]:font-bold"
              >
                Overview
              </Tabs.Trigger>
              <Tabs.Trigger
                value="api-keys"
                className="px-4 py-2 text-sm text-gray-600 border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:text-black data-[state=active]:font-bold"
              >
                API Keys
              </Tabs.Trigger>
              {agent.type === 'system' && (
                <Tabs.Trigger
                  value="permissions"
                  className="px-4 py-2 text-sm text-gray-600 border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:text-black data-[state=active]:font-bold"
                >
                  Permissions
                </Tabs.Trigger>
              )}
            </Tabs.List>

            <Tabs.Content value="overview" className="w-full">
              <OverviewTab agent={agent} userId={user?.id ?? ""} />
            </Tabs.Content>

            <Tabs.Content value="api-keys" className="w-full">
              <ApiKeysTab agent={agent} />
            </Tabs.Content>

            <Tabs.Content value="permissions" className="w-full">
              <PermissionsTab agent={agent} />
            </Tabs.Content>
          </Tabs.Root>
        </ContentContainer>
      </div>

      {isChatOrchestrator && activeTab === "overview" && (
        <div className="sticky bottom-0 z-20">
          <div className="px-6 lg:px-8">
            <ContentContainer>
              <NegotiationHistory userId={user?.id ?? ""} />
            </ContentContainer>
          </div>
        </div>
      )}
    </ClientLayout>
  );
}

export const Component = AgentDetailPage;