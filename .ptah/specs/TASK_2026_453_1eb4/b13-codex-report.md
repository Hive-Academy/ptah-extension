# Batch 13 Codex report

Status: **COMPLETE** for Tasks 13.0 and 13.1. Task 13.2 was triggered by the 707-line component, then stopped as required by its anti-fragment guardrail because the extractable replay-hold/retention concern is only about 76 noncontiguous physical source lines, well below ~150.

## Acceptance-criteria checklist

### Task 13.0 — completed

- [x] AC 1: `chat-transcript.component.ts` was 700 lines before Task 13.0 and 698 lines after it.
- [x] AC 2: the falling-edge branch calls `clearReplayMotionHold()` at `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts:476`, followed by the unchanged `replayMotionHold.set(true)` and 300 ms timer. The rising edge still calls the helper at line 471.
- [x] AC 3: the Task 13.0 hunk only replaces the duplicated clear block. The final component diff contains no hunk in `onScroll`, `scheduleStickToBottom`, `restoreScrollOnActivation`, `lastScrollTop`, the render-window feed effect, or retention `cleanup()` code.
- [x] AC 4: `chat-transcript.component.spec.ts`, `chat-transcript.replay-mount.spec.ts`, and `chat-transcript.replay-motion.spec.ts` are unedited and pass in the full 81-suite chat run.

The final `clearReplayMotionHold()` body at `chat-transcript.component.ts:700-706` is:

```ts
private clearReplayMotionHold(): void {
  if (this.replayMotionHoldTimeoutId) {
    clearTimeout(this.replayMotionHoldTimeoutId);
    this.replayMotionHoldTimeoutId = null;
  }
  this.replayMotionHold.set(false);
}
```

### Task 13.1 — completed

- [x] AC 1: after Task 13.0 and before Task 13.1, transcript inputs were at `chat-transcript.component.ts:181-193`, the frozen `vm` at `:423-442`, and the chat-view transcript binding at `chat-view.component.html:65-73`. Final evidence: IO at `chat-transcript.component.ts:199-201`, frozen `vm` field at `:447`, and parent bindings at `chat-view.component.html:70-72`. The component grew from 698 to 707 physical lines. All auto-load policy remains in the directive.
- [x] AC 2: `TranscriptOlderHistorySentinelDirective` owns the passive scroll listener (`transcript-older-history-sentinel.directive.ts:48-55`), requires an upward `scrollTop` decrease to arm, requires intersection, scrollability, and `!disabled` (`:29-45`), disarms before emitting (`:44-45`), uses a half-container-height top margin (`:70`), and disconnects/removes its listener (`:76-79`). The once-per-arm/open/downward/disabled/unscrollable cases are covered at `chat-transcript.older-history.spec.ts:221-281`.
- [x] AC 3: the real button and replay/availability gate are at `chat-transcript.component.html:7-23`. It has `type="button"`, visible `focus-visible` outline classes, `aria-busy`, and loading disablement. The no-`IntersectionObserver` manual-button fallback and loading state are covered at `chat-transcript.older-history.spec.ts:184-219`.
- [x] AC 4: per-tab bindings are at `chat-view.component.html:70-72`. The protected reads are at `chat-view.component.ts:176-184`; cursor availability is true only for a string, and loading reads `historyPaging.loadingTabIds()`. Their tests are at `chat-view.component.spec.ts:496-517`.
- [x] AC 5: the final component diff has only import, view-model, component IO, view-model population, and Task 13.0 replay-clear hunks. Safeguard scans returned `CSS_DIFF=False`, `CONTENT_VISIBILITY_ADDED=False`, `SCROLL_WRITE_ADDED=False`, and `TODO_STUB_ADDED=False`. The three protected existing specs remain unedited and green.

### Task 13.2 — triggered, stopped by guardrail

- [n/a] AC 1: no facade split was created. The batch explicitly prohibits extracting a fragment under ~150 lines.
- [x] AC 2: measured extractable concern is about 76 noncontiguous physical lines: fields/signals around `chat-transcript.component.ts:217-218,252,283-292`; replay edge `:464-484`; retention edge `:537-550`; cleanup calls `:673,678`; release/clear methods `:681-706`. This is materially below ~150, so `transcript-replay-hold.service.ts` was not created.
- [n/a] AC 3: component remains 707 lines because the split guardrail won; no collaborator file exists.
- [x] AC 4: the render-window feed effect remains untouched and continues to read raw `historyReplaying()`; no protected scroll-method hunk, CSS diff, or scroll write exists.
- [x] AC 5: all four transcript specs, including the new older-history spec, pass. The three pre-existing specs are unedited.
- [n/a] AC 6: `libs/frontend/chat/CLAUDE.md` was not changed because no collaborator was created.

Task 13.2 result: **STOPPED (extractable concern ~76 lines; no fragment created), component 707 lines**.

## Line counts

- Task 13.0: component 700 before, 698 after.
- Task 13.1: component 698 before, 707 after.
- Task 13.2: triggered at 707; approximately 76 extractable concern lines, below the ~150 floor; no split; final component 707.
- New directive: 83 lines.
- New older-history spec: 297 lines.

