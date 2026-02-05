'use client';

import { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { User } from '@/lib/types';
import { useAuth } from '@/contexts/APIContext';

interface PreferencesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User | null;
  onUserUpdate: (user: User) => void;
}

export default function PreferencesModal({ open, onOpenChange, user, onUserUpdate }: PreferencesModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const authService = useAuth();

  const [notificationPreferences, setNotificationPreferences] = useState(user?.notificationPreferences || {
    connectionUpdates: true,
    weeklyNewsletter: true,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setIsLoading(true);
    try {
      const updatedUser = await authService.updateProfile({ notificationPreferences });
      onUserUpdate(updatedUser);
      onOpenChange(false);
    } catch (error) {
      console.error('Error updating preferences:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (open && user) {
      setNotificationPreferences(user.notificationPreferences || {
        connectionUpdates: true,
        weeklyNewsletter: true,
      });
    }
  }, [open, user]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[100]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-sm shadow-lg w-full max-w-md z-[100] focus:outline-none">
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <Dialog.Title className="text-lg font-bold text-black">Preferences</Dialog.Title>
              <Dialog.Close className="p-1 rounded-sm hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <h3 className="text-sm font-medium text-gray-900 mb-3">Email Notifications</h3>
                <div className="space-y-2">
                  <label className="flex items-center justify-between p-3 border border-gray-200 rounded-sm cursor-pointer hover:bg-gray-50 transition-colors">
                    <div>
                      <p className="text-sm font-medium text-black">Connection Updates</p>
                      <p className="text-xs text-gray-500">Email when someone connects with you</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={notificationPreferences.connectionUpdates}
                      onChange={(e) => setNotificationPreferences(prev => ({ ...prev, connectionUpdates: e.target.checked }))}
                      className="w-4 h-4 accent-black"
                    />
                  </label>
                  <label className="flex items-center justify-between p-3 border border-gray-200 rounded-sm cursor-pointer hover:bg-gray-50 transition-colors">
                    <div>
                      <p className="text-sm font-medium text-black">Weekly Newsletter</p>
                      <p className="text-xs text-gray-500">Weekly summary of new connections</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={notificationPreferences.weeklyNewsletter}
                      onChange={(e) => setNotificationPreferences(prev => ({ ...prev, weeklyNewsletter: e.target.checked }))}
                      className="w-4 h-4 accent-black"
                    />
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>Cancel</Button>
                <Button type="submit" disabled={isLoading}>{isLoading ? 'Saving...' : 'Save'}</Button>
              </div>
            </form>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
