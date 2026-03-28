/**
 * Compile-time structural alignment tests.
 *
 * Each adapter defines its own local types (no import from protocol interfaces).
 * These tests verify that local adapter types remain structurally assignable to
 * the canonical protocol interface contracts, catching drift at compile time.
 *
 * If a test fails to compile, it means an adapter's local type has diverged from
 * the protocol interface it must satisfy.
 */

import { describe, it, expect } from 'bun:test';

// ─────────────────────────────────────────────────────────────────────────────
// Protocol interface types (the canonical contracts)
// ─────────────────────────────────────────────────────────────────────────────
import type {
  Cache as ProtocolCache,
  CacheOptions as ProtocolCacheOptions,
} from '../../lib/protocol/interfaces/cache.interface';

import type {
  LensEmbedding as ProtocolLensEmbedding,
  HydeSearchOptions as ProtocolHydeSearchOptions,
  ProfileEmbeddingSearchOptions as ProtocolProfileEmbeddingSearchOptions,
  HydeCandidate as ProtocolHydeCandidate,
  VectorSearchResult as ProtocolVectorSearchResult,
  VectorStoreOption as ProtocolVectorStoreOption,
} from '../../lib/protocol/interfaces/embedder.interface';

import type {
  IntegrationAdapter as ProtocolIntegrationAdapter,
  IntegrationSession as ProtocolIntegrationSession,
  IntegrationSessionOptions as ProtocolIntegrationSessionOptions,
  ToolActionResponse as ProtocolToolActionResponse,
  IntegrationConnection as ProtocolIntegrationConnection,
} from '../../lib/protocol/interfaces/integration.interface';

import type {
  UserDatabase as ProtocolUserDatabase,
  SystemDatabase as ProtocolSystemDatabase,
} from '../../lib/protocol/interfaces/database.interface';

// ─────────────────────────────────────────────────────────────────────────────
// Adapter local types (the structurally-aligned copies)
// ─────────────────────────────────────────────────────────────────────────────
import type {
  Cache as AdapterCache,
  CacheOptions as AdapterCacheOptions,
} from '../cache.adapter';

import type {
  LensEmbedding as AdapterLensEmbedding,
  ProfileEmbeddingSearchOptions as AdapterProfileEmbeddingSearchOptions,
  HydeSearchOptions as AdapterHydeSearchOptions,
  HydeCandidate as AdapterHydeCandidate,
  VectorSearchResult as AdapterVectorSearchResult,
  VectorStoreOption as AdapterVectorStoreOption,
} from '../embedder.adapter';

import type {
  IntegrationAdapter as AdapterIntegrationAdapter,
  IntegrationSession as AdapterIntegrationSession,
  IntegrationSessionOptions as AdapterIntegrationSessionOptions,
  ToolActionResponse as AdapterToolActionResponse,
  IntegrationConnection as AdapterIntegrationConnection,
} from '../integration.adapter';

import {
  createUserDatabase,
  createSystemDatabase,
  ChatDatabaseAdapter,
} from '../database.adapter';

// ─────────────────────────────────────────────────────────────────────────────
// Compile-time assignability helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assert that A is assignable to B at compile time.
 * If the adapter type is not structurally compatible with the protocol type,
 * TypeScript will emit a compile error here.
 */
function assertAssignable<_Target>() {
  return <T extends _Target>() => {};
}

// ═══════════════════════════════════════════════════════════════════════════════
// CACHE ADAPTER ALIGNMENT
// ═══════════════════════════════════════════════════════════════════════════════