## Files changed

- MODIFIED `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts` — Task 13.0 timer-clear reuse plus Task 13.1 IO/view-model/import.
- MODIFIED `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.html` — sentinel row and accessible manual button.
- CREATED `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-older-history-sentinel.directive.ts` — upward-scroll-armed observer policy.
- CREATED `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.older-history.spec.ts` — affordance, fallback, arming, disablement, scrollability, and teardown coverage.
- MODIFIED `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` — only the two approved protected per-tab read methods.
- MODIFIED `libs/frontend/chat/src/lib/components/templates/chat-view.component.html` — per-tab affordance bindings.
- MODIFIED `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts` — added tests/stub state for the two approved protected reads; no existing assertion changed.
- MODIFIED `.ptah/specs/TASK_2026_453_1eb4/b13-codex-report.md` — this report.

## Verification output

- Preferred Ptah tooling: unavailable; the session inventory contained no `ptah_*` tools. Read-only PowerShell/`rg` inspection and `apply_patch` were used.
- Test-runner guard: initial check found `ACTIVE_TEST_RUNNERS=2`, a later check found 16 while another suite expanded, and execution waited. Immediately before each successful targeted/full run: `ACTIVE_TEST_RUNNERS=0`.
- Tests: `npx nx run-many -t test -p @ptah-extension/chat --parallel=1 --maxWorkers=2`
  - Literal header: `NX   Running target test for project @ptah-extension/chat:` followed by `- @ptah-extension/chat`.
  - Literal summary: `Test Suites: 81 passed, 81 total`; `Tests: 2 skipped, 1297 passed, 1299 total`; `NX   Successfully ran target test for project @ptah-extension/chat`.
- Typecheck: `npx nx run-many -t typecheck -p @ptah-extension/chat ptah-extension-webview --parallel=1`
  - Literal header: `NX   Running target typecheck for 2 projects:` followed by `- @ptah-extension/chat` and `- ptah-extension-webview`.
  - Literal summary: `NX   Successfully ran target typecheck for 2 projects`.
