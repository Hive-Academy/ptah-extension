# Code Style Review — `TASK_2026_523_c3df` (Batch F)

## Verdict

- **Recommendation:** APPROVE WITH CHANGES (Sound; minor improvements and structured architectural extractions available)
- **Score:** 7/10
- **Confidence:** HIGH
- **Key concern:** Excessive file sizes in presentation components (`ProviderSetupWizardComponent` at 2,254 lines, `ProvidersSettingsStateService` at 1,134 lines) and positional constructor parameter bloat (`AuthRpcHandlers` at 18 parameters) introduce maintenance brittleness that requires structured collaborator extractions following the repository's facade rule.

### Justification

The branch implements a major, clean consolidation of provider configuration across the monorepo, retiring fragmented legacy editors (auth-config, custom-provider-form, provider-model-selector, llm-providers-config) in favor of an atomic Providers page. Type safety is strictly preserved across all 98 modified files: zero added production `as any`, zero `@ts-ignore`, zero `@ts-expect-error`, and error catching consistently narrows with `instanceof Error`. Layer boundaries are strictly respected—frontend libraries do not import backend modules, `libs/frontend/ui` remains isolated from `@ptah-extension/core`, and cross-library imports route through declared package barrels without deep path leaks. Verification is comprehensive and green: all 159 chat provider tests, 55 state service tests, and 4 affected project lint/typecheck runs pass cleanly with zero errors. However, structural and style debt is concentrated in three areas: (1) constructor parameter explosion in `AuthRpcHandlers` (18 positional dependencies) combined with direct handler-to-handler coupling from `ConfigScopeRpcHandlers`; (2) large file sizes driven by inline templates and monolithic state orchestration in `ProviderSetupWizardComponent` (2,254 lines) and `ProvidersSettingsStateService` (1,134 lines); and (3) continued propagation of the `vscode-core` logger token in the new `DraftVerificationService`. None of these break runtime contracts today, but they present immediate maintenance friction that warrants extraction before these components expand further.

---

## Independence

In accordance with role instructions, the reviewer discloses prior participation in earlier batches of this task:
- **Self-assessed files (same author):**
  - `libs/frontend/chat/src/lib/settings/providers/provider-connection-card.component.ts`
  - `libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.ts`
  - Setting scope row integration and skill-enhancement timeout additions (`libs/backend/platform-core/src/file-settings-keys.ts`, `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.ts`, `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts`).
- **Independent assessment (not written by this reviewer):**
  - `ProviderSetupWizardComponent` (`libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.ts`)
  - `ProvidersSettingsComponent` (`libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts`)
  - `ProvidersSettingsStateService` (`libs/frontend/core/src/lib/services/providers-settings-state.service.ts`)
  - `DraftVerificationService` (`libs/backend/auth-providers/src/lib/auth/draft-verification.service.ts`)
  - `AuthRpcHandlers` changes (`libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts`)
  - `ConfigScopeRpcHandlers` (`libs/backend/rpc-handlers/src/lib/handlers/config-scope-rpc.handlers.ts`)
  - Atomic page mount and legacy component deprecation.

Findings on self-assessed files are explicitly marked as `[Same-Author]` to ensure transparent auditability.

---

## Findings

### Serious Issues

