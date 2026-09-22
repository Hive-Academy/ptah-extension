# Batch D1 — ProviderSetupWizardComponent report

Task: `TASK_2026_523_c3df` · Batch D-i, part 4 (the provider setup wizard) · 22 September 2026

## Files changed

- CREATED `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\providers\provider-setup-wizard.component.ts` — five-step setup wizard (Provider / Credential / Verify / Models / Scope) inside `NativeDrawerComponent`, with the draft-probe state machine and the backend seam.
- CREATED `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\providers\provider-setup-wizard.component.spec.ts` — ~30 tests over the step machine, draft safety, the verify-then-cancel pin case, the `''` sentinel, scope defaults and the commit payload, close/discard, and the 36 px / 2 px focus outline rules.

Nothing else was created in `settings/providers/`. No `index.ts` barrel, no edits to `setting-scope-row.component.ts`, `provider-connection-card.component.ts`, `provider-consumer-assignments.component.ts`, `settings.component.ts`, `custom-provider-form.component.ts`, `libs/shared`, or `libs/frontend/core`. No git commands run. The component is not mounted anywhere.

## State machine

The step machine is signal state: `step = signal<WizardStepId>('provider')`, plus `completed = signal<ReadonlySet<WizardStepId>>(new Set())`. It is not RxJS. The five steps are `provider → credential → verify → models → scope`.

- **Provider step** — a radio group over `getAllAnthropicProviders()` plus a custom-endpoint option. Selecting a provider and Continue advances to Credential when `providerReady` holds.
- **Credential step** — `apiKey` mode shows a password field; `oauth` mode shows the external sign-in panel; `nativeAuth` modes show the CLI panel. `credentialReady` gates Continue (for `cli`: installed and signed in).
- **Verify step** — `wizard-verify-start` starts the probe. During `checking` the step is locked: `goToStep` refuses navigation while `probeChecking` holds, so a superseded result cannot be mixed with a new probe. `verified` enables Continue; `failed` keeps the step with a failure panel.
- **Models step** — three `ProviderModelPickerComponent` slots (everyday / complex / fast) in fixed-provider mode. `defaultsResolvable: false` hides "Use provider defaults" and makes Continue require all three tiers.
- **Scope step** — the "Save to" radio group (`wizard-save-to`), the activation radio (connect-only / use-main-agent), the review list, and the commit button. Commit emits `ProviderWizardCommit` through `commitRequested` only; the wizard never persists.

**Completed-step links** — the steps strip renders `wizard-step-link` buttons for completed steps (both the desktop and the mobile strip), guarded by `probeChecking`.

**Provider change after a probe** — changing the provider mid-flow invalidates the draft verification: the probe state resets to `idle` and a cancellation of the in-flight probe is issued (see Draft safety).

**Discard review** — `wizard-cancel` on any step opens a discard review (`wizard-discard-review`); `wizard-discard-confirm` closes the drawer with `closed` and drops the draft. `wizard-discard-cancel` returns to the wizard with the draft intact.

## Draft safety

- **The draft lives in memory only.** The credential is held in a `signal` and rendered through a masked password field. Nothing is written to disk, the secret store, or the persisted route before `commitRequested`. The commit carries the credential as a transient value (`ProviderWizardCommit.credential`, header comment: the host persists it through the secret store only).
- **Verification exercises the DRAFT.** `startProbe` builds the request from the draft's current values. It never reads a persisted route.
- **No probe on keystroke.** The probe runs only from the Verify step's start button. Editing the credential afterwards invalidates the verification (`_probeState` back to `idle`) — a stale "verified" badge can never sit next to a changed secret.
- **A failed probe stays on the Verify step.** Non-secret values (provider, host, protocol) stay intact, the masked draft stays intact, and nothing resets. The failure panel offers Retry and `wizard-edit-credential`.
- **Superseded results are discarded.** Every probe gets a fresh `probeId` from a module counter. `_probeId` equality plus a `probeSettled` guard discard any late result from a probe that was cancelled or superseded. This is why `cancelDraftVerification` exists in the contract.
- **Failure copy comes from a data map.** `PROBE_FAILURE_COPY` (keyed by `ProbeFailureReason`) supplies every failure line; the component never parses a message string and never renders a raw error. The `detail` field from the result is not rendered as an error message.
- **The verify-then-cancel pin case.** The spec case "leaves persisted settings untouched for a verify-then-cancel sequence" walks Provider → Credential → Verify (verified) → Scope, cancels, confirms the discard, and pins: exactly one `closed` emission, zero `commitRequested` emissions, no cancel call (the probe had already settled), and after close and reopen the Continue button is disabled — the draft is gone and persisted settings are unchanged.

## Backend seam

The wizard owns the state machine; a later batch wires the two seam inputs to the RPC service.

Exact input signatures in the component (lines 1348 and 1351):

```ts
readonly verifyDraftConnection = input.required<DraftVerifyConnectionFn>();
readonly cancelDraftVerification = input.required<DraftCancelVerificationFn>();
```

with

```ts
export type DraftVerifyConnectionFn = (
  params: AuthVerifyDraftConnectionParams,
) => Promise<AuthVerifyDraftConnectionResult>;

export type DraftCancelVerificationFn = (
  params: AuthCancelDraftVerificationParams,
) => Promise<AuthCancelDraftVerificationResult>;
```

A later batch binds them in the host composition as:

