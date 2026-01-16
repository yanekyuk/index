export interface StakeEvaluatorOutput {
  matches: {
    candidateIntentId: string;
    isMatch: boolean;
    confidence: number;
    reason: string;
  }[];
}