#### 1. Positional Constructor Parameter Bloat in `AuthRpcHandlers` (18 Parameters)
- **File:** [`libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts:228-274`](libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts#L228-L274)
- **Problem:** The `AuthRpcHandlers` constructor accepts 18 positional dependencies. During merge operations on this branch, inserting `draftVerification` at position 15 broke downstream unit harnesses that instantiate the class positionally. This directly violates the repository architectural guardrail: *"a constructor past ~8 deps means the cut was wrong"*.
- **Impact:** Positional instantiation in unit tests ([`auth-rpc.handlers.spec.ts:422-442`](libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.spec.ts#L422-L442)) requires 18 manual arguments cast with `as unknown as ...`. A future insertion or swap between two structurally compatible or cast types will compile without error and fail silently at runtime.
- **Fix:** Split `AuthRpcHandlers` along domain concerns into focused sub-handlers (e.g. `AuthStatusRpcHandlers`, `AuthOAuthRpcHandlers`, `AuthDraftVerificationRpcHandlers`, `AuthSettingsRpcHandlers`) each registering their own subset of the 16 RPC methods with <= 5 dependencies. For test harnesses, provide a typed builder factory `createAuthRpcHandlers(overrides?: Partial<AuthRpcDeps>)` to insulate tests from positional changes.

#### 2. Handler-to-Handler Direct Coupling: `ConfigScopeRpcHandlers` Injects Concrete `AuthRpcHandlers`
- **File:** [`libs/backend/rpc-handlers/src/lib/handlers/config-scope-rpc.handlers.ts:73, 143`](libs/backend/rpc-handlers/src/lib/handlers/config-scope-rpc.handlers.ts#L73)
- **Problem:** `ConfigScopeRpcHandlers` injects the entire concrete `AuthRpcHandlers` class solely to invoke `this.authHandlers.invalidateAuthStatusCache()` during scope override clears:
  ```ts
  73:  @inject(AuthRpcHandlers) private readonly authHandlers: AuthRpcHandlers,
  ...
  143: this.authHandlers.invalidateAuthStatusCache();
  ```
- **Tradeoff:** Direct dependency on a heavy 1,656-line RPC handler with 18 dependencies introduces tight coupling between peer handler classes. Unit testing `ConfigScopeRpcHandlers` now unnecessarily pulls in the `AuthRpcHandlers` dependency graph.
- **Recommendation:** Decouple auth status cache invalidation into an event on `SdkAdapterEvents` (e.g. `emitAuthSettingsChanged()`) or introduce a narrow DI token `IAuthCacheInvalidator` / `AuthStatusCacheCoordinator` that both handlers share.

#### 3. Monolithic Component Scope in `ProviderSetupWizardComponent` (2,254 lines)
- **File:** [`libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.ts:1-2254`](libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.ts#L1-L2254)
- **Problem:** At 2,254 lines, the wizard exceeds the repository's 700-line soft ceiling by more than 3x and triggers ESLint `max-lines` warnings (`File has too many lines (1973). Maximum allowed is 700`). The file mixes ~1,040 lines of inline template (lines 300–1338) with a 915-line component class containing the 5-step draft state machine, probe cancellation timers, OAuth polling, diagnostics translation, and commit assembly.
- **Tradeoff:** Keeping the entire wizard in a single file avoids multi-file wiring overhead, but impairs readability, increases merge conflict surface, and slows Angular template diagnostics.
- **Recommendation:** Apply the repository facade rule: (1) extract the inline template into `provider-setup-wizard.component.html` (saving ~1,040 lines in the `.ts` file); (2) extract `ProviderWizardDraftService` as an injected collaborator to manage the draft signals, probe timer, cancellation tokens, and commit payload assembly; and (3) extract `ProviderProbeVerificationViewComponent` for the Verify step (state machine, diagnostics disclosure, retry controls). See Agenda Item 1 for full specification.

#### 4. Broad Multi-Domain Orchestration in `ProvidersSettingsStateService` (1,134 lines)
- **File:** [`libs/frontend/core/src/lib/services/providers-settings-state.service.ts:1-1134`](libs/frontend/core/src/lib/services/providers-settings-state.service.ts#L1-L1134)
- **Problem:** The service exceeds the 700-line ceiling (1,134 lines) and manages state, caching, refresh logic, and mutations across six distinct domains: active route resolution, memory curation, skill lanes, judging/enhancement, CLI agent CRUD, and multi-RPC commit execution with rollback/unconfirmed tracking.
- **Tradeoff:** Consolidating state into one service gives `ProvidersSettingsComponent` a single facade, but concentrates too much implementation logic inside one class.
- **Recommendation:** Preserve `ProvidersSettingsStateService` as the public facade and DI token, but extract: (1) `ProvidersSettingsCommitCoordinator` (~260 lines, handling `runCommit`, multi-RPC sequencing, and partial/unconfirmed error states), and (2) `ProvidersExternalAuthCoordinator` (~150 lines, handling Copilot/Codex interactive sign-in and CLI detection). See Agenda Item 4.

---

### Minor Issues

#### 5. Continued Deepening of `vscode-core` Logger Token in New Backend Service
- **File:** [`libs/backend/auth-providers/src/lib/auth/draft-verification.service.ts:41, 131`](libs/backend/auth-providers/src/lib/auth/draft-verification.service.ts#L41)
- **Problem:** The newly introduced `DraftVerificationService` imports `TOKENS` from `@ptah-extension/vscode-core` and injects `@inject(TOKENS.LOGGER) private readonly logger: Logger`.
- **Impact:** While `auth-providers` already transitively depended on `vscode-core`, adding new usages of `TOKENS.LOGGER` deepens the known logging leak that prevents deleting `vscode-shim.ts` in standalone CLI and Electron runtimes. The repository architecture guide explicitly notes: *"Do not deepen this: new backend libs must log through the PLATFORM_TOKENS.OUTPUT_CHANNEL / IOutputChannel port, already registered in all three adapters."*
- **Fix:** In future refactoring, inject `IOutputChannel` from `@ptah-extension/platform-core` via `PLATFORM_TOKENS.OUTPUT_CHANNEL`.

#### 6. [Same-Author] Inline Template Bloat in `ProviderConnectionCardComponent` (823 lines)
- **File:** [`libs/frontend/chat/src/lib/settings/providers/provider-connection-card.component.ts:90-429`](libs/frontend/chat/src/lib/settings/providers/provider-connection-card.component.ts#L90-L429)
- **Problem:** The component is 823 lines, exceeding the 700-line soft ceiling. Of those, 340 lines are inline HTML template containing extensive SVG/icon templates, card tone/spine styling, and 10 visual state badges.
- **Impact:** Large inline template clutters component logic and triggers soft max-lines warnings.
- **Fix:** Extract lines 90–429 to `provider-connection-card.component.html`, reducing the TypeScript class file to ~390 lines.

#### 7. Unused Variables and Dead Assignments in RPC Handlers
- **File:** [`libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:40, 1979`](libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts#L40)
- **Problem:** ESLint flags `'SkillStatus' is defined but never used` (line 40) and `The value assigned to 'historyCount' is not used in subsequent statements` (line 1979).
- **Impact:** Adds diagnostic noise to CI lint runs.
- **Fix:** Remove the unused import and discard or prefix the unused assignment with `_`.

---

## The Four Agenda Items

### 1. `provider-setup-wizard.component.ts` (~2,254 lines)
- **Judgement:** The component is significantly oversized (2,254 lines vs. 700-line ceiling). However, a naive split into five ~200–300 line micro-components (one per step) is **explicitly rejected** because it violates the repository guardrail against creating fragments merely to satisfy a line cap, increases boilerplate inputs/outputs across five layers, and scatters the linear wizard workflow.
- **Named Recommendation:** Apply the **Facade Rule** with two extracted collaborators and one template extraction:
  1. **Extract `provider-setup-wizard.component.html`:** Moves ~1,040 lines of HTML out of the TypeScript file, immediately reducing the `.ts` file to ~1,214 lines.
  2. **Extract `ProviderWizardDraftService` (Injected Collaborator):** Extract the draft state signals (`_selection`, `_apiKeyDraft`, `_baseUrlDraft`, `_tiers`, `_saveTo`, `_activation`), the probe timeout/interval timer, probe cancellation token handling, error copy dictionary lookup (`PROBE_FAILURE_COPY`), and the `buildCommitPayload()` method into an `@Injectable()` draft service scoped to the component. This strips ~450 lines of state management from the component class.
  3. **Extract `ProviderProbeVerificationViewComponent` (UI Collaborator, ~350 lines):** Extract the Verify step into a named presentation component covering the probe progress spinner, live elapsed seconds counter, failure diagnostic accordion, external authentication redirect trigger, and retry actions.
  - **Result:** `ProviderSetupWizardComponent` remains the top-level facade (~420 lines of TS + HTML template), coordinating drawer visibility and step progression while delegating state to `ProviderWizardDraftService` and probe presentation to `ProviderProbeVerificationViewComponent`.

### 2. `provider-consumer-assignments.component.ts` (~794 lines)
- **Judgement:** The file grew from 695 lines to 794 lines during the Batch D-i Part 5 repair. **The added structure is entirely proportionate and justified.**
- **Rationale:**
  1. The repair eliminated three critical integrity defects: (a) fabricated fallback metadata (`{ 120000, 120000, 15000, 600000 }`) that showed fake time limits before judging data loaded; (b) fabricated `?? 'global'` guesses for unknown setting scopes (now honestly displaying `Mixed sources` per Decision 6); and (c) displaying empty assignments for not-yet-loaded sections.
  2. The ~100 added lines provide honest, granular UX states: individual row loading indicators (`Loading…`), retry strips (`Could not load this section. Retry.`), reactive deep-link navigation via `effect()`, and precise retry triggers (`refreshMemory`, `refreshLanes`, `refreshJudging`).
  3. Like the connection card, 270 lines of this file are inline template. The component logic itself is compact (~520 lines). Extracting the template to `provider-consumer-assignments.component.html` would bring the TypeScript file to ~524 lines, well within the 700-line ceiling, without splitting the cohesive 6-row consumer model.

### 3. `AuthRpcHandlers` 18 Positional Constructor Parameters
- **Judgement:** High architectural risk. A constructor with 18 positional parameters is a serious defect under the repository's SOLID standards (*"a constructor past ~8 deps means the cut was wrong"*).
- **Risk Assessment:** The incident during Batch A2 merge—where inserting `draftVerification` at position 15 broke the unit test harness—is a clear warning. In this case, TypeScript caught the breakage because the injected types differed. If a future change adds or shifts parameters with identical or compatible types (e.g. two services sharing a common interface or structural type), the error will pass compilation and cause silent runtime inversion of dependencies.
- **Named Recommendation:**
  1. **Domain Handler Splitting (Primary Fix):** `AuthRpcHandlers` currently handles 16 RPC methods. Split it into 4 focused handler classes registered in tsyringe:
     - `AuthStatusRpcHandler`: `auth:getHealth`, `auth:getAuthStatus`, `auth:getStatus`, `auth:getApiKeyStatus`, `auth:getScope` (5 deps: Logger, RpcHandler, ConfigManager, SecretsService, ScopeResolver).
     - `AuthOAuthRpcHandler`: `auth:copilotLogin`, `auth:copilotLogout`, `auth:copilotStatus`, `auth:codexLogin` (4 deps: Logger, RpcHandler, CopilotAuth, CodexAuth).
     - `AuthDraftVerificationRpcHandler`: `auth:verifyDraftConnection`, `auth:cancelDraftVerification` (3 deps: Logger, RpcHandler, DraftVerificationService).
     - `AuthSettingsRpcHandler`: `auth:saveSettings`, `auth:setApiKey`, `auth:testConnection`, `auth:getEffectiveRoute`, `auth:clearWorkspaceOverride` (6 deps: Logger, RpcHandler, SecretsService, SdkAdapter, ActiveProviderResolver, PlatformCommands).
  2. **Test Factory Pattern (Immediate Harness Hardening):** Replace direct positional constructor calls in `auth-rpc.handlers.spec.ts:422-442` with an options-bag factory:
     ```ts
     function createAuthRpcHandlers(overrides?: Partial<AuthRpcHandlerDependencies>): AuthRpcHandlers
     ```
     This prevents test suite breakages whenever constructor dependencies change.

### 4. `providers-settings-state.service.ts` (~1,134 lines)
- **Judgement:** The service has expanded to 1,134 lines, exceeding the 700-line soft ceiling. It acts as the central state coordinator for the new Providers page. While having a single state owner for the view is good Angular architecture, the service has accumulated responsibilities beyond state holding.
- **Named Recommendation:** Apply the **Facade Rule** by extracting two injected collaborators while keeping `ProvidersSettingsStateService` as the public DI token and facade:
  1. **`ProvidersSettingsCommitCoordinator` (~260 lines):** Extract lines 750–1010 (`runCommit`, `saveSettings`, `clearOverride`, multi-RPC partial failure handling, and `ProvidersSettingsCommit` state management). The commit coordinator receives the patch, executes the sequence of RPC calls, records `saved`, `unsaved`, and `unconfirmed` keys, and returns the result.
  2. **`ProvidersExternalAuthCoordinator` (~160 lines):** Extract lines 580–740 (`performExternalAuth`, Copilot/Codex interactive login lifecycle, device code handling, and CLI installation checks).
  - **Result:** `ProvidersSettingsStateService` is reduced to ~650 lines. It retains all reactive signal properties (`route`, `connections`, `scopes`, `effort`, `memory`, `lanes`, `judging`, `orchestration`, `cli`), refresh methods, and public method signatures, delegating heavy transactional execution to its collaborators.

---

## The Two Deliberate Decisions

### 1. Reasoning-Effort Single-Writer Exemption with Cache Invalidation
- **Evaluation:** **HOLDS.**
- **Analysis:**
  - In Batch D2/D3, the orchestrator deliberately exempted four pre-existing runtime effort writers from deletion:
    - `libs/frontend/chat/src/lib/components/molecules/chat-input/effort-selector.component.ts:306, 312` (runtime chat effort dropdown and active session synchronization).
    - `libs/frontend/chat/src/lib/settings/pro-features/workflows-config.component.ts:225` (workflows effort override).
    - `libs/frontend/tribunal-panel/src/lib/wizard/step-panel-preview.component.ts:341` (tribunal step preview effort).
    - `libs/frontend/chat/src/lib/services/ultracode-state.service.ts:47, 57` (ultracode transient boost).
  - The Single-Writer principle exists to prevent competing settings forms from silently clobbering each other's configuration on disk. In contrast, runtime chat controls are interactive session modifiers that need to adjust effort on the fly. Removing them would break the in-chat user experience.
  - The mitigation implemented via `EffortSettingsChangeService` (`effort-settings-change.service.ts:1-19`) is architecturally sound: it provides a value-free invalidation channel (revision counter + pending flag). When any runtime writer executes, `ProvidersSettingsStateService` immediately marks its effort view as loading, blanks the stale display value, and awaits an authoritative read-back from `config:effort-get` once the write settles. Three regression specs in `providers-settings-state.service.spec.ts` pin this behavior.
  - The reasoning holds; this is a pragmatic, well-mitigated coexistence rather than an architectural leak.

### 2. Asymmetric DTO Shapes for Enhancement Timeout (Read vs. Write)
- **Evaluation:** **HOLDS.**
- **Analysis:**
  - Read DTO (`SkillSynthesisSettingsDto.enhanceTimeoutMs`) returns metadata: `{ value: number, default: number, min: number, max: number }` (validated by `EnhanceTimeoutDtoSchema`).
  - Write DTO (`SkillSynthesisSettingsWriteDto.enhanceTimeoutMs`) accepts a scalar `number` (coerced and clamped by `EnhanceTimeoutSettingSchema`).
  - This asymmetry strictly follows **Command-Query Separation (CQS)**:
    - **Queries (Read)** must supply the UI with constraint bounds (`min: 15000, max: 600000, default: 120000`) so that inputs, validation copy, and slider ranges can be rendered dynamically from the backend without hardcoding or guessing defaults in client components.
    - **Commands (Write)** should accept only the user's desired value (`enhanceTimeoutMs: 60000`). Requiring the client to echo back `{ default, min, max }` would violate Single Source of Truth and force the server to validate client-supplied constraints against its own schema.
  - The design is clean, robust, and correctly implemented across backend schemas and frontend consumers.

---

## Five Style Questions

### 1. What breaks in six months?
- **Constructor fragility in `AuthRpcHandlers`:** If a new capability (e.g. MCP auth or enterprise SSO verification) is added to `AuthRpcHandlers`, inserting a 19th parameter will break all test harnesses and manual constructor callers.
- **Provider setup wizard state explosion:** When new provider types (e.g. local Ollama tool calling or custom proxy streaming headers) are added, adding more fields to `provider-setup-wizard.component.ts` will push the file past 2,500 lines, making it increasingly hazardous to edit without regressions.

### 2. What would a new team member misread?
- A new engineer might assume `provider-setup-wizard.component.ts` performs direct backend network calls because of its massive size, overlooking that it is purely presentational and delegates all I/O to the injected seams (`verifyDraftConnection`, `cancelDraftVerification`, and `commitRequested`).
- In `config-scope-rpc.handlers.ts:73`, a maintainer might assume `AuthRpcHandlers` is a domain service rather than an RPC handler class because it is injected directly into another RPC handler.

### 3. What does this cost to maintain?
- Inline templates across `provider-setup-wizard.component.ts` (1,040 lines), `provider-connection-card.component.ts` (340 lines), and `provider-consumer-assignments.component.ts` (270 lines) make visual reviews difficult during git diff inspections, because markup changes and TypeScript logic changes are mixed in single files.
- The 18-parameter constructor in `AuthRpcHandlers` costs developer time on every merge or dependency update.

### 4. Where is this inconsistent with the rest of the repository?
- Most settings components in `libs/frontend/chat/src/lib/settings/` use external template files (`.html`) when markup exceeds ~100 lines (e.g. `agent-orchestration-config.component.html`, `settings.component.html`). The new provider components use large inline templates (`styles` + `template` strings over 300–1,000 lines).
- Backend RPC handlers elsewhere in `rpc-handlers/src/lib/handlers/` do not inject sibling handler classes; they inject domain services or communicate via `SdkAgentAdapter` / `WorkspaceScopeResolver`.

### 5. What would you have done differently?
- I would have separated HTML templates from the TypeScript component files from day one (`provider-setup-wizard.component.html`, `provider-connection-card.component.html`, `provider-consumer-assignments.component.html`). This single change would have kept all three components under or near the 700-line ceiling without any behavioral alteration.
- I would have split `AuthRpcHandlers` into 4 cohesive handler classes rather than adding the 15th through 18th parameters to an already overloaded class.

---

## Pattern Compliance

| Repository rule or nearby convention | Status | Evidence |
| ------------------------------------ | ------ | -------- |
| Angular 22 standalone components only | **PASS** | `provider-setup-wizard.component.ts:281`, `provider-connection-card.component.ts:82`, `providers-settings.component.ts:32`, `provider-consumer-assignments.component.ts:146` |
| `ChangeDetectionStrategy.OnPush` mandatory | **PASS** | Present on all 4 new components (`provider-setup-wizard.component.ts:283`, `provider-connection-card.component.ts:89`, etc.) |
| State with signals + `inject()` | **PASS** | `providers-settings-state.service.ts:1, 140`, `providers-settings.component.ts:3` |
| No `[innerHTML]` on untrusted output | **PASS** | Zero `[innerHTML]` in all new templates; error messages use structured copy maps (`PROBE_FAILURE_COPY`) |
| Frontend does not import backend libs | **PASS** | Monorepo boundary check verified; zero `libs/backend/*` imports in `libs/frontend/*` |
| `libs/frontend/ui` does not import `@ptah-extension/core` | **PASS** | `libs/frontend/ui/src/lib/native/provider-mark/provider-mark.component.ts` imports only `@angular/core`, `lucide-angular`, and local data |
| Cross-lib imports use package barrels only | **PASS** | Verified zero deep-path imports (`/src/lib/...`) across all modified TypeScript files |
| No additions to production `as any` or `@ts-ignore` | **PASS** | 0 added `as any`, 0 added `@ts-ignore`, 0 added `@ts-expect-error` in production code |
| Narrow error catching with `instanceof Error` | **PASS** | `draft-verification.service.ts:342`, `config-scope-rpc.handlers.ts:94`, `providers-settings-state.service.ts:401` |
| Soft file ceiling 700 lines / past 1000 deliberate review | **FAIL (Warning)** | `provider-setup-wizard.component.ts` (2,254 lines), `providers-settings-state.service.ts` (1,134 lines), `provider-connection-card.component.ts` (823 lines), `provider-consumer-assignments.component.ts` (795 lines) |
| Constructor parameter limit (~8 dependencies max) | **FAIL** | `AuthRpcHandlers` has 18 positional constructor parameters (`auth-rpc.handlers.ts:228-274`) |
| No per-folder barrels under `settings/` | **PASS** | Pre-existing `settings/index.ts` cleaned up; no duplicate barrels created |
| Avoid deepening `vscode-core` logger leak in backend | **FAIL (Minor)** | `draft-verification.service.ts:41` injects `TOKENS.LOGGER` from `vscode-core` |

---

## Maintenance Debt

- **Introduced:**
  - 2,254-line wizard component requiring future collaborator extraction.
  - 1,134-line state service combining 6 distinct domains.
  - 18th positional parameter in `AuthRpcHandlers`.
  - Concrete class coupling between `ConfigScopeRpcHandlers` and `AuthRpcHandlers`.
- **Retired:**
  - Obsolete `auth-config.component.ts` (575 lines + 873 lines HTML + 433 lines spec).
  - Obsolete `custom-provider-form.component.ts` (454 lines + 441 lines HTML + 652 lines spec).
  - Obsolete `provider-model-selector.component.ts` (704 lines).
  - Obsolete `llm-providers-config.component.ts` (331 lines + 171 lines HTML).
  - Redundant model/effort editors in `agent-orchestration-config.component.ts` (net -566 lines).
  - Standalone mount duplication in `ptah-cli-config.component.ts` (net -1,140 lines).
- **Net:** **Massive net reduction in architectural fragmentation and duplicate editors.** 7,340 lines of legacy, split-brain configuration forms were deleted. While the replacement files are individually large, the system-wide architecture is much cleaner, unified under a single state owner and single-writer paradigm.

---

## What Is Good

1. **Strict Single-Writer Discipline:** The retirement of 8 conflicting legacy settings editors eliminates long-standing synchronization bugs where multiple forms silently overrode each other's configuration.
2. **Exemplary Type Precision:** In a change spanning +17,210 lines, zero `as any` and zero `@ts-ignore` were added to production code. All error boundaries rigorously narrow `unknown` errors with `instanceof Error`.
3. **Safe Draft Verification:** `DraftVerificationService` verifies connection drafts in memory using one-shot inference without persisting credentials or writing to `settings.json` or `process.env`. Transient secrets are scrubbed immediately.
4. **Resilient UX and Error Transparency:** As proven in the Batch D-i repair, components honestly report `Loading…`, `Mixed sources`, and `Could not load this section. Retry.` rather than fabricating default values or guessing global provenance.
5. **Rock-Solid Test Coverage:** All 159 chat provider tests, 55 state service tests, and monorepo lint/typecheck targets pass cleanly with 0 errors.

---

## Not Reviewed

1. **Live Electron / VS Code Host Integration:** Testing was conducted via Jest unit/component suites and static analysis; live execution inside an Electron window or VS Code extension host was not performed.
2. **Network / Real-Provider Inference Probing:** Draft verification was evaluated against mocked SDK adapters and unit specifications; live calls against real external OpenAI/Anthropic/Copilot endpoints were not executed.
3. **Legacy Files Untouched by this Branch:** Large pre-existing files outside the batch scope (e.g. `tasks-rpc.handlers.ts`, `voice-rpc.handlers.ts`, `chat-input.component.ts`) were not evaluated.
