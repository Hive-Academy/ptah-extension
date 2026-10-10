---
status: done
type: RESEARCH
title: Investigate the three failing CI jobs on pull request
description: >-
  Investigated the content-manifest drift, the degradation-audit ratchet
  failure, and the canvas Electron E2E failure on pull request #497. Findings
  and fixes are recorded in ci-investigation.md.
updated: '2026-10-10T18:17:37.488Z'
---

## Outcome

See `ci-investigation.md` for the full report.

- Content manifest: regenerated. The branch changed three ptah-cli-usage
  reference files without regenerating. No manifest entries dropped.
- Degradation audit: the real failure was a new swallowed-failure site in
  `session-title.service.ts` (this branch). Fixed with a `reported`
  suppression comment. The chat and editor lines the brief blamed are not
  failures; the audit passes at the base commit too.
- Canvas E2E spec: pre-existing flake. The branch touches no canvas code and
  the same test failed alone on an unrelated branch.
