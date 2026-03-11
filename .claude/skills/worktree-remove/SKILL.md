---
name: worktree-remove
description: Safely remove a git worktree after a feature branch is merged. Checks for uncommitted changes, verifies the branch is merged, and optionally deletes the local and remote branch.
model: claude-sonnet-4-6
allowed-tools: Bash, Read, Grep, AskUserQuestion
argument-hint: "[worktree-path-or-branch]"
---

# Git Worktree Remove

Safely remove a git worktree and optionally clean up its branch.

## Step 1: List Worktrees

Run:

```bash
git worktree list
```

Parse the output and display a numbered list of worktrees, **excluding the main worktree** (the one without `[branch]` suffix or marked as `(bare)`). Show each entry with its path and branch.

If `$ARGUMENTS` was provided, try to match it against worktree paths or branch names. If a unique match is found, pre-select it. Otherwise, show the list and ask the user to pick.

If there are no removable worktrees (only main), inform the user and exit.

## Step 2: Check for Uncommitted Changes

For the selected worktree, check its status:

```bash
git -C <worktree-path> status --porcelain
```

If there are uncommitted changes, display them and warn:

> **Warning**: This worktree has uncommitted changes:
> ```
> <status output>
> ```
> Removing it will **permanently discard** these changes.
> Do you want to proceed anyway?

Require an explicit "yes" to continue. If the user declines, abort.

## Step 3: Check Branch Merge Status

Extract the branch name from the worktree and check if it's merged into main:

```bash
# Check local merge status
git branch --merged main | grep -q <branch> && echo "merged-locally" || echo "not-merged-locally"

# Check remote merge status (fetch first)
git fetch origin main --quiet 2>/dev/null
git branch -r --merged origin/main | grep -q <branch> && echo "merged-remotely" || echo "not-merged-remotely"
```

**If merged** (locally or remotely): proceed normally.

**If NOT merged**: display a prominent warning:

> **WARNING**: Branch `<branch>` has NOT been merged into `main`.
>
> Removing this worktree will not delete the branch, but the working directory and any uncommitted changes will be lost.
>
> Options:
> 1. **Abort** — go back and merge first
> 2. **Proceed anyway** — remove worktree, keep branch

Ask the user to choose. The branch is always kept in this case (never offer to delete an unmerged branch).

## Step 4: Remove the Worktree

If the worktree has uncommitted changes AND the user confirmed in Step 2:
```bash
git worktree remove --force <worktree-path>
```

Otherwise:
```bash
git worktree remove <worktree-path>
```

If removal fails (e.g., locked), show the error. Suggest `git worktree unlock <path>` if it appears to be a lock issue.

## Step 5: Offer Branch Cleanup (Merged Branches Only)

**Only if the branch was confirmed merged in Step 3**, offer to delete it:

> Branch `<branch>` is merged. Would you like to delete it?
> 1. **Delete local only** — `git branch -d <branch>`
> 2. **Delete local and remote** — `git branch -d <branch> && git push origin --delete <branch>`
> 3. **Keep the branch**

Important safety rules:
- Use `-d` (lowercase), NOT `-D` — this ensures Git double-checks the merge status
- Never offer branch deletion for unmerged branches
- Never delete `main` or `master`

## Step 6: Prune Stale Worktree References

```bash
git worktree prune
```

## Step 7: Print Summary

Show the final state:

```
Worktree removed successfully!

  Removed:    <path>
  Branch:     <branch> — <deleted / kept>
  Changes:    <had uncommitted changes: discarded / clean>

Remaining worktrees:
<output of git worktree list>
```
