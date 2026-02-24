"use client";

import { useState } from "react";
import { Check, Lightbulb, X } from "lucide-react";

import { cn } from "@/lib/utils";

/** Format a speech act type for display (e.g. "DIRECTIVE" -> "Directive"). */
function formatSpeechActType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
}

/** Data shape for an intent proposal returned by the create_intent chat tool. */
export interface IntentProposalData {
  proposalId: string;
  description: string;
  indexId?: string;
  confidence?: number | null;
  speechActType?: string | null;
}

interface IntentProposalCardProps {
  card: IntentProposalData;
  onApprove?: (proposalId: string, description: string, indexId?: string) => void | Promise<void>;
  onReject?: (proposalId: string) => void | Promise<void>;
  currentStatus?: "pending" | "created" | "rejected";
}

/** Skeleton loader for intent proposal cards during streaming. */
export function IntentProposalSkeleton() {
  return (
    <div className="bg-[#F8F8F8] rounded-md p-4 animate-pulse">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-5 h-5 bg-gray-200 rounded-sm" />
        <div className="h-4 w-28 bg-gray-200 rounded-sm" />
      </div>
      <div className="space-y-2">
        <div className="h-4 w-full bg-gray-200 rounded-sm" />
        <div className="h-4 w-[60%] bg-gray-200 rounded-sm" />
      </div>
      <div className="mt-3 flex gap-1.5">
        <div className="h-7 w-28 bg-gray-200 rounded-sm" />
        <div className="h-7 w-14 bg-gray-200 rounded-sm" />
      </div>
    </div>
  );
}

/**
 * Interactive card for consent-based intent creation in chat.
 * Shows description, confidence, approve/reject buttons with in-place status transitions.
 */
export default function IntentProposalCard({
  card,
  onApprove,
  onReject,
  currentStatus,
}: IntentProposalCardProps) {
  const [actionTaken, setActionTaken] = useState<"created" | "rejected" | null>(null);
  const [pendingAction, setPendingAction] = useState<"approve" | "reject" | null>(null);
  const [actionError, setActionError] = useState(false);

  const effectiveStatus = currentStatus ?? (actionTaken ? actionTaken : "pending");
  const canTakeAction = effectiveStatus === "pending";
  const hasActions = !actionTaken && canTakeAction && (onApprove || onReject);

  const handleApprove = async () => {
    if (onApprove && !pendingAction) {
      setActionError(false);
      setPendingAction("approve");
      try {
        await onApprove(card.proposalId, card.description, card.indexId);
        setActionTaken("created");
      } catch {
        setActionError(true);
      } finally {
        setPendingAction(null);
      }
    }
  };

  const handleReject = async () => {
    if (onReject && !pendingAction) {
      setActionError(false);
      setPendingAction("reject");
      try {
        await onReject(card.proposalId);
        setActionTaken("rejected");
      } catch {
        setActionError(true);
      } finally {
        setPendingAction(null);
      }
    }
  };

  if (actionError) {
    return (
      <div className="bg-gray-50 rounded-lg p-4 my-2 text-center text-sm">
        <p className="text-red-600 mb-2">Something went wrong. Please try again.</p>
        <button
          type="button"
          onClick={() => setActionError(false)}
          className="text-[#041729] font-medium hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  const wrapperClass = cn(
    "rounded-md p-4",
    effectiveStatus === "rejected" ? "bg-gray-50 border border-gray-200" : "bg-[#F8F8F8]",
  );

  return (
    <div className={wrapperClass}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-amber-500 shrink-0" />
          <span className="text-xs font-semibold text-[#3D3D3D] uppercase tracking-wider">
            Proposed Intent
          </span>
        </div>
        {hasActions && (
          <div className="flex gap-1.5 shrink-0">
            {onApprove && (
              <button
                type="button"
                disabled={pendingAction !== null}
                aria-label={`Create intent: ${card.description}`}
                className="bg-[#041729] text-white px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-[#0a2d4a] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                onClick={handleApprove}
              >
                {pendingAction === "approve" ? "Creating..." : "Create Intent"}
              </button>
            )}
            {onReject && (
              <button
                type="button"
                disabled={pendingAction !== null}
                className="bg-transparent border border-gray-400 text-[#3D3D3D] px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-gray-200 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                onClick={handleReject}
              >
                {pendingAction === "reject" ? "Skipping..." : "Skip"}
              </button>
            )}
          </div>
        )}
        {effectiveStatus === "created" && (
          <span className="inline-flex items-center gap-1.5 text-green-600 text-xs font-semibold">
            <Check className="w-3.5 h-3.5 shrink-0" />
            Intent Created
          </span>
        )}
        {effectiveStatus === "rejected" && (
          <span className="inline-flex items-center gap-1 text-gray-400 text-xs font-medium">
            <X className="w-3 h-3" />
            Skipped
          </span>
        )}
      </div>

      {/* Description */}
      <p className={cn(
        "text-[14px] leading-relaxed",
        effectiveStatus === "rejected" ? "text-gray-400" : "text-[#3D3D3D]",
      )}>
        &ldquo;{card.description || "No description provided"}&rdquo;
      </p>

      {/* Metadata */}
      {(card.confidence != null || card.speechActType) && (
        <div className={cn(
          "mt-2 flex items-center gap-2 text-xs",
          effectiveStatus === "rejected" ? "text-gray-300" : "text-gray-400",
        )}>
          {card.confidence != null && (
            <span>Confidence: {Math.round(card.confidence * 100)}%</span>
          )}
          {card.confidence != null && card.speechActType && <span>&middot;</span>}
          {card.speechActType && (
            <span>{formatSpeechActType(card.speechActType)}</span>
          )}
        </div>
      )}
    </div>
  );
}
