export interface Opportunity {
    type: 'collaboration' | 'mentorship' | 'networking' | 'other';
    title: string;
    description: string;
    score: number;
    candidateId: string;
}

export type RetrievalStrategy = 'direct' | 'hyde';
export interface OpportunityFinderOptions {
    strategy?: RetrievalStrategy;
    minScore?: number;
    limit?: number;
    hydeDescription?: string;
}

export interface CandidateProfile {
    userId: string;
    identity: {
        bio?: string;
        description?: string;
        [key: string]: any;
    };
    narrative?: {
        aspirations?: string;
        [key: string]: any;
    };
    attributes?: {
        interests?: string[];
        skills?: string[];
        [key: string]: any;
    };
}
