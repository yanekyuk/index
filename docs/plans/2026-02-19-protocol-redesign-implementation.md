# Protocol Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the Index Protocol server into an OAuth 2.0 Authorization Server with A2A agent interoperability, wrapping the existing LangGraph/LangChain core.

**Architecture:** The server becomes three entry points (OAuth, A2A, REST) converging at one JWT-based auth guard, backed by the same services/graphs. OAuth handles authorization (client registration, tokens, scopes). A2A handles agent discovery and messaging. REST stays for direct resource access.

**Tech Stack:** Bun runtime, Drizzle ORM, PostgreSQL + pgvector, `jose` (JWT), Google A2A protocol, existing LangGraph/LangChain core.

**Design doc:** `docs/plans/2026-02-19-protocol-redesign-design.md`

---

## Task 1: OAuth Schema — New Tables

**Files:**
- Create: `protocol/src/schemas/oauth.schema.ts`
- Test: `protocol/src/schemas/tests/oauth.schema.spec.ts`

**Step 1: Write the schema file**

Create `protocol/src/schemas/oauth.schema.ts` with five new tables:

```typescript
import { pgTable, pgEnum, text, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { users } from './database.schema';

export const clientTypeEnum = pgEnum('client_type', ['public', 'confidential']);

export const oauthClients = pgTable('oauth_clients', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  secretHash: text('secret_hash'),
  redirectUris: jsonb('redirect_uris').$type<string[]>().notNull().default([]),
  clientType: clientTypeEnum('client_type').notNull().default('confidential'),
  ownerId: text('owner_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const accessTokens = pgTable('access_tokens', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id),
  clientId: text('client_id').notNull().references(() => oauthClients.id),
  scopes: text('scopes').array().notNull().default([]),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const personalAccessTokens = pgTable('personal_access_tokens', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(),
  scopes: text('scopes').array().notNull().default([]),
  lastUsedAt: timestamp('last_used_at'),
  expiresAt: timestamp('expires_at'),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const authorizationCodes = pgTable('authorization_codes', {
  code: text('code').primaryKey(),
  clientId: text('client_id').notNull().references(() => oauthClients.id),
  userId: text('user_id').notNull().references(() => users.id),
  scopes: text('scopes').array().notNull().default([]),
  codeChallenge: text('code_challenge').notNull(),
  codeChallengeMethod: text('code_challenge_method').notNull().default('S256'),
  redirectUri: text('redirect_uri').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
});

export const a2aTasks = pgTable('a2a_tasks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  contextId: text('context_id').notNull(),
  userId: text('user_id').references(() => users.id),
  status: jsonb('status').notNull(),
  artifacts: jsonb('artifacts'),
  history: jsonb('history'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

**Step 2: Write the schema test**

Create `protocol/src/schemas/tests/oauth.schema.spec.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { oauthClients, accessTokens, personalAccessTokens, authorizationCodes, a2aTasks } from '../oauth.schema';
import { getTableName } from 'drizzle-orm';

describe('OAuth schema', () => {
  it('defines oauth_clients table', () => {
    expect(getTableName(oauthClients)).toBe('oauth_clients');
  });

  it('defines access_tokens table', () => {
    expect(getTableName(accessTokens)).toBe('access_tokens');
  });

  it('defines personal_access_tokens table', () => {
    expect(getTableName(personalAccessTokens)).toBe('personal_access_tokens');
  });

  it('defines authorization_codes table', () => {
    expect(getTableName(authorizationCodes)).toBe('authorization_codes');
  });

  it('defines a2a_tasks table', () => {
    expect(getTableName(a2aTasks)).toBe('a2a_tasks');
  });
});
```

**Step 3: Run test to verify it passes**

Run: `cd protocol && bun test src/schemas/tests/oauth.schema.spec.ts`
Expected: PASS — all 5 table definitions verified

**Step 4: Commit**

```bash
git add protocol/src/schemas/oauth.schema.ts protocol/src/schemas/tests/oauth.schema.spec.ts
git commit -m "feat(schema): add OAuth and A2A tables"
```

---

## Task 2: Schema Migration — Index Governance Fields

**Files:**
- Modify: `protocol/src/schemas/database.schema.ts` (lines 260-290)

**Step 1: Add governance fields to indexes and index_members**

In `protocol/src/schemas/database.schema.ts`, add the `accessModeEnum` near the other enums (around line 11):

```typescript
export const accessModeEnum = pgEnum('access_mode', ['open', 'request', 'invite']);
export const memberRoleEnum = pgEnum('member_role', ['member', 'admin']);
export const memberStatusEnum = pgEnum('member_status', ['active', 'pending', 'invited']);
```

Add to the `indexes` table (after the `permissions` column, around line 273):

```typescript
  accessMode: accessModeEnum('access_mode').notNull().default('open'),
```

Add to the `indexMembers` table (after `autoAssign`, around line 284):

```typescript
  role: memberRoleEnum('role').notNull().default('member'),
  status: memberStatusEnum('status').notNull().default('active'),
```

**Step 2: Generate and apply migration**

Run:
```bash
cd protocol && bun run db:generate
```
Expected: New migration file created in `protocol/drizzle/`

Run:
```bash
cd protocol && bun run db:migrate
```
Expected: Migration applied successfully

**Step 3: Commit**

```bash
git add protocol/src/schemas/database.schema.ts protocol/src/schemas/oauth.schema.ts protocol/drizzle/
git commit -m "feat(schema): add index governance fields and generate migration"
```

---

## Task 3: Install Dependencies

**Files:**
- Modify: `protocol/package.json`

**Step 1: Install jose for JWT operations**

Run:
```bash
cd protocol && bun add jose
```
Expected: `jose` added to dependencies

**Step 2: Commit**

```bash
git add protocol/package.json protocol/bun.lock
git commit -m "chore: add jose for JWT signing and verification"
```

---

## Task 4: Token Service — JWT Signing and Verification

**Files:**
- Create: `protocol/src/oauth/token.service.ts`
- Test: `protocol/src/oauth/tests/token.service.spec.ts`

**Step 1: Write the failing test**

Create `protocol/src/oauth/tests/token.service.spec.ts`:

```typescript
import { describe, expect, it, beforeAll } from 'bun:test';
import { TokenService } from '../token.service';

