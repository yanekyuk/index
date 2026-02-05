'use client';

import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Globe, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface CreateIndexModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (index: { name: string; prompt?: string; joinPolicy?: 'anyone' | 'invite_only' }) => Promise<void>;
}

export default function CreateIndexModal({ open, onOpenChange, onSubmit }: CreateIndexModalProps) {
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [joinPolicy, setJoinPolicy] = useState<'anyone' | 'invite_only'>('invite_only');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), prompt: prompt.trim() || undefined, joinPolicy });
      setName('');
      setPrompt('');
      setJoinPolicy('invite_only');
      onOpenChange(false);
    } catch (error) {
      console.error('Error creating index:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!isSubmitting) {
      if (!open) {
        setName('');
        setPrompt('');
        setJoinPolicy('invite_only');
      }
      onOpenChange(open);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[100]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-sm shadow-lg w-full max-w-md z-[100] focus:outline-none">
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <Dialog.Title className="text-lg font-bold text-black">
                Create Network
              </Dialog.Title>
              <Dialog.Close className="p-1 rounded-sm hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">Name</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Network name"
                  disabled={isSubmitting}
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  Description <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="What people can share in this network..."
                  rows={3}
                  disabled={isSubmitting}
                  className="resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">Who can join</label>
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setJoinPolicy('anyone')}
                    disabled={isSubmitting}
                    className={`w-full flex items-center gap-3 p-3 border rounded-sm text-left transition-colors ${
                      joinPolicy === 'anyone' ? 'border-black bg-gray-50' : 'border-gray-200 hover:border-gray-300'
                    } ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <Globe className={`h-4 w-4 ${joinPolicy === 'anyone' ? 'text-black' : 'text-gray-400'}`} />
                    <div>
                      <p className="text-sm font-medium text-black">Public</p>
                      <p className="text-xs text-gray-500">Anyone can discover and join</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setJoinPolicy('invite_only')}
                    disabled={isSubmitting}
                    className={`w-full flex items-center gap-3 p-3 border rounded-sm text-left transition-colors ${
                      joinPolicy === 'invite_only' ? 'border-black bg-gray-50' : 'border-gray-200 hover:border-gray-300'
                    } ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <Lock className={`h-4 w-4 ${joinPolicy === 'invite_only' ? 'text-black' : 'text-gray-400'}`} />
                    <div>
                      <p className="text-sm font-medium text-black">Private</p>
                      <p className="text-xs text-gray-500">Only people with invitation link</p>
                    </div>
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!name.trim() || isSubmitting}>
                  {isSubmitting ? 'Creating...' : 'Create'}
                </Button>
              </div>
            </form>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
