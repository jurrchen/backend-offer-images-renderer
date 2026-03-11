---
name: worktree-setup
description: Install dependencies and build a git worktree. Runs npm install (with GitLab registry auth) and npm run build (Turborepo), then verifies build artifacts.
model: claude-sonnet-4-6
allowed-tools: Bash, Read, Glob, Grep, AskUserQuestion
---

# Git Worktree Setup

Install dependencies and build the Turborepo monorepo in a worktree created by `/worktree-create`.

## Step 1: Verify Worktree Environment

Check that we're inside a git worktree (not the main working tree):

```bash
GIT_DIR=$(git rev-parse --git-dir)
```

If `$GIT_DIR` contains `/worktrees/`, we're in a worktree — proceed.
If not, warn the user: "This doesn't appear to be a git worktree. Are you sure you want to run setup here?" and ask for confirmation before continuing.

## Step 2: Check Setup Marker

Look for `.claude-worktree-setup-pending` in the worktree root.

- If present: proceed normally.
- If missing: warn "Setup marker not found — this worktree may have already been set up, or was not created with /worktree-create." Ask for confirmation before continuing.

## Step 3: Verify .env Files

Check for the presence of these files:

| File | Required | Why |
|------|----------|-----|
| `apps/renderer-server/.env` | **Critical** | Contains `GITLAB_AUTH_TOKEN` needed by `.npmrc` for private registry |
| `apps/renderer-api/.env` | Optional | Renderer API config (FW tokens, port) |
| `apps/dashboard/.env.local` | Optional | Dashboard Supabase keys |

If `apps/renderer-server/.env` is **missing**, display a strong warning:

> **WARNING**: `apps/renderer-server/.env` is missing! This file typically contains the `GITLAB_AUTH_TOKEN` required for installing `@fourthwall/*` packages from the GitLab registry.
>
> Without it, `npm install` will fail with a 401/403 error.
>
> Options:
> 1. Copy it manually from the main worktree
> 2. Set `GITLAB_AUTH_TOKEN` as an environment variable
> 3. Abort and run `/worktree-create` again from the main worktree

Ask the user how to proceed.

## Step 4: Verify GitLab Auth Token

Check that the GitLab auth token is available. Run:

```bash
grep -q 'GITLAB_AUTH_TOKEN' apps/renderer-server/.env 2>/dev/null && echo "found-in-env" || echo "not-in-env"
echo "env-var: ${GITLAB_AUTH_TOKEN:+set}"
```

If the token is available in either location, proceed. If neither, warn and ask the user to provide it.

## Step 5: Install Dependencies

Run:

```bash
npm install
```

Watch for these common failure modes:

- **401/403 from GitLab registry**: Auth token issue. Suggest checking `GITLAB_AUTH_TOKEN` in `.env` or environment.
- **Native module build failure** (`canvas`, `gl`): These require system-level dependencies. On macOS: `brew install pkg-config cairo pango libpng jpeg giflib librsvg pixman`. On Linux: the Dockerfile has the apt packages.
- **ERESOLVE / peer dependency conflicts**: Try `npm install --legacy-peer-deps`.

If `npm install` fails, show the error and suggest remediation. Do not proceed to the build step.

## Step 6: Build

Run:

```bash
npm run build
```

This triggers Turborepo which builds packages in dependency order:
1. `packages/typescript-config` (no build step)
2. `packages/shared` (TypeScript compile)
3. `apps/renderer-server` (TypeScript compile + esbuild worker bundle)
4. `apps/dashboard` (Next.js build)

If the build fails, show the error output and suggest remediation. Do not remove the setup marker.

## Step 7: Verify Artifacts

Check that these key build artifacts exist:

| Artifact | Package |
|----------|---------|
| `apps/renderer-server/dist/server.js` | Renderer server main entry |
| `apps/renderer-server/dist/workers/RenderWorker.js` | Bundled worker |
| `apps/renderer-api/dist/server.js` | Renderer API main entry |
| `apps/dashboard/.next/BUILD_ID` | Next.js build output |
| `node_modules/.package-lock.json` | npm install completed |

Report which artifacts are present/missing. If any critical artifact is missing, warn but don't fail — the user may only need one app.

## Step 8: Remove Setup Marker

Only after **both** install and build succeed:

```bash
rm .claude-worktree-setup-pending
```

## Step 9: Print Summary

```
Worktree setup complete!

  Branch:     <current branch>
  Path:       <current directory>
  Install:    OK
  Build:      OK
  Artifacts:  <list of verified artifacts>

Port reminder:
  Default ports are shared with the main worktree:
  - Renderer server: 3000
  - Dashboard: 3001
  - Renderer API: 3004
  Update .env files if running both worktrees simultaneously.
```
