---
title: Commits
description: Agent-assisted commits with conventional-commits format enforced by commitlint.
---

# Commits

Ptah can draft commit messages, group related changes, and create the commit for you — but the final commit always happens on your explicit approval. No agent commits behind your back.

## The `/commit` command

In any chat, type `/commit` to start the commit flow. The agent will:

1. Read `git status` and `git diff` for all staged changes.
2. Summarize what changed and group related hunks.
3. Draft a commit message following [Conventional Commits](https://www.conventionalcommits.org/).
4. Present the message for you to accept, edit, or reject.

![Commit composer](/screenshots/commit-composer.png)

Example draft:

```
feat(workspace): add per-workspace plugin overrides

Allow .ptah/plugins.json to enable/disable plugins per workspace,
overriding global settings. Plugin resolution now checks the
workspace config before falling back to the global list.

Refs #412
```

## Conventional commits

Ptah enforces conventional commit format via [commitlint](https://commitlint.js.org/). The expected shape:

```
<type>(<scope>): <subject>

<body>

<footer>
```

Valid types:

| Type       | Use for                              |
| ---------- | ------------------------------------ |
| `feat`     | New user-visible feature             |
| `fix`      | Bug fix                              |
| `docs`     | Documentation only                   |
| `style`    | Formatting, no logic change          |
| `refactor` | Code restructure, no behavior change |
| `perf`     | Performance improvement              |
| `test`     | Tests only                           |
| `build`    | Build system or deps                 |
| `ci`       | CI configuration                     |
| `chore`    | Misc tasks that don't fit above      |

If a draft fails commitlint, Ptah shows the validation errors and offers to regenerate the message. You can also edit the message directly before confirming.

## Staging

The `/commit` command operates on **whatever is currently staged**. Stage files yourself with `git add`, or ask the agent to stage specific files:

```
> stage only the files in libs/shared/git/ and commit
```

## Multi-commit workflows

For larger changes, ask the agent to split the work into multiple commits:

```
> commit these changes as three separate commits:
  one for the watcher refactor,
  one for the new worktree API,
  one for the docs update
```

The agent stages subsets, proposes each message, and waits for your approval per commit.

## Hooks and signing

Ptah respects your git hooks. If a `pre-commit` or `commit-msg` hook fails, the commit fails — Ptah surfaces the hook's stderr so you can fix the issue. The same applies to commit signing (`commit.gpgsign`, signed commits, etc.) — Ptah uses your local git config as-is.

:::caution
Ptah never passes `--no-verify` or disables signing automatically. If a hook blocks a commit, investigate and fix the underlying issue rather than skipping it.
:::

## What Ptah won't do

- Force-push to `main`, `master`, or any protected branch without an extra confirmation.
- Rewrite history (`rebase -i`, `commit --amend` on pushed commits) without explicit instruction.
- Delete branches that aren't fully merged without a prompt.
