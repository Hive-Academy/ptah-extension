# Batch 14A Codex report — top-boundary prepend anchor

## Outcome

Implemented the narrow transcript-only scroll exception for an older-history HEAD prepend at exact `scrollTop === 0`. A component-local directive captures the first visible persistent message slot before Angular reconciles the `@for`, restores that slot's viewport offset in `afterNextRender`, and performs exactly one `scrollTop` assignment. Native overflow anchoring remains responsible for every non-zero scroll position and for later placeholder/mount height changes.

## Historical implementation checklist

This checklist records the implementation state before the final required headed verification. The later full headed run was not green (`2 failed, 3 passed`): its nominal zero-target case settled at `scrollTopBefore=5226`, while the later exact-zero diagnostic passed with `offsetDelta=0` and the non-zero diagnostic still failed. The pinned case remained valid and passed with its required `distance-from-bottom=0.00px` precondition.

- [x] **1 — Detect only a strict HEAD prepend.** `transcript-prepend-anchor.directive.ts:61-66,123-133` requires a non-empty prior list, a longer next list, identical tab and session identities, and every prior message id as the next list's contiguous suffix. This excludes initial population, live append, replacement, tab switch, and session switch. Specs cover append/replacement/session/tab changes at `transcript-prepend-anchor.directive.spec.ts:138-153`.
- [x] **2 — Apply every eligibility gate.** `transcript-prepend-anchor.directive.ts:61-72` requires the transcript to have been active and remain active, the same tab/session, no raw history replay, not pinned, and exact `scrollTop === 0`. Pinned, replaying, and inactive cases are covered at `transcript-prepend-anchor.directive.spec.ts:123-136`.
- [x] **3 — Capture before DOM update; restore after render.** The directive is attached to the scroll container before its descendant `@for` (`chat-transcript.component.html:1-10`). Its `ngOnChanges` capture runs while the old descendant DOM is present (`transcript-prepend-anchor.directive.ts:54-75`); it selects the first slot whose rectangle intersects the container (`:84-99`). `afterNextRender` then locates the same id and writes only when that slot still exists (`:101-119`). Slots carry stable message ids at `chat-transcript.component.html:38-44`. Missing-anchor behavior is covered at `transcript-prepend-anchor.directive.spec.ts:156-164`.
- [x] **4 — One downward write; no sentinel re-arm.** The sole assignment is `root.scrollTop = root.scrollTop + nextOffset - anchor.offset` at `transcript-prepend-anchor.directive.ts:116`. The geometry-stubbed spec proves exactly one write from `0` to `200` at `transcript-prepend-anchor.directive.spec.ts:100-111`. Therefore both unchanged scroll listeners observe an increase: `ChatTranscriptComponent.onScroll` computes `movedUp` as false, while `TranscriptOlderHistorySentinelDirective` arms only for `nextScrollTop < lastScrollTop`. The already-green `chat-transcript.older-history.spec.ts` continues to prove that upward movement is required before auto-load. No second page is armed by the compensating write.
- [x] **5 — Small nameable collaborator and facade discipline.** `TranscriptPrependAnchorDirective` owns detection, measurement, timing, and restoration. The component only imports it, exposes its existing session/pin state, and binds inputs (`chat-transcript.component.ts:27-31,145-150,317-321,606-608`; `chat-transcript.component.html:1-10`). The component finishes at 716 physical lines, below the requested ~720 threshold.
- [x] **6 — Required specs.** `transcript-prepend-anchor.directive.spec.ts:69-164` explicitly stubs jsdom geometry and covers top-zero/exactly-one-write, non-zero/native, pinned, replaying, inactive, append, replacement, session switch, tab switch, and missing anchor. The four named existing transcript specs and CSS are unedited; the full chat suite passed.
- [x] **7 — Tail-paging documentation.** `libs/frontend/chat/CLAUDE.md:78` documents the only paging-path scroll write and all top-boundary gates in one sentence.

## Prepend-detection rule

Let `previous` contain `p > 0` messages and `next` contain `n > p` messages. The change is a prepend only when:

1. the directive was active before the update and is active for the update;
2. tab id and session id are unchanged; and
3. for every `i` in `[0, p)`, `next[n - p + i].id === previous[i].id`.

This is deliberately stricter than count growth. New ids may occur only before the complete prior sequence.

## Timing hook

`ngOnChanges` on the scroll-container directive is the pre-reconciliation capture point: Angular applies the container directive's bound inputs before reconciling the nested `@for`, which the geometry spec exercises. `afterNextRender` is the zoneless-safe post-render hook; it avoids timer/rAF guessing and sees the final DOM for the atomic prepend render. A monotonically increasing revision cancels a pending restoration if another directive input update supersedes it before the callback.