- `verifyDraftConnection` → `(params) => claudeRpc.call('auth:verifyDraftConnection', params)`
- `cancelDraftVerification` → `(params) => claudeRpc.call('auth:cancelDraftVerification', params)` — the params object is `{ probeId }`.

The component calls `verifyDraftConnection(params)` with `{ probeId, authMode, providerId, credential?, baseUrl?, customProtocol?, probeLimitSeconds }` and accepts `AuthVerifyDraftConnectionResult`. It calls `cancelDraftVerification({ probeId })` fire-and-forget (`.catch(() => undefined)`) when a probe is superseded or the user leaves the Verify step. The host needs no other wiring: `open`/`closed` drive the drawer, `externalActionRequested` asks for sign-in and CLI work, `commitRequested` delivers the commit.

## Sentinel

The picker emits `''` for "inherit from the provider default", never the literal `'inherit'`. The wizard stores the emitted value in the three tier signals (`everyday`, `complex`, `fast`), each holding `''` or a model id. Translation happens at the binding: the review line renders `Provider default · {tier} tier` for `''` and `Set in this wizard · {model}` otherwise (`tierSource(key)`). The commit DTO carries `''` through unchanged in `ProviderWizardTierMappings` — no step writes the literal string `'inherit'`. The spec pins both review renderings through `wizard-tier-source`.

## Accessibility

- **36 px controls** — every button and interactive control this component renders carries `min-h-9`; the steps strip link buttons include it on both the desktop and the mobile strip.
- **Targets ≥ 24 px** — buttons have `min-h-9` plus padding; radio rows are full-width rows.
- **2 px visible focus outline** — controls carry `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content`; the spec asserts the classes on every button.
- **Keyboard** — native `<button>`, `<input>`, `<fieldset>` and radio inputs only; Enter and Space activate natively; the tab order follows the DOM.
- **Steps strip** — the current step carries `[aria-current="step"]`.
- **Heading focus on navigation** — moving to a step moves focus to that step's heading; the failure panel moves focus to its heading when a probe fails (queued with `queueMicrotask` so the heading exists in the same cycle as the state change); the discard review focuses its heading.
- **No secrets in output** — the API key renders only in a password input; no probe result detail, no raw error, no account value is printed. No `[innerHTML]` anywhere in the component.
- **Out-of-scope observation** — the shared `NativeDrawerComponent` close button (`native-drawer-close`) lacks `min-h-9`. That button is in `libs/frontend/ui` and outside this batch; every button this component renders complies, and the spec filters the drawer's own button out of the assertion with a comment.

## Verification

Environment of every Nx command: `NX_DAEMON=false`, `NX_CACHE_DIRECTORY=D:\projects\ptah-extension\.nx\verify-cache`.

- `npx nx run @ptah-extension/chat:typecheck` — "NX   Successfully ran target typecheck for project @ptah-extension/chat" (29.3 s). Three NG8107 warnings printed, all in pre-existing files outside this batch (`chat-ui` molecule, `peer-session-send-dialog`, `memory-curator-ui`); no diagnostic from the new files.
- `npx nx run @ptah-extension/chat:lint` — "NX   Successfully ran target lint for project @ptah-extension/chat"; "21 problems (0 errors, 21 warnings)". My file contributes one warning: `808:1 warning File has too many lines (1941). Maximum allowed is 700 max-lines` (see Deviations). The other warnings sit in other files, including the parallel `provider-consumer-assignments.component.ts` from a different lane.
- `npx nx run @ptah-extension/chat:test` — "Test Suites: 90 passed, 90 total / Tests: 2 skipped, 1470 passed, 1472 total" (24.356 s), "NX   Successfully ran target test for project @ptah-extension/chat". The wizard spec suite is inside the passing total. Note for the orchestrator: in an earlier run mid-session, 8 tests in `provider-consumer-assignments.component.spec.ts` (another lane's file, created at 12:41/12:43 while this batch was in progress) failed; the lane owner fixed them and the final run above is fully green. I did not touch that file at any point. The Nx jest executor ignores `--testPathPattern`, so every test run executes the full chat suite.

## Deviations

- **Single-file size.** The wizard is 1941 lines against the soft 700-line ceiling (lint warning `max-lines`). The task brief acknowledges this component as the largest and names one file, so no split was made. If the orchestrator wants a split, the natural seams are the probe state machine and the Models step, applied under the facade rule.
- **CLI signed-in copy** is plain "Signed in" for the account line; the richer `Signed in · {accountLabel}` variant appears only when the host supplies an account label.
- **Sentinel translation point.** The picker emits `''` and the translation to "Provider default" copy happens at the wizard's review binding, not inside the picker — the picker was not modified (batch C owns it).

## Not done

- No `index.ts` barrel in `settings/providers/` — the orchestrator writes it after every component exists.
- No mount in `settings.component.ts` and no edits to any existing settings file.
- The Verify step is NOT wired to the backend: `verifyDraftConnection` and `cancelDraftVerification` are `input.required` seams for a later batch (see Backend seam).
- No edits to `setting-scope-row.component.ts`, `provider-connection-card.component.ts`, `provider-consumer-assignments.component.ts`, `libs/shared`, or `libs/frontend/core`.
- **Cancelled-state copy ownership.** The copy "Setup discarded. Your external sign-in is still available." belongs to the parent composition: after `wizard-discard-confirm` the drawer is closed and nothing of the wizard renders, so the parent renders that line if the flow needs it after close.
- No git commands were run at any point.

## Clarifications Needed

None — the batch was not blocked.