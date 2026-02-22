export interface XmtpConversation {
  groupId: string;
  name: string | null;
  peerUserId: string | null;
  peerAvatar: string | null;
  lastMessage: { content: unknown; sentAt: string } | null;
  updatedAt: string | null;
}

export interface XmtpMessage {
  id: string;
  senderInboxId: string;
  content: unknown;
  sentAt: string;
}

export interface XmtpPeerInfo {
  walletAddress: string | null;
  xmtpInboxId: string | null;
}

export interface XmtpChatContext {
  groupId: string | null;
  opportunities: {
    opportunityId: string;
    headline: string;
    summary: string;
    peerName: string;
    peerAvatar: string | null;
    acceptedAt: string | null;
  }[];
}

export const createXmtpService = (api: {
  get: <T>(endpoint: string) => Promise<T>;
  post: <T>(endpoint: string, data?: unknown) => Promise<T>;
}) => ({
  getConversations: () =>
    api.get<{ conversations: XmtpConversation[] }>('/xmtp/conversations'),

  getChatContext: (peerUserId: string) =>
    api.get<XmtpChatContext>(`/xmtp/chat-context?peerUserId=${encodeURIComponent(peerUserId)}`),

  getMessages: (groupId: string, limit?: number) =>
    api.post<{ messages: XmtpMessage[] }>('/xmtp/messages', { groupId, limit }),

  sendMessage: (params: { groupId?: string; peerUserId?: string; text: string }) =>
    api.post<{ success: boolean; groupId: string }>('/xmtp/send', params),

  getPeerInfo: (userId: string) =>
    api.post<XmtpPeerInfo>('/xmtp/peer-info', { userId }),

  deleteConversation: (conversationId: string) =>
    api.post<{ success: boolean }>('/xmtp/conversations/delete', { conversationId }),
});