describe('TokenService', () => {
  let tokenService: TokenService;

  beforeAll(() => {
    tokenService = new TokenService('test-secret-key-at-least-32-chars-long!!');
  });

  describe('issueAccessToken', () => {
    it('returns a signed JWT string', async () => {
      const jwt = await tokenService.issueAccessToken({
        userId: 'user_123',
        clientId: 'client_456',
        scopes: ['user'],
      });
      expect(typeof jwt).toBe('string');
      expect(jwt.split('.')).toHaveLength(3);
    });

    it('includes correct claims when verified', async () => {
      const jwt = await tokenService.issueAccessToken({
        userId: 'user_123',
        clientId: 'client_456',
        scopes: ['user', 'index:abc'],
      });
      const payload = await tokenService.verifyToken(jwt);
      expect(payload.sub).toBe('user_123');
      expect(payload.client_id).toBe('client_456');
      expect(payload.scope).toBe('user index:abc');
    });
  });

  describe('verifyToken', () => {
    it('rejects an invalid token', async () => {
      await expect(tokenService.verifyToken('invalid.jwt.token')).rejects.toThrow();
    });

    it('rejects an expired token', async () => {
      const jwt = await tokenService.issueAccessToken({
        userId: 'user_123',
        clientId: 'client_456',
        scopes: ['user'],
        expiresInSeconds: -1,
      });
      await expect(tokenService.verifyToken(jwt)).rejects.toThrow();
    });
  });

  describe('issueRefreshToken', () => {
    it('returns a different token from access token', async () => {
      const access = await tokenService.issueAccessToken({
        userId: 'user_123',
        clientId: 'client_456',
        scopes: ['user'],
      });
      const refresh = await tokenService.issueRefreshToken({
        userId: 'user_123',
        clientId: 'client_456',
        scopes: ['user'],
      });
      expect(refresh).not.toBe(access);
    });
  });

  describe('hashToken', () => {
    it('produces a consistent hash for the same input', () => {
      const hash1 = TokenService.hashToken('some-token');
      const hash2 = TokenService.hashToken('some-token');
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different inputs', () => {
      const hash1 = TokenService.hashToken('token-a');
      const hash2 = TokenService.hashToken('token-b');
      expect(hash1).not.toBe(hash2);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd protocol && bun test src/oauth/tests/token.service.spec.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `protocol/src/oauth/token.service.ts`:

```typescript
import * as jose from 'jose';
import { createHash } from 'crypto';

export interface TokenPayload {
  sub: string;
  client_id: string;
  scope: string;
  jti: string;
  iss: string;
  [key: string]: unknown;
}

interface IssueTokenOptions {
  userId: string;
  clientId: string;
  scopes: string[];
  expiresInSeconds?: number;
}

export class TokenService {
  private secret: Uint8Array;
  private issuer: string;

  constructor(secret: string, issuer?: string) {
    this.secret = new TextEncoder().encode(secret);
    this.issuer = issuer || process.env.API_URL || 'http://localhost:3001';
  }

  async issueAccessToken(options: IssueTokenOptions): Promise<string> {
    const { userId, clientId, scopes, expiresInSeconds = 3600 } = options;
    const jti = crypto.randomUUID();

    return new jose.SignJWT({
      client_id: clientId,
      scope: scopes.join(' '),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
      .setJti(jti)
      .setIssuer(this.issuer)
      .sign(this.secret);
  }

  async issueRefreshToken(options: IssueTokenOptions): Promise<string> {
    const { userId, clientId, scopes, expiresInSeconds = 604800 } = options;
    const jti = crypto.randomUUID();

    return new jose.SignJWT({
      client_id: clientId,
      scope: scopes.join(' '),
      type: 'refresh',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
      .setJti(jti)
      .setIssuer(this.issuer)
      .sign(this.secret);
  }

  async verifyToken(token: string): Promise<TokenPayload> {
    const { payload } = await jose.jwtVerify(token, this.secret, {
      issuer: this.issuer,
    });
    return payload as unknown as TokenPayload;
  }

  static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd protocol && bun test src/oauth/tests/token.service.spec.ts`
Expected: PASS — all tests green

**Step 5: Commit**

```bash
git add protocol/src/oauth/token.service.ts protocol/src/oauth/tests/token.service.spec.ts
git commit -m "feat(oauth): add TokenService for JWT signing and verification"
```

---

## Task 5: Auth Guard — JWT Bearer Token Validation

**Files:**
- Modify: `protocol/src/guards/auth.guard.ts`
- Test: `protocol/src/guards/tests/auth.guard.spec.ts`

**Step 1: Write the failing test**

Create `protocol/src/guards/tests/auth.guard.spec.ts`:

```typescript
import { describe, expect, it, beforeAll } from 'bun:test';
import { TokenService } from '../../oauth/token.service';

// We test the guard logic directly — create a mock request with Bearer token
const SECRET = 'test-secret-key-at-least-32-chars-long!!';

describe('AuthGuard with JWT', () => {
  let tokenService: TokenService;

  beforeAll(() => {
    tokenService = new TokenService(SECRET, 'http://localhost:3001');
  });

  it('rejects requests without Authorization header', async () => {
    const req = new Request('http://localhost:3001/api/test');
    // Import dynamically to test fresh
    const { createAuthGuard } = await import('../auth.guard');
    const guard = createAuthGuard(tokenService);
    await expect(guard(req)).rejects.toThrow('Access token required');
  });

  it('rejects requests with invalid Bearer token', async () => {
    const req = new Request('http://localhost:3001/api/test', {
      headers: { Authorization: 'Bearer invalid-token' },
    });
    const { createAuthGuard } = await import('../auth.guard');
    const guard = createAuthGuard(tokenService);
    await expect(guard(req)).rejects.toThrow();
  });

  it('returns user with scopes for valid Bearer token', async () => {
    const token = await tokenService.issueAccessToken({
      userId: 'user_123',
      clientId: 'client_456',
      scopes: ['user'],
    });
    const req = new Request('http://localhost:3001/api/test', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { createAuthGuard } = await import('../auth.guard');
    const guard = createAuthGuard(tokenService);
    const result = await guard(req);
    expect(result.id).toBe('user_123');
    expect(result.scopes).toContain('user');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd protocol && bun test src/guards/tests/auth.guard.spec.ts`
Expected: FAIL — `createAuthGuard` not exported

**Step 3: Rewrite the auth guard**

Replace `protocol/src/guards/auth.guard.ts` with:

```typescript
import { TokenService, type TokenPayload } from '../oauth/token.service';

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  name: string;
  scopes: string[];
  clientId: string;
}

/**
 * Create an AuthGuard that validates JWT Bearer tokens.
 * Used in production with a singleton TokenService.
 * Testable by injecting a test TokenService.
 */
export function createAuthGuard(tokenService: TokenService) {
  return async (req: Request): Promise<AuthenticatedUser> => {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new Error('Access token required');
    }

    const token = authHeader.slice(7);
    let payload: TokenPayload;
    try {
      payload = await tokenService.verifyToken(token);
    } catch {
      throw new Error('Invalid or expired access token');
    }

    return {
      id: payload.sub,
      email: null,
      name: '',
      scopes: payload.scope ? payload.scope.split(' ') : [],
      clientId: payload.client_id,
    };
  };
}

// Singleton for production use — initialized lazily
let _guard: ReturnType<typeof createAuthGuard> | null = null;

export const AuthGuard = async (req: Request): Promise<AuthenticatedUser> => {
  if (!_guard) {
    const secret = process.env.OAUTH_SECRET || process.env.BETTER_AUTH_SECRET;
    if (!secret) throw new Error('OAUTH_SECRET environment variable required');
    const tokenService = new TokenService(secret);
    _guard = createAuthGuard(tokenService);
  }
  return _guard(req);
};
```

**Step 4: Run test to verify it passes**

Run: `cd protocol && bun test src/guards/tests/auth.guard.spec.ts`
Expected: PASS

**Step 5: Verify existing tests still compile**

Run: `cd protocol && bun test src/controllers/tests/auth.controller.spec.ts`
Expected: Existing controller tests may need `scopes` added to mock — check and fix if needed

**Step 6: Commit**

```bash
git add protocol/src/guards/auth.guard.ts protocol/src/guards/tests/auth.guard.spec.ts
git commit -m "feat(auth): rewrite AuthGuard for JWT Bearer token validation"
```

---

## Task 6: OAuth Controller — Client Registration

**Files:**
- Create: `protocol/src/oauth/oauth.controller.ts`
- Test: `protocol/src/oauth/tests/oauth.controller.spec.ts`

**Step 1: Write the failing test**

Create `protocol/src/oauth/tests/oauth.controller.spec.ts`:

```typescript
import { describe, expect, it, beforeAll, mock } from 'bun:test';
import { OAuthController } from '../oauth.controller';

// Mock DB operations
const mockDb = {
  insert: mock(() => ({ values: mock(() => ({ returning: mock(() => [{ id: 'client_123', name: 'Test', clientType: 'confidential' }]) })) })),
  select: mock(() => ({ from: mock(() => ({ where: mock(() => []) })) })),
};

describe('OAuthController', () => {
  let controller: OAuthController;

  beforeAll(() => {
    controller = new OAuthController();
  });

  describe('POST /oauth/register', () => {
    it('registers a new confidential client and returns client_id + client_secret', async () => {
      const req = new Request('http://localhost:3001/oauth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'My Agent',
          redirect_uris: ['http://localhost:3000/callback'],
          client_type: 'confidential',
        }),
      });

      const result = await controller.register(req);
      expect(result).toBeInstanceOf(Response);

      const body = await result.json();
      expect(body.client_id).toBeDefined();
      expect(body.client_secret).toBeDefined();
      expect(body.name).toBe('My Agent');
    });

    it('registers a public client without client_secret', async () => {
      const req = new Request('http://localhost:3001/oauth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Web App',
          redirect_uris: ['http://localhost:3000/callback'],
          client_type: 'public',
        }),
      });

      const result = await controller.register(req);
      const body = await result.json();
      expect(body.client_id).toBeDefined();
      expect(body.client_secret).toBeUndefined();
    });

    it('rejects registration without name', async () => {
      const req = new Request('http://localhost:3001/oauth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirect_uris: [] }),
      });

      const result = await controller.register(req);
      expect(result.status).toBe(400);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd protocol && bun test src/oauth/tests/oauth.controller.spec.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `protocol/src/oauth/oauth.controller.ts`:

```typescript
import { Controller, Post, Get } from '../lib/router/router.decorators';
import db from '../lib/drizzle/drizzle';
import { oauthClients, authorizationCodes, accessTokens } from '../schemas/oauth.schema';
import { TokenService } from './token.service';
import { eq, and, isNull } from 'drizzle-orm';
import { createHash, randomBytes } from 'crypto';

const tokenService = new TokenService(
  process.env.OAUTH_SECRET || process.env.BETTER_AUTH_SECRET || ''
);

@Controller('/oauth')
export class OAuthController {
  @Post('/register')
  async register(req: Request): Promise<Response> {
    const body = await req.json();
    const { name, redirect_uris, client_type } = body;

    if (!name) {
      return Response.json({ error: 'name is required' }, { status: 400 });
    }

    const clientId = crypto.randomUUID();
    let clientSecret: string | undefined;
    let secretHash: string | null = null;

    if (client_type !== 'public') {
      clientSecret = `idx_${randomBytes(32).toString('hex')}`;
      secretHash = createHash('sha256').update(clientSecret).digest('hex');
    }

    await db.insert(oauthClients).values({
      id: clientId,
      name,
      secretHash,
      redirectUris: redirect_uris || [],
      clientType: client_type || 'confidential',
    });

    const response: Record<string, unknown> = {
      client_id: clientId,
      name,
      client_type: client_type || 'confidential',
      redirect_uris: redirect_uris || [],
    };

    if (clientSecret) {
      response.client_secret = clientSecret;
    }

    return Response.json(response, { status: 201 });
  }

  @Post('/token')
  async token(req: Request): Promise<Response> {
    const body = await req.json();
    const { grant_type } = body;

    switch (grant_type) {
      case 'authorization_code':
        return this.handleAuthorizationCodeGrant(body);
      case 'refresh_token':
        return this.handleRefreshTokenGrant(body);
      case 'urn:ietf:params:oauth:grant-type:token-exchange':
        return this.handleTokenExchange(req, body);
      default:
        return Response.json({ error: 'unsupported_grant_type' }, { status: 400 });
    }
  }

  @Get('/authorize')
  async authorize(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const clientId = url.searchParams.get('client_id');
    const responseType = url.searchParams.get('response_type');
    const redirectUri = url.searchParams.get('redirect_uri');
    const codeChallenge = url.searchParams.get('code_challenge');
    const scope = url.searchParams.get('scope') || 'user';

    if (!clientId || responseType !== 'code' || !redirectUri || !codeChallenge) {
      return Response.json({ error: 'invalid_request' }, { status: 400 });
    }

    // Validate client exists
    const [client] = await db.select().from(oauthClients).where(eq(oauthClients.id, clientId));
    if (!client) {
      return Response.json({ error: 'invalid_client' }, { status: 400 });
    }

    // For now, return the authorize page info. The actual login flow
    // will be handled by Better Auth — this endpoint returns metadata
    // needed to render a login/consent UI.
    return Response.json({
      client_name: client.name,
      client_id: clientId,
      scope,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
    });
  }

  private async handleAuthorizationCodeGrant(body: Record<string, string>): Promise<Response> {
    const { code, code_verifier, client_id, redirect_uri } = body;

    if (!code || !code_verifier || !client_id) {
      return Response.json({ error: 'invalid_request' }, { status: 400 });
    }

    // Look up authorization code
    const [authCode] = await db.select().from(authorizationCodes)
      .where(and(
        eq(authorizationCodes.code, code),
        eq(authorizationCodes.clientId, client_id),
        isNull(authorizationCodes.usedAt),
      ));

    if (!authCode) {
      return Response.json({ error: 'invalid_grant' }, { status: 400 });
    }

    if (authCode.expiresAt < new Date()) {
      return Response.json({ error: 'invalid_grant', error_description: 'code expired' }, { status: 400 });
    }

    // Verify PKCE code_challenge
    const challengeFromVerifier = createHash('sha256')
      .update(code_verifier)
      .digest('base64url');

    if (challengeFromVerifier !== authCode.codeChallenge) {
      return Response.json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, { status: 400 });
    }

    // Mark code as used
    await db.update(authorizationCodes)
      .set({ usedAt: new Date() })
      .where(eq(authorizationCodes.code, code));

    // Issue tokens
    const scopes = authCode.scopes || ['user'];
    const accessToken = await tokenService.issueAccessToken({
      userId: authCode.userId,
      clientId: client_id,
      scopes,
    });
    const refreshToken = await tokenService.issueRefreshToken({
      userId: authCode.userId,
      clientId: client_id,
      scopes,
    });

    // Store access token hash for revocation
    await db.insert(accessTokens).values({
      userId: authCode.userId,
      clientId: client_id,
      scopes,
      tokenHash: TokenService.hashToken(accessToken),
      expiresAt: new Date(Date.now() + 3600 * 1000),
    });

    return Response.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: refreshToken,
      scope: scopes.join(' '),
    });
  }

  private async handleRefreshTokenGrant(body: Record<string, string>): Promise<Response> {
    const { refresh_token, client_id } = body;

    if (!refresh_token || !client_id) {
      return Response.json({ error: 'invalid_request' }, { status: 400 });
    }

    let payload;
    try {
      payload = await tokenService.verifyToken(refresh_token);
    } catch {
      return Response.json({ error: 'invalid_grant' }, { status: 400 });
    }

    if ((payload as any).type !== 'refresh') {
      return Response.json({ error: 'invalid_grant' }, { status: 400 });
    }

    const scopes = payload.scope ? payload.scope.split(' ') : ['user'];
    const accessToken = await tokenService.issueAccessToken({
      userId: payload.sub,
      clientId: client_id,
      scopes,
    });
    const newRefreshToken = await tokenService.issueRefreshToken({
      userId: payload.sub,
      clientId: client_id,
      scopes,
    });

    await db.insert(accessTokens).values({
      userId: payload.sub,
      clientId: client_id,
      scopes,
      tokenHash: TokenService.hashToken(accessToken),
      expiresAt: new Date(Date.now() + 3600 * 1000),
    });

    return Response.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: newRefreshToken,
      scope: scopes.join(' '),
    });
  }

  private async handleTokenExchange(req: Request, body: Record<string, string>): Promise<Response> {
    const { subject_token, scope } = body;

    if (!subject_token || !scope) {
      return Response.json({ error: 'invalid_request' }, { status: 400 });
    }

    // Verify the subject token
    let payload;
    try {
      payload = await tokenService.verifyToken(subject_token);
    } catch {
      return Response.json({ error: 'invalid_grant' }, { status: 400 });
    }

    // Parse requested scopes and validate index membership
    const requestedScopes = scope.split(' ');
    const existingScopes = payload.scope ? payload.scope.split(' ') : [];
    const allScopes = [...new Set([...existingScopes, ...requestedScopes])];

    // TODO: Validate index membership for index scopes
    // For each index:<id> scope, check the user is an active member

    const accessToken = await tokenService.issueAccessToken({
      userId: payload.sub,
      clientId: payload.client_id,
      scopes: allScopes,
    });

    await db.insert(accessTokens).values({
      userId: payload.sub,
      clientId: payload.client_id,
      scopes: allScopes,
      tokenHash: TokenService.hashToken(accessToken),
      expiresAt: new Date(Date.now() + 3600 * 1000),
    });

    return Response.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: allScopes.join(' '),
      issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd protocol && bun test src/oauth/tests/oauth.controller.spec.ts`
Expected: PASS (tests may need adjustment based on DB mock — integration test comes later)

**Step 5: Commit**

```bash
git add protocol/src/oauth/oauth.controller.ts protocol/src/oauth/tests/oauth.controller.spec.ts
git commit -m "feat(oauth): add OAuth controller with registration, token, and authorize endpoints"
```

---

## Task 7: PAT Controller — Personal Access Token Management

**Files:**
- Create: `protocol/src/oauth/pat.controller.ts`
- Test: `protocol/src/oauth/tests/pat.controller.spec.ts`

**Step 1: Write the failing test**

Create `protocol/src/oauth/tests/pat.controller.spec.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { PATController } from '../pat.controller';

describe('PATController', () => {
  const controller = new PATController();

  describe('POST /api/tokens', () => {
    it('rejects without auth', async () => {
      const req = new Request('http://localhost:3001/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My Bot', scopes: ['user'] }),
      });
      // Without user context, should fail — user is null
      const result = await controller.create(req, null as any);
      expect(result.status).toBe(400);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd protocol && bun test src/oauth/tests/pat.controller.spec.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `protocol/src/oauth/pat.controller.ts`:

```typescript
import { Controller, Post, Get, Delete, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import db from '../lib/drizzle/drizzle';
import { personalAccessTokens } from '../schemas/oauth.schema';
import { TokenService } from './token.service';
import { eq, and, isNull } from 'drizzle-orm';
import { randomBytes } from 'crypto';

@Controller('/tokens')
export class PATController {
  @Post('')
  @UseGuards(AuthGuard)
  async create(req: Request, user: AuthenticatedUser): Promise<Response> {
    if (!user?.id) {
      return Response.json({ error: 'Authentication required' }, { status: 400 });
    }

    const body = await req.json();
    const { name, scopes } = body;

    if (!name) {
      return Response.json({ error: 'name is required' }, { status: 400 });
    }

    const token = `idx_pat_${randomBytes(32).toString('hex')}`;
    const tokenHash = TokenService.hashToken(token);

    await db.insert(personalAccessTokens).values({
      userId: user.id,
      name,
      tokenHash,
      scopes: scopes || ['user'],
      expiresAt: body.expires_at ? new Date(body.expires_at) : null,
    });

    return Response.json({
      token,
      name,
      scopes: scopes || ['user'],
    }, { status: 201 });
  }

  @Get('')
  @UseGuards(AuthGuard)
  async list(req: Request, user: AuthenticatedUser): Promise<Response> {
    const tokens = await db.select({
      id: personalAccessTokens.id,
      name: personalAccessTokens.name,
      scopes: personalAccessTokens.scopes,
      lastUsedAt: personalAccessTokens.lastUsedAt,
      expiresAt: personalAccessTokens.expiresAt,
      createdAt: personalAccessTokens.createdAt,
    })
      .from(personalAccessTokens)
      .where(and(
        eq(personalAccessTokens.userId, user.id),
        isNull(personalAccessTokens.revokedAt),
      ));

    return Response.json({ tokens });
  }

  @Delete('/:id')
  @UseGuards(AuthGuard)
  async revoke(req: Request, user: AuthenticatedUser, params: { id: string }): Promise<Response> {
    await db.update(personalAccessTokens)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(personalAccessTokens.id, params.id),
        eq(personalAccessTokens.userId, user.id),
      ));

    return Response.json({ revoked: true });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd protocol && bun test src/oauth/tests/pat.controller.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add protocol/src/oauth/pat.controller.ts protocol/src/oauth/tests/pat.controller.spec.ts
git commit -m "feat(oauth): add PAT controller for personal access token management"
```

---

## Task 8: Mount OAuth in Main Server

**Files:**
- Modify: `protocol/src/main.ts`

**Step 1: Add OAuth controller imports and instances**

In `protocol/src/main.ts`, add imports after the existing controller imports (around line 13):

```typescript
import { OAuthController } from './oauth/oauth.controller';
import { PATController } from './oauth/pat.controller';
```

Add to controllerInstances (around line 69):

```typescript
controllerInstances.set(OAuthController, new OAuthController());
controllerInstances.set(PATController, new PATController());
```

Add AgentCard endpoint before the Better Auth routes block (around line 110):

```typescript
    // AgentCard discovery
    if (url.pathname === '/.well-known/agent.json') {
      const { agentCard } = await import('./a2a/agent-card');
      return Response.json(agentCard, { headers: corsHeaders });
    }
```

Note: The `OAuthController` is registered with `@Controller('/oauth')`, so its routes will be at `/api/oauth/*` via the global prefix. If you want `/oauth/*` without the prefix, add a special case before the controller loop similar to Better Auth routes. Decision: keep `/oauth/*` routes at that path by adding:

```typescript
    // OAuth routes (no /api prefix)
    if (url.pathname.startsWith('/oauth/')) {
      // Route to OAuthController manually — it uses /oauth prefix not /api/oauth
      // handled by the controller loop since OAuthController prefix is /oauth
    }
```

Actually, the cleanest approach: change the `OAuthController` decorator to `@Controller('/oauth')` and handle OAuth routes separately from the `/api` prefix in the controller loop. Update the controller route matching to skip `GLOBAL_PREFIX` for `/oauth` routes.

Alternatively, just use `@Controller('/oauth')` and route `/api/oauth/*` — simpler, no special cases.

**Step 2: Commit**

```bash
git add protocol/src/main.ts
git commit -m "feat: mount OAuth and PAT controllers in main server"
```

---

## Task 9: Index Governance — Service Layer

**Files:**
- Modify: `protocol/src/services/index.service.ts`
- Test: `protocol/src/services/tests/index.service.spec.ts`

**Step 1: Write the failing test**

Create `protocol/src/services/tests/index.service.spec.ts`:

```typescript
import { describe, expect, it, mock } from 'bun:test';

describe('IndexService governance', () => {
  // These are integration tests — they test that the service
  // methods exist and have the right signatures.
  // Full DB tests require a test database.

  it('should export IndexService with governance methods', async () => {
    const { IndexService } = await import('../index.service');
    const service = new IndexService();
    expect(typeof service.requestAccess).toBe('function');
    expect(typeof service.approveRequest).toBe('function');
    expect(typeof service.denyRequest).toBe('function');
    expect(typeof service.inviteMember).toBe('function');
    expect(typeof service.acceptInvite).toBe('function');
    expect(typeof service.grantAdmin).toBe('function');
    expect(typeof service.revokeAdmin).toBe('function');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd protocol && bun test src/services/tests/index.service.spec.ts`
Expected: FAIL — methods don't exist

**Step 3: Add governance methods to IndexService**

Add the following methods to `protocol/src/services/index.service.ts`:

```typescript
  async requestAccess(indexId: string, userId: string): Promise<{ status: string }> {
    return this.adapter.requestIndexAccess(indexId, userId);
  }

  async approveRequest(indexId: string, adminId: string, userId: string): Promise<{ status: string }> {
    return this.adapter.approveIndexRequest(indexId, adminId, userId);
  }

  async denyRequest(indexId: string, adminId: string, userId: string): Promise<{ status: string }> {
    return this.adapter.denyIndexRequest(indexId, adminId, userId);
  }

  async inviteMember(indexId: string, adminId: string, userId: string): Promise<{ status: string }> {
    return this.adapter.inviteIndexMember(indexId, adminId, userId);
  }

  async acceptInvite(indexId: string, userId: string): Promise<{ status: string }> {
    return this.adapter.acceptIndexInvite(indexId, userId);
  }

  async grantAdmin(indexId: string, adminId: string, userId: string): Promise<{ status: string }> {
    return this.adapter.grantIndexAdmin(indexId, adminId, userId);
  }

  async revokeAdmin(indexId: string, adminId: string, userId: string): Promise<{ status: string }> {
    return this.adapter.revokeIndexAdmin(indexId, adminId, userId);
  }
```

Note: The adapter methods need to be added to `ChatDatabaseAdapter` as well. Stub them first:

```typescript
  // In database.adapter.ts — add these stubs
  async requestIndexAccess(indexId: string, userId: string) { /* TODO */ }
  async approveIndexRequest(indexId: string, adminId: string, userId: string) { /* TODO */ }
  async denyIndexRequest(indexId: string, adminId: string, userId: string) { /* TODO */ }
  async inviteIndexMember(indexId: string, adminId: string, userId: string) { /* TODO */ }
  async acceptIndexInvite(indexId: string, userId: string) { /* TODO */ }
  async grantIndexAdmin(indexId: string, adminId: string, userId: string) { /* TODO */ }
  async revokeIndexAdmin(indexId: string, adminId: string, userId: string) { /* TODO */ }
```

**Step 4: Run test to verify it passes**

Run: `cd protocol && bun test src/services/tests/index.service.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add protocol/src/services/index.service.ts protocol/src/adapters/database.adapter.ts protocol/src/services/tests/index.service.spec.ts
git commit -m "feat(governance): add index governance methods to service and adapter"
```

---

## Task 10: Index Governance — Controller Endpoints

**Files:**
- Modify: `protocol/src/controllers/index.controller.ts`

**Step 1: Add governance endpoints to IndexController**

Add these methods to `protocol/src/controllers/index.controller.ts`:

```typescript
  @Post('/:id/request')
  @UseGuards(AuthGuard)
  async requestAccess(req: Request, user: AuthenticatedUser, params: { id: string }) {
    const result = await indexService.requestAccess(params.id, user.id);
    return Response.json(result);
  }

  @Post('/:id/approve/:userId')
  @UseGuards(AuthGuard)
  async approveRequest(req: Request, user: AuthenticatedUser, params: { id: string; userId: string }) {
    const result = await indexService.approveRequest(params.id, user.id, params.userId);
    return Response.json(result);
  }

  @Post('/:id/deny/:userId')
  @UseGuards(AuthGuard)
  async denyRequest(req: Request, user: AuthenticatedUser, params: { id: string; userId: string }) {
    const result = await indexService.denyRequest(params.id, user.id, params.userId);
    return Response.json(result);
  }

  @Post('/:id/invite')
  @UseGuards(AuthGuard)
  async invite(req: Request, user: AuthenticatedUser, params: { id: string }) {
    const body = await req.json();
    if (!body.user_id) return Response.json({ error: 'user_id required' }, { status: 400 });
    const result = await indexService.inviteMember(params.id, user.id, body.user_id);
    return Response.json(result);
  }

  @Post('/:id/accept')
  @UseGuards(AuthGuard)
  async acceptInvite(req: Request, user: AuthenticatedUser, params: { id: string }) {
    const result = await indexService.acceptInvite(params.id, user.id);
    return Response.json(result);
  }

  @Post('/:id/admin/grant')
  @UseGuards(AuthGuard)
  async grantAdmin(req: Request, user: AuthenticatedUser, params: { id: string }) {
    const body = await req.json();
    if (!body.user_id) return Response.json({ error: 'user_id required' }, { status: 400 });
    const result = await indexService.grantAdmin(params.id, user.id, body.user_id);
    return Response.json(result);
  }

  @Post('/:id/admin/revoke')
  @UseGuards(AuthGuard)
  async revokeAdmin(req: Request, user: AuthenticatedUser, params: { id: string }) {
    const body = await req.json();
    if (!body.user_id) return Response.json({ error: 'user_id required' }, { status: 400 });
    const result = await indexService.revokeAdmin(params.id, user.id, body.user_id);
    return Response.json(result);
  }
```

**Step 2: Commit**

```bash
git add protocol/src/controllers/index.controller.ts
git commit -m "feat(governance): add index governance endpoints"
```

---

## Task 11: A2A — AgentCard

**Files:**
- Create: `protocol/src/a2a/agent-card.ts`
- Test: `protocol/src/a2a/tests/agent-card.spec.ts`

**Step 1: Write the failing test**

Create `protocol/src/a2a/tests/agent-card.spec.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { agentCard } from '../agent-card';

describe('AgentCard', () => {
  it('has required fields', () => {
    expect(agentCard.name).toBeDefined();
    expect(agentCard.url).toBeDefined();
    expect(agentCard.version).toBeDefined();
    expect(agentCard.skills).toBeArray();
    expect(agentCard.skills.length).toBeGreaterThan(0);
  });

  it('declares OAuth2 authentication', () => {
    expect(agentCard.authentication.schemes).toContain('OAuth2');
  });

  it('includes all five skills', () => {
    const skillIds = agentCard.skills.map((s: any) => s.id);
    expect(skillIds).toContain('chat');
    expect(skillIds).toContain('intents');
    expect(skillIds).toContain('opportunities');
    expect(skillIds).toContain('indexes');
    expect(skillIds).toContain('profile');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd protocol && bun test src/a2a/tests/agent-card.spec.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `protocol/src/a2a/agent-card.ts`:

```typescript
const baseUrl = process.env.API_URL || 'http://localhost:3001';

export const agentCard = {
  name: 'Index Server',
  description: 'Intent-driven discovery protocol. Processes intents, discovers opportunities, manages profiles, and provides conversational AI.',
  url: baseUrl,
  version: '1.0.0',
  capabilities: { streaming: true, pushNotifications: false },
  authentication: {
    schemes: ['OAuth2'],
    credentials: {
      oauth2: {
        authorization_url: `${baseUrl}/oauth/authorize`,
        token_url: `${baseUrl}/oauth/token`,
        registration_url: `${baseUrl}/oauth/register`,
        scopes: {
          user: 'Full access to own data',
          'index:{id}': 'Access a specific index',
          'index:{id}:admin': 'Manage an index',
        },
      },
    },
  },
  skills: [
    {
      id: 'chat',
      name: 'Conversational Discovery',
      description: 'Multi-turn AI chat with intent discovery and opportunity presentation.',
      tags: ['chat', 'discovery', 'conversation'],
      examples: ['Find people interested in AI', 'Show my opportunities'],
    },
    {
      id: 'intents',
      name: 'Intent Management',
      description: 'Create, read, update, and archive intents.',
      tags: ['intents', 'crud'],
    },
    {
      id: 'opportunities',
      name: 'Opportunity Discovery',
      description: 'Find matching opportunities between users based on semantic intent matching.',
      tags: ['opportunities', 'matching'],
    },
    {
      id: 'indexes',
      name: 'Index Management',
      description: 'Join, leave, and manage index (community) memberships.',
      tags: ['indexes', 'communities'],
    },
    {
      id: 'profile',
      name: 'Profile Management',
      description: 'Read and update user profiles.',
      tags: ['profile'],
    },
  ],
  defaultInputModes: ['text/plain', 'application/json'],
  defaultOutputModes: ['text/plain', 'application/json'],
};
```

**Step 4: Run test to verify it passes**

Run: `cd protocol && bun test src/a2a/tests/agent-card.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add protocol/src/a2a/agent-card.ts protocol/src/a2a/tests/agent-card.spec.ts
git commit -m "feat(a2a): add AgentCard definition"
```

---

## Task 12: A2A — Task Store

**Files:**
- Create: `protocol/src/a2a/task-store.ts`
- Test: `protocol/src/a2a/tests/task-store.spec.ts`

**Step 1: Write the failing test**

Create `protocol/src/a2a/tests/task-store.spec.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { A2ATaskStore } from '../task-store';

describe('A2ATaskStore', () => {
  it('exports A2ATaskStore class', () => {
    expect(A2ATaskStore).toBeDefined();
    const store = new A2ATaskStore();
    expect(typeof store.create).toBe('function');
    expect(typeof store.get).toBe('function');
    expect(typeof store.update).toBe('function');
    expect(typeof store.list).toBe('function');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd protocol && bun test src/a2a/tests/task-store.spec.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `protocol/src/a2a/task-store.ts`:

```typescript
import db from '../lib/drizzle/drizzle';
import { a2aTasks } from '../schemas/oauth.schema';
import { eq, and } from 'drizzle-orm';

export interface A2ATask {
  id: string;
  contextId: string;
  userId: string | null;
  status: Record<string, unknown>;
  artifacts: unknown;
  history: unknown;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export class A2ATaskStore {
  async create(task: {
    contextId: string;
    userId?: string;
    status: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): Promise<A2ATask> {
    const [created] = await db.insert(a2aTasks).values({
      contextId: task.contextId,
      userId: task.userId || null,
      status: task.status,
      metadata: task.metadata || null,
    }).returning();
    return created as unknown as A2ATask;
  }

  async get(taskId: string): Promise<A2ATask | null> {
    const [task] = await db.select().from(a2aTasks).where(eq(a2aTasks.id, taskId));
    return (task as unknown as A2ATask) || null;
  }

  async update(taskId: string, updates: Partial<{
    status: Record<string, unknown>;
    artifacts: unknown;
    history: unknown;
    metadata: Record<string, unknown>;
  }>): Promise<A2ATask | null> {
    const [updated] = await db.update(a2aTasks)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(a2aTasks.id, taskId))
      .returning();
    return (updated as unknown as A2ATask) || null;
  }

  async list(userId: string): Promise<A2ATask[]> {
    const tasks = await db.select().from(a2aTasks).where(eq(a2aTasks.userId, userId));
    return tasks as unknown as A2ATask[];
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd protocol && bun test src/a2a/tests/task-store.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add protocol/src/a2a/task-store.ts protocol/src/a2a/tests/task-store.spec.ts
git commit -m "feat(a2a): add PostgreSQL-backed A2A TaskStore"
```

---

## Task 13: A2A — Executor

**Files:**
- Create: `protocol/src/a2a/executor.ts`
- Test: `protocol/src/a2a/tests/executor.spec.ts`

**Step 1: Write the failing test**

Create `protocol/src/a2a/tests/executor.spec.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import { A2AExecutor } from '../executor';

describe('A2AExecutor', () => {
  it('exports A2AExecutor class', () => {
    expect(A2AExecutor).toBeDefined();
  });

  it('routes text messages to chat skill by default', () => {
    const executor = new A2AExecutor();
    const skill = executor.resolveSkill({
      parts: [{ type: 'text', text: 'Hello, find me connections' }],
    });
    expect(skill).toBe('chat');
  });

  it('routes explicit skill requests from data parts', () => {
    const executor = new A2AExecutor();
    const skill = executor.resolveSkill({
      parts: [{ type: 'data', data: { skill: 'intents' } }],
    });
    expect(skill).toBe('intents');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd protocol && bun test src/a2a/tests/executor.spec.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `protocol/src/a2a/executor.ts`:

```typescript
import { A2ATaskStore } from './task-store';

interface MessagePart {
  type: string;
  text?: string;
  data?: Record<string, unknown>;
}

interface A2AMessage {
  parts: MessagePart[];
}

const VALID_SKILLS = ['chat', 'intents', 'opportunities', 'indexes', 'profile'] as const;
type SkillId = typeof VALID_SKILLS[number];

export class A2AExecutor {
  private taskStore: A2ATaskStore;

  constructor(taskStore?: A2ATaskStore) {
    this.taskStore = taskStore || new A2ATaskStore();
  }

  resolveSkill(message: A2AMessage): SkillId {
    // Check for explicit skill in data parts
    for (const part of message.parts) {
      if (part.type === 'data' && part.data?.skill) {
        const requested = part.data.skill as string;
        if (VALID_SKILLS.includes(requested as SkillId)) {
          return requested as SkillId;
        }
      }
    }
    // Default to chat for text messages
    return 'chat';
  }

  async execute(message: A2AMessage, userId: string, scopes: string[]): Promise<{
    taskId: string;
    status: string;
    result?: unknown;
  }> {
    const skill = this.resolveSkill(message);

    const task = await this.taskStore.create({
      contextId: crypto.randomUUID(),
      userId,
      status: { state: 'working', skill },
    });

    // Route to the appropriate service based on skill
    // This is a thin adapter — each skill maps to existing services
    try {
      const result = await this.routeToService(skill, message, userId, scopes);

      await this.taskStore.update(task.id, {
        status: { state: 'completed', skill },
        artifacts: result,
      });

      return { taskId: task.id, status: 'completed', result };
    } catch (error: any) {
      await this.taskStore.update(task.id, {
        status: { state: 'failed', skill, error: error.message },
      });

      return { taskId: task.id, status: 'failed' };
    }
  }

  private async routeToService(
    skill: SkillId,
    message: A2AMessage,
    userId: string,
    scopes: string[],
  ): Promise<unknown> {
    // Import services lazily to avoid circular dependencies
    switch (skill) {
      case 'chat':
        // TODO: Route to ChatGraphFactory
        return { message: 'Chat skill — not yet connected to service' };

      case 'intents':
        // TODO: Route to IntentService
        return { message: 'Intents skill — not yet connected to service' };

      case 'opportunities':
        // TODO: Route to OpportunityService
        return { message: 'Opportunities skill — not yet connected to service' };

      case 'indexes':
        // TODO: Route to IndexService
        return { message: 'Indexes skill — not yet connected to service' };

      case 'profile':
        // TODO: Route to ProfileService
        return { message: 'Profile skill — not yet connected to service' };

      default:
        throw new Error(`Unknown skill: ${skill}`);
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd protocol && bun test src/a2a/tests/executor.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add protocol/src/a2a/executor.ts protocol/src/a2a/tests/executor.spec.ts
git commit -m "feat(a2a): add A2A executor with skill routing"
```

---

## Task 14: Update AuthenticatedUser Interface

**Files:**
- Modify: All controllers that use `AuthenticatedUser`

The `AuthenticatedUser` interface now includes `scopes` and `clientId`. Existing controllers access `user.id`, `user.email`, `user.name` — these still work. But TypeScript may complain if any controller destructures the type.

**Step 1: Search for AuthenticatedUser usage**

Run: `grep -r "AuthenticatedUser" protocol/src/controllers/`
Check each file — if they import the type, ensure they handle the new fields gracefully.

**Step 2: Update imports if needed**

Most controllers just use `user.id` — no changes needed. If any controller explicitly types the parameter, ensure compatibility.

**Step 3: Commit (if changes needed)**

```bash
git add protocol/src/controllers/
git commit -m "refactor: update controllers for new AuthenticatedUser interface"
```

---

## Task 15: Frontend — OAuth Token Flow (Skeleton)

**Files:**
- Modify: `frontend/src/lib/auth-client.ts`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/contexts/AuthContext.tsx`

This task creates the skeleton for the frontend OAuth flow. The full implementation depends on building a login UI, but the token handling infrastructure goes in now.

**Step 1: Update auth-client.ts**

Replace `frontend/src/lib/auth-client.ts`:

```typescript
// OAuth 2.0 token-based auth client
const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/api\/?$/, '')
  || "http://localhost:3001";

const CLIENT_ID = process.env.NEXT_PUBLIC_OAUTH_CLIENT_ID || 'index-web';

// Token storage (in-memory — lost on page refresh, use refresh token to recover)
let accessToken: string | null = null;
let refreshToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setTokens(access: string, refresh: string) {
  accessToken = access;
  refreshToken = refresh;
}

export function clearTokens() {
  accessToken = null;
  refreshToken = null;
}

export async function refreshAccessToken(): Promise<string | null> {
  if (!refreshToken) return null;

  try {
    const res = await fetch(`${API_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      }),
    });

    if (!res.ok) {
      clearTokens();
      return null;
    }

    const data = await res.json();
    accessToken = data.access_token;
    refreshToken = data.refresh_token;
    return accessToken;
  } catch {
    clearTokens();
    return null;
  }
}

// Re-export for backward compatibility during migration
export const authClient = {
  useSession: () => ({
    data: accessToken ? { session: { token: accessToken } } : null,
    isPending: false,
    error: null,
  }),
};
```

**Step 2: Update api.ts to use Bearer tokens**

In `frontend/src/lib/api.ts`, update the `request` method to include the Authorization header. Find the `request` method and add:

```typescript
const token = getAccessToken();
if (token) {
  headers['Authorization'] = `Bearer ${token}`;
}
```

Add import at top:

```typescript
import { getAccessToken, refreshAccessToken } from './auth-client';
```

Add automatic token refresh on 401 responses.

**Step 3: Commit**

```bash
git add frontend/src/lib/auth-client.ts frontend/src/lib/api.ts
git commit -m "feat(frontend): add OAuth token-based auth client"
```

---

## Task 16: Environment Variables

**Files:**
- Modify: `protocol/.env.example` (or `.env.development`)

**Step 1: Add required env vars**

```bash
# OAuth 2.0
OAUTH_SECRET=your-secret-key-at-least-32-characters
```

Note: `OAUTH_SECRET` is used by the `TokenService` to sign JWTs. Can fall back to `BETTER_AUTH_SECRET` during migration.

**Step 2: Commit**

```bash
git add protocol/.env.example
git commit -m "chore: add OAUTH_SECRET to env example"
```

---

## Summary

| Task | Component | Type |
|------|-----------|------|
| 1 | OAuth schema (5 new tables) | Create |
| 2 | Index governance fields | Modify schema |
| 3 | Install jose | Dependency |
| 4 | TokenService (JWT) | Create |
| 5 | AuthGuard (JWT Bearer) | Rewrite |
| 6 | OAuthController (register, token, authorize) | Create |
| 7 | PATController (CRUD) | Create |
| 8 | Mount in main.ts | Modify |
| 9 | Index governance service | Modify |
| 10 | Index governance endpoints | Modify |
| 11 | AgentCard | Create |
| 12 | A2A TaskStore | Create |
| 13 | A2A Executor | Create |
| 14 | Update AuthenticatedUser across controllers | Modify |
| 15 | Frontend OAuth token flow | Modify |
| 16 | Environment variables | Config |

**Dependency order:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. Tasks 9-10 can parallel with 6-8. Tasks 11-13 can parallel with 9-10. Task 14 after 5. Task 15 after 8.
