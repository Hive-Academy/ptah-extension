---
title: Commits
description: Write or generate a commit message and commit staged files.
---

# Commits

The **Commit** tab of the review view commits the staged files.

![Commit composer](/screenshots/commit-composer.png)

## Make a commit

1. Stage files in the **Changes** tab. Refer to [Diffs](/git/diffs/).
2. Open the **Commit** tab.
3. Type a message in **Commit message**, or click **Generate message**.
4. Click **Commit**.

**Commit** is disabled when no files are staged or the message is empty.

## Generate a message

**Generate message** asks the provider for a message only when you click it. The generated message fills the field. If you type while the message is generated, PtahCode keeps your text.

## The draft

Each workspace keeps one draft message. A failed commit keeps the draft. Only a confirmed commit clears it.

## Hooks

PtahCode runs your git hooks. The hook output streams into the **Commit hook output** log while the commit runs.

- Click **Cancel** to stop a running commit.
- If a hook blocks the commit, the log stays open so that you can read the error.
- A successful commit shows the commit hash and subject.

If the reply from git takes too long, PtahCode reads the status and `HEAD` again. The commit counts as done only when `HEAD` moved to a commit with your message.

:::caution
Fix the cause of a failed hook. Do not skip hooks with `--no-verify`.
:::
