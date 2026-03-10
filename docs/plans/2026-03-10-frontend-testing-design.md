# Frontend Testing with Vitest + Playwright

**Date**: 2026-03-10
**Status**: Approved
**Goal**: Add testing infrastructure to the Vite + React Router frontend. Phase 1 focuses on migration verification — every route renders, navigation works, blog loads.

## Architecture

Two test layers:
1. **Vitest + React Testing Library** — Component/unit tests with `happy-dom`. Fast, runs without a browser.
2. **Playwright** — E2E smoke tests against the running Vite dev server. Validates real browser behavior.

## File Structure

```
frontend/
├── vitest.config.ts              # Vitest config (extends vite.config)
├── playwright.config.ts          # Playwright config
├── src/
│   └── test/
│       ├── setup.ts              # RTL cleanup, global mocks
│       └── test-utils.tsx        # renderWithProviders helper
├── tests/
│   ├── routes.test.tsx           # Every route renders without crash
│   ├── blog.test.ts              # Blog utility unit tests
│   └── e2e/
│       ├── navigation.spec.ts    # E2E: routes load, links navigate
│       └── blog.spec.ts          # E2E: blog listing + post render
```

## Scripts

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "playwright test",
  "test:e2e:ui": "playwright test --ui"
}
```

## Dependencies

- `vitest`, `happy-dom`, `@testing-library/react`, `@testing-library/jest-dom`
- `@playwright/test`

## Scope (Phase 1 — Migration Verification)

### Vitest (component/unit)
- Every route's page component renders without throwing
- React Router params are picked up correctly
- Blog utility: getAllPosts fetches JSON, getPostBySlug parses frontmatter
- Mock API calls and context providers via test wrapper

### Playwright (E2E)
- Home page loads
- Navigation between routes works
- Blog listing renders posts
- Blog post page renders content
- 404 page shows for bad routes
- No auth-dependent tests in phase 1
