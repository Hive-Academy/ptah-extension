---
id: TASK_2026_719_4f64
status: done
type: FEATURE
title: Enable named Claude accounts for chat and CLI lanes
description: >-
  Real named Claude sign-in, per-account environment and admission, main chat and lane account selection, D7 hold lifted, live Electron test.
depends_on: [TASK_2026_712_5d7c]
created: 2026-10-25T15:45:58.000Z
updated: "2026-10-30T01:09:07.477Z"
---

## Description

Follow-up (task B) of TASK_2026_712_5d7c. Make named Claude accounts usable end to end in
Electron: real sign-in into each profile's own `CLAUDE_CONFIG_DIR`, `environment()` and route
certification for the installed Claude CLI (A1-A3), real lane admission and reading the stored
lane selection at spawn (D37), `accountSelection` on the main chat RPC (D22), and lifting the D7
release hold fully (user decision D41). Acceptance: live Electron test with two real accounts on
Haiku — main chat on account 1, a Claude CLI lane on account 2, each verified to use its account.
