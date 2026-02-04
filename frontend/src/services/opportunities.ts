/**
 * Opportunities service — fetches user's opportunities from GET /v2/opportunities.
 * Used to show "My opportunities" and link to chat with the other party.
 */

const V2_BASE = process.env.NEXT_PUBLIC_API_URL_V2 || '';

export interface OpportunityActor {
  role: string;
  identityId: string;
  intents?: string[];
  profile?: boolean;
}

export interface OpportunityInterpretation {
  summary?: string;
  category?: string;
  confidence?: number;
}

export interface V2Opportunity {
  id: string;
  indexId: string;
  status: 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired';
  actors: OpportunityActor[];
  interpretation?: OpportunityInterpretation;
  createdAt: string;
  updatedAt: string;
}

export interface OpportunitiesListResponse {
  opportunities: V2Opportunity[];
}

/**
 * Fetch opportunities for the current user.
 * Requires auth token (e.g. from usePrivy().getAccessToken()).
 */
export async function fetchMyOpportunities(accessToken: string, options?: { status?: string; limit?: number }): Promise<V2Opportunity[]> {
  const params = new URLSearchParams();
  if (options?.status) params.set('status', options.status);
  if (options?.limit != null) params.set('limit', String(options.limit));
  const qs = params.toString();
  const url = `${V2_BASE}/v2/opportunities${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Failed to load opportunities: ${res.status}`);
  }
  const data = (await res.json()) as OpportunitiesListResponse;
  return data.opportunities ?? [];
}

/**
 * Get the "other party" user id(s) for an opportunity from the current user's perspective.
 * Prefers actors with role 'party' (the person to connect with), excluding the introducer.
 */
export function getOtherPartyIds(opportunity: V2Opportunity, currentUserId: string): string[] {
  const parties = opportunity.actors.filter(
    (a) => a.identityId !== currentUserId && a.role === 'party'
  );
  return parties.map((a) => a.identityId);
}
