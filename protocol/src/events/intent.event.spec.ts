/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, it, expect, mock } from 'bun:test';
import { IntentEvents } from './intent.event';

describe('IntentEvents.onArchived', () => {
  it('expires opportunities by intent and deletes HyDE documents for the intent', async () => {
    const expireOpportunitiesByIntent = mock(async () => 1);
    const deleteHydeDocumentsForSource = mock(async () => 2);
    const database = {
      expireOpportunitiesByIntent,
      deleteHydeDocumentsForSource,
    };

    await IntentEvents.onArchived(
      { intentId: 'intent-archived-1', userId: 'user-1' },
      { database }
    );

    expect(expireOpportunitiesByIntent).toHaveBeenCalledTimes(1);
    expect(expireOpportunitiesByIntent).toHaveBeenCalledWith('intent-archived-1');
    expect(deleteHydeDocumentsForSource).toHaveBeenCalledTimes(1);
    expect(deleteHydeDocumentsForSource).toHaveBeenCalledWith(
      'intent',
      'intent-archived-1'
    );
  });
});
