"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import OpportunityCard, { OpportunitySkeleton, parseOpportunityBlocks } from "./OpportunityCard";

function AssistantContent({ content }: { content: string }) {
  const segments = parseOpportunityBlocks(content);

  return (
    <article className="chat-markdown max-w-none">
      {segments.map((segment, idx) => {
        if (segment.type === "text") {
          return (
            <ReactMarkdown key={idx} remarkPlugins={[remarkGfm]}>
              {segment.content}
            </ReactMarkdown>
          );
        } else if (segment.type === "opportunity") {
          return (
            <div key={idx} className="my-3">
              <OpportunityCard card={segment.data} />
            </div>
          );
        } else if (segment.type === "opportunity_loading") {
          return (
            <div key={idx} className="my-3">
              <OpportunitySkeleton />
            </div>
          );
        }
        return null;
      })}
    </article>
  );
}

export function ConversationView({
  messages,
}: {
  messages: Array<{ role: string; content: string }>;
}) {
  return (
    <div className="space-y-4">
      {messages.map((msg, idx) => (
        <div
          key={idx}
          className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`max-w-[80%] rounded-sm px-3 py-2 ${
              msg.role === "user"
                ? "bg-[#041729] text-white"
                : "bg-gray-100 text-gray-900"
            }`}
          >
            {msg.role === "assistant" && (
              <span className="text-[10px] uppercase tracking-wider text-[#4091BB]/70 mb-1 block">
                Index
              </span>
            )}
            {msg.role === "assistant" ? (
              <AssistantContent content={msg.content} />
            ) : (
              <article className="chat-markdown max-w-none chat-markdown-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {msg.content}
                </ReactMarkdown>
              </article>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
