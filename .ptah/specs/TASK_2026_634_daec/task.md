---
id: TASK_2026_634_daec
status: backlog
type: BUGFIX
title: >-
  Finish the TASK_2026_614 token-burn stages: S3 rest, S1b and S2, QA session, F + G follow-ups
depends_on: []
created: "2026-10-12T18:53:17.413Z"
updated: '2026-11-07T00:00:00.000Z'
description: >-
  Remaining scope of TASK_2026_614 after Stages D-G merged (#650, #655): Stage A (S3 rest), Stage B
  (S1b, S2), Stage C (QA session with live proof) and Stage H (F + G review follow-ups).
executor: backend-developer
estimate: XL
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

The remaining stages of TASK_2026_614. The item lists are in `context.md` ("Scope"); the source
sections are in TASK_2026_614 and TASK_2026_597, which are now in git history only (see below).

- **Stage A (S3 rest):** A.1 Ollama window, proxied predicate, Responses translator (send the
  system prompt once), OpenCode lane config and usage split, strict MCP on proxied routes, cache
  flag, ledger cost, skill-budget cache columns; A.2 `compaction:getConfig` / `compaction:setConfig`
  RPC with the one-shot migration of `compaction.threshold`; A.3 apply a live change to
  `compaction.enabled`; A.4 Codex config TOML writer and RPC (opt-in, diff preview); A.5 frontend
  settings state, lane budgets card, usage displays and the no-cache hint.
- **Stage B (S1b and S2):** B.1 `CodexExecRunner` and the adapter switch, with the dotted
  model-name matcher; B.2 lane capture entries for tool M. Re-check B.1 first: Codex lanes now run
  through `codex-app-server-lane.adapter.ts`, so the exec runner may no longer be needed.
- **Stage C (QA session):** small budgeted runs only, each with user approval for paid calls.
- **Stage H:** H.1-H.14 review follow-ups of Stages F and G (H.1 needs a user decision). TASK_2026_627
  (PR #706) changed the same budget code, so re-verify each H item against current source.

TASK_2026_562_4b1d points here for tokaudit Waves 2.1, 2.4 and 2.5 (part of A.1).

## Current state (2026-11-07)

- Not started. No commit on main cites Stages A, B, C or H of 614 or 634.
- A.1 open: `libs/backend/auth-providers/src/lib/translation/responses-request-translator.ts:136,153`
  sends the system text both as a developer item and as `instructions`. The `strictMcpConfig: true`
  uses in `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:607,994` are for
  capability isolation and certified launches, not for proxied routes.
- A.2 open: no `compaction:*` RPC in `libs/shared/src`.
- B.1: no `CodexExecRunner` exists. Only
  `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-config.builder.ts`
  and `codex-app-server-lane.adapter.ts` exist.
- The source folders are retired from `.ptah/specs`. Read them in git history:
  `git show ff531866f:.ptah/specs/TASK_2026_614_327a/context.md` and
  `git show 12b721789^:.ptah/specs/TASK_2026_597_ab22/batches.md`.

Full context, plan and discussion live in [./context.md](./context.md).
