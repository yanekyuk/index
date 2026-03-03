# Elysia Migration Design

**Date**: 2026-03-03
**Status**: Approved
**Scope**: Protocol routing, Frontend framework, Evaluator framework

## Summary

Migrate the entire stack from Next.js (frontend/evaluator) and Bun.serve() + custom decorators (protocol) to an Elysia-based architecture with Eden Treaty for end-to-end type safety.

**Target stack**: Elysia (server) + Vite (bundler) + TanStack Router (client routing) + Eden Query (type-safe data fetching)

## Motivation

- Frontend and evaluator use Next.js as a pure SPA — no SSR, no RSC, no server actions, no streaming. 55 of 55 components are client-rendered via `"use client"`.
- Protocol already uses Bun; Elysia is Bun-native and enables Eden Treaty for end-to-end type-safe API calls.
- The hand-rolled `APIClient` + services layer can be replaced with auto-typed Eden Query hooks, eliminating an entire class of bugs.

## Architecture

### Current → Target

| Layer | Current | Target |
|-------|---------|--------|
| Protocol server | `Bun.serve()` + custom decorator routing | Elysia (plugins replace decorators) |
| Frontend server | Next.js 16 (barely used SSR features) | Elysia static file server + API proxy |
| Frontend bundler | Turbopack (Next.js) | Vite |
| Client routing | Next.js App Router (file-based) | TanStack Router (file-based via Vite plugin) |
| API client | Hand-rolled `APIClient` class + services/ | Eden Treaty + `@ap0nia/eden-react-query` |
| Data fetching | `useEffect` + fetch + setState | TanStack Query hooks via Eden Query |
| Blog | Next.js SSG (`generateStaticParams`) | Build script → static HTML served by Elysia |
| Evaluator | Next.js (same pattern as frontend) | Same as frontend target |

### Monorepo Structure

```
index/
├── protocol/          # Elysia server (exports type App)
├── frontend/          # Vite SPA + Elysia static server
├── evaluator/         # Vite SPA + Elysia static server
└── packages/
    └── api/           # Shared: exports Eden client typed to protocol's App
```

`packages/api` imports `type App` from protocol and exports a pre-configured Eden client. Both frontend and evaluator consume it.

## Phase 1: Protocol → Elysia

### Controller Pattern

Controllers keep class-based organization with Elysia chain registration for type inference.

**Before** (decorator-based):
```typescript
@Controller('/intents')
export class IntentController {
  @Post('/list')
  @UseGuards(AuthGuard)
  async list(req: Request, user: AuthenticatedUser) { ... }
}
```

**After** (class + Elysia chain):
```typescript
class IntentController {
  constructor(private intentService: IntentService) {}

  list({ user, body }) {
    return this.intentService.list(user, body);
  }

  getById({ user, params }) {
    return this.intentService.getById(params.id);
  }
}

const ctrl = new IntentController(intentService);

export const intentRoutes = new Elysia({ prefix: '/intents' })
  .use(authPlugin)
  .post('/list', (ctx) => ctrl.list(ctx), {
    body: t.Object({ /* ... */ }),
    response: t.Object({ /* ... */ })
  })
  .get('/:id', (ctx) => ctrl.getById(ctx), {
    params: t.Object({ id: t.String() })
  })
```

### Auth Plugin

`AuthGuard` becomes an Elysia plugin using `.derive()`:

```typescript
export const authPlugin = new Elysia({ name: 'auth' })
  .derive(async ({ request }) => {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new Error('Unauthorized');
    return { user: session.user };
  })
```

### main.ts

```typescript
import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'

const app = new Elysia()
  .use(cors({ origin: getAllowedOrigins() }))
  .get('/health', () => ({ status: 'ok' }))
  .mount('/dev/queues', adminQueuesApp.fetch)  // Bull Board (Hono)
  .mount('/api/auth', auth.handler)            // Better Auth
  .use(intentRoutes)
  .use(indexRoutes)
  .use(chatRoutes)
  .use(opportunityRoutes)
  .use(fileRoutes)
  .use(linkRoutes)
  .use(profileRoutes)
  .use(uploadRoutes)
  .use(userRoutes)
  .use(messagingRoutes)
  .listen(3001)

export type App = typeof app
```

### What Stays the Same

- Services layer (untouched)
- Adapters layer (untouched)
- Agents / LangGraph (untouched)
- Database schema (untouched)
- Queue system / BullMQ (untouched)
- All business logic (untouched)

Only the HTTP routing shell changes.

### Dependencies

**Add**: `elysia`, `@elysiajs/cors`, `@elysiajs/static`
**Remove**: Custom decorator system (`router.decorators.ts`, `RouteRegistry`)
**Keep**: `hono` (Bull Board adapter), `@bull-board/hono`

## Phase 2: Frontend → Vite + TanStack + Eden

### Project Structure

