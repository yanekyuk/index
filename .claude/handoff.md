---
trigger: "Publish the CLI as an npm package using platform-specific prebuilt binaries (Option C). Create platform-specific packages (@index-network/cli-linux-x64, @index-network/cli-darwin-arm64, @index-network/cli-darwin-x64, etc.) using `bun build --compile --target`. The main @index-network/cli package uses optionalDependencies that resolve per platform, similar to how esbuild/turbo distribute binaries. Zero runtime dependencies for end users — just `npm install -g @index-network/cli`."
type: feat
branch: feat/cli-npm-publish
base-branch: dev
created: 2026-03-31
version-bump: minor
---

## Related Files
- cli/package.json — current CLI package config (private: true, bin: src/main.ts, build: bun build --compile)
- cli/src/main.ts — entry point, uses Bun.spawn() for browser opening
- cli/src/login.command.ts — uses Bun.serve() for OAuth callback server
- cli/tsconfig.json — TypeScript config (target ESNext, module ESNext, outDir dist)
- cli/src/auth.store.ts — credential store (pure Node APIs, no Bun deps)
- cli/src/api.client.ts — API client (uses fetch, no Bun deps)
- cli/src/conversation.command.ts — unified conversation command (uses node:readline, fetch)
- cli/src/args.parser.ts — argument parser (pure JS, no Bun deps)

## Relevant Docs
- docs/specs/cli-v1.md — CLI v1 spec (auth + chat, Bun-based binary)

## Related Issues
None — no related issues found.

## Scope
Create an npm distribution pipeline for the CLI using platform-specific prebuilt binaries, similar to how esbuild and turbo distribute their CLIs.

### What needs to be done

1. **Replace Bun-specific APIs with Node-compatible equivalents:**
   - `Bun.spawn()` in main.ts → `child_process.execFile()` or `child_process.spawn()`
   - `Bun.serve()` in login.command.ts → `node:http.createServer()` with ephemeral port
   - This ensures the bundled JS fallback works on Node when Bun isn't available

2. **Build script that compiles for all targets:**
   - `bun build src/main.ts --compile --target=bun-linux-x64 --outfile dist/index-linux-x64`
   - `bun build src/main.ts --compile --target=bun-darwin-arm64 --outfile dist/index-darwin-arm64`
   - `bun build src/main.ts --compile --target=bun-darwin-x64 --outfile dist/index-darwin-x64`
   - `bun build src/main.ts --compile --target=bun-linux-arm64 --outfile dist/index-linux-arm64`
   - (Optional: Windows targets)

3. **Platform-specific npm packages:**
   - `@index-network/cli-linux-x64/` — contains only the Linux x64 binary
   - `@index-network/cli-linux-arm64/` — contains only the Linux arm64 binary
   - `@index-network/cli-darwin-x64/` — contains only the macOS x64 binary
   - `@index-network/cli-darwin-arm64/` — contains only the macOS arm64 binary
   - Each has its own package.json with `os` and `cpu` fields for npm's platform filtering

4. **Main package (`@index-network/cli`):**
   - Remove `"private": true`
   - Add `optionalDependencies` pointing to all platform packages
   - `bin` entry points to a thin JS shim that locates and executes the platform binary
   - Fallback: if no platform binary found, run via `bun` or `node` with bundled JS

5. **Publish script / CI workflow:**
   - Script that builds all targets, copies binaries into platform package dirs, and publishes all packages in order (platform packages first, then main package)

### Architecture (esbuild pattern)
```
cli/
├── package.json              # main package with optionalDependencies
├── bin/index.js              # thin shim: find platform binary → exec, or fallback to node
├── npm/
│   ├── linux-x64/
│   │   └── package.json      # @index-network/cli-linux-x64, os: ["linux"], cpu: ["x64"]
│   ├── linux-arm64/
│   │   └── package.json
│   ├── darwin-x64/
│   │   └── package.json
│   └── darwin-arm64/
│       └── package.json
└── scripts/
    └── build.ts              # cross-compile + package assembly script
```
