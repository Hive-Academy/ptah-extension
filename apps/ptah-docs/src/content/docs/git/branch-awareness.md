---
title: Branch Awareness
description: How agent context adapts to the current branch.
---

# Branch Awareness

Agents in Ptah are **branch-aware**. The current branch name, upstream tracking info, and recent branch-specific commits are all part of the context bundle that every agent receives.

This isn't cosmetic — it changes what agents do.

## What agents know about the branch

At spawn time, each agent sees:

| Field                    | Example                                 | Used for                                       |
| ------------------------ | --------------------------------------- | ---------------------------------------------- |
| Branch name              | `feature/workspace-intelligence`        | Inferring the task (often encoded in the name) |
| Upstream                 | `origin/feature/workspace-intelligence` | Deciding whether to suggest a push             |
| Ahead / behind           | `5 ahead, 0 behind`                     | Warning about unsynced commits                 |
| Base branch              | `main` (auto-detected)                  | Scoping diffs for PR descriptions              |
| Recent commits on branch | Last 10 subjects                        | Understanding the arc of the branch            |
| Dirty files              | From `git status`                       | Scoping edits to in-progress work              |

## How this changes behavior

Concrete examples:

### 1. Branch-name inference

On a branch called `fix/auth-redirect-loop`, an agent asked _"what's going on here?"_ starts with the assumption you're investigating an auth redirect bug, not writing a new feature.

### 2. Scoped refactors

On a branch called `refactor/extract-git-service`, an agent asked to refactor something will look at what's already been changed on the branch (via `git diff main...HEAD`) and continue in that direction instead of starting over.

### 3. PR description drafting

Ask an agent to draft a PR description and it automatically scopes the diff to the branch (`base...HEAD`), not the entire working tree. The draft reflects exactly what will be in the PR, not what you happen to have dirty locally.

### 4. Branch-specific warnings

If you're on `main` and ask an agent to make a risky change, it may suggest creating a feature branch first:

> _"This change touches the provider registry, which affects all workspaces. Want me to create a branch `refactor/provider-registry` before editing?"_

## Branch switches during a chat

When you switch branches mid-chat, Ptah's next agent invocation in that chat sees the new branch state. The chat history stays — agents get the new branch as updated context, not as a reset.

:::note
Branch switches do **not** automatically purge earlier context. If you asked the agent to review a file on `branch-a` and then switched to `branch-b`, the earlier review is still in the transcript. Be explicit about what you want the agent to do in the new state.
:::

## Turning off branch context

If you want a clean, branch-agnostic run — for example, when asking a general programming question — use **Chat → Show context → Git state** and toggle it off. Future messages in that chat omit git context until re-enabled.
