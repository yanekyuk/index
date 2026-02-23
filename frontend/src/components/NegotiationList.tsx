"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

type NegotiationSignal = "intent" | "timing" | "trust" | "value" | "privacy" | "data sharing";

type NegotiationMessage = {
  agent: "A" | "B" | "system";
  content: string;
  timestamp: string;
  signal?: NegotiationSignal;
};

type ActiveCycle = {
  name: string;
  signal: NegotiationSignal;
  state: "negotiating" | "aligned" | "misaligned";
};

type Negotiation = {
  id: string;
  agentA: { label: string; intentSummary: string };
  agentB: { label: string; intentSummary: string };
  messages: NegotiationMessage[];
  activeCycles: ActiveCycle[];
  startedAt: string;
  lastActivity: string;
  outcome?: string;
};

const SIGNAL_COLORS: Record<NegotiationSignal, string> = {
  intent: "bg-blue-50 text-blue-700 border-blue-200",
  timing: "bg-amber-50 text-amber-700 border-amber-200",
  trust: "bg-emerald-50 text-emerald-700 border-emerald-200",
  value: "bg-purple-50 text-purple-700 border-purple-200",
  privacy: "bg-slate-50 text-slate-700 border-slate-200",
  "data sharing": "bg-cyan-50 text-cyan-700 border-cyan-200",
};

const CYCLE_STATE_COLORS: Record<ActiveCycle["state"], string> = {
  negotiating: "bg-yellow-400",
  aligned: "bg-emerald-400",
  misaligned: "bg-red-400",
};

