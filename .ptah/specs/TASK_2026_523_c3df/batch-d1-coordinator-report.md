# Batch D-i, part 6 — Providers coordinator

## Files changed

- CREATED `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\providers\providers-settings.component.ts` — standalone OnPush page coordinator (617 lines), deliberately unmounted.
- CREATED `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\providers\providers-settings.component.spec.ts` — 17 coordinator cases, using a stub state service and shallow wizard/consumer children, with real connection and scope components.
- MODIFIED `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\providers-settings-state.service.ts` — state-owned connection setup, cancellation, external authentication and supporting non-secret reads.
- MODIFIED `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\providers-settings-state.service.spec.ts` — regression coverage for these additions and failure paths.
- REWROTE `D:\projects\ptah-extension\.ptah\specs\TASK_2026_523_c3df\batch-d1-coordinator-report.md` — replaces the earlier blocker report.

The existing core barrel already exports the service and its public types; no barrel change was necessary. No sibling component, shared/backend source, SettingsComponent, task state, or chat barrel was edited. No git command was run.

Stack observed: Angular 22.1.7 in package.json; standalone/OnPush/signal/input/output patterns in the four provider siblings; NativeCard and ProviderModelPicker from the UI barrel; existing Tailwind/daisyUI utility tokens. Applied the Angular frontend patterns skill. Followed design-spec.md and the specified implementation-plan decisions. The coordinator imports core, shared and UI through public aliases and has no direct RPC dependency or HTML binding.

## Composition

| Piece | Supplied | Received / action |
| --- | --- | --- |
| ProvidersSettingsStateService | Open, explicit refresh, captured edit contexts, field commits and named retries | All loaded values, provenance, readiness, catalog metadata and commit feedback come from its signals. |
| SettingScopeRowComponent | Field labels, actual source, overrides, supported targets, fallback previews and intermediate app-layer evidence | Workspace override opens the corresponding draft; clear/use-global opens review and calls the state service. Group provenance is shown only when all constituent sources exist; differing sources remain Mixed sources. |
| ProviderConnectionCardComponent | Deduplicated connection identity, modality, selected/active status, positive probe evidence, safe key-presence metadata and pending state | Check, setup/manage, named sign-in and activation review. Active identity is gated by the single effective driver and refreshed positive evidence. |
| ProviderSetupWizardComponent | Provider preselection, open state, required verify/cancel callbacks, workspace label, current-route presence, honest Global-only setup target, commitState and explicit-model requirement | commitRequested calls connectProvider; closed cancels owned verification and restores focus. The same child remains mounted after partial/unconfirmed saves so its draft survives. Unqualified external actions receive an explicit unsupported result; see Not done. |
| ProviderConsumerAssignmentsComponent | disabled during commits; initialEditingConsumerId for field deep links | setupProviderRequested opens setup; assignmentSaved triggers read-back; timeoutSaved refreshes judging. Its independent memory/lanes/judging read/retry behavior remains child-owned. No child edits. |
| ProviderModelPickerComponent | Main-agent or fixed CLI provider and current model draft | Draft-only selections; commits go through the state service. Delegated model assignments also reuse this picker. |

Layout follows the six sections: heading/workspace, Main agent, Your connections, Background models, CLI agents, collapsed More providers. Main model/effort editing uses actual writable provenance. CLI instances support creation, enabled state, selected-model editing and confirmed deletion; orchestration model and effort fields retain their global storage semantics. Catalog filtering is local and uses the merged host-derived inventory. Secrets remain transient masked drafts; the coordinator never renders a service error object or storedAuthMethodDiagnostic.

## Failure behaviour

Every section has unloaded/loading/ready/error state and its own retry. A failed route, catalog, scope, model, effort, model-source, CLI summary, CLI model or orchestration read does not blank the other sections. Background reads remain independent in the consumer child. Read-only stale information may remain during retry, but no active badge survives an unready route. A loaded empty route has its own empty message; an unloaded route does not choose a default.

Pinned coordinator spec cases:

- `does not render an active provider while the route is unloaded or loading`
- `renders at most one active badge when several connections are healthy`
- `distinguishes a loaded empty route from an unloaded route`
- `keeps successful sections usable when another read fails and retries only that read`
- `never renders raw stored authentication diagnostics`
- `preserves the wizard draft and names saved, unsaved and unconfirmed fields after a partial commit`
- `does not convert an unrefreshed acknowledged commit into wizard success`
- `does not block a refreshed connection commit because an unrelated section failed`
- `retries CLI model reads without disabling the CLI instance list`

Commit feedback retains saved, unsaved and unconfirmed field arrays separately, plus refreshFailed. Setup writes are ordered: custom metadata, credential, endpoint, connection model mappings, optional activation, then main-agent model mappings. A failed or unconfirmed prerequisite prevents subsequent activation. auth:setApiKey is deliberately used for connect-only storage: llm:setApiKey also selects the main route. Activation restores the saved connection tiers after the host's automatic tier mapping. All commits refresh the snapshots before the saving gate is released; an acknowledgement does not manufacture an active badge.

