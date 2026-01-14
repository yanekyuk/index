"use client";

import { forwardRef, useImperativeHandle, useRef, useState, useCallback, useEffect } from "react";
import { useAPI } from "@/contexts/APIContext";
import { usePrivy } from "@privy-io/react-auth";
import { useNotifications } from "@/contexts/NotificationContext";
import { validateFiles, getSupportedFileExtensions, formatFileSize, getFileCategoryBadge } from "@/lib/file-validation";
import { ArrowUp, X } from "lucide-react";

interface DiscoveryFormProps {
  onSubmit?: (intents: Array<{id: string; payload: string; summary?: string; createdAt: string}>) => void;
  floating?: boolean; // If true, renders as fixed floating at bottom; if false, renders inline
}

export interface DiscoveryFormRef {
  handleFileDrop: (files: FileList) => void;
  focus: () => void;
}

interface Attachment {
  id: string;
  file: File;
  preview?: string;
}

const DiscoveryForm = forwardRef<DiscoveryFormRef, DiscoveryFormProps>(({ onSubmit, floating = false }, ref) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const { discoverService } = useAPI();
  const { getAccessToken } = usePrivy();
  const { error } = useNotifications();
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlsRef = useRef<string[]>([]);

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    handleFileDrop: (files: FileList) => {
      handleFiles(Array.from(files));
    },
    focus: () => {
      inputRef.current?.focus();
    }
  }));

  const handleFiles = useCallback((files: File[]) => {
    // Validate combined file set
    const nextFiles = [...attachments.map(a => a.file), ...files];
    const validation = validateFiles(nextFiles, 'general');
    if (!validation.isValid) {
      error(validation.message || 'Invalid file');
      return;
    }

    const newAttachments: Attachment[] = files.map(file => {
      const id = `${Date.now()}-${Math.random()}`;
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      if (preview) {
        previewUrlsRef.current.push(preview);
      }
      return { id, file, preview };
    });

    setAttachments(prev => [...prev, ...newAttachments]);
    inputRef.current?.focus();
  }, [attachments, error]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFiles(Array.from(files));
      e.target.value = '';
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => {
      const attachment = prev.find(a => a.id === id);
      if (attachment?.preview) {
        URL.revokeObjectURL(attachment.preview);
        previewUrlsRef.current = previewUrlsRef.current.filter(url => url !== attachment.preview);
      }
      return prev.filter(a => a.id !== id);
    });
  };

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      previewUrlsRef.current.forEach(url => {
        URL.revokeObjectURL(url);
      });
      previewUrlsRef.current = [];
    };
  }, []);

  const handleSubmit = async () => {
    if (isProcessing || (!inputValue.trim() && attachments.length === 0)) return;
    
    const text = inputValue.trim();
    const files = attachments.map(a => a.file);
    
    // Clean up preview URLs
    attachments.forEach(attachment => {
      if (attachment.preview) {
        URL.revokeObjectURL(attachment.preview);
      }
    });
    previewUrlsRef.current = [];
    
    setInputValue("");
    setAttachments([]);
    setIsProcessing(true);
    
    try {
      // Submit discovery request with text and files
      const result = await discoverService.submitDiscoveryRequest(files, text || undefined)(getAccessToken);
      
      if (onSubmit && result.success) {
        onSubmit(result.intents);
      }
      
      if (!result.success) {
        error('Failed to generate intents. Please try again.');
      }
    } catch (err) {
      console.error('Discovery request failed:', err);
      error(err instanceof Error ? err.message : 'Failed to process discovery request');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFiles(Array.from(files));
    }
  };

  const formContent = (
    <>
      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div className="px-2 pt-2 pb-1 flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="group inline-flex items-center gap-2 bg-gray-100 border border-gray-300 rounded-sm px-2 py-1 hover:border-gray-400 transition-colors"
            >
              {attachment.preview ? (
                <img
                  src={attachment.preview}
                  alt={attachment.file.name}
                  className="w-4 h-4 object-cover rounded"
                />
              ) : (
                <div className="px-2 py-0.5 bg-gray-300 rounded flex items-center justify-center">
                  <span className="text-[8px] font-ibm-plex-mono text-gray-600 font-bold">
                    {getFileCategoryBadge(attachment.file.name)}
                  </span>
                </div>
              )}
              <span className="text-xs font-ibm-plex-mono text-gray-900">
                {attachment.file.name}
              </span>
              <button
                onClick={() => removeAttachment(attachment.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-600 hover:text-black"
                aria-label="Remove attachment"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="flex items-center px-4 py-2 min-h-[54px]">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept={getSupportedFileExtensions('general')}
          onChange={handleFileSelect}
        />
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder={floating ? "Ask a follow-up question...." : "What's your most important work?"}
          className="flex-1 font-ibm-plex-mono text-black text-lg focus:outline-none bg-transparent"
          disabled={isProcessing}
        />
        {isProcessing ? (
          <button
            onClick={() => setIsProcessing(false)}
            className="h-9 w-9 rounded-full bg-black text-white flex items-center justify-center hover:bg-gray-800 transition-colors cursor-pointer ml-2"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!inputValue.trim() && attachments.length === 0}
            className="h-9 w-9 rounded-full bg-black text-white flex items-center justify-center hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ml-2"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        )}
      </div>
    </>
  );

  const formClasses = floating
    ? "bg-white border border-gray-800 rounded-sm shadow-lg flex flex-col"
    : "w-full bg-white border border-gray-800 rounded-sm shadow-lg flex flex-col";

  const formElement = (
    <div className="space-y-4 mb-4 rounded-lg">
      <div 
        className={formClasses}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {formContent}
      </div>
    </div>
  );

  if (floating) {
    return (
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-full max-w-3xl z-[9999] px-4">
        {formElement}
      </div>
    );
  }

  return formElement;
});

DiscoveryForm.displayName = 'DiscoveryForm';

export default DiscoveryForm;
