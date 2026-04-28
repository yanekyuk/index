# OpenClaw plugin presentation & NPM publishing — design

**Date:** 2026-04-28
**Status:** Ready for implementation planning
**Driver:** ClawHub submission. The plugin currently installs from a GitHub marketplace URL and ships under an unscoped `indexnetwork-openclaw-plugin` name. ClawHub-grade presentation needs a real NPM package, a coherent naming theme, and a marketing-first README.

## Goals

1. Publish the plugin to NPM as `@indexnetwork/openclaw-plugin` via CI, mirroring the existing `@indexnetwork/protocol` flow (dev → `rc` prerelease, main → stable).
2. Tighten the user-facing naming surface to the brand identity "Index" — short CLI subcommand, short MCP server key — without claiming the generic `index` plugin ID on ClawHub.
3. Restructure the README as a single-file marketplace landing: marketing-first top, condensed reference below. No icon, no screenshots, no demo for v1.

## Non-goals

- ClawHub-specific listing fields. Submission requirements aren't yet known; we're designing against a generic plugin-marketplace shape and will adjust to ClawHub's actual fields when we have them.
- Visual assets (icon, screenshots, animated demo). Deferred.
- Runtime behavior changes. The plugin's polling, dispatch, and negotiation flows are untouched.

## Naming theme

User-visible surface after the rename:

```bash
# Install — typed once
openclaw plugins install @indexnetwork/openclaw-plugin

# Setup — typed once after install
openclaw index setup

# Update — periodic
openclaw plugins update @indexnetwork/openclaw-plugin
```

| Surface | Today | After |
|---|---|---|
| NPM package | `indexnetwork-openclaw-plugin` | `@indexnetwork/openclaw-plugin` |
| Plugin ID (`openclaw.plugin.json`) | `indexnetwork-openclaw-plugin` | **unchanged** — distinctive in registry & config files |
| CLI subcommand | `openclaw index-network setup` | `openclaw index setup` |
| MCP server key | `mcp.servers.index-network` | `mcp.servers.index` |
| Plugin config namespace | `plugins.entries.indexnetwork-openclaw-plugin.config.*` | unchanged (plugin ID unchanged) |
| Internal HTTP routes | `/index-network/poll/*` | `/index/poll/*` |

Rationale: the two surfaces a user actually types (install command, setup command) are short and on-brand; the registry/config identity stays distinctive. Plugin ID `index` was rejected because ClawHub uses the plugin ID as a global registry key and `index` is too generic to claim cleanly, while it also makes config-file scanning ambiguous ("which plugin is `index`?").

## Components

### 1. NPM publishing infrastructure

**Package metadata** (`packages/openclaw-plugin/package.json`):
- `name`: `@indexnetwork/openclaw-plugin`
- Add `publishConfig: { access: "public" }`
- Add a real build step:
  - `scripts.build`: `tsc`
  - `tsconfig.json`: emit to `dist/`, declarations on
  - `files`: `dist/`, `skills/`, `openclaw.plugin.json`, `README.md`, `LICENSE` (drop `src`)
