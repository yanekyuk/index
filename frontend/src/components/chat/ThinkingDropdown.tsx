'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Brain } from 'lucide-react';

interface ThinkingStep {
  content: string;
  step?: string;
  timestamp: Date;
}

interface ThinkingDropdownProps {
  thinking: ThinkingStep[];
  isStreaming?: boolean;
}

export default function ThinkingDropdown({ thinking, isStreaming }: ThinkingDropdownProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!thinking || thinking.length === 0) {
    return null;
  }

  return (
    <div className="mb-2 border border-gray-200 rounded-sm overflow-hidden bg-gray-50">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-gray-100 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-gray-600" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-600" />
          )}
          <Brain className="w-4 h-4 text-purple-600" />
          <span className="text-sm font-medium text-gray-700 font-ibm-plex-mono">
            Thinking
            {isStreaming && (
              <span className="ml-2 inline-block w-1.5 h-1.5 bg-purple-600 rounded-full animate-pulse" />
            )}
          </span>
        </div>
        <span className="text-xs text-gray-500 font-ibm-plex-mono">
          {thinking.length} step{thinking.length !== 1 ? 's' : ''}
        </span>
      </button>
      
      {isExpanded && (
        <div className="px-3 pb-3 space-y-2 max-h-80 overflow-y-auto">
          {thinking.map((step, index) => (
            <div
              key={index}
              className="border-l-2 border-purple-300 pl-3 py-1"
            >
              {step.step && (
                <div className="text-xs font-semibold text-purple-700 uppercase tracking-wide mb-1 font-ibm-plex-mono">
                  {step.step.replace(/_/g, ' ')}
                </div>
              )}
              <p className="text-sm text-gray-700 whitespace-pre-wrap font-ibm-plex-mono">
                {step.content}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
