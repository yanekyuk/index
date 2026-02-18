"use client";

import { Bot } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface OpportunityCardData {
  opportunityId: string;
  userId: string;
  name?: string;
  avatar?: string | null;
  mainText: string;
  cta?: string;
  headline?: string;
  primaryActionLabel?: string;
  secondaryActionLabel?: string;
  mutualIntentsLabel?: string;
  narratorChip?: {
    name: string;
    text: string;
    avatar?: string | null;
    userId?: string;
  };
  viewerRole?: string;
  score?: number;
  status?: string;
}

export type MessageSegment =
  | { type: "text"; content: string }
  | { type: "opportunity"; data: OpportunityCardData }
  | { type: "opportunity_loading" };

export function parseOpportunityBlocks(content: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  const regex = /```opportunity\s*\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const textBefore = content.slice(lastIndex, match.index);
      if (textBefore.trim()) {
        segments.push({ type: "text", content: textBefore });
      }
    }

    try {
      const jsonStr = match[1].trim();
      const data = JSON.parse(jsonStr) as OpportunityCardData;
      if (data.opportunityId && data.userId) {
        segments.push({ type: "opportunity", data });
      } else {
        segments.push({ type: "text", content: match[0] });
      }
    } catch {
      segments.push({ type: "text", content: match[0] });
    }

    lastIndex = match.index + match[0].length;
  }

  const remainingContent = content.slice(lastIndex);
  const partialStartMatch = remainingContent.match(/```opportunity/);

  if (partialStartMatch) {
    const partialIndex = partialStartMatch.index!;
    const textBefore = remainingContent.slice(0, partialIndex);
    if (textBefore.trim()) {
      segments.push({ type: "text", content: textBefore });
    }
    segments.push({ type: "opportunity_loading" });
  } else if (lastIndex < content.length) {
    const remaining = content.slice(lastIndex);
    if (remaining.trim()) {
      segments.push({ type: "text", content: remaining });
    }
  }

  if (segments.length === 0 && content.trim()) {
    segments.push({ type: "text", content });
  }

  return segments;
}

function getInitials(name?: string): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function OpportunityCard({ card }: { card: OpportunityCardData }) {
  return (
    <div className="bg-[#F8F8F8] rounded-md p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-full bg-gray-300/80 flex items-center justify-center shrink-0 text-xs font-semibold text-gray-600">
          {getInitials(card.name)}
        </div>
        <div className="min-w-0">
          <h4 className="font-bold text-gray-900 text-sm">
            {card.name || "Someone"}
          </h4>
          <p className="text-[11px] text-[#3D3D3D]">
            {card.mutualIntentsLabel || "Potential connection"}
          </p>
        </div>
        {typeof card.score === "number" && card.score > 0 && (
          <span className="ml-auto text-xs text-gray-400 shrink-0">
            {Math.round(card.score * 100)}% match
          </span>
        )}
      </div>

      <div className="text-[14px] text-[#3D3D3D] leading-relaxed [&_a]:text-[#4091BB] [&_a]:underline [&_a]:underline-offset-1">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ),
          }}
        >
          {card.mainText}
        </ReactMarkdown>
      </div>

      {card.narratorChip && (
        <div className="mt-3">
          <div className="inline-flex items-center gap-2.5 px-3 py-1 bg-[#F0F0F0] rounded-md">
            <div className="relative shrink-0">
              {card.narratorChip.name === "Index" ? (
                <Bot className="w-7 h-7 text-[#3D3D3D]" />
              ) : (
                <div className="w-7 h-7 rounded-full bg-gray-300/80 flex items-center justify-center text-[10px] font-semibold text-gray-600">
                  {getInitials(card.narratorChip.name)}
                </div>
              )}
            </div>
            <span className="text-[13px] text-[#3D3D3D]">
              <span className="font-semibold">{card.narratorChip.name}:</span>{" "}
              {card.narratorChip.text}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
