'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNotifications } from '@/contexts/NotificationContext';
import { useIntegrationsService } from '@/services/integrations';

interface SlackChannelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  integration: {
    id: string;
    type: string;
    name: string;
  };
  onSuccess?: () => void;
}

interface Channel {
  id: string;
  name: string;
}

export default function SlackChannelModal({ open, onOpenChange, integration, onSuccess }: SlackChannelModalProps) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannelIds, setSelectedChannelIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { success, error } = useNotifications();
  const integrationsService = useIntegrationsService();
  const loadingRef = useRef(false);

  const loadChannels = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const response = await integrationsService.getSlackChannels(integration.id);
      setChannels(response.channels);
      if (response.selectedChannels && response.selectedChannels.length > 0) {
        setSelectedChannelIds(new Set(response.selectedChannels));
      } else {
        setSelectedChannelIds(new Set());
      }
    } catch (err) {
      console.error('Failed to load channels:', err);
      error('Failed to load Slack channels');
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [integration.id, integrationsService, error]);

  useEffect(() => {
    if (open) {
      loadChannels();
    } else {
      setSelectedChannelIds(new Set());
      setSearchQuery('');
    }
  }, [open, loadChannels]);

  const handleToggleChannel = (channelId: string) => {
    setSelectedChannelIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(channelId)) newSet.delete(channelId);
      else newSet.add(channelId);
      return newSet;
    });
  };

  const filteredChannels = searchQuery.trim()
    ? channels.filter(ch => ch.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : channels;

  const handleSelectAll = () => {
    if (selectedChannelIds.size === filteredChannels.length && filteredChannels.length > 0) {
      setSelectedChannelIds(new Set());
    } else {
      setSelectedChannelIds(new Set(filteredChannels.map(ch => ch.id)));
    }
  };

  const handleSave = async () => {
    if (selectedChannelIds.size === 0) {
      error('Please select at least one channel');
      return;
    }

    setSaving(true);
    try {
      await integrationsService.saveSlackChannels(integration.id, Array.from(selectedChannelIds));
      success('Channels configured');
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      console.error('Failed to save channels:', err);
      error('Failed to save channels');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[100]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-sm shadow-lg w-full max-w-lg max-h-[90vh] z-[100] focus:outline-none flex flex-col">
          <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0">
            <Dialog.Title className="text-lg font-bold text-black">Select Channels</Dialog.Title>
            <button onClick={() => onOpenChange(false)} disabled={saving} className="p-1 rounded-sm hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-6 flex-1 overflow-hidden flex flex-col">
            <p className="text-sm text-gray-600 mb-4">Choose which Slack channels to sync messages from.</p>

            <div className="space-y-3 mb-4">
              <input
                type="text"
                placeholder="Search channels..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-10 px-3 text-sm border border-gray-200 rounded-sm focus:outline-none focus:ring-1 focus:ring-gray-300"
              />
              <div className="flex items-center justify-between">
                <button onClick={handleSelectAll} className="text-xs text-blue-600 hover:text-blue-700" disabled={loading || filteredChannels.length === 0}>
                  {selectedChannelIds.size === filteredChannels.length && filteredChannels.length > 0 ? 'Deselect All' : 'Select All'}
                </button>
                <span className="text-xs text-gray-500">{selectedChannelIds.size} selected</span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto border border-gray-200 rounded-sm">
              {loading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
              ) : filteredChannels.length === 0 ? (
                <div className="text-center py-8 text-sm text-gray-500">
                  {searchQuery ? 'No channels found' : 'No channels available'}
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {filteredChannels.map((channel) => (
                    <button key={channel.id} onClick={() => handleToggleChannel(channel.id)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left">
                      <div className={`w-4 h-4 border rounded-sm flex items-center justify-center transition-colors ${selectedChannelIds.has(channel.id) ? 'bg-black border-black' : 'border-gray-300'}`}>
                        {selectedChannelIds.has(channel.id) && <Check className="h-3 w-3 text-white" />}
                      </div>
                      <span className="text-sm text-black">#{channel.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3 p-6 border-t border-gray-200 flex-shrink-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || selectedChannelIds.size === 0}>{saving ? 'Saving...' : 'Save'}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