Regression tests cover false cancellation acknowledgements, cancellation of older probe IDs, failed catalog reads, connect-only isolation, shipped versus persisted local endpoints, incomplete setup preventing activation, preservation of selected tiers, custom metadata/credential separation, stale workspace context, Codex launch versus authenticated state, unsupported external cancellation, non-secret CLI model projection, existing Copilot CLI marker handling, and mixed provider-specific source provenance.

## Deep-link entry point

Public signal input:

```ts
readonly focusTarget = input<ProvidersSettingsFocusTarget | null>(null);
```

Accepted values: `main-agent`, `main-model`, `main-effort`, `connections`, `background-models`, `cli-agents`, `more-providers`, `memory-curator`, `archaeologist`, `synthesis`, `judge`, `replay`, `judging-enhancement`.

The post-render effect focuses the requested anchor; model/effort targets wait for their reads, main-model opens the editor, and More providers opens its disclosure before focus. Consumer field IDs are forwarded to initialEditingConsumerId while the page focuses the Background models section. A later changed parent input takes precedence over a previous local focus request. Specs cover section focus, consumer forwarding, disclosure opening and parent focus changes. No old-link forwarding or settings mounting was added.

## Accessibility

Native buttons, selects, inputs and details/summary provide keyboard behavior. Coordinator controls use min-h-9 and min-w-6, visible 2px focus-visible outlines with offset, explicit labels, semantic headings and safe status/alert text. Focus anchors use tabindex=-1; setup closing restores the invoking control. The page scrolls vertically, wraps actions, uses a bounded responsive content width and wraps the workspace path. No fixed-height section hides enlarged text.

Neutral existing daisyUI surfaces and content-colored focus outlines avoid relying on the current primary color's contrast across themes. This is a small visual deviation from the design's blue primary action. DOM tests check focus and control classes; no browser-based 320px/400%-zoom, theme contrast or above-the-fold audit was performed on this unmounted page. Child-owned dialog focus trapping and shared picker behavior were not reimplemented.

## Verification

Every Nx invocation used this environment:

```powershell
$env:NX_DAEMON='false'
$env:NX_CACHE_DIRECTORY='D:\projects\ptah-extension\.nx\verify-cache'
npx nx run-many --projects=@ptah-extension/core,@ptah-extension/chat --targets=typecheck,lint,test --parallel=1 --outputStyle=static
```

Final run after the source/provenance changes:

```text
> nx run @ptah-extension/core:test
Test Suites: 32 passed, 32 total
Tests:       813 passed, 813 total
Snapshots:   0 total
Time:        9.819 s
Ran all test suites.

> nx run @ptah-extension/core:typecheck
> npx ngc --noEmit --project libs/frontend/core/tsconfig.lib.json

> nx run @ptah-extension/core:lint
✖ 14 problems (0 errors, 14 warnings)

> nx run @ptah-extension/chat:typecheck
> npx ngc --noEmit --project libs/frontend/chat/tsconfig.lib.json

> nx run @ptah-extension/chat:test
Test Suites: 91 passed, 91 total
Tests:       2 skipped, 1494 passed, 1496 total
Snapshots:   0 total
Time:        43.179 s
Ran all test suites.

> nx run @ptah-extension/chat:lint
✖ 19 problems (0 errors, 19 warnings)

NX   Successfully ran targets typecheck, lint, test for 2 projects
Run duration:      2m 21s
Cache:             0/6 hit (0%)
```

The command exited 0. All six requested targets passed; chat lint has no warning in the new coordinator or its spec. Counts reflect the concurrent workspace at execution, not only this batch's added tests.

Core lint includes two warnings in the changed service: preserve-caught-error at line 734 (the cancellation boundary deliberately throws safe text without attaching the raw RPC failure) and max-lines at line 744 (1024 counted lines). Other core warnings are outside this batch. Chat ngc reports existing NG8107 optional-chain warnings in mcp-directory-browser.component.ts:174, peer-session-send-dialog.component.ts:181 and db-health-panel.component.ts:165. Nx reports deprecated explicit Jest/ESLint executors; Node also warns about loading core's Jest configuration as an ES module.

A final scoped ptah_get_diagnostics call reported 365 errors across the owning projects and **none in the four changed source/spec files**. It still reports these out-of-scope consumer spec errors, which were not fixed:

- provider-consumer-assignments.component.spec.ts:59 — `anthropic:direct` is not a valid route strategy.
- :63 — resolvedModel uses a string instead of the discriminated DTO.
- :67 — `not-configured` is not a wire provider status.
- :166, :173, :180 — ScopedSettingEntry fixtures omit effectiveKey and fallbackPreview.

This diagnostic scan includes spec type errors outside library ngc's file set; passing Nx targets therefore does not mean the wider workspace diagnostics are clean. The consumer lane remains responsible for its files.

## Deviations

