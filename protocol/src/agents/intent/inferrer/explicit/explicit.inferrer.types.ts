import { UserMemoryProfile } from '../../manager/intent.manager.types';

export interface InferredIntent {
  type: 'goal' | 'tombstone';
  description: string; // "Learn Rust" or "Stop learning Rust"
  reasoning: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface IntentDetectorResponse {
  intents: InferredIntent[];
}

export interface IntentDetector {
  // Note: removed activeIntents from signature as Inferrer shouldn't know about state
  run(content: string, profile: UserMemoryProfile): Promise<IntentDetectorResponse>;
}
