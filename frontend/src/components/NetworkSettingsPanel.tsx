'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { Copy, Globe, Lock, Trash2, Plus, Check, ChevronRight, ChevronDown } from 'lucide-react';
import { Index } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useIndexes } from '@/contexts/APIContext';
import { useIndexesState } from '@/contexts/IndexesContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useAuthenticatedAPI } from '@/lib/api';
import { createIntegrationsService } from '@/services/integrations';
import { DirectorySyncConfig } from '@/lib/types';
import { Member } from '@/services/indexes';
import { INTEGRATIONS } from '@/config/integrations';
import DirectoryConfigModal from '@/components/modals/DirectoryConfigModal';
import SlackChannelModal from '@/components/modals/SlackChannelModal';

interface IntegrationItem {
  id: string | null;
  type: string;
  name: string;
  connected: boolean;
  connectedAt?: string | null;
  lastSyncAt?: string | null;
}

const SUPPORTED_INTEGRATIONS = [
  { type: 'slack', name: 'Slack' },
  { type: 'notion', name: 'Notion' },
  { type: 'airtable', name: 'Airtable' },
];

interface NetworkSettingsPanelProps {
  index: Index;
  onDeleted?: () => void;
  activeTab: 'settings' | 'access' | 'integrations';
}

export default function NetworkSettingsPanel({ index, onDeleted, activeTab }: NetworkSettingsPanelProps) {
  const indexesService = useIndexes();
  const { indexes, updateIndex, removeIndex } = useIndexesState();
  const { success, error } = useNotifications();
  const api = useAuthenticatedAPI();

  const currentIndex = indexes?.find(idx => idx.id === index.id) || index;

  const [title, setTitle] = useState(currentIndex.title || '');
  const [prompt, setPrompt] = useState(currentIndex.prompt || '');
  const [originalTitle, setOriginalTitle] = useState(currentIndex.title || '');
  const [originalPrompt, setOriginalPrompt] = useState(currentIndex.prompt || '');
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isDeletingIndex, setIsDeletingIndex] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [isDangerZoneExpanded, setIsDangerZoneExpanded] = useState(false);

  const [anyoneCanJoin, setAnyoneCanJoin] = useState(currentIndex.permissions?.joinPolicy === 'anyone');
  const [members, setMembers] = useState<Member[]>([]);
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [suggestedUsers, setSuggestedUsers] = useState<Member[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [invitationLink, setInvitationLink] = useState<{ code: string } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const [integrations, setIntegrations] = useState<IntegrationItem[]>([]);
  const [integrationsLoaded, setIntegrationsLoaded] = useState(false);
  const [pendingIntegration, setPendingIntegration] = useState<string | null>(null);
  const [directoryConfigs, setDirectoryConfigs] = useState<Record<string, DirectorySyncConfig>>({});
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [selectedIntegrationForConfig, setSelectedIntegrationForConfig] = useState<IntegrationItem | null>(null);
  const [syncingDirectory, setSyncingDirectory] = useState<string | null>(null);
  const [slackChannelModalOpen, setSlackChannelModalOpen] = useState(false);
  const [selectedSlackIntegration, setSelectedSlackIntegration] = useState<IntegrationItem | null>(null);

  useEffect(() => {
    setTitle(currentIndex.title);
    setPrompt(currentIndex.prompt || '');
    setOriginalTitle(currentIndex.title);
    setOriginalPrompt(currentIndex.prompt || '');
    setAnyoneCanJoin(currentIndex.permissions?.joinPolicy === 'anyone');
    setDeleteConfirmationText('');
    setIsDangerZoneExpanded(false);
    if (currentIndex.permissions?.invitationLink?.code && currentIndex.permissions.joinPolicy === 'invite_only') {
      setInvitationLink({ code: currentIndex.permissions.invitationLink.code });
    } else {
      setInvitationLink(null);
    }
  }, [currentIndex.id, currentIndex.title, currentIndex.prompt, currentIndex.permissions]);

  const loadMembers = useCallback(async () => {
    try {
      const response = await indexesService.getMembers(index.id, {});
      setMembers(response.members);
    } catch (err) {
      console.error('Error loading members:', err);
    }
  }, [indexesService, index.id]);

  useEffect(() => {
    if (activeTab === 'access') loadMembers();
  }, [activeTab, loadMembers]);

  const searchUsers = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSuggestedUsers([]);
      return;
    }
    try {
      const users = await indexesService.searchUsers(query, index.id);
      setSuggestedUsers(users.map(u => ({ ...u, permissions: [] })));
    } catch (err) {
      console.error('Error searching users:', err);
      setSuggestedUsers([]);
    }
  }, [indexesService, index.id]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (memberSearchQuery) searchUsers(memberSearchQuery);
      else setSuggestedUsers([]);
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [memberSearchQuery, searchUsers]);

  const loadIntegrations = useCallback(async () => {
    try {
      const integrationsService = createIntegrationsService(api);
      const response = await integrationsService.getIntegrations(index.id);
      const filtered = response.integrations.filter(int =>
        SUPPORTED_INTEGRATIONS.some(s => s.type === int.type.toLowerCase())
      );
      const integrationsMap = new Map(filtered.map(int => [int.type.toLowerCase(), int]));
      const formattedIntegrations: IntegrationItem[] = SUPPORTED_INTEGRATIONS.map(({ type, name }) => {
        const existing = integrationsMap.get(type);
        return {
          id: existing?.id || null,
          type,
          name,
          connected: existing?.connected || false,
          connectedAt: existing?.connectedAt,
          lastSyncAt: existing?.lastSyncAt
        };
      });
      setIntegrations(formattedIntegrations);
      setIntegrationsLoaded(true);

      const configs: Record<string, DirectorySyncConfig> = {};
      for (const integration of formattedIntegrations) {
        const integrationDef = INTEGRATIONS.find(i => i.type === integration.type);
        if (integrationDef?.requiresDirectoryConfig && integration.id) {
          try {
            const configResponse = await integrationsService.getDirectoryConfig(integration.id);
            if (configResponse.config) configs[integration.id] = configResponse.config;
          } catch { /* Config not set yet */ }
        }
      }
      setDirectoryConfigs(configs);
    } catch (err) {
      console.error('Failed to load integrations:', err);
    }
  }, [index.id, api]);

  useEffect(() => {
    if (activeTab === 'integrations') loadIntegrations();
  }, [activeTab, loadIntegrations]);

  const handleSaveSettings = async () => {
    if (!title.trim()) {
      error('Title cannot be empty');
      return;
    }
    try {
      setIsSavingSettings(true);
      const updatedIndex = await indexesService.updateIndex(index.id, {
        title: title.trim(),
        prompt: prompt.trim() || null
      });
      setOriginalTitle(title);
      setOriginalPrompt(prompt);
      updateIndex(updatedIndex);
      success('Settings updated');
    } catch (err) {
      console.error('Error updating index:', err);
      error('Failed to update settings');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleDeleteIndex = async () => {
    try {
      setIsDeletingIndex(true);
      await indexesService.deleteIndex(index.id);
      removeIndex(index.id);
      success('Network deleted');
      setShowDeleteConfirmation(false);
      onDeleted?.();
    } catch (err) {
      console.error('Error deleting index:', err);
      error('Failed to delete network');
    } finally {
      setIsDeletingIndex(false);
    }
  };

  const handleUpdatePermissions = async (joinPolicy: boolean) => {
    try {
      await indexesService.updatePermissions(index.id, {
        joinPolicy: joinPolicy ? 'anyone' : 'invite_only',
      });
      const updatedIndex = await indexesService.getIndex(index.id);
      updateIndex(updatedIndex);
      if (updatedIndex.permissions?.invitationLink?.code) {
        setInvitationLink({ code: updatedIndex.permissions.invitationLink.code });
      }
    } catch (err) {
      console.error('Error updating permissions:', err);
      error('Failed to update permissions');
    }
  };

  const handleCopyLink = async () => {
    const url = anyoneCanJoin
      ? `${window.location.origin}/index/${index.id}`
      : `${window.location.origin}/l/${invitationLink?.code}`;
    try {
      await navigator.clipboard.writeText(url);
      setIsCopied(true);
      success('Link copied');
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      error('Failed to copy link');
    }
  };

  const handleAddMember = async (memberUser: Member) => {
    try {
      const newMember = await indexesService.addMember(index.id, memberUser.id, ['member']);
      setMembers(prev => [...prev, newMember]);
      setMemberSearchQuery('');
      setShowSuggestions(false);
    } catch (err) {
      console.error('Error adding member:', err);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    try {
      await indexesService.removeMember(index.id, memberId);
      setMembers(prev => prev.filter(m => m.id !== memberId));
    } catch (err) {
      console.error('Error removing member:', err);
    }
  };

  const handleToggleIntegration = async (integration: IntegrationItem) => {
    const integrationsService = createIntegrationsService(api);
    if (integration.connected) {
      if (!integration.id) return;
      setPendingIntegration(integration.type);
      try {
        await integrationsService.disconnectIntegration(integration.id);
        success(`${integration.name} disconnected`);
        await loadIntegrations();
      } catch {
        error(`Failed to disconnect ${integration.name}`);
      } finally {
        setPendingIntegration(null);
      }
    } else {
      setPendingIntegration(integration.type);
      try {
        const response = await integrationsService.connectIntegration(integration.type, { indexId: index.id });
        const width = 600, height = 700;
        const left = window.screen.width / 2 - width / 2;
        const top = window.screen.height / 2 - height / 2;
        const popup = window.open(response.redirectUrl, 'oauth', `width=${width},height=${height},left=${left},top=${top}`);
        const integrationId = response.integrationId;
        const checkInterval = setInterval(async () => {
          if (popup?.closed) {
            clearInterval(checkInterval);
            setPendingIntegration(null);
            return;
          }
          try {
            const status = await integrationsService.getIntegrationStatus(integrationId);
            if (status.status === 'connected') {
              clearInterval(checkInterval);
              popup?.close();
              success(`${integration.name} connected`);
              await loadIntegrations();
              if (integration.type === 'slack') {
                setSelectedSlackIntegration({ ...integration, id: integrationId });
                setSlackChannelModalOpen(true);
              }
              setPendingIntegration(null);
            }
          } catch { /* ignore */ }
        }, 2000);
        setTimeout(() => {
          clearInterval(checkInterval);
          if (pendingIntegration === integration.type) setPendingIntegration(null);
        }, 300000);
      } catch {
        error(`Failed to connect ${integration.name}`);
        setPendingIntegration(null);
      }
    }
  };

  const hasSettingsChanged = title !== originalTitle || prompt !== originalPrompt;
  const isDeleteConfirmationValid = deleteConfirmationText === currentIndex.title;
  const filteredSuggestions = suggestedUsers.filter(u => !members.find(m => m.id === u.id));

  return (
    <>
      {activeTab === 'settings' && (
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-2">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Network title" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-2">Prompt</label>
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What people can share in this network..." className="min-h-[100px]" rows={4} />
            <p className="text-xs text-gray-500 mt-1">Guides what kind of intents people can share.</p>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => { setTitle(originalTitle); setPrompt(originalPrompt); }} disabled={isSavingSettings || !hasSettingsChanged}>
              Cancel
            </Button>
            <Button onClick={handleSaveSettings} disabled={isSavingSettings || !hasSettingsChanged || !title.trim()}>
              {isSavingSettings ? 'Saving...' : 'Save'}
            </Button>
          </div>

          <div className="pt-6 border-t border-gray-200">
            <button
              onClick={() => setIsDangerZoneExpanded(!isDangerZoneExpanded)}
              className="flex items-center gap-2 text-sm font-medium text-red-700 hover:text-red-900 transition-colors"
            >
              {isDangerZoneExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              Danger Zone
            </button>
            {isDangerZoneExpanded && (
              <div className="mt-3 flex items-center justify-between p-3 border border-red-200 rounded-sm bg-red-50">
                <div>
                  <p className="text-sm font-medium text-red-900">Delete this network</p>
                  <p className="text-xs text-red-700">This action cannot be undone.</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirmation(true)} className="border-red-300 text-red-700 hover:bg-red-100">
                  <Trash2 className="h-4 w-4 mr-1" /> Delete
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'access' && (
        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-medium text-gray-900 mb-3">Who can join</h3>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => { setAnyoneCanJoin(true); handleUpdatePermissions(true); }}
                className={`w-full flex items-center gap-3 p-3 border rounded-sm text-left transition-colors ${anyoneCanJoin ? 'border-black bg-gray-50' : 'border-gray-200 hover:border-gray-300'}`}
              >
                <Globe className={`h-4 w-4 ${anyoneCanJoin ? 'text-black' : 'text-gray-400'}`} />
                <div>
                  <p className="text-sm font-medium text-black">Public</p>
                  <p className="text-xs text-gray-500">Anyone can discover and join</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => { setAnyoneCanJoin(false); handleUpdatePermissions(false); }}
                className={`w-full flex items-center gap-3 p-3 border rounded-sm text-left transition-colors ${!anyoneCanJoin ? 'border-black bg-gray-50' : 'border-gray-200 hover:border-gray-300'}`}
              >
                <Lock className={`h-4 w-4 ${!anyoneCanJoin ? 'text-black' : 'text-gray-400'}`} />
                <div>
                  <p className="text-sm font-medium text-black">Private</p>
                  <p className="text-xs text-gray-500">Only invited people can join</p>
                </div>
              </button>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-gray-900 mb-2">{anyoneCanJoin ? 'Network Link' : 'Invitation Link'}</h3>
            <div className="flex items-center gap-2 p-2 border border-gray-200 rounded-sm bg-gray-50">
              <code className="flex-1 text-xs text-gray-600 truncate">
                {anyoneCanJoin
                  ? `${typeof window !== 'undefined' ? window.location.origin : ''}/index/${index.id}`
                  : invitationLink ? `${typeof window !== 'undefined' ? window.location.origin : ''}/l/${invitationLink.code}` : 'Loading...'}
              </code>
              <button onClick={handleCopyLink} className={`p-1.5 rounded-sm transition-colors ${isCopied ? 'bg-green-100 text-green-700' : 'hover:bg-gray-200 text-gray-600'}`}>
                {isCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-gray-900 mb-3">Members ({members.length})</h3>
            <div className="space-y-2 max-h-[200px] overflow-y-auto mb-3">
              {members.map((member) => (
                <div key={member.id} className="flex items-center justify-between p-2 border border-gray-200 rounded-sm">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 bg-gray-200 rounded-full flex items-center justify-center text-gray-600 text-xs font-medium">
                      {member.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                    </div>
                    <span className="text-sm text-black">{member.name}</span>
                    <span className="text-xs text-gray-500 px-1.5 py-0.5 bg-gray-100 rounded-sm">
                      {member.permissions.includes('owner') ? 'Owner' : 'Member'}
                    </span>
                  </div>
                  {!member.permissions.includes('owner') && (
                    <button onClick={() => handleRemoveMember(member.id)} className="p-1 hover:bg-gray-100 rounded-sm text-gray-400 hover:text-red-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="relative">
              <Plus className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                ref={searchInputRef}
                placeholder="Add people by name..."
                value={memberSearchQuery}
                onChange={(e) => { setMemberSearchQuery(e.target.value); setShowSuggestions(e.target.value.length > 0); }}
                onFocus={() => memberSearchQuery && setShowSuggestions(true)}
                className="pl-10"
              />
              {showSuggestions && filteredSuggestions.length > 0 && (
                <div ref={suggestionsRef} className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-sm shadow-lg z-10 max-h-40 overflow-y-auto">
                  {filteredSuggestions.map((u) => (
                    <button key={u.id} onClick={() => handleAddMember(u)} className="w-full flex items-center gap-2 p-2 hover:bg-gray-50 text-left">
                      <div className="h-6 w-6 bg-gray-200 rounded-full flex items-center justify-center text-gray-600 text-xs">
                        {u.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                      </div>
                      <span className="text-sm">{u.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'integrations' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600 mb-4">Connect external services to sync data with your network.</p>
          <div className="space-y-2">
            {integrations.map((it) => {
              const integrationDef = INTEGRATIONS.find(i => i.type === it.type);
              const requiresDirectoryConfig = integrationDef?.requiresDirectoryConfig;
              const directoryConfig = it.id ? directoryConfigs[it.id] : null;
              return (
                <div key={it.type} className="flex items-center gap-3 p-3 border border-gray-200 rounded-sm hover:border-gray-300 transition-colors">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/integrations/${it.type}.png`} width={24} height={24} alt={it.name} className="flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-black">{it.name}</div>
                    <div className="text-xs text-gray-500">
                      {it.connected ? 'Connected' : 'Not connected'}
                      {it.connected && requiresDirectoryConfig && directoryConfig && ` · ${directoryConfig.source.name}`}
                    </div>
                  </div>
                  {it.connected && requiresDirectoryConfig && it.id && (
                    <div className="flex gap-1">
                      <button onClick={() => { setSelectedIntegrationForConfig(it); setConfigModalOpen(true); }} className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded-sm">
                        {directoryConfig ? 'Edit' : 'Configure'}
                      </button>
                      {directoryConfig && (
                        <button
                          onClick={async () => {
                            if (!it.id) return;
                            setSyncingDirectory(it.id);
                            try {
                              await createIntegrationsService(api).syncDirectory(it.id);
                              success('Sync started');
                              await loadIntegrations();
                            } catch { error('Failed to sync'); }
                            finally { setSyncingDirectory(null); }
                          }}
                          disabled={syncingDirectory === it.id}
                          className="text-xs px-2 py-1 bg-blue-100 hover:bg-blue-200 rounded-sm disabled:opacity-50"
                        >
                          {syncingDirectory === it.id ? 'Syncing...' : 'Sync'}
                        </button>
                      )}
                    </div>
                  )}
                  {it.connected && it.type === 'slack' && it.id && (
                    <button onClick={() => { setSelectedSlackIntegration(it); setSlackChannelModalOpen(true); }} className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded-sm">
                      Channels
                    </button>
                  )}
                  {!integrationsLoaded ? (
                    <div className="w-11 h-6 bg-gray-100 rounded-full animate-pulse" />
                  ) : (
                    <button
                      onClick={() => handleToggleIntegration(it)}
                      disabled={pendingIntegration === it.type}
                      className={`relative h-6 w-11 rounded-full transition-colors ${it.connected ? 'bg-[#006D4B]' : 'bg-gray-300'} ${pendingIntegration === it.type ? 'opacity-70' : ''}`}
                    >
                      <span className={`absolute top-[1px] left-[1px] h-[22px] w-[22px] rounded-full bg-white transition-transform shadow-sm ${it.connected ? 'translate-x-5' : ''}`} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {selectedIntegrationForConfig?.id && (
        <DirectoryConfigModal
          open={configModalOpen}
          onOpenChange={setConfigModalOpen}
          integration={{ id: selectedIntegrationForConfig.id, type: selectedIntegrationForConfig.type as 'notion' | 'airtable' | 'googledocs', name: selectedIntegrationForConfig.name }}
          onSuccess={loadIntegrations}
        />
      )}

      {selectedSlackIntegration?.id && (
        <SlackChannelModal
          open={slackChannelModalOpen}
          onOpenChange={setSlackChannelModalOpen}
          integration={{ id: selectedSlackIntegration.id, type: selectedSlackIntegration.type, name: selectedSlackIntegration.name }}
          onSuccess={loadIntegrations}
        />
      )}

      <AlertDialog.Root open={showDeleteConfirmation} onOpenChange={setShowDeleteConfirmation}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 bg-black/50 z-[100]" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-sm shadow-lg p-6 w-full max-w-md z-[100] focus:outline-none">
            <AlertDialog.Title className="text-lg font-bold text-gray-900 mb-4">Delete &apos;{currentIndex.title}&apos;</AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-gray-600 mb-4">This action cannot be undone. Type the network name to confirm.</AlertDialog.Description>
            <Input value={deleteConfirmationText} onChange={(e) => setDeleteConfirmationText(e.target.value)} placeholder={currentIndex.title} className="mb-4" />
            <div className="flex justify-end gap-3">
              <AlertDialog.Cancel asChild><Button variant="outline">Cancel</Button></AlertDialog.Cancel>
              <Button onClick={handleDeleteIndex} disabled={isDeletingIndex || !isDeleteConfirmationValid} className="bg-red-600 hover:bg-red-700 text-white">
                {isDeletingIndex ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}
