---
id: TASK_2026_309
status: done
type: BUGFIX
title: >-
  The non-destructive-wording guard is a verb denylist, so "purge" and "wipe"
  pass, and three of the five surfaces still carry only the bare delete check
description: >-
  Five surfaces tell a user how to clear a blocked harness path, and every one
  of them must say MOVE and must never say delete: the reconcile WARN action at
  `libs/backend/harness-sync/src/lib/reconciler/harness-reconciler.service.ts:761`,
  the Marketplace popover at
  `libs/frontend/marketplace/src/lib/harness/harness-blocked-paths.component.ts:93`,
  the Dashboard card, the repair dialog at
  `harness-repair-dialog.component.ts:181`, and the health store. The rule is
  load-bearing — nothing proves Ptah wrote these paths, so advising deletion
  trades a user's possibly-irreplaceable work for a tidier count — but the guard
  protecting it is a DENYLIST of eight regexes over the whole line
  (`harness-reconciler.blocked-logging.spec.ts:277-288`). "Purge", "wipe",
  "drop", "nuke", "clear out" and "get rid of" all pass it, and each reads as
  the same instruction to a user. Worse, only two of the five surfaces
  (`harness-reconciler.blocked-logging.spec.ts` and
  `harness-repair-dialog.spec.ts`) carry the synonym set at all — `harness-card.spec.ts:367`
  and `harness-blocked-paths.spec.ts:275` still make only the original bare
  `not.toContain('delete')` check that Batch 7 recorded as hole m1, so "remove
  the occupant" would ship on those two surfaces today. The durable fix is an
  exact-match ALLOWLIST on the action string rather than a denylist of forbidden
  verbs: brittleness is the feature for a safety-critical instruction, because a
  reworded action should have to be re-approved rather than merely re-scanned.
  Recorded as a follow-up by TASK_2026_306, which added the synonym list as a
  stopgap and named the allowlist as the real fix.
---

# The destructive-verb guard is a denylist, not a semantic check

Machine-owned metadata carrier. Prose lives in `./context.md`.
