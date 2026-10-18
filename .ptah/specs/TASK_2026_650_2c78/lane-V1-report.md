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
- Nx typecheck/lint for setup wizard and webview: failed. `ptah_get_diagnostics` found no errors in the edited shell/sidebar after the final edit, but reported errors in `generation-run-event-adapter.spec.ts:432,451,463,473` and `libs/shared/src/lib/types/capability-id-codec.ts:262-263`. The final focused Jest compile passed.
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
- Nx typecheck/lint did not pass; see Checks. No files outside batch ownership were changed to address diagnostics.
- The shell spec already exceeded the approximate 450-line guideline before this batch; extending it brings it to 630 lines. Production component files remain below 450 lines.

## Proposed Removals

None.