## Scroll and sentinel reasoning

The eligible state starts at `scrollTop === 0`. A real prepend moves the retained anchor down by the inserted height, so the one assignment increases `scrollTop` by that positive offset delta. The new spec observes `0 -> 200` with one setter call. The untouched component handler therefore sees a downward movement (`top < lastScrollTop - 1` is false), so it does not unpin/re-pin incorrectly. The untouched sentinel also sees an increase, while its arm condition is strictly decreasing scrollTop; its prior arm was consumed when it emitted the page request. Later slot/placeholder height changes are left to `overflow-anchor: auto`.

## Files changed and line counts

Physical line counts use `Get-Content` against `HEAD` and the working tree.

| File                                                                                                     | Before | After | Change                                                         |
| -------------------------------------------------------------------------------------------------------- | -----: | ----: | -------------------------------------------------------------- |
| `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts`                |    710 |   716 | Import/bind collaborator and expose existing session/pin state |
| `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.html`              |     85 |    95 | Attach directive inputs and stable slot id attribute           |
| `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-prepend-anchor.directive.ts`      |      0 |   133 | New component-local prepend-anchor collaborator                |
| `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-prepend-anchor.directive.spec.ts` |      0 |   170 | New explicit-geometry unit coverage                            |
| `libs/frontend/chat/CLAUDE.md`                                                                           |     79 |    79 | One Tail paging sentence appended in place                     |

No CSS file was changed. The directive is a complete, nameable behavior seam rather than a file-size-only extraction.

## Stack observed

- Angular `21.2.6` from `package.json`; standalone directive/component, signal inputs, `inject()`, `afterNextRender`, and mandatory `OnPush` component convention.
- Transcript view state remains Angular signals/computed state in `chat-transcript.component.ts`.
- Existing Tailwind/daisyUI classes and transcript CSS/native anchoring remain unchanged.

## Verification output

Pre-test worker check (the query excluded its own PowerShell process):

```text
PRE_TEST_WORKER_COUNT=0
```

1. `npx nx run-many -t test -p @ptah-extension/chat --parallel=1 --maxWorkers=2`

```text
NX   Running target test for project @ptah-extension/chat:
Test Suites: 82 passed, 82 total
Tests:       2 skipped, 1309 passed, 1311 total
NX   Successfully ran target test for project @ptah-extension/chat
```

The header names exactly one project. This includes the four required existing transcript specs unchanged and the new directive spec.

2. `npx nx run-many -t typecheck -p @ptah-extension/chat ptah-extension-webview --parallel=1`

```text
NX   Running target typecheck for 2 projects:
- @ptah-extension/chat
- ptah-extension-webview
NX   Successfully ran target typecheck for 2 projects
```

3. `npx nx run-many -t lint -p @ptah-extension/chat degradation-audit --parallel=1`

```text
NX   Running target lint for 2 projects:
✖ 17 problems (0 errors, 17 warnings)
degradation-audit: TOTAL 303 unsuppressed site(s)
NX   Successfully ran target lint for 2 projects
```

All 17 lint warnings are pre-existing and outside the touched files. `chat-transcript.component.ts` produced no `max-lines` warning; it is 716 physical lines after the change (710 before).

4. `npx nx run ptah-extension-webview:build:development`

```text
Application bundle generation complete. [17.832 seconds]
NX   Successfully ran target build for project ptah-extension-webview and 3 tasks it depends on
```

5. Prettier and forbidden-hunk proof:

```text
Checking formatting...
All matched files use Prettier code style!
FORBIDDEN_HUNK_SEARCH
[no output]
CHANGED_EXISTING_SPECS_OR_CSS
[no output]
```

The zero-context diff search checked added/removed lines for `onScroll`, `scheduleStickToBottom`, `restoreScrollOnActivation`, `lastScrollTop`, the `renderWindow.syncMessages` feed, `cleanup()`, retention, and `.css`. There are no hunks for them. A direct `git diff --name-only` over the four named existing specs and transcript CSS also returned no paths.

No Playwright/e2e command was run.

## Deviations

- The requested `ptah_*` tools were unavailable in this session, so repository discovery used read-only PowerShell/`rg`; edits used `apply_patch`.
- The first typecheck pass exposed non-iterable `NodeList` typings in the library target. The loop was changed to `Array.from(...)`; the final required typecheck is green for both projects.
- No product or test requirement deviation.

## Blocking findings

None.

## Revise round 1

### Outcome and root cause