- Lint/audit: `npx nx run-many -t lint -p @ptah-extension/chat degradation-audit --parallel=1`
  - Literal header: `NX   Running target lint for 2 projects:`.
  - Literal chat summary: `✖ 17 problems (0 errors, 17 warnings)`; all are pre-existing warnings in other files/lines. The new older-history files have no warnings.
  - `chat-transcript.component.ts` max-lines state: **no lint warning emitted** even though its physical count is 707 (the rule's counted-line behavior stays under its threshold).
  - Literal touched-directory audit row: `libs/frontend/chat: 11 ok (baseline 11)`.
  - Literal audit total: `degradation-audit: TOTAL 303 unsuppressed site(s)`.
  - Literal summary: `NX   Successfully ran target lint for 2 projects`.
- Development build: `npx nx run ptah-extension-webview:build:development`
  - Literal summary: `Application bundle generation complete.` and `NX   Successfully ran target build for project ptah-extension-webview and 3 tasks it depends on`.
- Production build: `npx nx run ptah-extension-webview:build:production`
  - Literal summary: `Application bundle generation complete.` and `NX   Successfully ran target build for project ptah-extension-webview and 3 tasks it depends on`.
  - Allowed existing warning: `bundle initial exceeded maximum budget. Budget 2.50 MB was not met by 426.51 kB with a total of 2.93 MB.`
- Prettier: `npx prettier --check` was run on all seven changed source/spec files plus this report. Literal result: `Checking formatting...` and `All matched files use Prettier code style!`.
- Diff: `git diff --check` returned no output. `git status --short` contains only the seven authorized source/spec files plus this report. No transcript CSS file is changed.

## Design fidelity and states covered

- Followed implementation-plan section (ii).6 C13 and decision 2: manual button plus auto-load armed only by an upward user scroll.
- Covered available, unavailable, loading, replay-hidden, observer-unavailable, downward/open, upward/intersecting, unscrollable, once-per-arm, and destroy states.
- Accessibility: semantic keyboard-operable button, explicit button type, visible focus outline, loading disablement, and `aria-busy`.

## Plan deviations

- The orchestrator approved expanding scope to `chat-view.component.ts` for exactly two protected read methods and to `chat-view.component.spec.ts` for their tests. `historyPaging` remains private; no other component logic was changed.
- Task 13.2 did not create the planned collaborator because its own >= ~150-line guardrail rejected the approximately 76-line extraction. The component remains physically above 700 lines, while ESLint emits no max-lines warning for it.

## Blocking findings

None.

## Clarifications Needed

None. The prior accessor-scope clarification was answered with “Expand scope for protected accessors” and implemented as approved.

## Out-of-scope observations

- Nx prints `Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.` after commands. No configuration change was authorized or made.
- The production webview build retains its allowed pre-existing initial-bundle budget warning.

## Revise round 1

Status: **COMPLETE**. Both logic-review moderate findings, the recommended failure-mode assertion, the style-review serious finding, and the three requested style minors were resolved. No Task 13.2 split was started.

### Finding → resolution

1. **Cross-workspace tab lookup**: `ChatViewComponent.hasOlderHistory` now resolves with `this._tabManager.findTabByIdAcrossWorkspaces(tabId)?.tab` at `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:176-179`, matching `HistoryPagingService.loadOlder`. The affordance spec supplies a cursor only through the cross-workspace lookup for a tab absent from `tabs()` and proves it renders as available at `chat-view.component.spec.ts:498-514`.
2. **Same-tick manual/auto dedup**: the real `HistoryPagingService` spec calls `loadOlder(TAB)` once as `manualClick` and once as `autoLoadEmit` before the RPC settles, asserts both calls return the same promise, and asserts exactly one RPC at `history-paging.service.spec.ts:122-148`.
3. **Inactive frozen-view catch-up**: the transcript spec starts without older history, deactivates, sets `hasOlderHistory` while inactive, verifies the button stays absent, then reactivates and verifies the button appears at `chat-transcript.older-history.spec.ts:203-219`.
4. **Public IO documentation/type consistency**: all three paging IO members now have one-line contract comments; both booleans use `input<boolean>(false)` at `chat-transcript.component.ts:199-204`.
5. **Import order**: `TranscriptOlderHistorySentinelDirective` now precedes `TranscriptRenderWindow` and `TranscriptSlotDirective` at `chat-transcript.component.ts:29-31`.
6. **Dead replay disable branch**: removed `|| historyReplaying()` from the sentinel's `[disabled]`; the enclosing replay gate remains authoritative. No spec depended on the redundant branch, and the full suite passes. Evidence: `chat-transcript.component.html:7-13`.
7. **Dual output paths**: short template comments identify the sentinel auto-load path at `chat-transcript.component.html:8` and manual button path at `:15`.

### Files changed in revise round 1

- MODIFIED `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts` — import order and documented, explicit paging IO.
- MODIFIED `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.html` — removed redundant disable clause and documented auto/manual emission paths.
- MODIFIED `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.older-history.spec.ts` — inactive-to-active frozen-view catch-up assertion.
- MODIFIED `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` — cross-workspace tab resolution.
- MODIFIED `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts` — cross-workspace affordance proof.
- MODIFIED `libs/frontend/chat/src/lib/services/chat-store/history-paging.service.spec.ts` — real-service same-tick manual/auto dedup proof.
- MODIFIED `.ptah/specs/TASK_2026_453_1eb4/b13-codex-report.md` — this revise-round record.

### Line counts

- `chat-transcript.component.ts`: 707 before revise round 1 → 710 after (three required one-line IO comments; no split).
- `chat-transcript.older-history.spec.ts`: 297 → 315.
- `chat-view.component.ts`: 1,337 → 1,335 (cross-workspace lookup is shorter).
- `chat-view.component.spec.ts`: 1,565 → 1,576.
- `history-paging.service.spec.ts`: 189 → 216.

### Verification

- Runner guard before tests: literal `ACTIVE_TEST_RUNNERS=0`.
- Tests: `npx nx run-many -t test -p @ptah-extension/chat --parallel=1 --maxWorkers=2`
  - Literal header: `NX   Running target test for project @ptah-extension/chat:` followed by `- @ptah-extension/chat`.
  - Literal summary: `Test Suites: 81 passed, 81 total`; `Tests: 2 skipped, 1299 passed, 1301 total`; `NX   Successfully ran target test for project @ptah-extension/chat`.
- Typecheck: `npx nx run-many -t typecheck -p @ptah-extension/chat ptah-extension-webview --parallel=1`
  - Literal header: `NX   Running target typecheck for 2 projects:` followed by `- @ptah-extension/chat` and `- ptah-extension-webview`.
  - Literal summary: `NX   Successfully ran target typecheck for 2 projects`.
- Lint/audit: `npx nx run-many -t lint -p @ptah-extension/chat degradation-audit --parallel=1`
  - Literal summary: `✖ 17 problems (0 errors, 17 warnings)` and `NX   Successfully ran target lint for 2 projects`.
  - Literal touched-directory row: `libs/frontend/chat: 11 ok (baseline 11)`.
  - Literal total: `degradation-audit: TOTAL 303 unsuppressed site(s)`.
  - No warning is emitted for the new/changed Batch 13 files; the 17 warnings are pre-existing elsewhere.
- Webview builds: not rerun, per revise-round instruction; typecheck found no template issue.
- Prettier: `npx prettier --check` ran on all eight changed source/spec files plus this report. Literal result: `Checking formatting...` and `All matched files use Prettier code style!`.
- Diff safeguards: literal results were `onScroll=False`, `scheduleStickToBottom=False`, `restoreScrollOnActivation=False`, `lastScrollTop=False`, `cleanup\(=False`, `setReplayRetention=False`, `syncMessages=False`, `CSS_DIFF=False`, `CONTENT_VISIBILITY_ADDED=False`, and `SCROLL_WRITE_ADDED=False`. `git diff --check` returned no output.

### Plan deviations and blockers

- Plan deviations: none beyond the explicitly requested review revisions.
- Blocking findings: none.
- Clarifications needed: none.
