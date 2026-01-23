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

/**
 * Represents a discovered opportunity between a source user and a candidate.
 * 
 * Contains two perspective-specific descriptions to prevent intent leak:
 * - `description`: Written for the SOURCE user ("You should meet X because...")
 * - `candidateDescription`: Written for the CANDIDATE ("You should meet Y because...")
 */
export interface Opportunity {
    type: 'collaboration' | 'mentorship' | 'networking' | 'other';
    title: string;
    /** Source-facing description: explains why the source should meet the candidate */
    description: string;
    /** Candidate-facing description: explains why the candidate should meet the source */
    candidateDescription: string;
    score: number;
    candidateId: string;
}