The headed Electron regression now passes all five cases. Instrumentation showed two real-browser-only causes behind the first implementation's overshoot:

1. The direct e2e jump to `scrollTop = 0` could leave the component's mutable pin state stale because `onScroll` saw the same previously recorded offset. The first failing trace reached the directive with `pinnedToBottom=true` and `scrollTop` already at the old bottom (for example 7,398 px), so the directive correctly refused capture and the existing pinned follow scheduled the later bottom write. The scroll binding now synchronously reconciles direct-jump geometry after the unchanged `onScroll` call (`chat-transcript.component.html:11`; `chat-transcript.component.ts:604-614`). This only clears a stale pin when the measured distance exceeds the existing `NEAR_BOTTOM_PX`; it does not create a second scroll write.
2. Once the stale pin was cleared, the retained anchor was captured before reconciliation and restored after render, but the first trace still drifted 14 px because prepended 120 px placeholders mounted after the measurement. The directive now temporarily force-mounts only the newly prepended prefix for the render containing the one anchor write (`transcript-prepend-anchor.directive.ts:56-60,86-94`; `chat-transcript.component.html:44-49`), then clears that set immediately (`transcript-prepend-anchor.directive.ts:124-130`). Native overflow anchoring owns all subsequent placeholder changes after `scrollTop` is non-zero.

The trace ruled out the other candidates: the captured id was a retained suffix message rather than a prepended id; `ngOnChanges` observed its old-DOM offset before descendant reconciliation; the e2e top-visible message and directive anchor agreed; and the compensating write was an increase, so neither the upward-only sentinel arm nor the unchanged `onScroll` upward branch ran. All temporary console and e2e probes were removed (`rg` returned `NO_TEMP_PROBES`).

### Fix evidence

- Strict HEAD-prepend detection remains a non-empty previous list preserved as the complete contiguous suffix of a longer next list, with unchanged tab/session and active-before/active-now identity (`transcript-prepend-anchor.directive.ts:63-84,153-163`). Empty-to-populated, append, replacement, tab switch, and session switch cannot qualify.
- `ngOnChanges` is intentional: its comment records that the anchor must be read from the old DOM at the pre-reconciliation lifecycle point, whereas a signal `effect()` runs too late (`transcript-prepend-anchor.directive.ts:63-65`).
- The first-visible scan stops at the first intersecting slot or once slots are below the viewport; the cost bound is documented inline (`transcript-prepend-anchor.directive.ts:104-121`). Restore uses the stable `data-ptah-transcript-message-id` selector (`:12,134-143`).
- The only compensating assignment remains `root.scrollTop = root.scrollTop + delta` (`transcript-prepend-anchor.directive.ts:144-149`). Non-positive and larger-than-`scrollHeight` deltas are rejected before it.
- The forced-mount set is cleared after the write or superseded input, so it is transient and does not become retention policy (`transcript-prepend-anchor.directive.ts:71,124-130`).

### Review finding resolutions

- Logic moderate, initial population: added explicit empty-to-populated no-write coverage (`transcript-prepend-anchor.directive.spec.ts:131-138`).
- Logic moderate, scan cost: bounded the ordered viewport scan and documented the stopping condition (`transcript-prepend-anchor.directive.ts:104-121`); anchor restore uses its stable attribute identity.
- Logic minor, defensive delta: reject non-positive and oversized deltas (`transcript-prepend-anchor.directive.ts:144-149`), with both cases covered (`transcript-prepend-anchor.directive.spec.ts:181-202`).
- Style serious, lifecycle choice: added the pre-reconciliation `ngOnChanges` rationale (`transcript-prepend-anchor.directive.ts:63-65`).
- Style minor, selector convention: renamed the slot marker to `data-ptah-transcript-message-id` (`chat-transcript.component.html:44`; directive `:12`).
- Style minor, pin getter: documented it as directive wiring and added optional direct-jump reconciliation (`chat-transcript.component.ts:604-614`).
- Style minor, type name: renamed the local contract to `TranscriptMessageIdentity` (`transcript-prepend-anchor.directive.ts:20,42,50,154-155`).

### Final line counts

Physical counts are `HEAD -> working tree`:

| File                                          | Before | After |
| --------------------------------------------- | -----: | ----: |
| `chat-transcript.component.ts`                |    710 |   720 |
| `chat-transcript.component.html`              |     85 |    99 |
| `transcript-prepend-anchor.directive.ts`      |      0 |   163 |
| `transcript-prepend-anchor.directive.spec.ts` |      0 |   209 |
| `libs/frontend/chat/CLAUDE.md`                |     79 |    79 |

The component is exactly 720 physical lines and emits no `max-lines` warning. No CSS or existing transcript spec changed.

