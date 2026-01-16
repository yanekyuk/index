import { UserMemoryProfile } from '../intent/manager/intent.manager.types';

export interface OpportunityEvaluatorOptions {
    minScore?: number;
    hydeDescription: string; // REQUIRED for search phase
    existingOpportunities?: string;
}

export interface CandidateProfile {
    userId: string;
    identity: Partial<UserMemoryProfile['identity']>;
    narrative: Partial<UserMemoryProfile['narrative']>;
    attributes: Partial<UserMemoryProfile['attributes']>;
}

export interface Opportunity {
    type: 'collaboration' | 'mentorship' | 'networking' | 'other';
    title: string;
    description: string;
    score: number;
    candidateId: string;
}
