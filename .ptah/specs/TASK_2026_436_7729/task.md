---
status: backlog
type: feature
title: >-
  Share Ptah's core system prompt with every CLI lane and add a harness instructions facet
updated: 2026-11-07T00:00:00.000Z
description: >-
  Lanes now get their role and policy through a native channel, but never Ptah's core system
  prompt, and CLIs the user runs get no Ptah instructions at all. Send a CLI-neutral core prompt
  to every lane, and add a harness-sync `instructions` facet with a managed section per CLI.
---

# Share Ptah's system prompt with every CLI

Machine-owned carrier. Prose in `./context.md`.

## Description

A Claude SDK session gets `PTAH_CORE_SYSTEM_PROMPT` (exported from `libs/backend/agent-sdk`)
plus the workspace prompt, identity, output style, memory and code-symbol blocks. Rival lanes
(codex, antigravity, opencode, copilot, cursor, pi, grok) do not get the core prompt. Remaining
work:

1. Make the core prompt CLI-neutral and send it to every lane through its native channel, next
   to the role block. The channel plumbing exists: `getRoleDelivery` / `getLanePolicyDelivery`
   (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.interface.ts:182-191`),
   Codex `developer_instructions` (`codex/codex-lane-config.builder.ts`).
2. Merge with the user's own Codex `developer_instructions` instead of replacing it.
3. Add an `instructions` facet to harness-sync: `HarnessEntryKind` and `HarnessFacet`
   (`libs/shared/src/lib/types/harness-sync.types.ts:33-36`) list only skills, commands, agents
   and MCP. The facet writes a managed Ptah section into `AGENTS.md`, `GEMINI.md`,
   `.github/copilot-instructions.md` and cursor rules without touching user content.
4. Fix any doc that claims `AGENTS.md` is already propagated.

## Current state (2026-11-07)

- Done: lanes get role and policy text through a native channel (TASK_2026_597,
  `cli-adapter.utils.ts:491`; Pi uses one shared channel).
- Not done: no lane receives `PTAH_CORE_SYSTEM_PROMPT` (no reference in
  `libs/backend/cli-agent-runtime`), and harness-sync writes no instruction files.
