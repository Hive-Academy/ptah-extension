---
status: backlog
type: devops
title: Add a dependency guard to ptah-license-server
description: >-
  Give the license server the bundle-versus-manifest check that ptah-electron
  already has, so an undeclared runtime import fails the build instead of
  reaching production. Also removes the duplicate marked declaration.
---

Follow-up from the 2026-09-04 api.ptah.live outage (TASK_2026_392).

`ptah-electron` survives this bug class because `validate-deps` scans its built
bundle for external imports and fails when one is not declared.
`ptah-license-server` has no equivalent, which is why the same defect reached
production there and stayed for four days.

Evidence, prior art and acceptance criteria are in `context.md`.