### Final verification

Every unit/e2e launch was preceded by the requested node-process query using the literal pattern:

```text
RUNNER_PATTERN=jest-worker|run-executor COUNT=0
```

1. `npx nx run-many -t test -p @ptah-extension/chat --parallel=1 --maxWorkers=2`

```text
NX   Running target test for project @ptah-extension/chat:
- @ptah-extension/chat
Test Suites: 82 passed, 82 total
Tests:       2 skipped, 1312 passed, 1314 total
NX   Successfully ran target test for project @ptah-extension/chat
```

The jsdom directive specs explicitly stub `getBoundingClientRect`, `scrollTop`, and `scrollHeight`; they do not rely on jsdom layout.

2. `npx nx run-many -t typecheck -p @ptah-extension/chat ptah-extension-webview --parallel=1`

```text
NX   Running target typecheck for 2 projects:
- @ptah-extension/chat
- ptah-extension-webview
NX   Successfully ran target typecheck for 2 projects
```

3. `npx nx run-many -t lint -p @ptah-extension/chat degradation-audit --parallel=1`

```text
17 problems (0 errors, 17 warnings)
degradation-audit: TOTAL 303 unsuppressed site(s)
NX   Successfully ran target lint for 2 projects
```

The warnings are pre-existing and outside touched files; `chat-transcript.component.ts` has no max-lines warning.

4. `npx nx run ptah-extension-webview:build:development`

```text
Application bundle generation complete. [19.279 seconds]
NX   Successfully ran target build for project ptah-extension-webview and 3 tasks it depends on
```

5. Final authorized headed regression:

`npx nx run ptah-electron-e2e:e2e -- src/specs/chat/tile-load-older-history.spec.ts --reporter=list --headed`

```text
[load-older e2e][scrollTop-zero] scrollTopBefore=0.00px scrollTopAfter=5586.00px scrollHeightBefore=7449.00px scrollHeightAfter=13161.00px prependedHeight=5712.00px offsetDelta=1.00px
[load-older e2e][scrollTop-nonzero] scrollTopBefore=300.00px scrollTopAfter=5609.00px scrollHeightBefore=7449.00px scrollHeightAfter=12897.00px prependedHeight=5448.00px offsetDelta=0.13px
[load-older e2e] pinned-prepend distance-from-bottom=0.00px
5 passed (1.3m)
NX   Successfully ran target e2e for project ptah-electron-e2e and 2 tasks it depends on
```

6. Formatting and forbidden-hunk proof:

```text
All matched files use Prettier code style!
FORBIDDEN_ADDED_OR_REMOVED_LINES=[no output]
CHANGED_EXISTING_SPECS_OR_CSS=[no output]
TEMPORARY_PROBES=[no output]
```

The zero-context source diff has no added/removed line in `onScroll`, `scheduleStickToBottom`, `restoreScrollOnActivation`, `lastScrollTop` handling, the render-window feed effect, `cleanup()` retention, or CSS. The template still calls the unchanged `onScroll` first, followed by the narrow directive-pin reconciliation. The compensating write raises `scrollTop`, so the next unchanged `onScroll` observes downward movement and the older-history sentinel cannot arm another request.

### Deviations and blocking findings

- Temporary read-only e2e console probes were used as authorized and removed. No permanent file under `apps/ptah-electron-e2e/**` was changed by this lane.
- The direct `ptah_*` tools were unavailable in this session; reads used PowerShell/`rg`, and edits used `apply_patch`.
- No requirement deviation. No blocking finding.

## Revise round 2

### Binding-decision correction

Removed the round-1 pin reconciliation completely:

- `chat-transcript.component.html:11` is restored to the pure `(scroll)="onScroll($event)"` binding.
- `chat-transcript.component.ts:604-608` exposes `isPinnedToBottom()` as a parameterless, mutation-free read for directive wiring.
- The accepted transient forced mount and all round-1 review fixes remain unchanged.

The e2e anchor helper now uses stepped programmatic scrolling as the user-like input method. It divides the current-to-target distance into at least four steps and no more than 500 px per step; each decreasing `scrollTop` assignment dispatches a real `scroll` event and awaits one `requestAnimationFrame` before the next step. The same helper is used for both target 0 and target 300, and all assertions (including the 2 px limit) remain unchanged.

### Required headed result

Before the full headed run:

```text
RUNNER_PATTERN=jest-worker|run-executor COUNT=0
```

Command:

`npx nx run ptah-electron-e2e:e2e -- src/specs/chat/tile-load-older-history.spec.ts --reporter=list --headed`

Literal measurement lines and summary:

