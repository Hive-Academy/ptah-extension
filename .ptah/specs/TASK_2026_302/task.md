---
id: TASK_2026_302
status: backlog
type: bugfix
title: >-
  DI phase registration cannot be imported under Jest, so override specs mirror
  the code they are meant to guard
description: >-
  `apps/ptah-electron/src/di/phase-2-libraries.ts` and
  `libs/backend/cli-engine/src/lib/container.ts` both throw at module-evaluation
  time under Jest — importing either transitively pulls `persistence-sqlite`
  (better-sqlite3), `memory-curator`, `messaging-gateway` and `voice-providers`,
  none of which load cleanly in a test process. TASK_2026_299 needed to prove
  that the `PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER` override actually replaces the
  Phase 0 stub, and could not import the functions that perform it. The specs
  written instead call the real `registerWorkspaceIntelligenceServices` against
  a minimal child container and then MIRROR the override snippet verbatim from
  each host. That proves the override mechanism works, but it cannot detect
  drift: editing the real override lines will not fail these tests. Both spec
  headers document the caveat. The repo has normalized this workaround —
  `with-engine.spec.ts` and `container.smoke.spec.ts` both hand-build
  containers rather than call the real registration path — so the DI
  composition layer is effectively untestable end-to-end across every host.
  Fixing the import-time weight is the real deliverable; the mirrored specs are
  a symptom.
---

# DI phase registration is unimportable under Jest; override specs mirror instead of import

Machine-owned metadata carrier. Prose lives in `./context.md`.
