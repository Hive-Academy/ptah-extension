# Batch B3c report

## Files changed

- `libs/frontend/harness-builder/src/lib/components/harness-builder-sidebar.component.ts` — standalone OnPush sidebar with required `tabId`, pinned root input, fixed strip and one bounded vertical scroll body. It reads the validated stack profile, displays the hydrated preview, applies it to the pinned root, keeps written paths and warnings visible, exposes health and session statistics, and wires presets and eight helper actions through the existing services.
- `libs/frontend/harness-builder/src/lib/components/harness-builder-sidebar.component.spec.ts` — structural cases for 360, 400, 720 and 960 px hosts at 480 px height; pinned Apply result and failure cases; helper dispatch case.
- `libs/frontend/harness-builder/src/lib/components/harness-builder-leave-dialog.component.ts` — standalone OnPush builder leave dialog with Cancel, Discard and Save as draft outputs; initial Cancel focus, keyboard cycle, backdrop/Escape Cancel, background inertness and focus return.
- `libs/frontend/harness-builder/src/lib/components/harness-builder-leave-dialog.component.spec.ts` — focus order, Tab/Shift+Tab, Escape/backdrop, pending-session Save, saving and failure cases.

## Verification

- `ptah_ast_analyze` returned `parseStatus: ok` for both production files and both specs; this checks TypeScript syntax only.
- Nx, Jest, TypeScript compilation, `ptah_get_diagnostics`, build, serve and e2e were not run, as the batch instruction reserves those checks for the orchestrator.
- The width tests assert DOM/class structure, not `scrollHeight` or pixel scrolling. Visual review remains required for real short-window scrolling.

## Parity rows covered

- 7: stack profile with validated-record fallback.
- 12–13: setup states and pinned workspace Apply.
- 25: collapsible Session section and the existing statistics component.
- 33–34: sidebar structure and existing preview component.
- 39–47: one Apply control by state, paths/warnings, health, and preset load/save.
- 49–54: eight helper entry points, preview commit, result/error handling and copy actions.
- 57: builder-only leave choice and keyboard behaviour.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep tab binding in the page; take `tabId`, mode, pinned root and session data as inputs | Sidebar binds tab vs page binds tab | `implementation-plan.md` component boundaries and B3c task 1 assign binding to B4c; existing hydration service exposes `config` and `setSnapshot` | Yes |
| Use `mergeBuilderUpdates` and validated snapshot writes for helper/preset choices | Replace preview vs merge by ID | `harness-proposal-hydration.service.ts:29-106`, design §5.4/5.6 and D9 precedence | Yes |
| Expose `sheet` as an input for the page's responsive controller | Sidebar observes width vs page controls width | `implementation-plan.md` assigns host ResizeObserver and sheet to B4c; design §8 | Yes |
| Emit leave choices and let the page perform save/discard/abort | Dialog orchestrates vs page orchestrates | B3c task 2 and `implementation-plan.md` leave boundary | Yes |

## Not done in B3c

- B4c must bind the sidebar to the routed tab, supply initialized/session/agent state, place it in docked or full-cover sheet mode, and handle `retrySetup`, `openDashboard`, the dialog choice, and page notices. B4c owns those files.
- B4c must connect health/dashboard navigation and the closed sidebar/peek-bar status. The sidebar emits `openDashboard`; it does not navigate itself.
- The full visual pass and the orchestrator's typecheck/lint/Jest checks remain outstanding.

## Fix round

- Corrected the dialog's `ElementRef<HTMLElement>` injection and typed focusable-button query so focus cycling works with strict TypeScript types.
- Built the `generate-claude-md` request config from its required fields, removing three unused destructured bindings flagged by lint.
- The orchestrator reported degradation audit OK (3/3). It will rerun typecheck and lint; no checks were run in this lane, per instruction.

## Orchestrator fix

- The pre-commit prettier hook moved `{{ documentContent() }}` onto its own line inside a `whitespace-pre-wrap` element (`harness-config-preview.component.ts`, committed in 7777ba773), so the document viewer showed extra spaces and line breaks (preview spec failed: " # Requirements "). Changed to `[textContent]="documentContent()"`. The new sidebar helper result viewer (`harness-builder-sidebar.component.ts:149`) gets the same binding before prettier runs.
- Later item (not 649): `harness-config-preview.component.ts` prompt preview `{{ promptPreview() }}` inside `whitespace-pre-wrap line-clamp-6` has the same pattern on main today.