```text
[load-older e2e][scrollTop-zero] scrollTopBefore=5226.00px scrollTopAfter=5323.00px scrollHeightBefore=12633.00px scrollHeightAfter=12744.00px prependedHeight=111.00px offsetDelta=0.13px
[load-older e2e][scrollTop-nonzero] scrollTopBefore=300.00px scrollTopAfter=314.00px scrollHeightBefore=7977.00px scrollHeightAfter=13063.00px prependedHeight=5086.00px offsetDelta=5072.75px
[load-older e2e] pinned-prepend distance-from-bottom=0.00px
2 failed
3 passed (1.4m)
```

The zero test failed its unchanged `scrollTopBefore === 0` assertion because the helper ended at 5,226 px, so this run did not exercise the requested zero-boundary prepend.

### Diagnostic evidence

A temporary read-only probe recorded component pin state and `lastScrollTop` after every dispatched step. It was run headed after another `RUNNER_PATTERN=jest-worker|run-executor COUNT=0` check, then removed.

On the diagnostic zero sequence, the event snapshots (`scrollTop / lastScrollTop / pinned`) were:

```text
1  6905 / 6905 / true
2  6412 / 6412 / false
3  5918 / 5918 / false
4  5425 / 5425 / false
5  4932 / 4932 / false
6  4439 / 4439 / false
7  3946 / 3946 / false
8  3452 / 3452 / false
9  2959 / 2959 / false
10 2466 / 2466 / false
11 1973 / 1973 / false
12 1480 / 1480 / false
13  986 /  986 / false
14  493 /  493 / false
15    0 /    0 / false
```

The first animation frame moved 6,905 back to 7,398 while still pinned; after the second upward event, pin state was false. Several later frames shifted the offset by 14-55 px while `lastScrollTop` followed the emitted native scroll events. At the actual anchor capture boundary, the final event and frame both showed `scrollTop=0`, `lastScrollTop=0`, and `pinned=false`.

With that valid zero precondition, the diagnostic measurement was:

```text
[load-older e2e][scrollTop-zero] scrollTopBefore=0.00px scrollTopAfter=5059.00px scrollHeightBefore=7977.00px scrollHeightAfter=13036.00px prependedHeight=5059.00px offsetDelta=0.00px
```

Thus the directive's one write preserved the anchor exactly when the stepped input actually settled at zero. The same diagnostic invocation still produced a failing nonzero case (`scrollTopBefore=300.00px`, `scrollTopAfter=314.00px`, `offsetDelta=5336.75px`), showing that one animation frame per step is not sufficient to settle render-window/native-anchor work before the prepend.

All temporary fields/logging were removed. Final probe search output:

```text
[no output]
```

### Round-2 line counts

Counts are round-1 final -> round-2 final:

| File                                                                    | Before | After |
| ----------------------------------------------------------------------- | -----: | ----: |
| `chat-transcript.component.ts`                                          |    720 |   714 |
| `chat-transcript.component.html`                                        |     99 |    99 |
| `transcript-prepend-anchor.directive.ts`                                |    163 |   163 |
| `transcript-prepend-anchor.directive.spec.ts`                           |    209 |   209 |
| `libs/frontend/chat/CLAUDE.md`                                          |     79 |    79 |
| `apps/ptah-electron-e2e/src/specs/chat/tile-load-older-history.spec.ts` |    374 |   387 |

### Verification completed before stop

```text
All matched files use Prettier code style!
FORBIDDEN_HUNKS=[no output]
CSS_HUNKS=[no output]
TEMPORARY_PROBES=[no output]
git diff --check: PASS
```

The zero-context diff proof found no hunk versus `HEAD` for the template `(scroll)` binding, `onScroll`, `scheduleStickToBottom`, `restoreScrollOnActivation`, `lastScrollTop`, the render-window feed effect, `cleanup()` retention, or CSS. Per the explicit stop instruction after a failed zero case, the broader unit/typecheck/lint verification was not run in round 2; the last completed round-1 results remain above but do not claim verification of this final e2e-helper revision.

## Clarifications Needed

The fixed-step helper does not reliably remain at its requested target through render-window updates, so the required full headed run is not green. Production scroll behavior was not changed beyond removing the disallowed pin path.

Which e2e input should replace the unstable fixed-step helper?

1. **Convergent stepped scroll (Recommended):** keep dispatching bounded decreasing steps and animation frames until the requested target remains stable for two consecutive frames, with an explicit attempt limit.
2. **Playwright mouse wheel:** hover the tile container, wheel upward in bounded increments, and poll until the requested target is stable; use a final smaller wheel delta for 300 px.