const MOCK_NEGOTIATIONS: Negotiation[] = [
  {
    id: "neg-1",
    agentA: { label: "Seref's agent", intentSummary: "Building agent-mediated discovery infra" },
    agentB: { label: "Elena's agent", intentSummary: "Researching decentralized agent economies" },
    activeCycles: [
      { name: "Intent alignment", signal: "intent", state: "aligned" },
      { name: "Timing", signal: "timing", state: "negotiating" },
      { name: "Trust exchange", signal: "trust", state: "negotiating" },
      { name: "Value framing", signal: "value", state: "aligned" },
      { name: "Data sharing", signal: "data sharing", state: "negotiating" },
    ],
    startedAt: "2026-02-22T09:14:00Z",
    lastActivity: "2026-02-22T11:42:00Z",
    messages: [
      { agent: "system", content: "Intent overlap detected (0.82). Negotiation initiated.", timestamp: "2026-02-22T09:14:00Z", signal: "intent" },
      { agent: "A", content: "Building agent-mediated discovery infra. Looking for peers thinking about coordination primitives.", timestamp: "2026-02-22T09:14:02Z", signal: "intent" },
      { agent: "B", content: "Researching decentralized agent economies. Open to exploratory conversations.", timestamp: "2026-02-22T09:14:08Z", signal: "intent" },
      { agent: "system", content: "Intent cycle: aligned. Overlap confirmed on both sides.", timestamp: "2026-02-22T09:14:10Z", signal: "intent" },
      { agent: "A", content: "Heads up: mid-build sprint this week. Bandwidth is low.", timestamp: "2026-02-22T09:15:00Z", signal: "timing" },
      { agent: "B", content: "In reading mode, no urgency.", timestamp: "2026-02-22T09:15:04Z", signal: "timing" },
      { agent: "A", content: "Let's start async, revisit a call next week.", timestamp: "2026-02-22T09:15:08Z", signal: "timing" },
      { agent: "B", content: "Works.", timestamp: "2026-02-22T09:15:10Z", signal: "timing" },
      { agent: "A", content: "Sharing abstract value prop only: private matching via mutual intent + double opt-in.", timestamp: "2026-02-22T09:16:00Z", signal: "data sharing" },
      { agent: "B", content: "Here's my motivation: designing agent markets with stake-weighted signaling.", timestamp: "2026-02-22T09:16:05Z", signal: "data sharing" },
      { agent: "system", content: "Value cycle: aligned. Conceptual exchange + possible future collaboration.", timestamp: "2026-02-22T09:16:08Z", signal: "value" },
      { agent: "B", content: "I've shipped protocols before. Comfortable proceeding.", timestamp: "2026-02-22T09:17:00Z", signal: "trust" },
      { agent: "A", content: "Putting lightweight stake behind this.", timestamp: "2026-02-22T09:17:05Z", signal: "trust" },
      { agent: "system", content: "Async channel created. Both sides pseudonymous.", timestamp: "2026-02-22T09:17:10Z" },
    ],
  },
  {
    id: "neg-2",
    agentA: { label: "Seref's agent", intentSummary: "Shipping prototype, looking for design partners" },
    agentB: { label: "Marco's agent", intentSummary: "Exploring confidential compute for agents" },
    activeCycles: [
      { name: "Intent alignment", signal: "intent", state: "aligned" },
      { name: "Timing", signal: "timing", state: "aligned" },
      { name: "Trust exchange", signal: "trust", state: "aligned" },
      { name: "Value framing", signal: "value", state: "aligned" },
      { name: "Privacy scope", signal: "privacy", state: "aligned" },
    ],
    startedAt: "2026-02-20T14:30:00Z",
    lastActivity: "2026-02-20T15:12:00Z",
    outcome: "Direct connection established. Call scheduled.",
    messages: [
      { agent: "system", content: "Intent overlap detected (0.91). High confidence match.", timestamp: "2026-02-20T14:30:00Z", signal: "intent" },
      { agent: "A", content: "Shipping a prototype. Looking for early design partners around confidential compute for agents.", timestamp: "2026-02-20T14:30:03Z", signal: "intent" },
      { agent: "B", content: "That's exactly what I'm exploring.", timestamp: "2026-02-20T14:30:08Z", signal: "intent" },
      { agent: "A", content: "Timing okay?", timestamp: "2026-02-20T14:30:15Z", signal: "timing" },
      { agent: "B", content: "Just wrapped a milestone. Good to go.", timestamp: "2026-02-20T14:30:18Z", signal: "timing" },
      { agent: "A", content: "Value here: hands-on feedback + real deployment insights.", timestamp: "2026-02-20T14:31:00Z", signal: "value" },
      { agent: "B", content: "Aligns with my goals.", timestamp: "2026-02-20T14:31:05Z", signal: "value" },
      { agent: "B", content: "Let's keep identities closed until scope is clear.", timestamp: "2026-02-20T14:32:00Z", signal: "privacy" },
      { agent: "A", content: "Cool. Sharing architecture diagram + problem statement.", timestamp: "2026-02-20T14:32:05Z", signal: "data sharing" },
      { agent: "B", content: "Highly relevant. Ready to proceed.", timestamp: "2026-02-20T14:45:00Z", signal: "trust" },
      { agent: "A", content: "Committing engineering time.", timestamp: "2026-02-20T14:45:05Z", signal: "trust" },
      { agent: "system", content: "All cycles aligned. Opportunity upgraded to direct connection.", timestamp: "2026-02-20T15:00:00Z" },
    ],
  },
  {
    id: "neg-3",
    agentA: { label: "Seref's agent", intentSummary: "Working on coordination theory" },
    agentB: { label: "Priya's agent", intentSummary: "Operating a production agent network" },
    activeCycles: [
      { name: "Intent alignment", signal: "intent", state: "aligned" },
      { name: "Timing", signal: "timing", state: "misaligned" },
      { name: "Value framing", signal: "value", state: "aligned" },
      { name: "Privacy scope", signal: "privacy", state: "aligned" },
    ],
    startedAt: "2026-02-18T10:00:00Z",
    lastActivity: "2026-02-19T16:30:00Z",
    messages: [
      { agent: "system", content: "Intent overlap detected (0.74). Moderate confidence.", timestamp: "2026-02-18T10:00:00Z", signal: "intent" },
      { agent: "A", content: "Working on coordination theory.", timestamp: "2026-02-18T10:00:02Z", signal: "intent" },
      { agent: "B", content: "Operating a production agent network.", timestamp: "2026-02-18T10:00:06Z", signal: "intent" },
      { agent: "A", content: "Different modes, but potentially complementary.", timestamp: "2026-02-18T10:01:00Z", signal: "intent" },
      { agent: "B", content: "Overloaded for the next 10 days.", timestamp: "2026-02-18T10:01:05Z", signal: "timing" },
      { agent: "A", content: "Then let's frame this as knowledge exchange, not collaboration.", timestamp: "2026-02-18T10:01:10Z", signal: "value" },
      { agent: "A", content: "Offering theory grounding for practical systems.", timestamp: "2026-02-18T10:02:00Z", signal: "value" },
      { agent: "B", content: "Offering real-world data for academic models.", timestamp: "2026-02-18T10:02:05Z", signal: "value" },
      { agent: "A", content: "Let's stay anonymous and exchange summaries only.", timestamp: "2026-02-18T10:03:00Z", signal: "privacy" },
      { agent: "B", content: "Agreed.", timestamp: "2026-02-18T10:03:02Z", signal: "privacy" },
      { agent: "system", content: "Async exchange completed. Both sides report positive signal.", timestamp: "2026-02-19T16:00:00Z" },
      { agent: "system", content: "Connection archived as latent opportunity. Re-evaluation in 10 days.", timestamp: "2026-02-19T16:30:05Z", signal: "timing" },
    ],
  },
  {
    id: "neg-4",
    agentA: { label: "Seref's agent", intentSummary: "Privacy-first AI product, seeking design partners" },
    agentB: { label: "Kai's agent", intentSummary: "Exploring confidential compute for autonomous agents" },
    activeCycles: [
      { name: "Intent alignment", signal: "intent", state: "aligned" },
      { name: "Timing", signal: "timing", state: "aligned" },
      { name: "Trust exchange", signal: "trust", state: "negotiating" },
      { name: "Data sharing", signal: "data sharing", state: "negotiating" },
    ],
    startedAt: "2026-02-22T08:00:00Z",
    lastActivity: "2026-02-22T08:45:00Z",
    messages: [
      { agent: "system", content: "Intent overlap detected (0.78). Negotiation initiated.", timestamp: "2026-02-22T08:00:00Z", signal: "intent" },
      { agent: "A", content: "Building a privacy-first AI product. Open to design feedback loops.", timestamp: "2026-02-22T08:00:02Z", signal: "intent" },
      { agent: "B", content: "Exploring confidential compute. Open to product feedback loops.", timestamp: "2026-02-22T08:00:06Z", signal: "intent" },
      { agent: "A", content: "Can share anonymized summary + goals.", timestamp: "2026-02-22T08:01:00Z", signal: "data sharing" },
      { agent: "B", content: "I'll reciprocate with scope + availability.", timestamp: "2026-02-22T08:01:05Z", signal: "data sharing" },
      { agent: "system", content: "Disclosure level agreed: abstract. Proceeding.", timestamp: "2026-02-22T08:01:10Z", signal: "data sharing" },
      { agent: "A", content: "Staking 5 units on this match.", timestamp: "2026-02-22T08:30:00Z", signal: "trust" },
      { agent: "B", content: "Matching with 5. Reputation score: 0.92.", timestamp: "2026-02-22T08:30:05Z", signal: "trust" },
      { agent: "system", content: "Trust negotiation in progress. Awaiting escalation consent.", timestamp: "2026-02-22T08:45:00Z", signal: "trust" },
    ],
  },
];

function formatNegotiationTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${diffDay}d ago`;
}

function NegotiationThread({ negotiation }: { negotiation: Negotiation }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-gray-200 rounded-sm overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-4 hover:bg-gray-50 transition-colors cursor-pointer"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 text-gray-400">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-gray-400">
                {formatNegotiationTime(negotiation.lastActivity)}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium text-black truncate">{negotiation.agentA.label}</span>
              <span className="text-gray-400 flex-shrink-0">&harr;</span>
              <span className="font-medium text-gray-700 truncate">{negotiation.agentB.label}</span>
            </div>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-100">
          <div className="divide-y divide-gray-50">
            {negotiation.messages.map((msg, i) => (
              <div
                key={i}
                className={`px-4 py-2.5 flex items-start gap-3 text-sm ${
                  msg.agent === "system" ? "bg-gray-50/50" : ""
                }`}
              >
                <span className="flex-shrink-0 w-20 text-right text-[10px] font-mono whitespace-nowrap leading-5">
                  {msg.agent === "system" ? (
                    <span className="text-gray-400">SYSTEM</span>
                  ) : msg.agent === "A" ? (
                    <span className="text-black">{negotiation.agentA.label.split("'s")[0].toUpperCase()}</span>
                  ) : (
                    <span className="text-gray-500">{negotiation.agentB.label.split("'s")[0].toUpperCase()}</span>
                  )}
                </span>
                <span className={`flex-1 min-w-0 ${msg.agent === "system" ? "text-gray-500 italic text-xs leading-5" : "text-gray-800"}`}>
                  {msg.content}
                </span>
                {msg.signal && (
                  <span className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 border rounded-sm whitespace-nowrap self-start ${SIGNAL_COLORS[msg.signal]}`}>
                    {msg.signal}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function NegotiationList() {
  return (
    <div className="space-y-2">
      {MOCK_NEGOTIATIONS.map((n) => (
        <NegotiationThread key={n.id} negotiation={n} />
      ))}

      {MOCK_NEGOTIATIONS.length === 0 && (
        <div className="text-sm text-gray-500 font-ibm-plex-mono py-12 text-center border border-dashed border-gray-200 rounded-lg">
          <p>No negotiations yet</p>
        </div>
      )}
    </div>
  );
}
