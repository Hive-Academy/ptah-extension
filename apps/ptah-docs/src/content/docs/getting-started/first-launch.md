---
title: First launch
description: Open your first workspace, run the setup wizard, and import existing sessions.
---

The first time you open Ptah, the app guides you through selecting a workspace, analyzing the project, and generating a tailored set of AI agents. This page walks through what to expect.

## Welcome screen

Ptah is free and fully open source, so first launch goes straight into the app — there's no gate, license prompt, or lockout to clear. Every local capability is available immediately.

Signing in is optional: it connects you to a **Ptah Builders** membership, which adds the SaaS-building course, weekly live sessions, member skill packs, the private community, and priority support. You can sign in — or attach a Builders license key — any time from **Settings → License**. See [Signing in](/getting-started/signing-in/) for details.

![Welcome screen](/screenshots/welcome.png)

## Open a workspace

Ptah is workspace-centric: everything — agents, chat sessions, plugins, project analysis — is scoped to the folder you open.

1. Click **Open folder**.
2. Select the root of a project (a Git repository, a package root, or any folder you want to work in).
3. Ptah loads the workspace and begins analyzing it in the background.

:::tip[Recent workspaces]
Workspaces you've opened appear under **File → Open recent**. Pin frequently used ones to keep them at the top.
:::

## Setup wizard

The first time you open a workspace, Ptah offers a seven-step setup wizard. It
scans your project, detects your stack, proposes an agent roster, tunes each
agent's prompt to your conventions, and writes the result to `.claude/agents/`.

You can skip it and return later from the **Setup Hub → Workspace Analysis**
card. Most users get the best results by letting it run once per project.

The scan is local. No source code leaves your machine during analysis.

![Project analysis progress](/screenshots/setup-analysis.png)

See [Setup Wizard](/setup/setup-wizard/) for a walkthrough of all seven steps.

:::note[Customize freely]
The wizard's suggestions are a starting point, not a prescription. Nothing generated here is locked — rename, rewrite, or delete any agent at any time.
:::

## CLI agent detection

Separately from the wizard, Ptah scans your `PATH` for installed agent CLIs —
Codex, Copilot, Cursor, Antigravity, OpenCode, and Pi — and registers the ones
it finds. Detected CLIs appear in **Providers → CLI agents**. A missing CLI is
not an error. See [CLI agents](/agents/cli-agents/).

## Import existing sessions

If Ptah finds a Claude CLI session history at `~/.claude/projects/`, it offers to import those conversations into the current workspace. Imported sessions appear in the chat history sidebar and remain fully editable — the import is a one-time copy, not a live link.

:::caution[Privacy]
Session imports read local files only. Nothing is uploaded during the import step.
:::

## After the wizard

Once setup finishes, Ptah drops you into the main workspace view with:

- A default chat session ready to use
- Your generated agents in the sidebar
- Detected providers and CLI agents in the status bar

If the analysis missed something — a nested subproject, a custom tech stack — you can re-run it any time with **Workspace → Re-analyze**.

## Next step

Continue to [Signing in](/getting-started/signing-in/) to configure your AI providers, and optionally sign in for a Ptah Builders membership.
