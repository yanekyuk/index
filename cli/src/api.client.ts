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
