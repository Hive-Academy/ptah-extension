---
id: TASK_2026_388
status: backlog
type: feature
title: >-
  Add private chat sessions on their own provider through an isolated session runtime
updated: 2026-11-07T00:00:00.000Z
description: >-
  Let a user start a new session as a private session with its own immutable execution config
  (provider, auth route, model, tier snapshot), served by an isolated in-process runtime. The
  global provider path stays unchanged. Planning is done; none of the 11 batches has run.
---

# Private chat sessions on their own provider

Machine-owned metadata carrier. User intent and the design constraints live in
`./context.md`. The plan goes in `./implementation-plan.md` and the batch
breakdown in `./batches.md`.

## Description

Supersedes TASK_2026_304 (cancelled; its review is in
`.ptah/specs/TASK_2026_304/plan-review-codex.md`). The private runtime must:

- own its lifecycle and a fail-closed provider-profile lease;
- be routed by tab id and real session id;
- never be disposed by a global auth reset;
- be restored from durable session metadata after a host restart.

Remaining work: run the 11 batches in `batches.md` in order. Wire DI only in the Electron
container (`apps/ptah-electron/src/di/`) and, if provider CLI lanes need it,
`libs/backend/cli-engine`. Drop the batch steps for the removed hosts.

## Current state (2026-11-07)

- Planning is complete: `implementation-plan.md`, `plan-self-review.md`, `plan-review-claude.md`
  and `batches.md` ("Complete: 0/11").
- No implementation on main: no `SessionExecutionConfig` or private session runtime in `libs/`.
- `batches.md:335-343` lists `apps/ptah-extension-vscode/...` and `apps/ptah-cli/...` DI files.
  Those hosts were removed in `1cee6fafe`; skip those steps.
