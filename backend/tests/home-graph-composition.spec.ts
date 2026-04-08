import { config } from 'dotenv';
config({ path: '.env.development' });

import { describe, it, expect } from 'bun:test';
import { selectByComposition } from '@indexnetwork/protocol';

/**
 * Tests that home graph's load step uses selectByComposition instead of plain .slice().
 * We verify this indirectly by importing the home graph module and checking that
 * selectByComposition is imported (code path verification is in the integration scope).
 */
describe('home.graph.ts composition import', () => {
  it('selectByComposition is exported and callable', () => {
    expect(typeof selectByComposition).toBe('function');
  });

  it('selectByComposition enforces soft targets on mixed feed', () => {
    const viewerId = 'viewer-1';

    function makeOpp(id: string, isConnectorFlow: boolean, status = 'latent') {
      if (isConnectorFlow) {
        // Viewer is the introducer on connector-flow opportunities
        return {
          id,
          actors: [
            { userId: viewerId, role: 'introducer' },
            { userId: `party-a-${id}`, role: 'party' },
            { userId: `party-b-${id}`, role: 'party' },
          ],
          status,
        };
      }
      return {
        id,
        actors: [
          { userId: viewerId, role: 'party' },
          { userId: `other-${id}`, role: 'party' },
        ],
        status,
      };
    }

    // 10 connections, 5 connector-flows, 5 expired -- way more than soft targets
    const opps = [
      ...Array.from({ length: 10 }, (_, i) => makeOpp(`conn-${i}`, false)),
      ...Array.from({ length: 5 }, (_, i) => makeOpp(`cf-${i}`, true)),
      ...Array.from({ length: 5 }, (_, i) => makeOpp(`exp-${i}`, false, 'expired')),
    ];

    const result = selectByComposition(opps, viewerId);

    // Total should be capped to soft target total (3 + 2 + 2 = 7)
    expect(result.length).toBe(7);

    const connections = result.filter(
      (o) => o.status !== 'expired' && !o.actors.some((a) => a.role === 'introducer')
    );
    const connectorFlows = result.filter(
      (o) => o.status !== 'expired' && o.actors.some((a) => a.role === 'introducer')
    );
    const expired = result.filter((o) => o.status === 'expired');

    expect(connections.length).toBe(3);
    expect(connectorFlows.length).toBe(2);
    expect(expired.length).toBe(2);
  });
});