- Followed the wizard source and shared verification DTO: timeoutMs is sent; customProtocol is not a draft-verification parameter. The wizard report's older prose was not used as a contract.
- Setup storage is Global because the host's credential, endpoint, custom-entry and tier writers do not accept another settings target. Independent main-route activation still offers only actual host-supported targets.
- defaultsResolvable is false for the wizard because it does not publish its current provider selection. This requires explicit models instead of displaying an invented default capability.
- Direct Claude API connections can be summarized when already configured, but cannot be managed through the current connect-only wizard contract; see Not done.
- The service is 1073 physical lines, exceeding the deliberate-review threshold. Its existing facade retains ownership of the new operations and only two injected dependencies; no arbitrary fragments or extra files were introduced outside the authorized scope. Connection setup and external authentication are identifiable future collaborator boundaries if an extraction batch is authorized. The coordinator itself stays at 617 lines and delegates background sections, connection rows, scope controls, wizard rendering and model selection.

## Not done

- Intentionally no SettingsComponent mount, chat barrel, old-editor removal or old-link forwarding.
- The wizard's externalActionRequested emits only an action, not provider identity, and the current provider selection is private. Full OAuth/CLI wizard step-2 integration cannot be made truthful through this API. Named Copilot/Codex sign-in actions on the page call the real host facade and recheck authentication; unqualified wizard actions return a safe explanation. No fake success, inferred account or fabricated cancellation was added. The child needs a provider-aware event/status contract in its owning lane.
- The wizard has no public existing-connection draft or context-review/error-detail input. It retains its own draft after partial/unconfirmed saves, while field-specific feedback is on the page behind the dialog. A workspace change safely blocks the stale context, but in-dialog re-review is not implemented. Existing key/endpoint/model prefilling also remains constrained by that child surface.
- New direct Anthropic-key setup is not represented by the registry-based wizard, and auth:setApiKey does not write the direct Anthropic credential slot. The service blocks that connect-only case instead of selecting a route as a side effect. An authorized direct-auth seam is needed before replacing all existing auth entry points.
- Custom metadata accepts its real protocol field, but draft verification follows the existing shared DTO, which has no customProtocol. No backend/shared change was made to broaden probe behavior.
- The consumer child is still being repaired by its own lane. At the final inspection, saveDraft and saveTimeout close for any result except failed/blocked, which includes partial/unconfirmed, and the spec errors above remain. These are integration follow-ups for that lane, not worked around here.
- CLI provider reassignment is not invented: the shared update contract lacks providerId. New CLI creation excludes direct Anthropic and Codex OAuth because their credential semantics are not supported by that create path. Existing CLI instances and their model settings remain visible.
- No live browser visual audit or full real-wizard end-to-end test. Required project checks are distinct from the unresolved child-contract integration issues. This is an implemented, unmounted composition with explicit integration gaps, not a claim that all old provider editors can already be removed.

## State service additions

| Method / change | Coordinator caller and necessity |
| --- | --- |
| `refreshConnections(): Promise<void>` and `connections` signal | open/refresh and the catalog retry; merged registry/custom inventory, key-presence metadata, persisted setup and confirmed account status are needed to render the page without direct RPC. |
| `refreshMainSources(): Promise<void>` and `mainSources` signal | open/refresh and model/effort-source retry; resolves concrete current-auth model/effort keys and host provenance, so scope controls do not guess source or writable targets. |
| `refreshCliModels(): Promise<void>` and `cliModels` signal | open/refresh and CLI model retry; the summary RPC omits selectedModel/tierMappings. Reads settings:get, validates the unknown result and projects only those non-secret fields. |
| `connectProvider(draft: ProvidersConnectionDraft, context: ProvidersEditContext): Promise<void>` | commitWizard; persists connect-only and custom setups, reports ordered field outcomes, and optionally activates after prerequisites. The component cannot own these writes. |
| `activateConnection(providerId: string, applyTo: SettingScope, context: ProvidersEditContext): Promise<void>` | activate; reads saved connection tiers, activates, then restores those choices after host default mapping. |
| `performExternalAuth(providerId: string \| null, action: ProvidersExternalAuthAction): Promise<void>` and `externalAuth` signal | externalAction; supported named logins/checks and safe unsupported outcomes. Rechecks host authentication instead of treating launch as success. |
| `cancelVerification(params?: AuthCancelDraftVerificationParams): Promise<AuthCancelDraftVerificationResult>` | required cancelDraftVerification callback, dialog close and destruction; now returns the real cancellation result and respects the requested probe ID. |
| Existing `checkConnection()` now refreshes all sections | explicit Check connection controls; route changes can also change the model namespace and effective settings. No polling timer. |
| Existing CLI-create operation supplies the established Copilot OAuth marker | createCli; keeps the transport-specific marker in the state owner, following the existing CLI editor/host convention. |

Public types are exported by the existing export-star: ProvidersConnection, ProvidersMainSources, ProvidersCliModels, ProvidersConnectionDraft, ProvidersExternalAuthAction and ProvidersExternalAuth. No unused speculative facade was added.

## Decisions taken

1. Accepted the scope extension: repaired the state service and its tests for the coordinator's actual calls. Cancellation is a real result; setup and external actions remain state-owned.
2. Accepted the consumer ownership boundary: did not modify provider-consumer-assignments.component.ts or its spec. Composed against its current documented surface and recorded remaining evidence for its lane.
