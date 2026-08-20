---
id: TASK_2026_230
status: done
type: BUGFIX
title: >-
  hunk-apply-real-rpc "bogus snapshot token" negative control fails on an
  RpcBridge.sendRpc timeout instead of its assertion
description: >-
  The "bogus snapshot token" case in
  apps/ptah-electron-e2e/src/specs/editor/hunk-apply-real-rpc.spec.ts fails on
  an RpcBridge.sendRpc timeout rather than on the assertion it exists to make.
  It is a negative control -- it proves the app REFUSES an apply carrying a
  stale snapshot token -- so a timeout failure means the guard it protects is
  currently unverified, not merely that a test is red. Confirmed pre-existing
  by the TASK_2026_227 agent, which stashed only its own harness edit to
  git-scratch-repo.ts and reproduced the identical timeout at HEAD. Neither
  TASK_2026_227 nor TASK_2026_229 investigated further; both correctly kept it
  out of scope and flagged it. Whether the timeout is a harness defect, an RPC
  bridge defect, or the app genuinely hanging on the rejection path is unknown.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-11T00:00:00.000Z
updated: 2026-08-11T00:00:00.000Z
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`.