describe('Cache adapter ↔ protocol interface alignment', () => {
  it('CacheOptions is assignable to protocol CacheOptions', () => {
    // Compile-time check: adapter type → protocol type
    const check: (_: AdapterCacheOptions) => ProtocolCacheOptions = (v) => v;
    expect(check).toBeDefined();
  });

  it('Cache is assignable to protocol Cache', () => {
    const check: (_: AdapterCache) => ProtocolCache = (v) => v;
    expect(check).toBeDefined();
  });

  it('protocol Cache is assignable to adapter Cache (bidirectional)', () => {
    const check: (_: ProtocolCache) => AdapterCache = (v) => v;
    expect(check).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EMBEDDER ADAPTER ALIGNMENT
// ═══════════════════════════════════════════════════════════════════════════════

describe('Embedder adapter ↔ protocol interface alignment', () => {
  it('LensEmbedding is assignable to protocol LensEmbedding', () => {
    const check: (_: AdapterLensEmbedding) => ProtocolLensEmbedding = (v) => v;
    expect(check).toBeDefined();
  });

  it('protocol LensEmbedding is assignable to adapter LensEmbedding', () => {
    const check: (_: ProtocolLensEmbedding) => AdapterLensEmbedding = (v) => v;
    expect(check).toBeDefined();
  });

  it('HydeSearchOptions is assignable to protocol HydeSearchOptions', () => {
    const check: (_: AdapterHydeSearchOptions) => ProtocolHydeSearchOptions = (v) => v;
    expect(check).toBeDefined();
  });

  it('ProfileEmbeddingSearchOptions is assignable to protocol ProfileEmbeddingSearchOptions', () => {
    const check: (_: AdapterProfileEmbeddingSearchOptions) => ProtocolProfileEmbeddingSearchOptions = (v) => v;
    expect(check).toBeDefined();
  });

  it('HydeCandidate is assignable to protocol HydeCandidate', () => {
    const check: (_: AdapterHydeCandidate) => ProtocolHydeCandidate = (v) => v;
    expect(check).toBeDefined();
  });

  it('VectorSearchResult is assignable to protocol VectorSearchResult', () => {
    const check: (_: AdapterVectorSearchResult<unknown>) => ProtocolVectorSearchResult<unknown> = (v) => v;
    expect(check).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRATION ADAPTER ALIGNMENT
// ═══════════════════════════════════════════════════════════════════════════════

describe('Integration adapter ↔ protocol interface alignment', () => {
  it('IntegrationSession is assignable to protocol IntegrationSession', () => {
    const check: (_: AdapterIntegrationSession) => ProtocolIntegrationSession = (v) => v;
    expect(check).toBeDefined();
  });

  it('IntegrationSessionOptions is assignable to protocol IntegrationSessionOptions', () => {
    const check: (_: AdapterIntegrationSessionOptions) => ProtocolIntegrationSessionOptions = (v) => v;
    expect(check).toBeDefined();
  });

  it('ToolActionResponse is assignable to protocol ToolActionResponse', () => {
    const check: (_: AdapterToolActionResponse) => ProtocolToolActionResponse = (v) => v;
    expect(check).toBeDefined();
  });

  it('IntegrationConnection is assignable to protocol IntegrationConnection', () => {
    const check: (_: AdapterIntegrationConnection) => ProtocolIntegrationConnection = (v) => v;
    expect(check).toBeDefined();
  });

  it('IntegrationAdapter is assignable to protocol IntegrationAdapter', () => {
    const check: (_: AdapterIntegrationAdapter) => ProtocolIntegrationAdapter = (v) => v;
    expect(check).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DATABASE ADAPTER ALIGNMENT (factory return types)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Database adapter ↔ protocol interface alignment', () => {
  it('createUserDatabase return type is assignable to protocol UserDatabase', () => {
    // We only need the type — no runtime call.
    type UserDbReturn = ReturnType<typeof createUserDatabase>;
    const check: (_: UserDbReturn) => ProtocolUserDatabase = (v) => v;
    expect(check).toBeDefined();
  });

  it('createSystemDatabase return type is assignable to protocol SystemDatabase', () => {
    type SystemDbReturn = ReturnType<typeof createSystemDatabase>;
    const check: (_: SystemDbReturn) => ProtocolSystemDatabase = (v) => v;
    expect(check).toBeDefined();
  });
});
