import { UserMemoryProfile, ActiveIntent } from '../manager/intent.manager.types';

export interface CreateIntentAction {
  type: 'create';
  payload: string;
}

export interface UpdateIntentAction {
  type: 'update';
  id: string;
  payload: string;
}

export interface ExpireIntentAction {
  type: 'expire';
  id: string;
  reason: string;
}

export type IntentAction = CreateIntentAction | UpdateIntentAction | ExpireIntentAction;

export interface IntentDetectorResponse {
  actions: IntentAction[];
}

export interface IntentDetector {
    run(content: string, profile: UserMemoryProfile, activeIntents: ActiveIntent[]): Promise<IntentDetectorResponse>;
}
