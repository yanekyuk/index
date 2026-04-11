# OpenClaw Railway One-Click Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `indexnetwork/openclaw-railway-template` the clear one-click Railway deploy path for Index Network users by adding a working deploy entrypoint and accurate post-deploy instructions.

**Architecture:** Keep this implementation documentation-first. Use the Railway template URL that already resolves for the GitHub fork, describe the existing runtime shape truthfully, and point the OpenClaw plugin README at the deployable fork rather than only at the fixed source code.

**Tech Stack:** Markdown, Railway template URL flow, `railway.toml`, GitHub READMEs, `rg`, `curl`

---

### Task 1: Add the One-Click Deploy Entry Point to the Fork README

**Files:**
- Modify: `packages/openclaw-railway-template/README.md`
- Verify: `packages/openclaw-railway-template/railway.toml`

- [ ] **Step 1: Write the failing content check**

Run in `packages/openclaw-railway-template`:

```bash
rg -n "Deploy on Railway|After deploy|Verify webhook reachability" README.md
```

Expected: no matches, proving the one-click deploy sections are missing.

- [ ] **Step 2: Verify the Railway template URL and current runtime config**

Run in `packages/openclaw-railway-template`:

```bash
curl -I -L "https://railway.app/new/template?template=https://github.com/indexnetwork/openclaw-railway-template"
rg -n "healthcheckPath|PORT" railway.toml
```

Expected:

- `curl` ends with `HTTP/2 200`
- `railway.toml` shows:

```toml
[deploy]
healthcheckPath = "/setup/healthz"

[variables]
PORT = "8080"
```

- [ ] **Step 3: Add the deploy badge and the new deployment guidance**

In `packages/openclaw-railway-template/README.md`, insert the following block immediately after the security notice and before the first screenshot:

````md
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/indexnetwork/openclaw-railway-template)

## Deploy on Railway

Use the button above to create a Railway project from this fork. For Index Network users, this is the recommended Railway template because it includes the two webhook-critical wrapper fixes missing from upstream.

Before onboarding OpenClaw, make sure the Railway project has:

- a persistent volume mounted at `/data`
- public networking enabled
- `SETUP_PASSWORD` set in service variables
- optional `ENABLE_WEB_TUI=true` if you want browser TUI access

### After deploy

1. Open `https://<your-domain>/setup`.
2. Sign in with `SETUP_PASSWORD`.
3. Complete OpenClaw onboarding.
4. Open the OpenClaw UI from `/setup`.

### Verify webhook reachability

After enabling the Index Network OpenClaw plugin, confirm the deployment forwards HTTP webhook requests to the gateway:

```bash
curl -i https://<your-domain>/index-network/webhook
```

A healthy deployment returns `401 invalid signature`. That means the route is reachable and the remaining rejection is the expected missing HMAC.
````

- [ ] **Step 4: Run verification for the new README content**

Run in `packages/openclaw-railway-template`:

```bash
rg -n "Deploy on Railway|railway\.app/new/template\?template=https://github.com/indexnetwork/openclaw-railway-template|After deploy|Verify webhook reachability|SETUP_PASSWORD|401 invalid signature" README.md
```

Expected: matches for the badge URL, the new deploy sections, `SETUP_PASSWORD`, and `401 invalid signature`.

- [ ] **Step 5: Commit the fork README change**

Run in `packages/openclaw-railway-template`:

```bash
git add README.md
git commit -m "docs: add one-click Railway deploy guidance"
```


### Task 2: Point the OpenClaw Plugin README at the Deployable Template Path

**Files:**
- Modify: `packages/openclaw-plugin/README.md`

- [ ] **Step 1: Write the failing content check**

Run in the monorepo root:

```bash
rg -n "railway\.app/new/template\?template=https://github.com/indexnetwork/openclaw-railway-template|After Railway creates the project" packages/openclaw-plugin/README.md
```

Expected: no matches, proving the plugin README does not yet point users at the one-click deploy flow.

- [ ] **Step 2: Replace the current recommendation paragraph with deploy-oriented wording**

In `packages/openclaw-plugin/README.md`, replace the current `Recommended Railway template.` paragraph with this exact text:

```md
**Recommended Railway template.** Deploy [`indexnetwork/openclaw-railway-template`](https://github.com/indexnetwork/openclaw-railway-template) with Railway's template flow: [Deploy on Railway](https://railway.app/new/template?template=https://github.com/indexnetwork/openclaw-railway-template). This fork of `arjunkomath/openclaw-railway-template` includes two webhook-critical fixes: (1) `express.json()` is scoped to `/setup/api` so proxied request bodies reach the gateway intact, and (2) the wrapper tracks `gatewayExternallyHealthy` so `SIGUSR1` self-restarts by OpenClaw don't strand the wrapper serving `503`s on every HTTP request. After Railway creates the project, finish OpenClaw onboarding at `/setup`, then confirm `https://<your-public-url>/index-network/webhook` returns `401 invalid signature`.
```

- [ ] **Step 3: Verify the README change landed exactly**

Run in the monorepo root:

```bash
rg -n "Recommended Railway template|railway\.app/new/template\?template=https://github.com/indexnetwork/openclaw-railway-template|After Railway creates the project|401 invalid signature" packages/openclaw-plugin/README.md
```

Expected: one paragraph containing the deploy link, the two fixes, the `/setup` handoff, and the `401 invalid signature` verification note.

- [ ] **Step 4: Commit the monorepo README change**

Run in the monorepo root:

```bash
git add packages/openclaw-plugin/README.md
git commit -m "docs(openclaw-plugin): add one-click Railway deploy link"
```


### Task 3: Verify the Combined Documentation Story and Publish It

**Files:**
- Verify: `packages/openclaw-railway-template/README.md`
- Verify: `packages/openclaw-plugin/README.md`

- [ ] **Step 1: Run the combined verification checks**

Run in the monorepo root:

```bash
curl -I -L "https://railway.app/new/template?template=https://github.com/indexnetwork/openclaw-railway-template"
rg -n "Deploy on Railway|After deploy|Verify webhook reachability|401 invalid signature" packages/openclaw-railway-template/README.md
rg -n "Deploy on Railway|railway\.app/new/template\?template=https://github.com/indexnetwork/openclaw-railway-template|401 invalid signature" packages/openclaw-plugin/README.md
```

Expected:

- `curl` ends with `HTTP/2 200`
- the fork README contains the deploy badge and the post-deploy verification guidance
- the plugin README contains the deploy link and the `401 invalid signature` verification language

- [ ] **Step 2: Push the fork README commit**

Run in `packages/openclaw-railway-template`:

```bash
git push origin main
```

Expected: the fork README update is published on `indexnetwork/openclaw-railway-template`.

- [ ] **Step 3: Push the monorepo branch and open a PR**

Run in the monorepo root or the active worktree:

```bash
branch=$(git branch --show-current)
owner=$(gh api user -q .login)
git push -u origin "$branch"
gh pr create --repo indexnetwork/index --base dev --head "$owner:$branch" --title "docs(openclaw-plugin): add one-click Railway deploy link" --body "$(cat <<'EOF'
## Summary
- add a one-click Railway deploy link for `indexnetwork/openclaw-railway-template`
- keep the plugin README focused on the fixed, deployable template path and the webhook verification check
EOF
)"
```

Expected: a PR is opened into `upstream/dev` for the plugin README change.
