# Code review — TASK_2026_693_5e0e

## Summary

| Metric | Result |
| --- | --- |
| Score | **6/10** |
| Verdict | **REVISE** |
| Findings | 1 Serious, 1 Moderate, 1 Minor |
| Failure modes traced | 3 |

The page counter follows replay's current user-message filters and assistant-run grouping, and the new SDK reader token is registered before the handler in all three hosts. The two behavior gaps below keep this out of the 7–8 band. They do not warrant 5 or below: the ordinary count path, pointer-specific release, and the two presentation fixes have direct supporting code and tests.

## Findings

### Serious — A cold session page can miss the existing latency target and return incomplete counts

`session:list` awaits counting before returning any rows (`libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts:471-486`). The shared budget is 1,500 ms and four transcript streams run at once (`libs/backend/rpc-handlers/src/lib/handlers/session-message-count.ts:26-33,159-179`), while this RPC already warns after 200 ms and its performance spec requires p95 below 200 ms (`session-rpc.handlers.ts:115,573-579`; `session-list.perf.spec.ts:140-141,312-343`). With several cold, large transcripts, users wait up to the counting budget before seeing the list, and rows whose reads abort receive `messageCount: 0`, hiding their label (`session-message-count.ts:198-219`; `session-rpc.handlers.ts:525`). The performance spec passes an unused reader because it indexes no transcripts (`session-list.perf.spec.ts:275-300`); it therefore does not measure this new path. The `fs.stat` call also precedes the abort check, so the stated 1.5 s bound is not a hard bound if metadata I/O stalls (`session-message-count.ts:186-198`). Preserve the list latency contract with a measured cold-transcript test and a bounded or asynchronous enrichment path. Test the page with more rows than four workers can count inside the budget, and define how an unavailable count is represented.

### Moderate — Hiding and reopening the board can retain a stale text hold

The effect runs only while `visible()` is true (`libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:369-372`). Its cleanup removes listeners and clears pointer IDs but never clears `holdTabId` (`:438-443`); the hold is passed to the rail (`:89-99`) and then to each card as `holdText` (`libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts:216`). Hiding the board during a press, then showing it again, can keep that card's text held with no pointer left to release it. Destruction leaves the same stale state. The new destroy spec checks removed listeners, then *sets* `holdTabId` after destruction, so it cannot catch this (`libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts:896-919`). Clear the hold in cleanup and assert it is null immediately after `fixture.destroy()` and after a visible→hidden→visible cycle. The new lost-capture test does assert that the other tracked pointer remains active (`:865-894`).

### Minor — Duplicated replay filters have no parity guard

The counter copies skill/meta and hidden-user checks (`libs/backend/rpc-handlers/src/lib/handlers/session-message-count.ts:69-95`) used by replay (`libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts:135-163`). The copied rules match the inspected current replay path, but the new test hard-codes an expected count instead of comparing the same transcript with replay or a shared predicate (`libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.spec.ts:908-952`). A later replay filter change can silently make sidebar counts disagree with loaded chat. Add a parity test or share the filter implementation through the public SDK surface.

## Five logic questions

1. **Silent failure:** read, stat, or budget failure returns no count and the RPC substitutes zero; the UI hides the count label (`session-message-count.ts:211-219`; `session-rpc.handlers.ts:525`; `libs/frontend/chat/src/lib/components/molecules/session-list-row/session-list-row.component.ts:231-232`). A debug log records read errors, but the returned row does not distinguish unavailable from empty.
2. **User action:** hiding the board during a pointer hold and reopening it can preserve a stale held card, because effect cleanup omits `holdTabId` (`canvas-rail-board.component.ts:369-372,438-443`).
3. **Wrong input answer:** a cold page of many large transcripts can exceed the shared count budget; later rows look count-less although their transcript exists (`session-message-count.ts:159-179,198-219`; `session-rpc.handlers.ts:525-529`).
4. **Dependency failure:** `projectJsonlLines` rejection is caught, logged at debug, and mapped to an absent label (`session-message-count.ts:200-219`). A stalled `fs.stat` is outside the signal check (`:186-198`).
5. **Unspecified case:** requirements do not define whether a count is allowed to be unavailable or stale, even though the API always sends a number (`session-rpc.handlers.ts:525`). The cold-list 200 ms contract also lacks a transcript-backed regression test (`session-list.perf.spec.ts:275-300,312-343`).

