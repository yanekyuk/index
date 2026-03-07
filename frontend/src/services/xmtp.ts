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

export interface ChatContextResponse {
  opportunities: {
    opportunityId: string;
    headline: string;
    personalizedSummary: string;
    narratorRemark: string;
    introducerName: string | null;
    peerName: string;
    peerAvatar: string | null;
    acceptedAt: string | null;
  }[];
}

export interface XmtpChatContext extends ChatContextResponse {
  groupId: string | null;
}

export const createXmtpService = (api: {
  get: <T>(endpoint: string) => Promise<T>;
  post: <T>(endpoint: string, data?: unknown) => Promise<T>;
}) => ({
  getConversations: () =>
    api.get<{ conversations: XmtpConversation[] }>('/xmtp/conversations'),

  getChatContext: (peerUserId: string) =>
    api.get<ChatContextResponse>(`/opportunities/chat-context?peerUserId=${encodeURIComponent(peerUserId)}`),

  getMessages: (groupId: string, limit?: number) =>
    api.post<{ messages: XmtpMessage[] }>('/xmtp/messages', { groupId, limit }),

  sendMessage: (params: { groupId?: string; peerUserId?: string; text: string }) =>
    api.post<{ success: boolean; groupId: string }>('/xmtp/send', params),

  getPeerInfo: (userId: string) =>
    api.post<XmtpPeerInfo>('/xmtp/peer-info', { userId }),

  findDm: (peerUserId: string) =>
    api.post<{ groupId: string | null }>('/xmtp/find-dm', { peerUserId }),

  deleteConversation: (conversationId: string) =>
    api.post<{ success: boolean }>('/xmtp/conversations/delete', { conversationId }),
});