```
frontend/
├── src/
│   ├── routes/                    # TanStack Router file-based routes
│   │   ├── __root.tsx             # Root layout (providers, sidebar, header)
│   │   ├── index.tsx              # /
│   │   ├── blog/
│   │   │   ├── index.tsx          # /blog
│   │   │   └── $slug.tsx          # /blog/:slug
│   │   ├── u/
│   │   │   ├── $id.tsx            # /u/:id
│   │   │   └── $id/chat.tsx       # /u/:id/chat
│   │   ├── d/$id.tsx              # /d/:id
│   │   ├── index_/$indexId.tsx    # /index/:indexId
│   │   ├── l/$code.tsx            # /l/:code
│   │   ├── s/$token.tsx           # /s/:token
│   │   ├── library.tsx            # /library
│   │   ├── networks/
│   │   │   ├── index.tsx          # /networks
│   │   │   └── $id.tsx            # /networks/:id
│   │   ├── chat.tsx               # /chat
│   │   ├── profile.tsx            # /profile
│   │   ├── about.tsx              # /about
│   │   └── pages/
│   │       ├── privacy-policy.tsx
│   │       └── terms-of-use.tsx
│   ├── components/                # Same components (mostly unchanged)
│   ├── contexts/                  # Same contexts (drop Next.js-specific bits)
│   ├── lib/
│   │   ├── eden.ts                # Eden client (imports type App from protocol)
│   │   ├── auth-client.ts         # Better Auth (unchanged)
│   │   └── blog.ts                # Blog markdown utils
│   ├── services/                  # REMOVED — replaced by Eden Query hooks
│   ├── main.tsx                   # Vite entry point
│   └── index.html                 # SPA shell
├── server.ts                      # Elysia static file server + API proxy
├── vite.config.ts                 # Vite + TanStack Router plugin
├── scripts/
│   └── build-blog.ts              # Pre-build: markdown → static HTML
└── public/                        # Static assets (unchanged)
```

### Key Replacements

| Next.js Feature | Replacement |
|---|---|
| `useRouter()` (11 files) | `useNavigate()` from TanStack Router |
| `usePathname()` | `useLocation()` from TanStack Router |
| `useSearchParams()` | `useSearch()` from TanStack Router (type-safe) |
| `next/link` (6 files) | `<Link>` from TanStack Router |
| `next/image` (5 files) | `<img>` tag |
| `next/script` (1 file) | `<script>` in index.html |
| `NEXT_PUBLIC_*` env vars | `VITE_*` env vars |
| `useEffect` + fetch + setState | Eden Query `useQuery` / `useMutation` hooks |
| Service layer (`services/*.ts`) | Replaced by Eden Query |

### Data Fetching (Before → After)

**Before**:
```typescript
const [data, setData] = useState(null);
const [loading, setLoading] = useState(true);
useEffect(() => {
  api.get('/intents/list').then(setData).finally(() => setLoading(false));
}, []);
```

**After**:
```typescript
const { data, isLoading } = eden.api.intents.list.post.useQuery({ body: filters });
// Fully typed from protocol route definition
```

### Elysia Static Server (server.ts)

```typescript
import { Elysia } from 'elysia'
import { staticPlugin } from '@elysiajs/static'

const PROTOCOL_URL = process.env.PROTOCOL_URL || 'http://localhost:3001';

new Elysia()
  .use(staticPlugin({ assets: 'dist', prefix: '/' }))
  .all('/api/*', ({ request }) =>
    fetch(new URL(request.url.replace(/^.*\/api/, `${PROTOCOL_URL}/api`)))
  )
  .get('*', () => Bun.file('dist/index.html'))  // SPA fallback
  .listen(3000)
```

### Blog System

A `scripts/build-blog.ts` script runs at build time:
1. Reads `content/blog/*/index.md`
2. Renders to HTML with react-markdown
3. Outputs to `dist/blog/*.html`
4. Generates `dist/blog-index.json` manifest
5. Elysia serves these as static files

Client-side blog listing page fetches `blog-index.json`.

### Dependencies

**Add**: `vite`, `@vitejs/plugin-react`, `@tanstack/react-router`, `@tanstack/router-vite-plugin`, `@tanstack/react-query`, `@ap0nia/eden-react-query`, `@elysiajs/eden`
**Remove**: `next`, `eslint-config-next`
**Keep**: All UI libraries (Radix, Ant Design, Lucide, react-markdown, etc.), `better-auth`, `tailwindcss`

## Phase 3: Evaluator

Same migration pattern as frontend. Smaller scope (fewer pages, simpler app).

## Migration Order & Safety

Each phase is a separate branch/PR:

### Phase 1: Protocol (branch: `refactor/protocol-elysia`)
1. Add Elysia deps
2. Create `authPlugin` (replaces AuthGuard)
3. Convert 12 controllers: class methods + Elysia chain
4. Replace main.ts with Elysia app
5. Mount Better Auth + Bull Board
6. Export `type App`
7. Verify: all API tests pass, Bull Board works, auth works

### Phase 2: Frontend (branch: `refactor/frontend-elysia`)
1. Add Vite, TanStack Router, Eden Query deps
2. Create `packages/api` with typed Eden client
3. Convert 17 pages to TanStack Router routes
4. Replace Next.js hooks across ~24 files
5. Replace services with Eden Query hooks
6. Create blog build script
7. Create Elysia static server
8. Remove Next.js
9. Verify: all pages render, auth works, API calls typed, blog works

### Phase 3: Evaluator (branch: `refactor/evaluator-elysia`)
Same as Phase 2 but smaller scope.

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Eden Treaty type inference breaks with complex routes | Add schema validation (`body`, `response`) to every Elysia route |
| TanStack Router file-based routing differences | Use Vite plugin; route structure maps 1:1 from Next.js App Router |
| Blog SEO regression | Build script generates static HTML; same content, same URLs |
| Auth flow breaks | Better Auth is framework-agnostic; only the client-side session hook changes |
| Large PR size | Phased approach: each phase is independently shippable |
