# Lane report R9r

**Status: COMPLETE** — `setCompactHeight` and every `compactHeightUnits` reference removed from the four files; rg proof 0 lines; all three spec checks green. `viewMode` behaviour fully preserved.

Batch R9r of TASK_2026_629_c0b3 (phase R9, wave 4). Parity rows 52 and 114.

## Per-file changes

### libs/frontend/chat-state/src/lib/tab-manager.service.ts
- Removed the `setCompactHeight(tabId, units)` method and its doc comment (the Grid-only height writer).
- Removed the `getTabCompactHeightUnits(tabId)` method and its doc comment — its body was the only remaining `compactHeightUnits` read, so the rg-zero acceptance cannot hold with it kept; no callers remain anywhere in the workspace (Grid consumers were deleted in R9i/R9j; `chat-view.component.ts` only mentions the field in a comment owned by R9h).
- Removed the height paragraph from the `toggleTabViewMode` doc comment (`compactHeightUnits` / `{@link setCompactHeight}` mentions).
- Trimmed the stale sentence "The stored compact height is kept." from the `setViewMode` doc comment (prose reference to the removed feature).
- PRESERVED untouched: `toggleTabViewMode`, `setViewMode`, `getTabViewMode`, `activeTabViewMode`, and `viewMode` persistence behaviour.

### libs/frontend/chat-state/src/lib/tab-manager.service.spec.ts
- Removed spec cases that only tested the removed feature:
  - `returns a tall compact tab to full on toggle, then back to the same height`
  - `setCompactHeight switches a full tab to compact at the given height`
  - `setCompactHeight is a no-op for an equal height, invalid units or a missing tab`
  - `setCompactHeight re-enters compact from full even when the height is unchanged`
- Kept the viewMode cases `toggles full and compact independently per tab, without cycling` and `selects a view mode directly and ignores repeated selections or missing tabs` unchanged.
- Trimmed the stale "Height is tab state, not a third mode." sentence from the toggle rationale comment.

### libs/frontend/chat-state/src/lib/tab-manager.persistence.spec.ts
- Rewrote `persists compactHeightUnits and restores it after a reload (TASK_2026_583)` into `persists viewMode and restores it after a reload`: identical structure (set → verify stored value; single-field change → exactly one write; reload → restored value), driven by `setViewMode` instead of `setCompactHeight`. This case carried the only `viewMode` persistence round-trip coverage in this file, so per the batch rule ("tests other behaviour and only mentions the field → strip the field, keep the case") it was rewritten, not deleted.

### libs/frontend/chat-state/src/lib/tab-manager.intent-mutators.spec.ts
- Removed spec cases that only tested the removed feature (binary-toggle coverage remains in the kept `toggleTabViewMode is binary: full to compact and straight back` case):
  - `toggleTabViewMode stays binary and keeps the last compact height`
  - `setCompactHeight writes the tab once and ignores non-positive or fractional units`

## rg proof

```
rg -n "setCompactHeight|compactHeightUnits" \
  libs/frontend/chat-state/src/lib/tab-manager.service.ts \
  libs/frontend/chat-state/src/lib/tab-manager.service.spec.ts \
  libs/frontend/chat-state/src/lib/tab-manager.persistence.spec.ts \
  libs/frontend/chat-state/src/lib/tab-manager.intent-mutators.spec.ts
```
→ 0 lines (exit 1, no output).

## Spec results (each via `node .ptah/tmp/check-run.mjs <label> -- …`, from W)

| Label | Test file | Result |
|---|---|---|
| r9r-svc | `tab-manager.service.spec.ts` | Test Suites: 1 passed, 1 total — **Tests: 60 passed, 60 total** (exit 0) |
| r9r-pers | `tab-manager.persistence.spec.ts` | Test Suites: 1 passed, 1 total — **Tests: 23 passed, 23 total** (exit 0) |
| r9r-intent | `tab-manager.intent-mutators.spec.ts` | Test Suites: 1 passed, 1 total — **Tests: 94 passed, 94 total** (exit 0) |

Command shape: `npx nx test @ptah-extension/chat-state --testFile=<file> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`.

## Decisions

- **`getTabCompactHeightUnits` removed too.** The objective says remove `setCompactHeight` and every `compactHeightUnits` reference; the getter's body reads `compactHeightUnits`, so the rg-zero acceptance forces its removal. With the height feature gone it has no purpose; workspace-wide grep confirmed no remaining callers (only `.ptah` docs and R9s/R9h-owned files mention the field).
- **Persistence case rewritten, not deleted**, because it is the only `viewMode` persistence coverage in `tab-manager.persistence.spec.ts` and the batch contract says preserve viewMode persistence. The middle "single-field change writes exactly once" assertion was kept as the viewMode analog of the removed height-change assertion.
- **Two token-free prose sentences removed** ("Height is tab state, not a third mode."; "The stored compact height is kept.") — stale references to the removed feature; rg-zero alone did not require their removal.
- **Case name drops the `(TASK_2026_583)` tag** — that task introduced the height feature; the rewritten viewMode case no longer derives from it.
- **Untouched per contract** (owned by R9s/R9h): `TabState.compactHeightUnits` in chat-types, `tab-persistence.ts`, `tab-restore-sanitize.spec.ts`, and the `chat-view.component.ts` comment. The optional type field remains, so the service and specs still compile with it present.

## Clarifications Needed

None.
