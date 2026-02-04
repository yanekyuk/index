'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import { X, Copy, Globe, Lock, Trash2, Plus, Check, ChevronRight, ChevronDown } from 'lucide-react';
import { Index } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useIndexes } from '@/contexts/APIContext';
import { useIndexesState } from '@/contexts/IndexesContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useAuthContext } from '@/contexts/AuthContext';
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

interface IndexOwnerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  index: Index;
}

export default function IndexOwnerModal({ open, onOpenChange, index }: IndexOwnerModalProps) {
  const indexesService = useIndexes();
  const { indexes, updateIndex, removeIndex } = useIndexesState();
  const { success, error } = useNotifications();
  const { user } = useAuthContext();
  const api = useAuthenticatedAPI();

  // Get fresh index data
  const currentIndex = indexes?.find(idx => idx.id === index.id) || index;

  // Tab management
  const [activeTab, setActiveTab] = useState<'settings' | 'access' | 'integrations'>('settings');

  // Settings state
  const [title, setTitle] = useState(currentIndex.title || '');
  const [prompt, setPrompt] = useState(currentIndex.prompt || '');
  const [originalTitle, setOriginalTitle] = useState(currentIndex.title || '');
  const [originalPrompt, setOriginalPrompt] = useState(currentIndex.prompt || '');
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isDeletingIndex, setIsDeletingIndex] = useState(false);
  const [isDangerZoneExpanded, setIsDangerZoneExpanded] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');

  // Access state
  const [anyoneCanJoin, setAnyoneCanJoin] = useState(currentIndex.permissions?.joinPolicy === 'anyone');
  const [members, setMembers] = useState<Member[]>([]);
  const [memberFilterQuery, setMemberFilterQuery] = useState('');
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [suggestedUsers, setSuggestedUsers] = useState<Member[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isCopied, setIsCopied] = useState<string | null>(null);
  const [invitationLink, setInvitationLink] = useState<{ code: string } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Integrations state
  const [integrations, setIntegrations] = useState<IntegrationItem[]>([]);
  const [integrationsLoaded, setIntegrationsLoaded] = useState(false);
  const [pendingIntegration, setPendingIntegration] = useState<string | null>(null);
  const [directoryConfigs, setDirectoryConfigs] = useState<Record<string, DirectorySyncConfig>>({});
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [selectedIntegrationForConfig, setSelectedIntegrationForConfig] = useState<IntegrationItem | null>(null);
  const [syncingDirectory, setSyncingDirectory] = useState<string | null>(null);
  const [slackChannelModalOpen, setSlackChannelModalOpen] = useState(false);
  const [selectedSlackIntegration, setSelectedSlackIntegration] = useState<IntegrationItem | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setTitle(currentIndex.title);
      setPrompt(currentIndex.prompt || '');
      setOriginalTitle(currentIndex.title);
      setOriginalPrompt(currentIndex.prompt || '');
      setAnyoneCanJoin(currentIndex.permissions?.joinPolicy === 'anyone');
      if (currentIndex.permissions?.invitationLink?.code && currentIndex.permissions.joinPolicy === 'invite_only') {
        setInvitationLink({ code: currentIndex.permissions.invitationLink.code });
      }
    }
  }, [open, currentIndex]);

  // Load members
  const loadMembers = useCallback(async (searchQuery?: string) => {
    try {
      const response = await indexesService.getMembers(index.id, { searchQuery });
      setMembers(response.members);
    } catch (err) {
      console.error('Error loading members:', err);
    }
  }, [indexesService, index.id]);

  useEffect(() => {
    if (open && activeTab === 'access') {
      loadMembers(memberFilterQuery || undefined);
    }
  }, [open, activeTab, memberFilterQuery, loadMembers]);

  // Search users for adding
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
      if (memberSearchQuery) {
        searchUsers(memberSearchQuery);
      } else {
        setSuggestedUsers([]);
      }
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [memberSearchQuery, searchUsers]);

  // Load integrations
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

      // Load directory configs
      const configs: Record<string, DirectorySyncConfig> = {};
      for (const integration of formattedIntegrations) {
        const integrationDef = INTEGRATIONS.find(i => i.type === integration.type);
        if (integrationDef?.requiresDirectoryConfig && integration.id) {
          try {
            const configResponse = await integrationsService.getDirectoryConfig(integration.id);
            if (configResponse.config) {
              configs[integration.id] = configResponse.config;
            }
          } catch {
            // Config not set yet
          }
        }
      }
      setDirectoryConfigs(configs);
    } catch (err) {
      console.error('Failed to load integrations:', err);
    }
  }, [index.id, api]);

  useEffect(() => {
    if (open && activeTab === 'integrations') {
      loadIntegrations();
    }
  }, [open, activeTab, loadIntegrations]);

  // Handlers
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
      success('Network settings updated successfully');
    } catch (err) {
      console.error('Error updating index:', err);
      error('Failed to update network settings');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleDeleteIndex = async () => {
    try {
      setIsDeletingIndex(true);
      await indexesService.deleteIndex(index.id);
      removeIndex(index.id);
      success('Network deleted successfully');
      setShowDeleteConfirmation(false);
      onOpenChange(false);
    } catch (err) {
      console.error('Error deleting index:', err);
      error('Failed to delete network');
    } finally {
      setIsDeletingIndex(false);
    }
  };

  const handleUpdatePermissions = async (joinPolicy: boolean) => {
    try {
      const updates: { joinPolicy: 'anyone' | 'invite_only' } = {
        joinPolicy: joinPolicy ? 'anyone' : 'invite_only',
      };
      await indexesService.updatePermissions(index.id, updates);
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

  const handleCopyLink = async (linkType: 'index' | 'invitation', code?: string) => {
    const url = linkType === 'index'
      ? `${window.location.origin}/index/${index.id}`
      : `${window.location.origin}/l/${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setIsCopied(linkType === 'index' ? 'index-link' : `invitation-${code}`);
      success('Link copied to clipboard');
      setTimeout(() => setIsCopied(null), 2000);
    } catch (err) {
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
          } catch {}
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
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 animate-in fade-in duration-200 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[95vw] max-w-[900px] bg-[#FAFAFA] border border-[#E0E0E0] rounded-lg shadow-lg focus:outline-none animate-in fade-in zoom-in-95 duration-200 z-50 max-h-[85vh] flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
            <Dialog.Title className="text-lg font-bold text-[#333] font-ibm-plex-mono">
              {currentIndex.title} - Admin
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="text-gray-500 hover:text-black transition-colors">
                <X className="w-5 h-5" />
              </button>
            </Dialog.Close>
          </div>

          {/* Tabs */}
          <Tabs.Root value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="flex-1 flex flex-col overflow-hidden">
            <Tabs.List className="flex border-b border-gray-200 px-6 flex-shrink-0">
              <Tabs.Trigger value="settings" className="px-4 py-2 text-sm font-ibm-plex-mono text-gray-600 border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:text-black">
                Settings
              </Tabs.Trigger>
              <Tabs.Trigger value="access" className="px-4 py-2 text-sm font-ibm-plex-mono text-gray-600 border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:text-black">
                Access
              </Tabs.Trigger>
              <Tabs.Trigger value="integrations" className="px-4 py-2 text-sm font-ibm-plex-mono text-gray-600 border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:text-black">
                Integrations
              </Tabs.Trigger>
            </Tabs.List>

            <div className="flex-1 overflow-y-auto p-6">
              {/* Settings Tab */}
              <Tabs.Content value="settings" className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2 font-ibm-plex-mono">Title</label>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Enter network title" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2 font-ibm-plex-mono">Prompt</label>
                  <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe what people can share..." className="min-h-[100px]" rows={4} />
                  <p className="text-xs text-gray-500 mt-1">This helps guide what kind of intents people can share.</p>
                </div>
                <div className="flex justify-end gap-3">
                  <Button variant="outline" onClick={() => { setTitle(originalTitle); setPrompt(originalPrompt); }} disabled={isSavingSettings}>Cancel</Button>
                  <Button onClick={handleSaveSettings} disabled={isSavingSettings || !hasSettingsChanged || !title.trim()}>
                    {isSavingSettings ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>

                {/* Danger Zone */}
                <div className="pt-6 border-t border-gray-200">
                  <button onClick={() => setIsDangerZoneExpanded(!isDangerZoneExpanded)} className="flex items-center gap-2 text-sm font-medium text-red-900 font-ibm-plex-mono hover:text-red-700">
                    {isDangerZoneExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    Danger Zone
                  </button>
                  {isDangerZoneExpanded && (
                    <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-sm font-medium text-red-900">Delete this network</h4>
                          <p className="text-sm text-red-700 mt-1">Deleting a network is permanent.</p>
                        </div>
                        <Button variant="outline" onClick={() => setShowDeleteConfirmation(true)} className="border-red-300 text-red-700 hover:bg-red-50">
                          <Trash2 className="h-4 w-4 mr-2" />Delete Network
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </Tabs.Content>

              {/* Access Tab */}
              <Tabs.Content value="access" className="space-y-6">
                <div>
                  <h3 className="text-sm font-medium text-gray-900 font-ibm-plex-mono mb-3">Who can join</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <button type="button" onClick={() => { setAnyoneCanJoin(true); handleUpdatePermissions(true); }}
                      className={`border-2 p-3 rounded-md text-left transition-all ${anyoneCanJoin ? 'border-blue-500 bg-white' : 'border-gray-200 bg-gray-50 hover:border-blue-300'}`}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <Globe className={`h-4 w-4 ${anyoneCanJoin ? 'text-blue-500' : 'text-gray-600'}`} />
                        <h4 className="text-sm font-medium font-ibm-plex-mono">Anyone can join</h4>
                      </div>
                      <p className="text-xs text-gray-600">People can discover and join freely.</p>
                    </button>
                    <button type="button" onClick={() => { setAnyoneCanJoin(false); handleUpdatePermissions(false); }}
                      className={`border-2 p-3 rounded-md text-left transition-all ${!anyoneCanJoin ? 'border-blue-500 bg-white' : 'border-gray-200 bg-gray-50 hover:border-blue-300'}`}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <Lock className={`h-4 w-4 ${!anyoneCanJoin ? 'text-blue-500' : 'text-gray-600'}`} />
                        <h4 className="text-sm font-medium font-ibm-plex-mono">Private</h4>
                      </div>
                      <p className="text-xs text-gray-600">Only invited people can join.</p>
                    </button>
                  </div>
                </div>

                {/* Link Section */}
                <div className="pt-4">
                  <h4 className="text-sm font-medium font-ibm-plex-mono text-black mb-2">{anyoneCanJoin ? 'Network Link' : 'Invitation Link'}</h4>
                  <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
                    {anyoneCanJoin ? <Globe className="h-4 w-4 text-gray-500" /> : <Lock className="h-4 w-4 text-gray-500" />}
                    <code className="flex-1 text-xs text-gray-700 font-mono truncate">
                      {anyoneCanJoin ? `${typeof window !== 'undefined' ? window.location.origin : ''}/index/${index.id}` : invitationLink ? `${typeof window !== 'undefined' ? window.location.origin : ''}/l/${invitationLink.code}` : 'Loading...'}
                    </code>
                    <Button variant="outline" size="sm" onClick={() => handleCopyLink(anyoneCanJoin ? 'index' : 'invitation', invitationLink?.code)}
                      className={isCopied ? 'bg-green-50 border-green-200 text-green-700' : ''}>
                      {isCopied ? <><Check className="h-4 w-4 mr-2" />Copied!</> : <><Copy className="h-4 w-4 mr-2" />Copy</>}
                    </Button>
                  </div>
                </div>

                {/* Members */}
                <div className="pt-4">
                  <h3 className="text-sm font-medium text-gray-900 font-ibm-plex-mono mb-3">Members ({members.length})</h3>
                  <Input placeholder="Search members..." value={memberFilterQuery} onChange={(e) => setMemberFilterQuery(e.target.value)} className="mb-3" />
                  <div className="space-y-2 max-h-[200px] overflow-y-auto">
                    {members.map((member) => (
                      <div key={member.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-2">
                          <div className="h-6 w-6 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-medium text-xs">
                            {member.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                          </div>
                          <span className="text-sm text-black">{member.name}</span>
                          <span className="text-xs text-gray-500 px-1.5 py-0.5 bg-gray-100 rounded">
                            {member.permissions.includes('owner') ? 'Owner' : member.permissions.includes('admin') ? 'Admin' : 'Member'}
                          </span>
                        </div>
                        {!member.permissions.includes('owner') && (
                          <Button variant="ghost" size="sm" onClick={() => handleRemoveMember(member.id)} className="text-red-500 hover:text-red-700 h-6 w-6 p-0">
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="relative mt-3">
                    <Plus className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input ref={searchInputRef} placeholder="Add people by name..." value={memberSearchQuery}
                      onChange={(e) => { setMemberSearchQuery(e.target.value); setShowSuggestions(e.target.value.length > 0); }}
                      onFocus={() => memberSearchQuery && setShowSuggestions(true)} className="pl-10" />
                    {showSuggestions && filteredSuggestions.length > 0 && (
                      <div ref={suggestionsRef} className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 max-h-40 overflow-y-auto">
                        {filteredSuggestions.map((u) => (
                          <button key={u.id} onClick={() => handleAddMember(u)} className="w-full flex items-center gap-2 p-2 hover:bg-gray-50 text-left">
                            <div className="h-6 w-6 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 text-xs">
                              {u.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                            </div>
                            <span className="text-sm">{u.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </Tabs.Content>

              {/* Integrations Tab */}
              <Tabs.Content value="integrations" className="space-y-4">
                <p className="text-sm text-gray-600 font-ibm-plex-mono">Connect external services to sync data with your network.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {integrations.map((it) => {
                    const integrationDef = INTEGRATIONS.find(i => i.type === it.type);
                    const requiresDirectoryConfig = integrationDef?.requiresDirectoryConfig;
                    const directoryConfig = it.id ? directoryConfigs[it.id] : null;
                    return (
                      <div key={it.type} className="flex flex-col gap-2 border border-black border-b-2 rounded-none px-3 py-2.5 bg-[#FAFAFA] hover:bg-[#F0F0F0]">
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-3">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/integrations/${it.type}.png`} width={20} height={20} alt="" />
                            <span className="text-xs font-medium text-[#333] font-ibm-plex-mono">{it.name}</span>
                          </span>
                          {!integrationsLoaded ? (
                            <div className="w-11 h-6 bg-gray-100 rounded-full animate-pulse" />
                          ) : (
                            <button onClick={() => handleToggleIntegration(it)} disabled={pendingIntegration === it.type}
                              className={`relative h-6 w-11 rounded-full transition-colors ${it.connected ? 'bg-green-600' : 'bg-gray-300'} ${pendingIntegration === it.type ? 'opacity-70' : ''}`}>
                              <span className={`absolute top-[1px] left-[1px] h-[22px] w-[22px] rounded-full bg-white transition-transform shadow-sm ${it.connected ? 'translate-x-5' : ''}`} />
                            </button>
                          )}
                        </div>
                        {it.connected && requiresDirectoryConfig && it.id && (
                          <div className="mt-2 pt-2 border-t border-gray-200">
                            {directoryConfig ? (
                              <div className="space-y-1">
                                <p className="text-[10px] text-gray-600">{directoryConfig.source.name}</p>
                                <div className="flex gap-1">
                                  <button onClick={() => { setSelectedIntegrationForConfig(it); setConfigModalOpen(true); }} className="text-[10px] px-2 py-0.5 bg-gray-100 hover:bg-gray-200 rounded">Edit</button>
                                  <button onClick={async () => {
                                    if (!it.id) return;
                                    setSyncingDirectory(it.id);
                                    try {
                                      await createIntegrationsService(api).syncDirectory(it.id);
                                      success('Sync started');
                                      await loadIntegrations();
                                    } catch { error('Failed to sync'); }
                                    finally { setSyncingDirectory(null); }
                                  }} disabled={syncingDirectory === it.id} className="text-[10px] px-2 py-0.5 bg-blue-100 hover:bg-blue-200 rounded disabled:opacity-50">
                                    {syncingDirectory === it.id ? 'Syncing...' : 'Sync'}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button onClick={() => { setSelectedIntegrationForConfig(it); setConfigModalOpen(true); }} className="w-full text-[10px] px-2 py-1 bg-blue-100 hover:bg-blue-200 rounded">
                                Configure Directory Sync
                              </button>
                            )}
                          </div>
                        )}
                        {it.connected && it.type === 'slack' && it.id && (
                          <div className="mt-2 pt-2 border-t border-gray-200">
                            <button onClick={() => { setSelectedSlackIntegration(it); setSlackChannelModalOpen(true); }} className="w-full text-[10px] px-2 py-1 bg-blue-100 hover:bg-blue-200 rounded">
                              Select Channels
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Tabs.Content>
            </div>
          </Tabs.Root>
        </Dialog.Content>
      </Dialog.Portal>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirmation && typeof window !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowDeleteConfirmation(false)} />
          <div className="relative bg-white rounded-lg shadow-lg p-6 w-full max-w-md z-[70]">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Delete &apos;{currentIndex.title}&apos;</h2>
            <p className="text-sm text-gray-600 mb-4">This action cannot be undone. Type the network name to confirm.</p>
            <Input value={deleteConfirmationText} onChange={(e) => setDeleteConfirmationText(e.target.value)} placeholder={currentIndex.title} className="mb-4" />
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowDeleteConfirmation(false)}>Cancel</Button>
              <Button onClick={handleDeleteIndex} disabled={isDeletingIndex || !isDeleteConfirmationValid} className="bg-red-600 hover:bg-red-700 text-white">
                {isDeletingIndex ? 'Deleting...' : 'Delete Network'}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Directory Config Modal */}
      {selectedIntegrationForConfig?.id && (
        <DirectoryConfigModal
          open={configModalOpen}
          onOpenChange={setConfigModalOpen}
          integration={{ id: selectedIntegrationForConfig.id, type: selectedIntegrationForConfig.type as 'notion' | 'airtable' | 'googledocs', name: selectedIntegrationForConfig.name }}
          onSuccess={loadIntegrations}
        />
      )}

      {/* Slack Channel Modal */}
      {selectedSlackIntegration?.id && (
        <SlackChannelModal
          open={slackChannelModalOpen}
          onOpenChange={setSlackChannelModalOpen}
          integration={{ id: selectedSlackIntegration.id, type: selectedSlackIntegration.type, name: selectedSlackIntegration.name }}
          onSuccess={loadIntegrations}
        />
      )}
    </Dialog.Root>
  );
}
