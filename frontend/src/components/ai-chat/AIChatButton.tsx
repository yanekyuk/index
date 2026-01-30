'use client';

import { MessageCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAIChat } from '@/contexts/AIChatContext';

export function AIChatButton() {
  const { isOpen, setIsOpen } = useAIChat();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setIsOpen(!isOpen)}
      className="relative"
      title={isOpen ? 'Close AI Chat' : 'Open AI Chat'}
    >
      {isOpen ? (
        <X className="h-5 w-5" />
      ) : (
        <MessageCircle className="h-5 w-5" />
      )}
    </Button>
  );
}
