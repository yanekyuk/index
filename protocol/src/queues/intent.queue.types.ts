export const QUEUE_NAME = 'intent-processing-queue';

export interface IndexIntentJobData {
  intentId: string;
  indexId: string;
  userId: string;
}

export interface GenerateIntentsJobData {
  userId: string;
  sourceId: string;
  sourceType: 'file' | 'link' | 'integration' | 'discovery_form';
  content?: string;
  objects?: any[];
  indexId?: string;
  intentCount?: number;
  instruction?: string;
  createdAt?: number | Date;
}
