# Frontend implementation ? TASK_2026_609_c495, Batch B-4

Verdict: B-4.1 and B-4.2 implemented; scoped typecheck, lint and tests passed. No git commands run. Task/batch state documents and other batches' code were not edited.

## Files written

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\frontend\setup-wizard\src\lib\services\wizard-rpc.service.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\frontend\setup-wizard\src\lib\services\wizard-rpc.service.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\frontend\setup-wizard\src\lib\components\agent-selection.component.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\frontend\setup-wizard\src\lib\components\agent-selection.component.spec.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\.ptah\specs\TASK_2026_609_c495\b4-executor-report.md`

## B-4.1 evidence

`wizard-rpc.service.ts:89`: typed `previewGeneration(selectedAgentIds)` calls `wizard:preview-generation` with `WizardPreviewGenerationParams`, returns `WizardPreviewGenerationResponse`, and uses the existing 10-second read timeout and throwing error pattern. `GenerationPreviewFile` is consumed in the component's typed certainty filter.

Specs in wizard-rpc.service.spec.ts:
- calls wizard:preview-generation with selectedAgentIds and returns the preview
- throws the preview RPC failure reason
- propagates a rejected preview transport error

## B-4.2 evidence

`agent-selection.component.ts:497`: existing NativeModalComponent lists per-agent definite paths and overwrite markers, separate conditional paths with each condition, and response.warning. `:989` starts preview; `:1005` confirms; `:1016` rechecks; `:1067` contains the original generation body moved unchanged to confirmGenerate. Cancel preserves selection. Pending preview responses are invalidated on cancellation. Selection/back handlers are guarded while the modal is open or generation runs.

Specs in agent-selection.component.spec.ts:
- lists definite files, overwrite markers, conditional files with conditions, and warning separately
- cancels the preview without submitting and keeps selection
- re-previews unchanged targets and submits once on confirm
- shows Targets changed since preview and requires a second confirm for a changed definite set
- shows the reason and permits explicit generation after initial preview failure
- shows the reason and permits explicit generation after confirm preview failure
- ignores a pending re-preview after cancellation
- compares definite paths as a set regardless of ordering or conditional changes

Existing generation specs now confirm first and retain assertions for payload, progress, navigation, failure and duplicate submission; affected assertions have one-line reason comments.

## PR6 and preview failure

Confirm performs another read-only preview. Definite relPaths are compared as sets (order/duplicates do not matter). A difference replaces the displayed list, announces ?Targets changed since preview?, and requires another confirm; that confirm checks again before submitting. Conditional paths never enter the promised definite set. The B-2c fresh-workspace condition is rendered verbatim as ?May also write, if ?? in a separate group.

An initial or confirmation-preview rejection clears the stale preview, displays the reason, releases the loading state and offers an enabled ?Generate without preview? action. This explicit confirmation runs confirmGenerate without another preview call. A failed preview never automatically submits and never blocks generation.

## Stack, boundaries and design fidelity

- Angular 22.1.7: package.json:94. Standalone/OnPush, signals, computed and inject follow agent-selection.component.ts and generation-progress.component.ts. Confirmation-modal.component.ts and NativeModalComponent supplied the existing modal contracts; the requested NativeModal is reused via the UI package barrel.
- Tailwind/daisyUI classes follow the existing selection screen. No new primitive, design token, dependency or library.
- Boundaries: setup-wizard/project.json declares scope:webview/type:feature; eslint.config.mjs:264 and :365 permit the existing shared/core/UI dependencies. No backend imports.
- Handoff: implementation-plan.md C5, batches.md B-4 and B-2c result. No design document was assigned; the existing screen's styling is retained.
- State coverage: loading, successful preview, conditional results, changed targets, warning/error, cancellation and submit. Native buttons, labelled native modal, status/alert announcements and escaped Angular interpolation; no innerHTML. NativeModal owns keyboard focus/Escape behavior. Tests render the actual Angular template with jsdom dialog-method shims following existing NativeModal tests; these are test environment shims, not production stubs.

## Verification

Executed from the assigned worktree, output limited using PowerShell `Select-Object -Last 40` (equivalent to the requested `tail -40`):

1. `npx nx run-many -t typecheck,lint -p @ptah-extension/setup-wizard 2>&1 | Select-Object -Last 40` ? Nx reported both targets successful, 0/2 cache hits.
2. `npx nx run-many -t test -p @ptah-extension/setup-wizard --maxWorkers=2 2>&1 | Select-Object -Last 40` ? Nx reported test target successful, 0/1 cache hits. Nx suppressed successful task details, so no individual suite/test count is claimed.
3. `npx prettier --write` on exactly the four source/spec files above ? completed successfully after the checks, as requested.
4. Scoped `ptah_get_diagnostics` after implementation ? no diagnostics in the four requested files. The tool reported TS2737 in unedited shared capability-id-codec.ts:262-263 (BigInt with a target below ES2020); the project's configured Angular typecheck passed.

Both Nx runs also printed an account-level Nx Cloud 401 (organization disabled after exceeding its free plan), after reporting target success. No extra project/build or workspace-wide check was run.

## Deviations and limitations

No functional plan deviation. The component was already large (949 lines before this batch); the explicit four-file ownership and unchanged-generation-body requirement keep the modal and flow in place rather than extracting an unassigned file.

Browser screenshots and real-browser light/dark/focus/layout QA were not performed in this executor batch; B-7 owns that visual evidence. Compiled template rendering and interaction were checked by the component specs. The full backend write-fidelity tests are owned by completed B-2c; B-4 verifies the frontend confirmation contract.

## Fix round 1

Verdict: corrected both mangled overwrite markers; strengthened regression assertions; scoped checks passed.

Files modified in this round:
- `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\frontend\setup-wizard\src\lib\components\agent-selection.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\frontend\setup-wizard\src\lib\components\agent-selection.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\.ptah\specs\TASK_2026_609_c495\b4-executor-report.md`

- agent-selection.component.ts:539 now renders the UTF-8 em dash marker `— will overwrite`; :561 renders ASCII `(will overwrite if written)`.
- agent-selection.component.spec.ts:48 sets the conditional fixture's willOverwrite flag so that marker is exercised. The listing spec now asserts exact trimmed marker text at :458-461 and :466-469, including separators, instead of accepting any text containing `will overwrite`. Either original mangled marker would fail these assertions.
- Scanned all four assigned files as strict UTF-8, reviewed every literal question-mark occurrence, and checked replacement characters, suspicious mojibake characters, and unexpected control characters. Only the two reported punctuation defects were found; remaining question marks are TypeScript syntax. The service and service spec required no changes.
- Prettier completed on the two edited component files before verification.

Checks (from the assigned worktree, tailed using PowerShell Select-Object -Last 40):

1. `npx nx run-many -t typecheck,lint -p @ptah-extension/setup-wizard` - both targets passed; 0/2 cache hits.
2. `npx nx run-many -t test -p @ptah-extension/setup-wizard --maxWorkers=2` - target passed; 0/1 cache hits. Successful task details were suppressed by Nx, so no test count is claimed.
3. Scoped ptah_get_diagnostics - no diagnostics in the edited files; same unedited shared capability-id-codec.ts:262-263 TS2737 BigInt target diagnostics as before. The configured project Angular typecheck passed.

Both Nx commands again printed the account-level Nx Cloud 401 after reporting target success. No git commands, other source edits, or workspace-wide checks. All requested fix-round work completed.
