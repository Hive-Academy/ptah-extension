# Batch R0 report

## Files changed

- `libs/frontend/chat-types/src/lib/chat-types.ts` — documented optional per-tab `terminalFailureSeq`.
- `libs/frontend/chat-state/src/lib/terminal-failure-seq.ts` — internal pure `withTerminalFailureSeq` helper; no barrel export.
- `libs/frontend/chat-state/src/lib/terminal-failure-seq.spec.ts` — five required scenarios (six tests for null and undefined separately).
- `libs/frontend/chat-state/src/lib/tab-manager.service.ts` — enriches updates against `existingTab` before the equality check, within the existing signal update.
- `libs/frontend/chat-state/src/lib/tab-workspace-partition.service.ts` — enriches background updates against `existingTab` before the spread.
- `libs/frontend/chat-state/src/lib/tab-manager.terminal-failure.spec.ts` — real store wiring for repeated equal-text stamps, duplicate failed-turn stamp, and background partition.

The reset block still clears `lastTerminalReason` without clearing `terminalFailureSeq`. `NON_PERSISTED_TAB_KEYS` is unchanged. Neither writer adds a store write or signal emission.

## Check results

- `npx nx test @ptah-extension/chat-state --testFile=libs/frontend/chat-state/src/lib/terminal-failure-seq.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` — exit 0; `Test Suites: 1 passed, 1 total`; `Tests:       6 passed, 6 total`.
- `npx nx test @ptah-extension/chat-state --testFile=libs/frontend/chat-state/src/lib/tab-manager.terminal-failure.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` — exit 0; `Test Suites: 1 passed, 1 total`; `Tests:       3 passed, 3 total`.
- `npx nx test @ptah-extension/chat-state --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` — exit 0; `Test Suites: 24 passed, 24 total`; `Tests:       572 passed, 572 total`.
- `npx nx typecheck @ptah-extension/chat-state --parallel=1 --skip-nx-cache` — exit 0.
- `npx nx lint @ptah-extension/chat-state --parallel=1 --skip-nx-cache` — exit 0.
- `npx nx typecheck @ptah-extension/chat-types --parallel=1 --skip-nx-cache` — exit 0.
- `npx nx lint @ptah-extension/chat-types --parallel=1 --skip-nx-cache` — exit 0.

Scoped `ptah_get_diagnostics` found no diagnostics in the six changed source files. It reported 21 errors in untouched sibling files, outside the changed-project typecheck targets.

## A5 finding

`tab-restore-sanitize.ts` does not exist in this checkout. The actual restore path is `libs/frontend/chat-state/src/lib/tab-persistence.ts`: `projectTabForPersist` and `sanitizeRestoredTab` both spread the tab and only override named transient fields. Neither overrides `terminalFailureSeq`; `NON_PERSISTED_TAB_KEYS` omits it. A stored numeric value is retained on restore.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Add the sequence in both existing tab writers using one pure helper. | Writer-level enrichment; add sequence in each reason mutator. | Plan Component 7a specifies both writers; the `StopFailure` setter, failed `turn_state`, and background delegation all flow through them. | Yes, by removing the helper calls and field. |
| Keep the helper internal. | Internal relative import; public barrel export. | Plan Component 7a explicitly requires no barrel export. | Yes. |
| Preserve the sequence during reset and persistence. | Preserve; clear or exclude it. | Reset needs monotonic IDs; `tab-persistence.ts` uses object spreads and the non-persisted set omits the field. | Yes, though clearing it would break the approved ID contract. |

## Anything not done

None for Batch R0.
