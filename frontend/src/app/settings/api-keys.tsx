import { useState, useEffect, useCallback } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { Loader2, Plus, Trash2, Copy, Check, ChevronDown, ChevronRight, Key } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useApiKeys } from '@/contexts/APIContext';
import { useNotifications } from '@/contexts/NotificationContext';
import type { ApiKeyInfo } from '@/services/api-keys';

/** Mask an API key prefix, showing only the first 8 characters. */
function maskKey(start: string): string {
  return `${start}${'*'.repeat(24)}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** MCP configuration snippets for agent setup. */
function SetupInstructions({ apiKey }: { apiKey?: string }) {
  const [expanded, setExpanded] = useState(false);
  const placeholder = apiKey || 'YOUR_API_KEY';

  const mcpUrl = `${window.location.origin}/api/mcp`;

  const claudeConfig = JSON.stringify({
    "mcpServers": {
      "index-network": {
        "type": "http",
        "url": mcpUrl,
        "headers": {
          "x-api-key": placeholder
        }
      }
    }
  }, null, 2);

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

export default function ApiKeysSection() {
  const apiKeysService = useApiKeys();
  const { success, error } = useNotifications();

  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');

  // State for the "show once" flow after creation
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<ApiKeyInfo | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchKeys = useCallback(async () => {
    try {
      const result = await apiKeysService.list();
      setKeys(result);
    } catch {
      error('Failed to load API keys');
    } finally {
      setLoading(false);
    }
  }, [apiKeysService, error]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;

    setCreating(true);
    try {
      const result = await apiKeysService.create(newKeyName.trim());
      setCreatedKey(result.key);
      setNewKeyName('');
      setShowCreateForm(false);
      await fetchKeys();
      success('API key created');
    } catch {
      error('Failed to create API key');
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
      error('Failed to copy to clipboard');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiKeysService.revoke(deleteTarget.id);
      setDeleteTarget(null);
      await fetchKeys();
      success('API key revoked');
    } catch {
      error('Failed to revoke API key');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-black font-ibm-plex-mono">API Keys</h2>
          <p className="text-sm text-gray-500 mt-1">
            Create API keys to connect external AI agents to your Index account.
          </p>
        </div>
        {!showCreateForm && !createdKey && (
          <Button size="sm" onClick={() => setShowCreateForm(true)}>
            <Plus className="w-4 h-4 mr-1" />
            Create Key
          </Button>
        )}
      </div>

      {/* Created key banner - shown once after creation */}
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

      {/* Create form */}
      {showCreateForm && (
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
            {creating ? 'Creating...' : 'Create'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => { setShowCreateForm(false); setNewKeyName(''); }}
            disabled={creating}
          >
            Cancel
          </Button>
        </form>
      )}

      {/* Keys table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : keys.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-gray-200 rounded-sm">
          <Key className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">No API keys yet.</p>
          <p className="text-xs text-gray-400 mt-1">Create one to connect AI agents to your account.</p>
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
                <th className="text-right px-4 py-2.5 font-medium text-gray-500 text-xs uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{key.name || 'Unnamed'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{maskKey(key.start)}</td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(key.createdAt)}</td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(key.lastUsedAt)}</td>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Setup instructions (when no key was just created) */}
      {!createdKey && keys.length > 0 && <SetupInstructions />}

      {/* Delete confirmation dialog */}
      <AlertDialog.Root open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 bg-black/50 z-[100]" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-sm shadow-lg p-6 w-full max-w-md z-[100] focus:outline-none">
            <AlertDialog.Title className="text-lg font-bold text-gray-900 mb-2">
              Revoke API Key
            </AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-gray-600 mb-6">
              Are you sure you want to revoke <strong>{deleteTarget?.name || 'this key'}</strong>? 
              Any agents using this key will immediately lose access.
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
                {deleting ? 'Revoking...' : 'Revoke Key'}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}
