---
status: in_review
type: bugfix
title: Diagnose the failing platform-electron real-process suites
description: >-
  Three tests in AC-7 real host-kill and ST-2 mass delete storm fail on clean
  origin/main. Determine whether they are load-sensitive or genuinely broken,
  then fix or quarantine them with evidence.
---

# Diagnose the failing platform-electron real-process suites

Measured on 2026-09-20 against a clean detached worktree at `origin/main`:
`@ptah-extension/platform-electron` fails 4 tests. The same suites fail in a
feature branch that does not touch them, with 3 failures. They are not caused by
any current change.

See `context.md`.