- Update the `openclaw` field to declare both source and runtime entries (per OpenClaw's plugin SDK docs):
  ```json
  "openclaw": {
    "extensions": ["./src/index.ts"],
    "runtimeExtensions": ["./dist/index.js"],
    "compat": { "openclaw": ">=0.1.0" }
  }
  ```
  `extensions` is used during local development (linked install). `runtimeExtensions` is used when OpenClaw loads the plugin from an installed npm package, avoiding runtime TypeScript compilation.

**CI workflow** (`packages/openclaw-plugin/.github/workflows/publish.yml`):
- Copy of `indexnetwork/protocol`'s publish.yml (already proven). Triggers on push to `dev` (publishes `X.Y.Z-rc.<run>.<attempt>` under `rc` tag) and `main` (publishes `X.Y.Z` under `latest`). Skips silently if version already exists.
- Lives inside the subtree directory in the monorepo. The existing `sync-subtrees.yml` workflow force-pushes the subtree to `indexnetwork/openclaw-plugin`, which carries the publish workflow with it.
- Requires `INDEX_REPO_TOKEN` secret on `indexnetwork/openclaw-plugin` (not the monorepo). Verify before first push.

### 2. Plugin code changes

| File | Change |
|---|---|
| `src/index.ts:45` | `.command('index-network')` → `.command('index')` |
| `src/index.ts:49` | descriptor `name: 'index-network'` → `'index'` |
| `src/index.ts` | `mcp.servers.index-network` references → `mcp.servers.index`; HTTP routes `/index-network/poll/*` → `/index/poll/*`; log/error strings referencing `openclaw index-network setup` → `openclaw index setup` |
| `src/setup/setup.cli.ts:217` | `mcp.servers.index-network` → `mcp.servers.index` |
| `src/lib/delivery/main-agent.dispatcher.ts:212` | error message string update |
| `src/polling/*/scheduler.ts` | route paths in local fetch URLs |
| `src/polling/*/poller.ts` (if any reference the route prefix) | route paths |

**Migration shim** (in setup wizard, runs on next `openclaw index setup` after upgrade):
1. If `mcp.servers.index-network` exists and `mcp.servers.index` is absent: copy entry to `index`, delete the old key. Log the migration.
2. The plugin config namespace (`plugins.entries.indexnetwork-openclaw-plugin.config.*`) is preserved — plugin ID unchanged, no migration needed.

**CLI alias** (one-version deprecation): register both `.command('index')` and `.command('index-network')` in 0.22.0. The latter logs a deprecation warning ("Use `openclaw index setup`") then dispatches to the same handler. Remove the alias in 0.23.0.

### 3. Frontend cascade (`frontend/src/lib/mcp-config.ts`)

```ts
OPENCLAW_INSTALL_CMD = "openclaw plugins install @indexnetwork/openclaw-plugin"
OPENCLAW_UPDATE_CMD  = "openclaw plugins update @indexnetwork/openclaw-plugin"
OPENCLAW_SETUP_CMD   = "openclaw index setup"
```

Inside `buildMcpConfigs`, the `"index-network"` MCP server key in the Claude Code (`claudeConfig`) and Hermes (`hermesConfig`) snippets becomes `"index"`.

Walk the three pages that consume `mcp-config.ts` and verify no hardcoded `"index-network"` strings remain in narrative copy:
- `frontend/src/app/agents/page.tsx`
- `frontend/src/app/agents/[id]/page.tsx`
- `frontend/src/components/settings/AgentApiKeysSection.tsx`

Per project memory, the agent detail page mirrors the wizard — its narrative copy may need touching beyond the constants.

### 4. README rewrite

Single file, ordered by what a ClawHub visitor needs first. Target ~200 lines (current is 168, but denser and reference-first).

```
# @indexnetwork/openclaw-plugin

> Find the right people. Let them find you.

[1-paragraph value prop: opportunities arrive in your own chat, rendered by
your main agent in its own voice; alpha negotiation handling]

## Install

  openclaw plugins install @indexnetwork/openclaw-plugin
  openclaw index setup

## What you get

- Real-time opportunity delivery + daily digest
- Rendered by your main agent on your active chat channel
- Silent negotiation handling (alpha)
- Outbound polling only — no public ports

## How it works

[condensed: auth modes, MCP registration]

## Configuration

[condensed config keys table; drop redundant prose]

## Daily digest

[keep table, drop redundant paragraph]

## Troubleshooting

[tightened]

## Technical notes

[route auth, no public endpoint required]

## License
```

Marketing-first top is ~30 lines (tagline + value-prop paragraph + install + bullets); reference fills the rest. Scanners decide on first screen; configurators scroll.

### 5. Documentation updates

- `CLAUDE.md` — update install command, setup command, MCP server key references
- `packages/openclaw-plugin/README.md` — full rewrite per (4)
- The `openclaw mcp set` command shown in the existing README references `index-network` — that example block is removed (the wizard handles MCP registration; the example was a fallback for a manual path that's no longer canonical)

## Versioning

Bump to **0.22.0** when the rename ships. Pre-1.0, breaking changes in minor bumps are semver-permitted; promotion to 1.0 waits for negotiation alpha to stabilize.

Both `package.json` `version` and `openclaw.plugin.json` `version` must be bumped together. The CLI reads `openclaw.plugin.json` for `openclaw plugins list` — mismatched values are a known silent foot-gun.

**Old name disposal (recommended):** publish `indexnetwork-openclaw-plugin@0.21.1` with a README pointing to `@indexnetwork/openclaw-plugin`. Stops anyone landing on the old listing without a forwarding signal. ~15 minutes; do it.

## Sequencing

1. **Verify build step locally** — `tsc` config, `dist/` output, `runtimeExtensions` declared. Confirm OpenClaw loads the dev install with both extension entries.
2. **Plugin code rename** — CLI subcommand, MCP key, routes, log strings + migration shim + deprecation alias.
3. **Frontend cascade** — `mcp-config.ts` constants + walk the three consuming pages.
4. **README rewrite** — marketing top + condensed reference.
5. **CI workflow** — drop `publish.yml` into `packages/openclaw-plugin/.github/workflows/` (mirroring protocol's).
6. **Manual verification** — `npm pack` → `openclaw plugins install <tarball>` on a fresh OpenClaw config; setup wizard runs end-to-end; opportunities still deliver.
7. **Version bump** — both `package.json` and `openclaw.plugin.json` to `0.22.0`.
8. **Push to dev** — sync workflow carries publish.yml into the subtree repo, which publishes `0.22.0-rc.N.M` under `rc` tag.
9. **Smoke test rc** — `openclaw plugins install @indexnetwork/openclaw-plugin@rc` in a clean env; verify migration shim on a config that has the old keys.
10. **Old name disposal** — publish `indexnetwork-openclaw-plugin@0.21.1` with forwarding README.
11. **Merge to main** — publishes `0.22.0` stable under `latest`.
12. **Update CLAUDE.md** with new install/setup commands.
13. **Submit to ClawHub** with the new README as the listing.

## Open questions deferred to implementation

- Does OpenClaw's `openclaw plugins install` resolve scoped names against npm without a registry flag? Docs imply yes (bare specs check ClawHub then npm), but verify on first install of the rc.
- ClawHub submission fields are unknown. We're producing a generic-marketplace-shaped README; ClawHub may want extra metadata (icon, category, demo URL) we'll fill in when we get the form.

## Risks

- **Existing users hit broken state if the migration shim has a bug.** Mitigation: smoke test on a config with the old keys before merging to main.
- **`INDEX_REPO_TOKEN` not configured on the subtree repo.** Mitigation: verify the secret is set on `indexnetwork/openclaw-plugin` before the first dev push lands.
- **OpenClaw's plugin loader doesn't honor `runtimeExtensions` correctly on some install paths.** Mitigation: test both linked-dev install and tarball install in step 6.
