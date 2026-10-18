# V1 responsive shell and visual fixes

## Findings fixed

| Finding | Fix file:line | Spec file:line |
| --- | --- | --- |
| B1: chat composer pushed below the viewport | `generation-workflow-shell.component.ts:165,201` places a bounded, independently scrolling 336 px sidebar beside a flexing full-height bare chat embed | `generation-workflow-shell.component.spec.ts:17` |
| B2: responsive bands and sheet missing | `generation-workflow-shell.component.ts:58,116,165,229,359` adds header, host-width breakpoint, peek, sheet, inert chat, Escape focus restoration, and separate active-run Stop | `generation-workflow-shell.component.spec.ts:17` |
| S1: multiple primary actions | `generation-guidance-page.component.ts:36`, `guidance-run-card.component.ts:83`, `generation-agent-sidebar.component.ts:88`, `agent-selection-list.component.ts:155` choose the single primary for saved/empty guidance and agent next-step states | `generation-guidance-page.component.spec.ts:11` |
| S2: faint toggle focus ring | `guidance-result-panel.component.ts:37` uses the existing base-content focus outline token, which has the measured 14:1 contrast on sidebar surfaces in design-spec 2.8 | Focus class is covered by the guidance component render in `generation-guidance-page.component.spec.ts:11`; no browser contrast measurement was run |

## Layout

- The shell observes its own host element using `ResizeObserver` and updates a signal. It disconnects the observer on destroy.
- At host widths 960 px and above, the chat uses the remaining width (at least 624 px) beside a 336 px scrolling sidebar. At 720–959 px, the same sidebar leaves at least 384 px for chat.
- Below 720 px, the chat uses the full width and height beneath the header and peek row. The workflow sidebar is a full-cover sheet inside the content region. Opening it makes the chat inert and aria-hidden; Escape closes it and focuses the peek button. The sheet uses the specified 180 ms easing and disables animation for reduced motion. A separate 32 px Stop control appears beside the peek button only during a bound run; cancelling and unconfirmed stop states disable it.
- The agent workflow content moved into `generation-agent-sidebar.component.ts`; its stores and actions remain wired. The chat embed now uses `chrome="bare"`.

## Checks

- Focused Jest: 3 suites, 20 tests passed after the final edit (shell, guidance page, agent selection).
- Setup wizard Nx test: 35 suites, 435 tests passed.
- Targeted ESLint on all edited components/specs: 0 errors, 58 warnings, mainly existing explicit-accessibility style warnings.
- Nx typecheck/lint for setup wizard and webview: succeeded. The earlier failure was TS2341 in `generation-workflow-shell.component.ts:178` because the template read private `now`; the orchestrator changed it to protected. Scoped diagnostics separately listed errors in unrelated files, but those did not cause the Nx target failure.
- Degradation audit: `libs/frontend/setup-wizard: 1 ok (baseline 1)`.
- Prettier applied to all edited files. No build, serve, dev, e2e, or package target ran.

## Final line counts

| File | Lines |
| --- | ---: |
| `generation-workflow-shell.component.ts` | 449 |
| `generation-agent-sidebar.component.ts` | 248 |
| `agent-selection-list.component.ts` | 389 |
| `generation-guidance-page.component.ts` | 109 |
| `guidance-run-card.component.ts` | 107 |
| `guidance-result-panel.component.ts` | 105 |
| `generation-workflow-shell.component.spec.ts` | 630 |
| `generation-guidance-page.component.spec.ts` | 324 |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Measure shell width with `ResizeObserver` | Window width; host width | Design-spec 2.7 explicitly uses host width; existing harness builder view uses the same 720 px host breakpoint | Yes |
| Reuse one sidebar DOM subtree as docked panel or sheet | Separate duplicated panels; one responsive panel | Preserves child state and bindings while matching the planned shell; the sheet's position changes below 720 px | Yes |
| Demote Retry and the agent Generate action when another primary exists | Hide actions; outline styling | Keeps all existing capabilities available and satisfies the one-primary rule | Yes |
| Use base-content for toggle focus ring | Primary ring; base-content ring | Design-spec 2.8 measures base-content contrast on sidebar surfaces above the 3:1 focus minimum | Yes |

## Deviations

- No screenshot or browser measurement was run because the task forbids build, serve and e2e checks. The app shell overflow at 360/400 px and Hub S3 are outside this batch; those files were not edited.
- The earlier Nx failure was caused by the shell template access level and has been corrected. Revision 1 Nx typecheck/lint passes.
- The shell spec already exceeded the approximate 450-line guideline before this batch; extending it brings it to 630 lines. Production component files remain below 450 lines.

## Proposed Removals

None.
## Revision 1

| Item | Fix file:line | Spec file:line |
| --- | --- | --- |
| 1. Prevented Escape and sheet-scoped handler | `generation-workflow-shell.component.ts:180,282` | `generation-workflow-shell.component.spec.ts:247` |
| 2. No lasting sheet transform | `generation-workflow-shell.component.ts:55` uses backwards fill; reduced-motion rule remains | CSS behavior reviewed against the animation declaration; no browser visual check was run |
| 3. Escape, widening and real agent sidebar coverage | `generation-workflow-shell.component.ts:180,364`; real sidebar remains imported | `generation-workflow-shell.component.spec.ts:21,247,277` |
| 4. Hide primary Regenerate during a run | `guidance-result-panel.component.ts:69` | `guidance-result-panel.component.spec.ts:46`; `generation-guidance-page.component.spec.ts:59` |
| 5. Dialog semantics and focus entry | `generation-workflow-shell.component.ts:166-180,265` | `generation-workflow-shell.component.spec.ts:245` |
| 6. Clear sheet on binding change | `generation-workflow-shell.component.ts:364` | `generation-workflow-shell.component.spec.ts:285` |
| 7. Closed-sheet error indicator | `generation-workflow-shell.component.ts:126,251` | `generation-workflow-shell.component.spec.ts:273` |
| 8. Remove duplicate shell state and injections | `generation-workflow-shell.component.ts:298` retains only `hasVerifiedResults`, which the shell's handoff effect reads; duplicate model/provider/countdown/next-step values remain in `generation-agent-sidebar.component.ts` | Real sidebar rendering and countdown: `generation-workflow-shell.component.spec.ts:21` |

Exact final checks: focused Jest 3 suites/16 tests passed; Nx typecheck and lint succeeded for `@ptah-extension/setup-wizard` and `ptah-extension-webview`; setup wizard Nx test 35 suites/435 tests passed. Scoped `ptah_get_diagnostics` reported no errors in edited files. Prettier ran on all five edited files.

Final revision line counts: shell 457; shell spec 804; guidance result panel 106; result panel spec 60; guidance page spec 324.

Deviation: no browser visual confirmation of the transform behavior was possible under the batch's no build/serve/e2e rule. The shell is 457 lines, slightly above the approximate 450-line guideline; the pre-existing shell spec grew to 804 lines to cover the required real sidebar and sheet states. No new user-facing capability was removed.