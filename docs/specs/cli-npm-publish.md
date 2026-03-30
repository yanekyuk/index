---
title: "CLI npm distribution with platform-specific binaries"
type: spec
tags: [cli, npm, publish, binary, distribution]
created: 2026-03-31
updated: 2026-03-31
---

## Behavior

The Index CLI is distributed as an npm package (`@indexnetwork/cli`) that installs a native binary via platform-specific optional dependency packages. This follows the same pattern used by esbuild and turbo.

### Installation

```bash
npm install -g @indexnetwork/cli
```

npm resolves the correct platform package from `optionalDependencies` based on the user's OS and CPU architecture. The result is a single `index` command available on the PATH.

### Platform packages

Each platform package contains exactly one precompiled Bun binary:

| Package | OS | CPU | Binary |
|---|---|---|---|
| `@indexnetwork/cli-linux-x64` | linux | x64 | `bin/index` |
| `@indexnetwork/cli-linux-arm64` | linux | arm64 | `bin/index` |
| `@indexnetwork/cli-darwin-x64` | darwin | x64 | `bin/index` |
| `@indexnetwork/cli-darwin-arm64` | darwin | arm64 | `bin/index` |

Each package.json uses npm's `os` and `cpu` fields so npm only downloads the matching binary.

### Bin shim

The main package's `bin` entry points to `bin/index.js`, a thin JavaScript shim that:

1. Determines the current platform and architecture (`process.platform`, `process.arch`).
2. Looks for the platform binary in the corresponding `@indexnetwork/cli-{os}-{arch}` package.
3. If found, executes it via `child_process.execFileSync`, forwarding all arguments and stdio.
4. If not found, falls back to running `cli/dist/index.js` via `node` (the bundled JS fallback).

### Build process

A build script (`cli/scripts/build.ts`) performs cross-compilation:

1. Bundles `src/main.ts` into a single JS file (`dist/index.js`) for the Node fallback.
2. Compiles platform binaries for all 4 targets using `bun build --compile --target=bun-{os}-{arch}`.
3. Copies each binary into the corresponding `npm/{os}-{arch}/bin/index` directory.

### Node-compatible APIs

To support the JS fallback path (when no platform binary is available), two Bun-specific APIs are replaced with Node equivalents:

- `Bun.spawn()` in main.ts (browser opening) replaced with `child_process.execFile()`
- `Bun.serve()` in login.command.ts (OAuth callback server) replaced with `node:http.createServer()`

These Node APIs work in both Bun and Node runtimes, so the compiled Bun binaries continue to function identically.

### Publish workflow

A publish script (`cli/scripts/publish.ts`) automates the release:

1. Runs the build script.
2. Publishes each platform package (`@indexnetwork/cli-{os}-{arch}`).
3. Publishes the main package (`@indexnetwork/cli`).

Platform packages must be published first so they exist in the registry when users install the main package.

## Constraints

- Zero runtime dependencies for end users. The binary is self-contained.
- The `bin` name must remain `index` for backward compatibility.
- Platform packages must use `os` and `cpu` fields correctly for npm's platform filtering.
- The bin shim must work on both macOS and Linux without any runtime dependencies.
- The bin shim must handle the case where no platform binary is available (fallback to bundled JS).
- Bun.spawn() and Bun.serve() replacements must use only `node:` prefixed imports.
- The compiled Bun binaries must remain functionally identical to the current `bun build --compile` output.
- Windows support is not required for this release.

## Acceptance Criteria

1. `bun run build` in `cli/` cross-compiles binaries for all 4 targets (linux-x64, linux-arm64, darwin-x64, darwin-arm64).
2. Each platform package directory (`cli/npm/{os}-{arch}/`) contains a valid `package.json` with correct `os`, `cpu`, `name`, and `version` fields.
3. The bin shim (`cli/bin/index.js`) correctly resolves and executes the platform binary.
4. The bin shim falls back to the bundled JS when no platform binary is available.
5. The `Bun.spawn()` replacement opens the browser correctly on macOS and Linux.
6. The `Bun.serve()` replacement handles OAuth callbacks identically to the current implementation.
7. All existing CLI tests continue to pass after the API replacements.
8. The main `cli/package.json` has `private: true` removed and includes `optionalDependencies` for all platform packages.
9. A publish script exists that builds and publishes all packages in the correct order.
