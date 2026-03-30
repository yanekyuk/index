/**
 * HTTP client for the Index Network protocol API.
 *
 * All methods attach the stored Bearer token and handle
 * common error patterns (401, network errors).
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly token: string;

  /**
   * @param baseUrl - Protocol server base URL (e.g. `http://localhost:3001`).
   * @param token - Bearer JWT token for authentication.
   */
  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
  }

  /**
   * List all chat sessions for the authenticated user.
   *
   * @returns Array of session objects.
   * @throws Error on auth failure or network error.
   */
  async listSessions(): Promise<ChatSession[]> {
    const res = await this.get("/api/chat/sessions");
    const body = (await res.json()) as { sessions: ChatSession[] };
    return body.sessions;
  }

  /**
   * Get the currently authenticated user's profile.
   *
   * @returns The user object.
   * @throws Error on auth failure or network error.
   */
  async getMe(): Promise<UserProfile> {
    const res = await this.get("/api/auth/me");
    const body = (await res.json()) as { user: UserProfile };
    return body.user;
  }

  /**
   * Get a user by ID.
   *
   * @param userId - The user ID to look up.
   * @returns The user profile data.
   * @throws Error on auth failure or network error.
   */
  async getUser(userId: string): Promise<UserData> {
    const res = await this.get(`/api/users/${userId}`);
    const body = (await res.json()) as { user: UserData };
    return body.user;
  }

  /**
   * Trigger profile sync/regeneration for the authenticated user.
   *
   * @returns The sync result.
   * @throws Error on auth failure or network error.
   */
  async syncProfile(): Promise<SyncProfileResult> {
    const res = await this.post("/api/profiles/sync");
    const body = (await res.json()) as SyncProfileResult;
    return body;
  }

  /**
   * List opportunities for the authenticated user.
   *
   * @param opts - Optional filters (status, limit).
   * @returns Array of opportunity objects.
   * @throws Error on auth failure or network error.
   */
  async listOpportunities(opts?: OpportunityListOptions): Promise<Opportunity[]> {
    const params = new URLSearchParams();
    if (opts?.status) params.set("status", opts.status);
    if (opts?.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    const path = qs ? `/api/opportunities?${qs}` : "/api/opportunities";
    const res = await this.get(path);
    const body = (await res.json()) as { opportunities: Opportunity[] };
    return body.opportunities;
  }

  /**
   * Get a single opportunity with presentation details.
   *
   * @param id - Opportunity ID.
   * @returns Opportunity object with presentation.
   * @throws Error on auth failure, not found, or network error.
   */
  async getOpportunity(id: string): Promise<Opportunity> {
    const res = await this.get(`/api/opportunities/${id}`);
    return (await res.json()) as Opportunity;
  }

  /**
   * Update an opportunity's status (accept/reject).
   *
   * @param id - Opportunity ID.
   * @param status - New status value.
   * @returns Updated opportunity object.
   * @throws Error on auth failure or network error.
   */
  async updateOpportunityStatus(id: string, status: string): Promise<Opportunity> {
    const res = await this.patch(`/api/opportunities/${id}/status`, { status });
    return (await res.json()) as Opportunity;
  }

  /**
   * Open an SSE stream to the chat endpoint.
   *
   * Returns the raw Response so the caller can read the body
   * as a stream and parse SSE events incrementally.
   *
   * @param params - Stream parameters (message, optional sessionId).
   * @returns The raw fetch Response with SSE body.
   * @throws Error on auth failure or network error.
   */
  async streamChat(params: StreamChatParams): Promise<Response> {
    const res = await fetch(`${this.baseUrl}/api/chat/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        message: params.message,
        ...(params.sessionId ? { sessionId: params.sessionId } : {}),
      }),
    });

    if (!res.ok) {
      await this.handleError(res);
    }

    return res;
  }

  /**
   * List intents with optional pagination and filters.
   *
   * @param options - Optional filters: limit, archived, sourceType.
   * @returns Object with intents array and pagination metadata.
   * @throws Error on auth failure or network error.
   */
  async listIntents(options: ListIntentsOptions = {}): Promise<IntentListResult> {
    const body: Record<string, unknown> = {};
    if (options.limit !== undefined) body.limit = options.limit;
    if (options.archived !== undefined) body.archived = options.archived;
    if (options.sourceType !== undefined) body.sourceType = options.sourceType;
    if (options.page !== undefined) body.page = options.page;

    const res = await this.post("/api/intents/list", body);
    return (await res.json()) as IntentListResult;
  }

  /**
   * Get a single intent by ID.
   *
   * @param id - The intent ID.
   * @returns The intent object.
   * @throws Error on auth failure, not found, or network error.
   */
  async getIntent(id: string): Promise<Intent> {
    const res = await this.get(`/api/intents/${id}`);
    const body = (await res.json()) as { intent: Intent };
    return body.intent;
  }

  /**
   * Process natural language content through the intent graph.
   *
   * @param content - The natural language content to process.
   * @returns The processing result from the intent graph.
   * @throws Error on auth failure or network error.
   */
  async processIntent(content: string): Promise<Record<string, unknown>> {
    const res = await this.post("/api/intents/process", { content });
    return (await res.json()) as Record<string, unknown>;
  }

  /**
   * Archive an intent by ID.
   *
   * @param id - The intent ID to archive.
   * @returns Object with success boolean.
   * @throws Error on auth failure, not found, or network error.
   */
  async archiveIntent(id: string): Promise<{ success: boolean }> {
    const res = await this.patch(`/api/intents/${id}/archive`);
    return (await res.json()) as { success: boolean };
  }

  // ── Network methods ─────────────────────────────────────────────

  /**
   * List networks (indexes) the authenticated user is a member of.
   *
   * @returns Array of network objects.
   * @throws Error on auth failure or network error.
   */
  async listNetworks(): Promise<Network[]> {
    const res = await this.get("/api/indexes");
    const body = (await res.json()) as { indexes: Network[] };
    return body.indexes;
  }

  /**
   * Create a new network.
   *
   * @param title - The network title.
   * @param prompt - Optional description/prompt for the network.
   * @returns The created network object.
   * @throws Error on auth failure or network error.
   */
  async createNetwork(title: string, prompt?: string): Promise<Network> {
    const res = await this.post("/api/indexes", {
      title,
      ...(prompt ? { prompt } : {}),
    });
    const body = (await res.json()) as { index: Network };
    return body.index;
  }

  /**
   * Get a single network by ID with owner info and member count.
   *
   * @param id - The network ID.
   * @returns The network object.
   * @throws Error on auth failure or network error.
   */
  async getNetwork(id: string): Promise<Network> {
    const res = await this.get(`/api/indexes/${id}`);
    const body = (await res.json()) as { index: Network };
    return body.index;
  }

  /**
   * Get members of a network.
   *
   * @param id - The network ID.
   * @returns Array of member objects.
   * @throws Error on auth failure or network error.
   */
  async getNetworkMembers(id: string): Promise<NetworkMember[]> {
    const res = await this.get(`/api/indexes/${id}/members`);
    const body = (await res.json()) as { members: NetworkMember[] };
    return body.members;
  }

  /**
   * Join a public network.
   *
   * @param id - The network ID.
   * @returns The joined network object.
   * @throws Error on auth failure, forbidden, or network error.
   */
  async joinNetwork(id: string): Promise<Network> {
    const res = await this.post(`/api/indexes/${id}/join`, {});
    const body = (await res.json()) as { index: Network };
    return body.index;
  }

  /**
   * Leave a network.
   *
   * @param id - The network ID.
   * @throws Error on auth failure, forbidden (owner), or network error.
   */
  async leaveNetwork(id: string): Promise<void> {
    await this.post(`/api/indexes/${id}/leave`, {});
  }

  /**
   * Search users by query string, optionally filtering by index membership.
   *
   * @param query - Search query (email or name).
   * @param indexId - Optional network ID to exclude existing members.
   * @returns Array of matching user objects.
   * @throws Error on auth failure or network error.
   */
  async searchUsers(query: string, indexId?: string): Promise<SearchedUser[]> {
    const params = new URLSearchParams({ q: query });
    if (indexId) params.set("indexId", indexId);
    const res = await this.get(`/api/indexes/search-users?${params.toString()}`);
    const body = (await res.json()) as { users: SearchedUser[] };
    return body.users;
  }

  /**
   * Add a member to a network.
   *
   * @param networkId - The network ID.
   * @param userId - The user ID to add.
   * @returns Object with member info and message.
   * @throws Error on auth failure, forbidden, or network error.
   */
  async addNetworkMember(networkId: string, userId: string): Promise<AddMemberResult> {
    const res = await this.post(`/api/indexes/${networkId}/members`, { userId });
    const body = (await res.json()) as AddMemberResult;
    return body;
  }

  // ── Conversation methods ─────────────────────────────────────────

  /**
   * List all conversations for the authenticated user.
   *
   * @returns Array of conversation objects.
   * @throws Error on auth failure or network error.
   */
  async listConversations(): Promise<Conversation[]> {
    const res = await this.get("/api/conversations");
    const body = (await res.json()) as { conversations: Conversation[] };
    return body.conversations;
  }

  /**
   * Get or create a DM conversation with a peer user.
   *
   * @param peerUserId - The peer user's ID.
   * @returns The conversation object (existing or newly created).
   * @throws Error on auth failure or network error.
   */
  async getOrCreateDM(peerUserId: string): Promise<Conversation> {
    const res = await this.post("/api/conversations/dm", { peerUserId });
    const body = (await res.json()) as { conversation: Conversation };
    return body.conversation;
  }

  /**
   * Get messages for a conversation.
   *
   * @param conversationId - The conversation ID.
   * @param opts - Optional filters (limit, before cursor).
   * @returns Array of message objects.
   * @throws Error on auth failure or network error.
   */
  async getMessages(conversationId: string, opts?: { limit?: number; before?: string }): Promise<ConversationMessage[]> {
    const params = new URLSearchParams();
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.before) params.set("before", opts.before);
    const qs = params.toString();
    const path = qs
      ? `/api/conversations/${conversationId}/messages?${qs}`
      : `/api/conversations/${conversationId}/messages`;
    const res = await this.get(path);
    const body = (await res.json()) as { messages: ConversationMessage[] };
    return body.messages;
  }

  /**
   * Send a text message in a conversation.
   *
   * @param conversationId - The conversation ID.
   * @param text - The message text.
   * @returns The created message object.
   * @throws Error on auth failure or network error.
   */
  async sendMessage(conversationId: string, text: string): Promise<ConversationMessage> {
    const res = await this.post(`/api/conversations/${conversationId}/messages`, {
      parts: [{ type: "text", text }],
    });
    const body = (await res.json()) as { message: ConversationMessage };
    return body.message;
  }

  /**
   * Hide a conversation (soft-hide via hiddenAt).
   *
   * @param conversationId - The conversation ID.
   * @throws Error on auth failure or network error.
   */
  async hideConversation(conversationId: string): Promise<void> {
    await this.del(`/api/conversations/${conversationId}`);
  }

  /**
   * Open an SSE stream for real-time conversation events.
   *
   * Returns the raw Response so the caller can read the body
   * as a stream and parse SSE events incrementally.
   *
   * @returns The raw fetch Response with SSE body.
   * @throws Error on auth failure or network error.
   */
  async streamConversationEvents(): Promise<Response> {
    const res = await fetch(`${this.baseUrl}/api/conversations/stream`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "text/event-stream",
      },
    });

    if (!res.ok) {
      await this.handleError(res);
    }

    return res;
  }

  // ── Private helpers ──────────────────────────────────────────────

  private async get(path: string): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
    });

    if (!res.ok) {
      await this.handleError(res);
    }

    return res;
  }

  private async post(path: string, body?: unknown): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (!res.ok) {
      await this.handleError(res);
    }

    return res;
  }

  private async patch(path: string, body?: unknown): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (!res.ok) {
      await this.handleError(res);
    }

    return res;
  }

  private async del(path: string): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
    });

    if (!res.ok) {
      await this.handleError(res);
    }

    return res;
  }

  /**
   * Handle non-2xx responses with meaningful error messages.
   *
   * @throws Error with a descriptive message.
   */
  private async handleError(res: Response): Promise<never> {
    if (res.status === 401) {
      throw new Error(
        "Session expired or invalid. Run `index login` to re-authenticate.",
      );
    }

    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Response body was not JSON — use status text.
    }

    throw new Error(message);
  }
}

// ── Types ────────────────────────────────────────────────────────────

/** A chat session as returned by the API. */
export interface ChatSession {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt?: string;
}

/** User profile from GET /api/auth/me. */
export interface UserProfile {
  id: string;
  name: string;
  email: string;
}

/** Parameters for POST /api/chat/stream. */
export interface StreamChatParams {
  message: string;
  sessionId?: string;
}

/** Full user data from GET /api/users/:userId. */
export interface UserData {
  id: string;
  name: string | null;
  intro: string | null;
  avatar: string | null;
  location: string | null;
  socials: Record<string, string> | null;
  isGhost: boolean;
  createdAt: string;
  updatedAt: string | null;
}

/** Result from POST /api/profiles/sync. */
export interface SyncProfileResult {
  success: boolean;
  [key: string]: unknown;
}

/** An intent as returned by the API. */
export interface Intent {
  id: string;
  payload: string;
  summary: string | null;
  status: string;
  sourceType: string | null;
  confidence?: number;
  inferenceType?: string;
  intentMode?: string;
  speechActType?: string;
  semanticEntropy?: number;
  isIncognito?: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  indexes?: Array<{ id: string; title: string; relevancyScore?: number }>;
}

/** Options for listing intents. */
export interface ListIntentsOptions {
  page?: number;
  limit?: number;
  archived?: boolean;
  sourceType?: string;
}

/** Result from POST /api/intents/list. */
export interface IntentListResult {
  intents: Intent[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/** Options for listing opportunities. */
export interface OpportunityListOptions {
  status?: string;
  limit?: number;
}

/** An actor (party) in an opportunity. */
export interface OpportunityActor {
  userId: string;
  name?: string;
  role?: "agent" | "patient" | "peer";
  indexId?: string;
  intent?: string;
}

/** Interpretation (evaluation) of an opportunity. */
export interface OpportunityInterpretation {
  category?: string;
  reasoning?: string;
  confidence?: number;
  signals?: Array<{ type: string; weight: number; detail: string }>;
}

/** Detection provenance for an opportunity. */
export interface OpportunityDetection {
  source?: string;
  triggeredBy?: string;
  createdBy?: string;
  createdByName?: string;
  timestamp?: string;
}

/** An opportunity object as returned by the API. */
export interface Opportunity {
  id: string;
  status: string;
  actors?: OpportunityActor[];
  interpretation?: OpportunityInterpretation;
  detection?: OpportunityDetection;
  presentation?: string;
  counterpartName?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** A network (index) as returned by the API. */
export interface Network {
  id: string;
  title: string;
  prompt?: string | null;
  joinPolicy?: string;
  isPersonal?: boolean;
  memberCount?: number;
  createdAt?: string;
  owner?: { id: string; name: string; email: string };
  /** Role of the current user (from list endpoint). */
  role?: string;
}

/** A member of a network. */
export interface NetworkMember {
  userId: string;
  user: { id?: string; name: string; email: string; image?: string | null };
  permissions: string[];
  createdAt?: string;
}

/** A user returned from the search endpoint. */
export interface SearchedUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

/** Result of adding a member to a network. */
export interface AddMemberResult {
  member: { userId: string };
  message: string;
}

// ── Conversation types ──────────────────────────────────────────────

/** A participant in a conversation. */
export interface ConversationParticipant {
  participantId: string;
  participantType: "user" | "agent";
  user?: { name: string; email?: string };
}

/** A conversation as returned by the API. */
export interface Conversation {
  id: string;
  createdAt: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
  participants: ConversationParticipant[];
}

/** A message part (A2A-compatible). */
export interface MessagePart {
  type: string;
  text?: string;
  [key: string]: unknown;
}

/** A message in a conversation. */
export interface ConversationMessage {
  id: string;
  role: string;
  senderId?: string;
  parts: MessagePart[];
  createdAt: string;
  metadata?: Record<string, unknown>;
}