## Traced paths and remaining checks

- **FU-13:** metadata is filtered and paginated, surviving transcript IDs are indexed, and only page rows are counted (`session-rpc.handlers.ts:437-486`). Counting resets at compaction and groups consecutive assistant records (`session-message-count.ts:127-143`), matching the inspected replay sequence (`session-replay.service.ts:100-113,130-163,224-240`). The per-process cache keys by path and exact size/mtime and evicts after 512 entries (`session-message-count.ts:187-209,223-229`); append changes size and causes a recount. Same-size, same-mtime external rewrites remain an uncommon stale-cache possibility. `degradation-audit: optional-capability` comments accompany the malformed-line and read-failure catches (`:110-113,211-219`).
- **DI:** `SDK_JSONL_READER` is registered in `libs/backend/agent-sdk/src/lib/di/register.ts:177-181`; SDK registration precedes session-handler registration in VS Code (`apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:179`, `phase-3-handlers.ts:70`), Electron (`apps/ptah-electron/src/di/phase-2-libraries.ts:218`, `phase-4-handlers.ts:91`), and CLI (`libs/backend/cli-engine/src/lib/container.ts:678,849`). No new `expected-resolvable.ts` entry is needed for the token; existing DI guards do not specifically measure the new cold-count latency.
- **FU-14:** `lostpointercapture` now uses the same pointer-ID deletion as `pointerup` (`canvas-rail-board.component.ts:393-395,431-435`); hidden page and blur release all tracked IDs (`:384-395,418-423`). The visibility and lost-capture specs exercise state and listener removal; the Tab-from-outside spec manually focuses the target after a synthetic Tab, so it verifies `focusin` handling, not browser Tab navigation (`canvas-rail-board.component.spec.ts:1950-1986`).
- **FU-12:** `bottom-end` lets Floating UI shift horizontally, and the content width is capped to viewport minus 1 rem (`canvas-rail-card.component.ts:175-178,295`; `libs/frontend/ui/src/lib/native/popover/native-popover.component.ts:249-256`; `libs/frontend/ui/src/lib/native/shared/floating-ui.service.ts:135-147`). The spec asserts the placement and classes, not clipping at an actual 400 px viewport (`canvas-rail-card.component.spec.ts:556-572`). The existing `z-40` backdrop, `z-50` panel, focus ring, and equal-width button grid remain in place (`native-popover.component.ts:90-104`; `canvas-rail-card.component.ts:297-305`). FU-15's visual check is outside this diff.
- **FU-16:** the edit wrapper inherits the host's inset shadow and squares its left corners (`session-list-row.component.ts:75-103,152-155`); the spec checks CSS text and wrapper structure rather than rendered pixels (`session-list-row.component.spec.ts:225-244`). No concrete layout regression was established.

## Verification and decision

The orchestrator reports changed-project typecheck, lint, and tests green. Scoped `ptah_get_diagnostics` returned **unavailable** after its 45 s TypeScript timeout, so it adds no independent pass claim. I ran no Jest check because the relevant suites were already reported green and the key open risk is a cold-transcript performance scenario those suites do not exercise. No source files were edited.

**Decision:** REVISE. Preserve the 200 ms list behavior or explicitly change that contract with evidence, and clear the board hold on effect cleanup. The count-unavailable representation and shared replay predicate are reversible design choices; a typed unavailable state is preferable to treating every failed count as zero.
