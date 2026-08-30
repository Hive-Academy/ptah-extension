---
id: TASK_2026_340
status: backlog
type: BUGFIX
title: >-
  Phantom session entries already written before the TASK_2026_308 fix are never
  pruned and survive every future scan
description: >-
  TASK_2026_308 stopped the session importer from minting a phantom
  `Session <date>` entry for a contentless file. It fixed the PRODUCER only.
  Entries already written into `SessionMetadataStore` before that fix stay
  forever, because the existing sweep cannot recognise them:
  `pruneTitleOnlySessions`
  (`libs/backend/agent-sdk/src/lib/session-importer.service.ts:282-317`) delegates
  to `isTitleOnlySidecar` (`:325-353`), which returns true only when a parsed
  `ai-title` line is present AND no `system` or `user` line is. A whitespace-only
  file has ZERO parseable lines, so `sawAiTitle` stays false and the predicate
  returns false unconditionally. The stored entry therefore survives every scan
  indefinitely, and an affected user sees a stale session in their list with no
  way to clear it. Confirmed user-visible by an independent reviewer during the
  TASK_2026_308 review. The cleanup must be a POSITIVE re-classification —
  re-run the corrected guard against the entry's backing file and delete only on
  a definite match — and must NOT key on the entry's name. `Session <date>` is a
  legitimate name for a real session whose first user message yielded no title
  text (`:736`), so a name heuristic would delete real history. That is the same
  design principle `isTitleOnlySidecar` already documents: a truncated or
  unparseable real-session file must fail the positive test rather than be
  misclassified.
relates_to:
  - TASK_2026_308
labels:
  - agent-sdk
  - data-cleanup
executor: backend-developer
estimate: S
---

# Pre-existing phantom session entries are never pruned

Machine-owned metadata carrier. Prose lives in `./context.md`.
