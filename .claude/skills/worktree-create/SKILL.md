---
name: worktree-create
description: Create a git worktree for parallel development. Sets up a new working directory with its own branch, copies .env files and Claude settings, and leaves a setup marker for worktree-setup.
model: claude-sonnet-4-6
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion
---

# Git Worktree Create

Create a new git worktree for parallel feature development in this Turborepo monorepo.

## Step 1: Determine Branch Strategy

Ask the user which strategy to use:

- **New branch** — create a fresh branch from the current HEAD
- **Existing branch** — check out an existing local or remote branch

If creating a new branch, ask the user for the branch name.
If using an existing branch, run `git branch -a` and let the user pick.

## Step 2: Determine Worktree Path

Compute a suggested path:
```
REPO_BASENAME=$(basename "$(git rev-parse --show-toplevel)")
SANITIZED_BRANCH=$(echo "$BRANCH" | tr '/' '-')
SUGGESTED_PATH="../${REPO_BASENAME}-${SANITIZED_BRANCH}"
```

Show the suggested path and confirm with the user. Let them override if they prefer a different location.

## Step 3: Validate Preconditions

Run these checks and abort with a clear message if any fail:

1. Confirm we're in a git repository: `git rev-parse --is-inside-work-tree`
2. Confirm the branch is not already checked out: `git worktree list` — check that the target branch doesn't appear
3. Confirm the target path doesn't already exist: `test ! -e <path>`
4. If using an existing branch, confirm it exists: `git branch -a | grep <branch>`

## Step 4: Create the Worktree

For a **new branch**:
```bash
git worktree add -b <branch> <path>
```

For an **existing branch** (local):
```bash
git worktree add <path> <branch>
```

For an **existing branch** (remote only — e.g. `origin/feature-x`):
```bash
git worktree add -b <local-branch> <path> <remote-tracking-branch>
```

## Step 5: Copy Local Files

Copy these files from the current worktree to the new one. Check each source file exists before copying — skip with a note if it doesn't:

| Source | Destination | Purpose |
|--------|------------|---------|
| `apps/renderer-server/.env` | `<path>/apps/renderer-server/.env` | GitLab auth token, port, Supabase keys |
| `apps/renderer-api/.env` | `<path>/apps/renderer-api/.env` | Renderer API config (FW tokens, port) |
| `apps/dashboard/.env.local` | `<path>/apps/dashboard/.env.local` | Dashboard Supabase keys |
| `.claude/settings.local.json` | `<path>/.claude/settings.local.json` | Claude Code permissions |

Use `cp` for each file individually. Do NOT use recursive copy of `.claude/` — only copy `settings.local.json`.

## Step 6: Create Setup Marker

```bash
touch <path>/.claude-worktree-setup-pending
```

This marker tells `/worktree-setup` that dependencies haven't been installed yet.

## Step 7: Port Conflict Warning

Display a warning:

> **Port conflict warning**: The main worktree and this new worktree share the same default ports:
> - Renderer server: 3000
> - Dashboard: 3001
> - Renderer API: 3004
>
> If you need to run both simultaneously, update the `PORT` values in the new worktree's `.env` files before starting servers.

## Step 8: Print Summary

Print a summary like:

```
Worktree created successfully!

  Branch:   <branch>
  Path:     <absolute-path>
  Files copied: .env (renderer-server), .env (renderer-api), .env.local (dashboard), settings.local.json
  Files skipped: <any skipped files>

Next steps:
  cd <path>
  claude
  /worktree-setup
```
