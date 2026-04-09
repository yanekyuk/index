import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useConversation } from '@/contexts/ConversationContext';

interface NegotiationTurn {
  action: string;
  message?: string;
  assessment: {
    reasoning: string;
    suggestedRoles: { ownUser: string; otherUser: string };
  };
}

const ACTION_COLORS: Record<string, string> = {
  propose: 'bg-blue-100 text-blue-800',
  accept: 'bg-green-100 text-green-800',
  reject: 'bg-red-100 text-red-800',
  counter: 'bg-amber-100 text-amber-800',
};

export default function NegotiationDetailPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const { negotiations, messages, loadMessages } = useConversation();
  const [loading, setLoading] = useState(true);

  const conversation = negotiations.find((c) => c.id === conversationId);
  const conversationMessages = messages.get(conversationId!) ?? [];

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    loadMessages(conversationId, { limit: 100 }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [conversationId, loadMessages]);

  const participants = conversation?.participants ?? [];
  const participantNames = new Map(
    participants.map((p) => [p.participantId, p.name ?? p.participantId.replace('agent:', '')])
  );

  const turns: { senderId: string; senderName: string; turn: NegotiationTurn; createdAt: string }[] = conversationMessages
    .map((msg) => {
      const dataPart = (msg.parts as { kind?: string; data?: NegotiationTurn }[])?.find((p) => p.kind === 'data');
      if (!dataPart?.data) return null;
      return {
        senderId: msg.senderId,
        senderName: participantNames.get(msg.senderId) ?? msg.senderId,
        turn: dataPart.data,
        createdAt: msg.createdAt,
      };
    })
    .filter(Boolean) as { senderId: string; senderName: string; turn: NegotiationTurn; createdAt: string }[];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-3">
        <button onClick={() => navigate('/chat')} className="text-gray-500 hover:text-black transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h2 className="text-sm font-bold text-black font-ibm-plex-mono">Negotiation</h2>
          <p className="text-xs text-gray-500">
            {participants.map((p) => p.name ?? p.participantId.replace('agent:', '')).join(' vs ')}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : turns.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">No turns recorded</p>
        ) : (
          turns.map((entry, i) => (
            <div key={i} className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-black">{entry.senderName}</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ACTION_COLORS[entry.turn.action] ?? 'bg-gray-100 text-gray-700'}`}>
                    {entry.turn.action}
                  </span>
                </div>
                <span className="text-xs text-gray-400">
                  {new Date(entry.createdAt).toLocaleTimeString()}
                </span>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">{entry.turn.assessment.reasoning}</p>
              {entry.turn.message && (
                <p className="text-sm text-gray-500 mt-2 italic">"{entry.turn.message}"</p>
              )}
              <div className="flex gap-3 mt-2 text-xs text-gray-400">
                <span>Own: {entry.turn.assessment.suggestedRoles.ownUser}</span>
                <span>Other: {entry.turn.assessment.suggestedRoles.otherUser}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export const Component = NegotiationDetailPage;
