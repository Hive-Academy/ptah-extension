---
id: TASK_2026_611_8fe7
status: backlog
type: REFACTORING
title: Close the TASK_2026_609 follow-ups (subagent setup, model control, harness safety)
description: >-
  Open follow-ups of TASK_2026_609 (PR #635): retirement digest, file splits, Windows workspace-key
  casing, onboarding preview edge cases, Agents-tab layout, regression specs and the reviewer role.
depends_on: []
created: 2026-10-04T00:00:00.000Z
updated: '2026-11-07T00:00:00.000Z'
---

## Description

Follow-ups from TASK_2026_609_c495 (PR #635, merged as `0ec714c79`) that are still open. The
severity, source and suggested fix of each item are in `context.md` (by ID). Drop any item that
serves only skill synthesis (rescope of 2026-10-14).

1. **Harness safety (harness-sync).**
   - FU-5: retirement can delete a tree when the hash read fails transiently and the recorded hash
     already holds the `unreadable` sentinel. Use one strict digest that throws on any read
     failure, and drop the separate readability walk.
2. **Settings identity (settings-core).**
   - FU-7(a): on win32 a path that differs only in letter case (other than the drive letter) gets a
     different `workspace.<hash>` key. Case-fold with a one-time rehash migration of existing keys.
   - FU-7(b): model-read failures are silent in the plugin-config source resolver. Add an
     optional warn callback, logged once per root.
3. **Onboarding wizard (rpc-handlers + setup-wizard).**
   - FU-8: `wizard:preview-generation` labels a foreign existing copy "will overwrite", but
     reconcile refuses it. Label it as blocked, with the reason.
   - FU-9: the confirm-preview can continue to submit after its component is destroyed. The
     original component (`agent-selection.component.ts`) no longer exists; find the current
     confirm path in `libs/frontend/setup-wizard` first, and drop the item if it is safe now.
   - FU-2: split `wizard-generation-rpc.handlers.ts` (facade rule).
4. **Agents tab (skill-synthesis-ui).** FU-3 (split the Agents-tab wiring out of
   `skill-clones-view.component.ts` and add a view-level spec), FU-6 (card height, badge wrap,
   `text-warning` contrast about 2.4:1 in light), R-5 (chip and pill style), R-2 (fake-timer spec
   for the 15 s model-list timeout), R-3 (extract the agent-model methods from
   `skills-synthesis-rpc.handlers.ts`). R-4 needs a decision only.
5. **Process.** FU-11: the generated `code-logic-reviewer` role forbids all git and fixes the
   deliverable name. Allow read-only git (`git show`) and honour an explicit deliverable path.
6. **Test hygiene.** T-1: harness-sync tests that failed locally on Windows. Re-run and
   investigate separately.

## Current state (2026-11-07)

- Done since PR #635: FU-1 by `a621f0323` ("keep edited managed copies", D8). An edited owned copy
  is now kept, never overwritten (`libs/backend/harness-sync/src/lib/targets/claude-target.ts:200-339`,
  including MCP fragments). R-1 is obsolete: the snapshot-then-overwrite branch was removed.
- FU-5 open: `libs/backend/harness-sync/src/lib/targets/artifact-retirement.ts:375-389`
  (`isProvablyUnchanged`) still does `hashDir` and a separate `isFullyHashable` walk (`:404`).
- FU-7(a) open: `libs/backend/settings-core/src/scope/workspace-scope-resolver.ts:16-25` lowercases
  only the drive letter on win32.
- File sizes now: `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts`
  1768 lines, `libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts`
  1182, `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts` 1688 (timeout
  constant at `:153`).
- FU-11 open: `.claude/agents/code-logic-reviewer.md:257` still says "no git operations".
- The TASK_2026_609_c495 folder is retired. Read its files in git history:
  `git show 12b721789^:.ptah/specs/TASK_2026_609_c495/completion-report.md`.
- The first-run wizard moved into the onboarding module (PR #877). The `wizard:*` RPCs and
  `libs/frontend/setup-wizard` still exist.
