# Implementation Plan — TASK_2026_523_c3df

Build `Settings → Providers` as the one surface for every provider and model
choice, make the settings show the authentication route actually in use, and
delete the eight existing entry points in the same pull request.

**Revision 2 (2026-09-22).** Rewritten after `context.md` gained the user
decisions D1, D2 and D3, and after `design-spec.md` and `research-report.md`
landed. Three decisions from revision 1 changed. Each change is labelled
**REVISED** below with the evidence that moved it.

## Inputs and constraints

- Requirements used:
  - `.ptah\specs\TASK_2026_523_c3df\context.md` (including "Decisions taken by
    the user (2026-09-22)": D1, D2, D3)
  - `.ptah\specs\TASK_2026_523_c3df\design-spec.md`
  - `.ptah\specs\TASK_2026_523_c3df\research-report.md`
  - `CLAUDE.md`, `libs\backend\auth-providers\CLAUDE.md`,
    `libs\backend\skill-synthesis\CLAUDE.md`
- Corrections applied: this file's revision 1, superseded in the three places
  named under "Decisions changed since revision 1".
- Design handoff used: `design-spec.md`. Its component names, file paths, state
  table, scope-affordance rules and wizard steps are taken as given. Where it
  conflicted with revision 1 of this plan, the resolution is written out rather
  than applied silently — see Decisions 3 and 4.
- Missing decision-critical input: none remaining. The vendor-mark licensing
  question that blocked revision 1 is settled by D1 and D2.

---

## Decisions changed since revision 1

| Was | Now | What moved it |
| --- | --- | --- |
| **D-old 3.** A new lib `libs/frontend/model-routing`, to avoid a `chat` to `memory` import cycle. | **Decision 3.** No new lib. The page lives at `libs/frontend/chat/src/lib/settings/providers/`, as `design-spec.md` proposes. | The cycle I feared does not exist. `ClaudeRpcService.call<T extends RpcMethodName>` (`libs/frontend/core/src/lib/services/claude-rpc.service.ts:129`) is a generic typed client in `core`, so `chat` reaches `skillSynthesis:*` and `memory:*` **without importing either feature lib**. Deep links back from those tabs go through `AppStateManager.setPendingSettingsTab` (`app-state.service.ts:907-913`), also in `core`, which is a call and not an import. My cycle argument was wrong, and a new lib, path alias and tag pair would have been cost for nothing. |
| **D-old 4.** Keep `judgeModel` model-only; do **not** add `skillSynthesis.judgeProvider`; add a `modelOnly` mode to the picker. | **Decision 4.** Add `skillSynthesis.judgeProvider`, and route the enhancer's auth override through the **existing** `ProviderAuthResolver`. The picker gains **fixed-provider** mode instead of model-only. | `design-spec.md` ("Background models") requires provider persistence for Judging & enhancement and forbids both a UI-only pin and a concatenated string. My objection was that the enhancer carries no auth override — but `ProviderAuthResolver.resolve(providerId, scope)` (`provider-auth-resolver.ts:123-168`) already produces one, tier values included, and `LaneResolverService` already consumes it. Reusing it is not a new writer. See Decision 4 for the rule that makes it safe. |
| **D-old "re-hosted, not deleted"** for `auth-config`, `provider-model-selector`, `ptah-cli-config`, `agent-orchestration-config`. | **Decision 9.** Eight entry points, each with an explicit treatment: two **replaced**, two **moved and reworked**, three **removed from their host**, one **audited then deleted**. | D3 plus the `design-spec.md` "Replace existing editors" table. Revision 1 under-scoped this. |

---

## Codebase evidence

Revision 1's evidence table is unchanged and still governs. The rows below are
the ones added or corrected for revision 2.

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| `ClaudeRpcService.call<T extends RpcMethodName>` is a generic typed client in `libs/frontend/core` | `libs/frontend/core/src/lib/services/claude-rpc.service.ts:129` | Any `scope:webview` lib can call any RPC method without importing another feature lib. **This is why no new lib is needed.** |
| `AppStateManager.setPendingSettingsTab` / `consumePendingSettingsTab` already carry a settings deep link with an optional provider id | `libs/frontend/core/src/lib/services/app-state.service.ts:907-913`; consumed at `settings.component.ts:119-123` | The "link to Providers" affordance from the Memory and Skills tabs is a call into `core`, not an import of `chat`. |
| `ProviderAuthResolver.resolve(requestedProviderId, scope = 'mainAgent')` returns a `OneShotAuthOverride` whose env is built by `buildLaneEnv` and layered with `buildTierValues` | `libs/backend/auth-providers/src/lib/auth/provider-auth-resolver.ts:123-168`, `:384`, `:456` | A pinned provider for enhancement can reuse **tier writer #3**. It does not become a new writer. |
| `resolve` returns `null` for an empty provider id and for the already-active provider | `provider-auth-resolver.ts:135-142` | `''` means inherit, end to end. The picker's `''` sentinel maps onto this exactly. |
| `assertNotCoolingDown` runs **above** both `return null` branches, keyed on `requested \|\| active` | `provider-auth-resolver.ts:133,196` | A pinned enhancement provider gets quota protection for free. Re-implementing the override in the enhancer would lose it. |
| `resolveLaneModel(cfg, judgeModel, ws)` is an exported pure function with exactly the three-branch rule a pinned consumer needs | `libs/backend/skill-synthesis/src/lib/lanes/lane-resolver.service.ts:156-164` | The enhancer can reuse the rule without becoming a lane. |
| `LaneResolverService` injects `PROVIDER_AUTH_RESOLVER_TOKEN` as **optional**, because a CLI or e2e host may not register `auth-providers` | `lane-resolver.service.ts:174-183` | The enhancer must inject it the same way, or it breaks those hosts. |
| A lane that names a provider resolves its model to the bare `defaultTier`, never a pinned dated id, because `buildLaneEnv` blanks the ambient tier env | `lane-resolver.service.ts:163`; `auth-providers/CLAUDE.md:121-138` | **The rule that makes Decision 4 safe.** A naive pinned enhancement would send an unservable model id. |
| `LlmProvidersConfigComponent` is defined but referenced only from comments — no component imports it | `libs/frontend/chat/src/lib/settings/ptah-ai/llm-providers-config.component.ts:66`; only comment hits at `vscode-lm-config.component.ts:7` and `agent-orchestration-config.component.ts:35` | Confirms `design-spec.md`: it is dead UI. It is entry point 8, to audit and delete. |
| Marketplace scanner rejects trademarked AI product names in non-JS files; a failed extension id is permanently burned | `CLAUDE.md:180-189` | Binding constraint on D2. A path such as `assets/icons/openai.svg` carries the token in the file path. |
| The webview is an Angular app bundled to JS; JS bundles pass the scanner | `CLAUDE.md:180-189` ("JS bundles … these names are safe there") | Inlined TypeScript path constants are the only compliant delivery. |

### Added for revision 3 — the draft-probe evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| `AuthConfigComponent.saveAndTest()` persists first and tests second; its own docblock lists "Saving settings via RPC (`auth:saveSettings`)" before "Testing connection via RPC (`auth:testConnection`)" | `libs/frontend/chat/src/lib/settings/auth/auth-config.component.ts:405-414` | Confirmed. Testing a bad credential overwrites a working one before discovering it is bad. |
| **`auth:testConnection` is not a network probe at all.** It polls `sdkAdapter.getHealth()` up to five times with an exponential 200 ms → 3.2 s delay and returns `success: health.status === 'available'` | `auth-rpc.handlers.ts:818-874` | It reads the health of the **already-reconfigured** adapter. It cannot test a candidate credential even in principle, and it is meaningless unless a save preceded it. There is no non-mutating probe in the product. |
| `OneShotAuthOverride` is `{ env: AuthEnv; baseUrl?: string }` | `agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:124-127` | The isolated-env unit already exists and is already what a lane passes. |
| `IInternalQuery.execute` accepts an optional `auth` override | `skill-synthesis/src/lib/internal-query.interface.ts:115` | A draft inference probe needs no new execution path. |
| `buildLaneEnv` is public on `ProviderAuthResolver`; a lane env is snapshot-only and must never mutate global `AuthEnv` or `process.env`; blanking assigns `undefined` and never deletes, and the env must never be serialized or normalized or the keys re-leak | `provider-auth-resolver.ts:456`; `auth-providers/CLAUDE.md:121-138` | The existing precedent for an isolated auth env, and the three rules a draft probe inherits verbatim. |
| `ProviderAuthResolver.resolve` reads the **persisted** credential for a provider id | `provider-auth-resolver.ts:208-278` | It cannot accept a draft credential. A sibling entry point is required; the env assembly is reused. |
| `classifyThrownNetworkFailure` returns `NetworkFailureSignal = 'connection' \| 'dns' \| 'timeout' \| 'http-5xx' \| 'http-429'`, walking `code`, `status` and `statusCode` up to 8 `cause` levels | `agent-sdk/src/lib/internal-query/network-failure.ts:41-46`, `:102-124` | Four of the nine taxonomy rows map straight onto it. |
| The network classifier deliberately excludes auth, validation and parse failures | `skill-synthesis/CLAUDE.md:99` ("never auth, validation or parse") | **401 and 403 are NOT classifiable by it.** The draft probe must read the HTTP status itself for those two rows, before consulting the classifier. |
| `networkSignalForHttpStatus` maps 429 → `http-429`, 408 → `timeout`, 5xx → `http-5xx` | `network-failure.ts:84-92` | Rate limiting arrives in-flight as `http-429`. |
| `ProviderQuotaError` carries `providerId` and `retryAfterMs`, honouring a `retry-after` header; it is thrown **pre-flight** by `assertNotCoolingDown` | `auth-providers/src/lib/auth/provider-quota.error.ts:21-33`; `provider-auth-resolver.ts:133,196` | Pre-flight quota exhaustion and in-flight rate limiting are two different taxonomy rows and the code already distinguishes them. |
| `ProviderAuthError` carries `providerId`; it means "configured but unusable" | `auth-providers/src/lib/auth/provider-auth.error.ts:11-20`; `agent-sdk/src/lib/auth/provider-auth-resolver.port.ts:28` | The pre-flight counterpart for the credential rows. |

---

## Decisions

### Decision 1 — `authMethod` stays the stored key. The route is DERIVED. No `'unset'` member, and no user-facing enum. (unchanged, with one addition)

Revision 1's reasoning stands in full: `FileSettingsManager.get`
(`platform-core/src/file-settings-manager.ts:84-91`) returns the registered
default `'apiKey'` (`file-settings-keys.ts:442`) for a physically absent key, so
an `'unset'` enum member cannot recover the truth on any existing install; and
it would make `normalizeAuthMethod` (`auth-method.utils.ts:30`),
`resolveActiveAuth` (`active-provider-resolver.ts:26`) and `resolveJudgeModel`
(`model-resolver.ts:167`) partial with no failure channel. The route is the
truthful answer and is what the page shows.

**Addition required by `design-spec.md`.** The spec states "No user-facing
`authMethod` enum" and "Do not reinterpret the shipped `apiKey` fallback as user
configuration". Revision 1 said the stored `authMethod` would be "shown beneath
as provenance". **That is corrected.** The page renders a human route identity —
"Claude · CLI subscription", "Claude · API key" — derived from
`resolveEffectiveAuthRoute` plus the resolved provider entry. The raw
`storedAuthMethod` stays in the RPC payload as **diagnostic data only** and is
never rendered as an enum value or a radio group.

**Trade-off.** Keeping the raw value in the payload but not on screen risks a
future implementer binding it to a control. Mitigation: name the field
`storedAuthMethodDiagnostic` and comment it at the type declaration. The
alternative — omit it — was rejected because the Verify step and the sanitized
diagnostic disclosure (`design-spec.md`, wizard step 3) need it to explain why a
route resolved the way it did.

### Decision 2 — Do NOT remove the `authMethod` store default in this task. (unchanged)

Deleting `authMethod: 'apiKey'` from `FILE_BASED_SETTINGS_DEFAULTS`
(`file-settings-keys.ts:442`) would make absence observable, and every consumer
already coalesces. It changes the meaning of a value read on every
session-start path in three hosts, for a benefit Decision 1 already delivers.
Out of scope; it needs its own test matrix.

### Decision 3 — REVISED. The page lives in `libs/frontend/chat/src/lib/settings/providers/`. No new lib.

**Chosen:** the file layout `design-spec.md` proposes, unchanged:

- `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts`
- `.../providers/provider-connection-card.component.ts`
- `.../providers/provider-setup-wizard.component.ts`
- `.../providers/setting-scope-row.component.ts`
- `.../providers/provider-consumer-assignments.component.ts`
- `libs/frontend/core/src/lib/services/providers-settings-state.service.ts`

**Why revision 1 was wrong.** I argued a new lib was needed to stop `chat`
importing `skill-synthesis-ui` and `memory-curator-ui`. It never had to.
`ClaudeRpcService.call<T extends RpcMethodName>`
(`claude-rpc.service.ts:129`) is generic over the whole `RpcMethodMap` and lives
in `core`, which `chat` already injects (`settings.component.ts:79`). Reading
`skillSynthesis:getLanes` from `chat` is one typed call, not an import. The
return links from the Memory and Skills tabs go through
`AppStateManager.setPendingSettingsTab` (`app-state.service.ts:907`), also in
`core`. There is no cycle to break, so there is no lib to create.

**Trade-off.** `chat` is already a large lib, and this adds a page plus a
five-step wizard to it. Against that: a new lib costs a `project.json`, two Nx
tags, a `tsconfig.base.json` alias, a jest config, an ng-packagr target and an
`index.ts` barrel — real, permanent surface — to solve a problem that does not
exist. `settings/` is already `chat`'s responsibility and `SettingsComponent`
is already the mount point and deep-link router (`settings.component.ts:118-134`).
If `chat` later needs splitting, that is a `humanize-library` task with its own
measurements, not a speculative pre-split here.

**Boundary check.** `chat` is `["scope:webview","type:feature"]`
(`libs/frontend/chat/project.json:7`). It imports `@ptah-extension/ui`
(`type:ui`), `@ptah-extension/core` (`type:core`) and
`@ptah-extension/shared`. All are permitted (`eslint.config.mjs:263-266`,
`:364-373`). No frontend lib imports a backend lib. No new tags are needed
because no new project is created.

### Decision 4 — REVISED. Add `skillSynthesis.judgeProvider`, and reuse the EXISTING auth resolver.

**Chosen:** add `skillSynthesis.judgeProvider` (default `''` = inherit). Keep
`skillSynthesis.judgeModel` with its `'inherit'` sentinel intact. Render both
through one `ProviderModelPickerComponent` instance, labelled "Judging &
enhancement", with the mandatory helper copy from `design-spec.md`: "Used for
judging and for Enhance now on skills, agents, and commands. The Judge lane is
configured separately above."

**Why this reverses revision 1.** `design-spec.md` requires provider
persistence here and forbids both a UI-only pin and a concatenated
provider/model string. My objection was that `SkillEnhancerService` passes no
`auth` to `internalQuery.execute` (`skill-enhancer.service.ts:838-846`), so a
pinned provider would name credentials the call does not carry. That objection
is answerable: `ProviderAuthResolver.resolve(providerId, scope)`
(`provider-auth-resolver.ts:123-168`) already produces exactly that override,
and `LaneResolverService` already consumes it through the optional
`PROVIDER_AUTH_RESOLVER_TOKEN` (`lane-resolver.service.ts:181-183`).

**Does this add a sixth place a provider can be pinned?** No. The constraint in
`context.md` counts **surfaces**, and the surface count goes from five to one.
Enhancement being the only background consumer without a provider is precisely
the asymmetry that produced the original failure report; making it symmetric is
the consolidation, not a violation of it.

**The two rules that make it safe. Both are mandatory.**

1. **Reuse tier writer #3. Do not grow a fourth.**
   `SkillEnhancerService` must obtain its override by injecting
   `PROVIDER_AUTH_RESOLVER_TOKEN` **as optional, last in the constructor** —
   mirroring `lane-resolver.service.ts:174-183`, because a CLI or e2e host may
   not register `auth-providers` — and calling
   `resolve(judgeProvider, 'lane')`. It must **not** assemble an env of its
   own. `auth-providers/CLAUDE.md:114-119` states that a fifth writer stopping
   at `persisted ?? defaults` silently reverts the bug and looks correct in
   review. `ProviderAuthResolver.resolve` already layers `buildTierValues`
   (`provider-auth-resolver.ts:240,252,276,384`), so reuse is the whole
   compliance story. Reuse also inherits the 429 cooling-down gate
   (`provider-auth-resolver.ts:133,196`), which a hand-rolled override would
   lose.
2. **A pinned provider changes the MODEL rule, not only the auth.**
   `buildLaneEnv` blanks every `ALL_TIER_ENV_KEYS` entry by design
   (`auth-providers/CLAUDE.md:121-138`), so under a pinned provider there is no
   tier mapping for a pinned dated id to travel through — which is exactly why
   `resolveLaneModel` returns the bare `defaultTier` on that branch
   (`lane-resolver.service.ts:163`). Enhancement must follow the same rule.
   **Reuse `resolveLaneModel` rather than restating it**, calling it with
   `{ provider: judgeProvider, model: judgeModel === 'inherit' ? '' : judgeModel,
   defaultTier: 'haiku' }` and `judgeModel = 'inherit'`. That yields: an explicit
   model wins; no provider pinned falls back to `resolveJudgeModel`'s ambient
   behaviour, byte-identical to today; a pinned provider with no model gets the
   bare tier alias. Enhancement stays **not a lane** — it keeps its own
   `skillQueryLane(origin)` routing and its own `ProviderNetworkBackoffs`
   handling (`skill-synthesis/CLAUDE.md:63,99`). Only the resolution rule is
   shared.

#### The sentinel translation — the single highest-risk line in this plan

Two components use the word "inherit" and spell it differently:

- `ProviderModelPickerComponent` spells inherit as **`''`**
  (`provider-model-picker.component.ts:56-60`).
- `resolveJudgeModel` spells it as the literal **`'inherit'`**, and returns
  **anything else verbatim** — including `''` (`model-resolver.ts:171`:
  `if (judgeModel !== 'inherit') return judgeModel;`).

**The failure this causes.** Swapping the free-text input
(`skill-settings-panel.component.ts:230-239`) for the picker without a
translation persists `''` into `skillSynthesis.judgeModel`. `resolveJudgeModel`
then returns `''`, and `SkillEnhancerService.generateCandidate` hands an empty
model string to `internalQuery.execute` (`skill-enhancer.service.ts:782-785`).
Enhancement breaks. It breaks **silently and for every install that opens the
new page**, because the control looks correct, the value round-trips, and the
default `'inherit'` (`file-settings-keys.ts:516`) is only replaced the first
time a user touches the row. This is the same class of defect as the original
bug report, reintroduced by the fix for it.

**Who owns the translation, and exactly where.**

| Direction | Owner | Rule |
| --- | --- | --- |
| Read (backend to picker) | `ProvidersSettingsStateService` (`libs/frontend/core/src/lib/services/providers-settings-state.service.ts`), in the adapter that turns the `skillSynthesis:getSettings` DTO into the row's view model | `judgeModel === 'inherit' ? '' : judgeModel` |
| Write (picker to backend) | The same service, in the commit path that builds the `skillSynthesis:updateSettings` patch | `model.trim() === '' ? 'inherit' : model.trim()` |

**It is owned by the state service, not the component**, for one reason: the
component is presentational and a second consumer of `judgeModel` (the wizard's
review step, or a future dashboard summary) would otherwise each need its own
copy of the rule. One translation, one place, both directions.

Both call sites carry a comment naming `model-resolver.ts:171`, so the next
reader learns why the mapping exists without re-deriving it.

**Do not "fix" this in the backend.** Relaxing `resolveJudgeModel` to treat `''`
as inherit looks simpler and is wrong: `resolveLaneModel`
(`lane-resolver.service.ts:156-164`) already gives `''` a *different* meaning
for the lane `provider` and `model` fields, and collapsing the two spellings
makes a blank lane model and a blank judge model indistinguishable in a function
that must treat them differently. `design-spec.md` reaches the same conclusion:
the legacy value "must map to the shared picker's empty model sentinel without
losing read compatibility" — map it, do not redefine it.

**Pin it with a test in both directions** (listed under Testability). A one-way
test passes while the write path still persists `''`.

**Picker extension changed.** Revision 1's `modelOnly` input is **dropped** — it
is no longer needed, because the judge row now has a real provider half. The
extension the design spec actually requires is **fixed-provider** mode (main
agent, and wizard step 4), plus externally supplied connection identities,
catalog retry, arbitrary model entry, a whole-control disabled state, and a
provenance slot. Still one picker; no second picker is minted.

### Decision 5 — `memory.curatorProvider` / `curatorModel` keep their names, RPC and write path. (unchanged)

Keys are correct (`file-settings-keys.ts:212-213`, defaults `:498-499`) and
round-trip through `memory:setTriggers` (`memory-rpc.handlers.ts:704-711`). Only
the control moves. Per `design-spec.md`, the Memory tab keeps a **read-only
resolved summary** plus a "Manage in Providers" link, which is a call to
`setPendingSettingsTab`, not an import.

### Decision 6 — Scope is generic for READS, honest about WRITES. (unchanged, with the design spec's additions folded in)

Auth keys have a scoped write path (`auth-rpc.handlers.ts:744-749`). Memory and
skill keys do not: both write through `workspaceProvider.setConfiguration`
(`memory-rpc.handlers.ts:707`, `skills-synthesis-rpc.handlers.ts:572`), which is
global only. The UI therefore shows a source strip for every field and offers
the override control only where `writeScopes` permits it.

`design-spec.md` adds four requirements the contract must carry, and names the
same gap: "existing `auth:getScope` exposes only `authMethodScope`,
`providerScope`, `activePath`, and optional `runtime`". The `ScopedSettingEntry`
DTO below therefore also carries `supportedTargets`, the resolved
`fallbackValue` preview, and a `credentialSource` discriminator, so the page can
render "Will use {value} from {source}" and can avoid pretending that choosing
Workspace relocates a secret.

### Decision 7 — No new tier-env writer. (unchanged, and now load-bearing for Decision 4)

Every write goes through an existing owning handler. The new backend surface is
two read-only methods plus one clear-only method. The one place revision 2 comes
close to a new writer is enhancement's pinned provider, and Decision 4 rule 1
closes it by reuse. `ProvidersSettingsComponent` must never write
`provider.<id>.<scope>.modelTier.*` directly; tier persistence continues through
the existing `provider:getModelTiers` / `provider:setModelTier` family, as
`design-spec.md` requires.

### Decision 8 — `ENHANCE_TIMEOUT_MS` becomes a registered setting. (unchanged, with a bound and a message)

`skillSynthesis.enhanceTimeoutMs`, default `120000`, registered in **both**
`FILE_BASED_SETTINGS_KEYS` and `FILE_BASED_SETTINGS_DEFAULTS`. The measured
failure was 37,311 ms against a 30,000 ms abort
(`skill-enhancer.service.ts:61`, `:826-829`); the lane defaults bracket the
choice at archaeologist `120000` and synthesis `90000`
(`file-settings-keys.ts:99,108`).

**Added for the design spec.** It states the UI "must display the new
backend-provided effective default, range, and validation message". So the
backend owns the bound: accept `15000` to `600000`, clamp on read, and return
`{ value, default, min, max }` in the settings DTO. The UI renders seconds and
never invents the range.

### Decision 9 — NEW. Eight entry points, each with a named treatment.

| # | Entry point | Treatment |
| --- | --- | --- |
| 1 | `settings/auth/auth-config.component.ts` + `.html` | **REPLACE.** The strategy-radio and tile editor is deleted. Its guided login flows (`auth-config.component.ts:409-419`) are re-implemented as wizard step 2 credential variants. No user-facing `authMethod` enum survives. |
| 2 | `settings/auth/provider-model-selector.component.ts` | **REPLACE the UI, PRESERVE the persistence.** Its independent autocomplete is deleted; tier editing moves into wizard step 4 on the shared picker. It continues to call `provider:getModelTiers` / `provider:setModelTier` — those calls move, they are not rewritten. |
| 3 | `settings/ptah-ai/ptah-cli-config.component.ts` | **MOVE and REWORK in place.** Becomes the CLI agents section's instance manager. Replace its embedded nine-entry provider constant with the merged registry (`design-spec.md`, IA section). |
| 4 | `settings/ptah-ai/agent-orchestration-config.component.ts` | **MOVE the provider/model/credential controls.** Concurrency and execution policy stay under Agent Orchestration with a link to the CLI row. |
| 5 | `memory-diagnostics-accordion.component.ts:155-170`, `:310-318` | **REMOVE the editor**, leave a read-only resolved summary plus a Manage link. |
| 6 | `skill-settings-panel.component.ts` lanes section (`:25-27`, `:35-40`, `:83`) | **REMOVE the four picker mounts.** Unrelated synthesis policy stays. |
| 7 | `skill-settings-panel.component.ts:230-239` judge free-text | **REMOVE.** Replaced by the shared picker in Background models. |
| 8 | `settings/ptah-ai/llm-providers-config.component.ts` | **AUDIT, then DELETE.** No component imports it (verified: only comment references at `vscode-lm-config.component.ts:7` and `agent-orchestration-config.component.ts:35`). Do **not** mount it as another editor. Run a reference check for its template, spec and any barrel export before removal. |

**Unused code is deleted, not commented out, renamed or re-exported.** After #8,
grep for `LlmProvidersConfigComponent` must return zero hits outside version
control history.

### Decision 10 — NEW. Vendor marks are a data table of inlined, sanitized TypeScript path constants. (D1 + D2)

**Chosen:** one data module and one presentational component, both in
`libs/frontend/ui`.

- `libs/frontend/ui/src/lib/native/provider-mark/provider-marks.data.ts` — a
  `Readonly<Record<string, ProviderMark>>` keyed by **registry provider id**,
  where `ProviderMark` is a discriminated union:
  `{ kind: 'path'; viewBox: string; d: readonly string[] } | { kind: 'lucide'; icon: 'Bot' | 'Server' | 'Terminal' }`.
- `libs/frontend/ui/src/lib/native/provider-mark/provider-mark.component.ts` —
  renders a 32 px box with a 24 px mark, `currentColor`, `aria-hidden="true"`,
  and falls back to the lucide glyph for any id absent from the table or whose
  record is `kind: 'lucide'`.

**D1 compliance.** Inlined marks exist only for `openrouter`, `ollama`,
`ollama-cloud`, `opencode`, `pi` and Ptah's own. Every other provider — including
`anthropic`, `github-copilot`, `openai-codex`, `moonshot`, `z-ai`, `lm-studio`,
`requesty` and every user-defined entry — resolves to the lucide fallback:
`Terminal` for a CLI route, `Server` for an endpoint or local server, `Bot`
otherwise. **The allowlist is the table.** No component may branch on a provider
id, which is the same rule `model-tier-derivation.ts` already holds
(`auth-providers/CLAUDE.md:81-88`: "No provider id appears anywhere in the file,
and none may be added"). Granting a vendor a mark later is one record.

**D2 compliance.** No `.svg` file enters the repository, the webview assets
directory, or the VSIX. Path data is TypeScript, compiled into the webview
bundle, and JS bundles pass the scanner (`CLAUDE.md:180-189`). **A file path is
scanned before its contents**, so `assets/icons/<vendor>.svg` would carry the
token regardless of what is inside it.

**Sanitization is a build-time obligation, not a runtime one.** Each record
carries only `viewBox` and a `d` array. `<title>`, `<desc>`, comments, metadata,
and any `class` or `id` containing a trademarked token are stripped when the
constant is authored. Nothing at runtime parses SVG markup, so there is no
injection surface and `[innerHTML]` is never used — the component builds
`<svg><path [attr.d]>` in its template.

**Trade-off.** A hand-authored constant can drift from the vendor's current
mark, and nothing detects it. Accepted: the alternative is a build step that
downloads and sanitizes, which reintroduces both the network dependency D2
rejected and a `.svg` file on disk. Five marks changing rarely is a cheaper
liability.

**Release gate (from D2's "Open verification").** Before release, run
`vsce package` then `vsce ls`, and assert that no non-JS file in the archive
carries a flagged token. **Against a throwaway extension id, never the shipping
one** — a failed id is permanently burned (`CLAUDE.md:180-189`). This is a
`devops-engineer` task and a release blocker, not an implementation detail.

---

## Target key map

Fate values: **KEEP** (key unchanged, UI moves), **UI-DELETE** (key unchanged,
old control removed), **NEW**, **UNCHANGED** (out of scope).

| Key | Owner surface AFTER | Write RPC | Scope today | Fate |
| --- | --- | --- | --- | --- |
| `authMethod` | Providers, Main agent (never rendered as an enum) | `auth:saveSettings` | global / app / workspace (`auth-schema.ts:14`) | KEEP |
| `anthropicProviderId` | Providers, Main agent | `auth:saveSettings` | global / app / workspace (`auth-schema.ts:24`) | KEEP |
| `provider.<authKey>.selectedModel` | Providers, Main agent model editor | `auth:saveSettings` | scoped (`auth-rpc.handlers.ts:1298-1305`) | KEEP |
| `provider.<authKey>.reasoningEffort` | Providers, Main agent | `auth:saveSettings` | scoped | KEEP |
| `provider.<id>.modelTier.{opus,sonnet,haiku}` | Providers, wizard step 4 (Models) | `provider:setModelTier` (unchanged family) | scoped | KEEP. UI moves; persistence path untouched (Decision 7). |
| `ptahCliAgents` | Providers, CLI agents | `ptahCli:create\|update\|delete` | global (`file-settings-keys.ts:184`) | KEEP |
| `agentOrchestration.*Model` / `*ReasoningEffort` | Providers, CLI agents | `agent:setConfig` | global (`file-settings-keys.ts:160-175`) | KEEP |
| `memory.curatorProvider` | Providers, Background models | `memory:setTriggers` | global only | UI-DELETE at `memory-diagnostics-accordion.component.ts:160,314` |
| `memory.curatorModel` | Providers, Background models | `memory:setTriggers` | global only | UI-DELETE at `:161,315` |
| `skillSynthesis.<lane>.provider` (4) | Providers, Background models | `skillSynthesis:setLanes` | global only | UI-DELETE from the Lanes section |
| `skillSynthesis.<lane>.model` (4) | Providers, Background models | `skillSynthesis:setLanes` | global only | UI-DELETE, same section |
| `skillSynthesis.judgeModel` | Providers, Judging & enhancement | `skillSynthesis:updateSettings` | global only | KEEP the key AND the `'inherit'` sentinel. Free-text control deleted. |
| `skillSynthesis.judgeProvider` | Providers, Judging & enhancement | `skillSynthesis:updateSettings` | global only | **NEW**, default `''` = inherit (Decision 4) |
| `skillSynthesis.enhanceTimeoutMs` | Providers, beneath Judging & enhancement | `skillSynthesis:updateSettings` | global only | **NEW**, default `120000`, bounds 15000–600000 (Decision 8) |

**Surface count: 5 before, 1 after.** Two new keys are added, and neither is a
new *place*: both sit inside the single Providers page, and `judgeProvider`
removes the asymmetry that made enhancement invisible in the first place. No key
in this table has a second writable editor anywhere after the change.

---

## RPC contract additions

Dual registration applies to every method below: an entry in `RpcMethodMap`
**and** in the boolean table in `libs/shared/src/lib/types/rpc.types.ts` (near
`:820` and `:3439`), plus membership of the handler class's
`static readonly METHODS` array (typed `satisfies readonly RpcMethodName[]`,
`auth-rpc.handlers.ts:164-178`). Both prefixes used — `auth:`
(`rpc-handler.ts:56`) and `config:` (`:52`) — are **already in
`ALLOWED_METHOD_PREFIXES`**, so that constant needs no edit.

**Documentation drift, in two files, not one.** The `rpc-handler.ts:46` citation
appears in root `CLAUDE.md:167` **and** in
`libs/backend/rpc-handlers/CLAUDE.md:179`. The constant is declared at
`rpc-handler.ts:44`. Both documents are wrong by the same two lines. The rule
they state is correct; only the line number is stale. Trust the source, and fix
both files if a docs batch is ever scheduled — fixing one leaves the other to
mislead the next reader.

**Count.** Four methods are specified below. A fifth, `auth:cancelDraftVerification`,
is required by repository precedent rather than by choice — see §4.

### Prerequisite — promote three declarations into `libs/shared`

Move `EffectiveRouteProvider` (`effective-route.ts:33-60`) and
`EffectiveRouteResult` (`:69-76`) into
`libs/shared/src/lib/types/rpc/rpc-auth.types.ts`, and re-export them from
`effective-route.ts` with `export type` (`node16` + `isolatedModules`;
`platform-core/src/index.ts` is the model). `effective-route.ts` already imports
from `@ptah-extension/shared` (`:21-26`), so no dependency is added, and
`doctor.ts:113`'s re-export keeps working. Also promote `SettingScope`
(currently local at `auth-state.service.ts:26`).

### 1. `auth:getEffectiveRoute` (read-only)

```ts
params: { refresh?: boolean }
result: AuthGetEffectiveRouteResult {
  route: AuthStrategyType | 'unresolved';
  ready: boolean;
  blockers: readonly string[];
  driverProviderId: string | null;
  resolvedAuthModality: 'api-key' | 'oauth' | 'cli' | 'local' | 'unknown';
  resolvedModel: { kind: 'model'; id: string }
               | { kind: 'tier'; tier: ProviderModelTier }
               | { kind: 'unresolved' };
  storedAuthMethodDiagnostic: string | null;   // RAW. Never rendered (Decision 1)
  storedAuthMethodScope: SettingScope;
  providers: readonly EffectiveRouteProvider[];
  lastSuccessfulProbeAt: string | null;
  lastFailedProbeAt: string | null;
  probedAt: string;
  fromCache: boolean;
}
```

- **Owner:** `AuthRpcHandlers`. It already holds the scope resolver, the Claude
  CLI detector, the Copilot and Codex auth services and the registry.
- **Probes: none new.** Composed from the caches the handler already keeps —
  `auth:getAuthStatus` (15 s, `auth-rpc.handlers.ts:77`), Claude CLI health
  (5 min, `:90`) and `llm:getProviderStatus` — so the existing 5 s per-probe
  ceiling (`:107`) already bounds it. Same three sources `doctor.ts:180-219`
  assembles by hand.
- **Config passed to the resolver:** the **raw**
  `scopeResolver.read<string>('authMethod', true) ?? null`, never
  `normalizeAuthMethod(...)`. `EffectiveRouteConfig.authMethod` is already
  `string | null` (`effective-route.ts:64`) and the unset blocker already exists
  (`:102-107`). Normalising first deletes that branch (Decision 1).
- **`design-spec.md` gap this closes.** The spec observes that the existing
  result "currently treats some unknown/skipped probe statuses permissively" and
  that implementation "must combine it with explicit successful probe evidence".
  `resolveEffectiveAuthRoute` is therefore **not modified** — it keeps producing
  `{route, ready, blockers}` for the CLI. The handler adds
  `resolvedAuthModality`, `resolvedModel` and the two probe timestamps
  **alongside** it, so the UI can map `unknown` / `skipped` to "Not checked" and
  "Check unavailable" rather than to "Connected", as the spec's state table
  requires. Widening the shared result with `driverProviderId` is the one change
  to the resolver's output, and it is a widening, not a behaviour change —
  recomputing it in the handler would be a second copy of a precedence chain,
  the failure mode `auth-providers/CLAUDE.md:90-119` documents.
- **Refresh:** on page open; after `auth:saveSettings`; after
  `auth:clearWorkspaceOverride`; after `config:clearScopeOverride` on an auth
  key; on an explicit **Check connection**. **No polling timer.** `refresh: true`
  calls the existing `invalidateAuthStatusCache()` first.

### 2. `config:getScopes` (read-only, allowlisted, batch)

```ts
params: { keys: readonly string[] }
result: {
  activePath: string | null;
  entries: readonly ScopedSettingEntry[];
}
ScopedSettingEntry {
  key: string;
  scope: SettingScope;
  hasOverride: boolean;
  effectiveKey: string;
  supportedTargets: readonly SettingScope[];
  fallbackPreview: { scope: SettingScope; value: unknown } | null;
  credentialSource: 'machine-secret-store' | 'host-supplied' | 'not-a-secret';
  runtime?: string;
}
```

- **Owner:** a new `ConfigScopeRpcHandlers` in `libs/backend/rpc-handlers`. The
  class name must end in `RpcHandlers` and must live in a **lib** — the same
  name under `apps/**` is a lint error (root `CLAUDE.md`, Naming).
- **Allowlist:** `SCOPED_SETTING_KEYS` in `libs/shared`, a
  `Record<string, { appScopable: boolean; supportedTargets: SettingScope[] }>`
  naming exactly the target-key-map keys. An unknown key returns
  `RpcUserError('INVALID_PARAMS')`. Without the allowlist this is a generic
  settings-read backdoor.
- **`appScopable` must travel with the key.** `read`, `hasOverride` and
  `effectiveKey` all take the flag (`workspace-scope-resolver.ts:109,118,257`),
  and `authMethod` / `anthropicProviderId` are `appScopable: true`
  (`auth-schema.ts:14,24`). A wrong flag yields a wrong effective key and a
  wrong badge.
- **`fallbackPreview`** is what makes the design spec's "Will use {value} from
  {source}" honest. Compute it by walking
  `candidateKeysForNorm` (`workspace-scope-resolver.ts:80-103`) past the current
  winner. **Do not simulate it in the frontend** — the spec forbids exactly that.
- **Implementation:** reuse `resolveScopeFromKey`
  (`auth-rpc.handlers.ts:137-157`) after **moving it** to a shared module in
  `rpc-handlers`. Two parsers of the same key grammar is the divergence this
  repository keeps warning about.

### 3. `config:clearScopeOverride` (clear-only, allowlisted, single key)

```ts
params: { key: string; target?: 'nearest' | 'all-above-global' }
result: { success: boolean; cleared: readonly string[]; resolvesFrom: SettingScope }
```

- `'nearest'` maps to `WorkspaceScopeResolver.clearOverride`
  (`workspace-scope-resolver.ts:202-211`), which removes **one** winning
  override. `'all-above-global'` maps to
  `clearMoreSpecific(key, 'global', appScopable)` (`:227-255`), which is what
  the spec's **Use global value** action needs. Returning `resolvesFrom` after a
  re-read is what lets the UI report success only when the value genuinely
  resolves from Global, as the spec demands.
- **Post-clear effect** registered per key prefix. For `authMethod`,
  `anthropicProviderId` or `provider.*`, call `sdkAdapter.reset()` and
  `invalidateAuthStatusCache()`, mirroring `auth-rpc.handlers.ts:1305-1306`.
  Omitting this leaves the SDK on a stale provider, silently.
- **`auth:clearWorkspaceOverride` stays.** It clears the four-key auth bundle as
  one action and is wired into `AuthStateService`
  (`auth-state.service.ts:1179-1193`). The spec's "No frontend loop calling the
  ambiguously named auth clear RPC" is satisfied because the page uses
  `config:clearScopeOverride` for per-field clears and never loops.

### 4. `auth:verifyDraftConnection` (non-mutating draft probe) — NEW

**Why it must exist.** There is no way to test a connection today without
persisting it first, and that is a defect as well as a blocker.

- `AuthConfigComponent.saveAndTest()` (`auth-config.component.ts:414`) delegates
  to `AuthStateService.saveAndTest()`, whose order its own docblock states:
  "Saving settings via RPC (`auth:saveSettings`)" **then** "Testing connection
  via RPC (`auth:testConnection`)" (`auth-config.component.ts:407-411`).
  Testing a wrong credential therefore overwrites a working one **before**
  anything is verified.
- `CustomProviderFormComponent.testConnection()` calls
  `authState.testCustomEntry(existing.id)` (`custom-provider-form.component.ts:416-419`)
  — it can only test an entry that is already persisted.
- `auth:testConnection` itself takes **no params** and performs **no request**.
  It polls `this.sdkAdapter.getHealth()` up to five times with exponential
  backoff (`auth-rpc.handlers.ts:818-874`). It reads the health of the
  already-configured adapter. It is structurally incapable of verifying a draft,
  so this is a new capability, not a parameter added to an existing one.

`design-spec.md` step 3 requires exactly the opposite posture: verify a draft,
change nothing, and leave the active route untouched. Hence a new method.

```ts
params: {
  probeId: string;              // client-generated; echoed back for supersession
  providerId: string;           // registry id, or the draft's custom id
  authMode: 'apiKey' | 'oauth' | 'cli' | 'local-native' | 'local-proxy' | 'custom';
  credential?: { kind: 'apiKey'; value: string };   // TRANSIENT — see below
  baseUrl?: string;             // local / custom only
  model?: string;               // provider default when absent
  timeoutMs?: number;           // clamped server-side
}
result: AuthVerifyDraftResult {
  probeId: string;
  outcome: 'verified' | 'failed' | 'cancelled';
  reason: ProbeFailureReason | null;   // null only when outcome is 'verified'
  detail: string | null;               // sanitized; never echoes the credential
  latencyMs: number | null;
  modelUsed: string | null;
  checkedAt: string;                   // ISO 8601
}
type ProbeFailureReason =
  | 'credential-rejected'   // 401
  | 'permission-denied'     // 403
  | 'unreachable'           // DNS, refused, reset
  | 'timeout'
  | 'rate-limited'          // 429
  | 'quota-exhausted'
  | 'model-unavailable'
  | 'cancelled'
  | 'unclassified';
```

- **Prefix:** `auth:`, already in `ALLOWED_METHOD_PREFIXES`
  (`rpc-handler.ts:56`). **No prefix must be added.**
- **Owner:** `AuthRpcHandlers`. Add to `METHODS` (`auth-rpc.handlers.ts:164-178`).

**Where the transient credential lives, and where it must never go.**

A new `DraftVerificationService` in `libs/backend/auth-providers` holds an
in-memory `Map<probeId, DraftEntry>` with a short TTL (60 s suggested) and a
hard entry cap. The credential exists only as a field on that entry, is
overwritten on completion, and is dropped on TTL expiry. It must **never** reach
`~/.ptah/settings.json` (`ISettingsStore.writeGlobal`) or the encrypted secrets
file (`IAuthSecretsService`). The service performs no write of any kind; a draft
that is never confirmed leaves no trace. The frontend holds the same value only
in a component signal and clears it when the wizard is cancelled, which
`design-spec.md` already requires.

**The auth env: reuse the existing isolated mechanism. Do not invent a second.**

Decision 7 forbids mutating global `AuthEnv` or `process.env`, and
`auth-providers/CLAUDE.md:135-138` states that a lane snapshot must be
snapshot-only for the same reason. The existing precedent is
`ProviderAuthResolver`: `buildLaneEnv` (`provider-auth-resolver.ts:456`) blanks
every `ALL_TIER_ENV_KEYS` entry and returns a snapshot, and `buildTierValues`
(`:384`) layers the resolved provider's tier values back on.

`ProviderAuthResolver.resolve` cannot be called directly, because it reads
**persisted** credentials (`:208-278`) and a draft's key is not persisted.
**Add a sibling entry point on that same class** —
`buildDraftOverride(draft): OneShotAuthOverride` — which routes the supplied
credential through the identical `buildLaneEnv` + `buildTierValues` internals.
Both helpers are private to the class (`:384`) or exported from it (`:456`), so
the new method belongs inside `ProviderAuthResolver` and nowhere else.

This keeps **one** env assembler. A separate draft assembler would be tier
writer #5 by construction — the failure `auth-providers/CLAUDE.md:114-119`
warns is invisible in review. Also call `assertNotCoolingDown`
(`:133,196`) so a draft probe cannot burn a quota that is already exhausted.

**What the probe actually does.** A single minimal inference call through the
one-shot path, with `maxTurns: 1`, the draft override as its `auth`
(`OneShotAuthOverride`, `sdk-query-runner.service.ts:124-127`), and its own
`AbortController`. A model-catalogue fetch is **not** sufficient:
`design-spec.md` states "Model-list retrieval alone is not proof that inference
works." Catalogue loading belongs to wizard step 4, not step 3.

**Cancellation and supersession.**

- *Superseded:* `probeId` is the generation token. The frontend records the
  latest id it issued and **discards any result whose `probeId` does not match**
  — the same stale-load generation guard the picker already uses and which
  `design-spec.md` requires be kept. No backend state is needed for this case.
- *Cancelled by the user:* this needs a real abort channel, because an
  in-flight inference call keeps spending until aborted. The repository's own
  convention for a long-running operation is a sibling method —
  `wizard:cancel-analysis` (`rpc.types.ts:848`), `indexing:cancel` (`:2066`),
  `agent:stop` (`:1149`), `subagent:interrupt` (`:993`). Follow it:
  **`auth:cancelDraftVerification { probeId } -> { cancelled: boolean }`**,
  which aborts the entry's `AbortController` and clears its credential
  immediately. The in-flight call then resolves `outcome: 'cancelled'`,
  `reason: 'cancelled'`.
  This is a fifth method rather than the fourth the brief anticipated. It is
  required by precedent, not preference: the transport carries no per-request
  cancel token (no `requestId` or abort field exists in
  `vscode-core/src/messaging/rpc-types.ts`), so without it the spec's "Cancel
  check" button cannot stop anything it claims to stop.

**Mapping onto the spec's failure copy.** The `reason` union is one-to-one with
`design-spec.md`'s "Probe failure copy by reason" table, so the frontend selects
copy from a data map and never parses a message string:

| `reason` | Spec row | Spec copy |
| --- | --- | --- |
| `credential-rejected` | Credential rejected / 401 | "The provider rejected this credential. Replace it or sign in again." |
| `permission-denied` | Permission / 403 | "This account cannot use the requested service or model." |
| `unreachable` | Network / DNS / refused | "Could not reach {hostname}. Check the URL and that the service is running." |
| `timeout` | Timeout | "No response within {probeLimitSeconds} seconds. Check the service and retry." |
| `rate-limited` | Rate limited / 429 | "The provider is rate-limiting requests. Retry {when available}." |
| `quota-exhausted` | Quota exhausted | "This account has no available quota for the test." |
| `model-unavailable` | Unsupported / missing model | "{model} is not available on this connection." |
| `cancelled` | Probe cancelled | "Connection check cancelled. Nothing was activated." |
| `unclassified` | Unclassified | "The connection check failed. Retry or review the connection details." |

Classification is **backend-side and evidence-based**, reusing the existing
classifier rather than a new one: `classifyThrownNetworkFailure` and
`QueryNetworkObserver` (`@ptah-extension/agent-sdk`, already imported by
`skill-enhancer.service.ts:17-20`) distinguish network-class failures from auth,
validation and parse failures. `ProviderQuotaError` from
`assertNotCoolingDown` maps to `quota-exhausted`. `timeout` is this method's own
`AbortController` firing. Anything unmatched is `unclassified` — **never** a
guessed `credential-rejected`, because the spec's recovery action for that
reason tells the user to replace a credential that may be fine.

**`detail` must be sanitized at the handler.** It is rendered inside the spec's
expandable diagnostic disclosure. It must never carry the credential, an
`Authorization` header, or a full request URL with a query string.

#### Classification precedence — the part the classifier does NOT cover

Reusing `classifyThrownNetworkFailure` is correct and is not sufficient. Two of
the nine rows cannot come from it, and one row is reachable by two paths. The
handler must therefore apply this order, and a test must pin the order rather
than the individual mappings:

| # | Check | Produces | Why it is at this position |
| --- | --- | --- | --- |
| 1 | Our own `AbortController` fired from `auth:cancelDraftVerification` | `cancelled` | A user cancel must never be reported as a timeout or a network failure. |
| 2 | `ProviderQuotaError` thrown **pre-flight** by `assertNotCoolingDown` (`provider-auth-resolver.ts:133,196`) | `quota-exhausted` | Pre-flight. No request was made, so no later evidence exists to classify. Its `retryAfterMs` (`provider-quota.error.ts:24`) supplies the spec's "Retry {when available}". |
| 3 | `ProviderAuthError` thrown pre-flight (`provider-auth.error.ts:11-20`) | `credential-rejected` | "Configured but unusable" is a credential verdict, and it too precedes any request. |
| 4 | **HTTP status read directly: 401 → `credential-rejected`, 403 → `permission-denied`** | those two | **This is the gap.** `classifyThrownNetworkFailure` deliberately excludes auth failures (`skill-synthesis/CLAUDE.md:99`: "never auth, validation or parse"), and `networkSignalForHttpStatus` (`network-failure.ts:84-92`) returns `null` for both. Fall through to the classifier and a rejected credential becomes `unclassified`. Read `status` / `statusCode` on the error and its `cause` chain, matching the classifier's own walk (`network-failure.ts:102-124`). |
| 5 | HTTP 404, or a provider message naming the requested model | `model-unavailable` | Before the network classifier, because 404 carries no network signal and would otherwise fall to `unclassified`. |
| 6 | `classifyThrownNetworkFailure` → `'http-429'` | `rate-limited` | **In-flight** 429, which is a different row from #2. The code already separates them: #2 is the pre-flight cooldown gate, this is a live response. Collapsing the two loses the distinction the spec's copy table draws. |
| 7 | `classifyThrownNetworkFailure` → `'timeout'`, or our own abort on `timeoutMs` | `timeout` | `ETIMEDOUT`, the undici timeout codes and HTTP 408 all land here (`network-failure.ts:60-65`, `:90`). |
| 8 | `classifyThrownNetworkFailure` → `'connection'` or `'dns'` | `unreachable` | `ECONNREFUSED`, `ECONNRESET`, `ENOTFOUND` and siblings (`network-failure.ts:50-61`). |
| 9 | `classifyThrownNetworkFailure` → `'http-5xx'` | `unclassified` | A 5xx is the provider's fault, not the credential's. It must not become `credential-rejected`. |
| 10 | Anything else | `unclassified` | Never guess. The spec's recovery for `credential-rejected` tells the user to replace a credential that may be fine. |

`QueryNetworkObserver` (`network-failure.ts:161`) applies only when the probe is
run through a streaming one-shot, where a `system/api_retry` message can carry
`error_status`. Feed it every message when that path is used; its `answered`
verdict is the positive evidence `auth:getEffectiveRoute`'s
`lastSuccessfulProbeAt` records.

### Settings DTO extensions (no new method)

`skillSynthesis:getSettings` / `updateSettings` carry `judgeProvider: string`
and `enhanceTimeoutMs: { value: number; default: number; min: number; max: number }`
(read) / `enhanceTimeoutMs: number` (write). Touch points:
`skills-synthesis-rpc.schema.ts:43` region, `skill-synthesis/src/lib/types.ts:433`
region, `skill-synthesis.service.ts:143` and `:1328`, and
`libs/shared/.../rpc.types.ts:2697` region.

---

## Migration

**No destructive rewrite of user settings. Nothing in this plan writes to
`~/.ptah/settings.json` on boot.**

**Reason.** `authMethod: 'apiKey'` is at once the shipped default
(`auth-schema.ts:12`, `file-settings-keys.ts:442`) and a legitimate persisted
choice, and `FileSettingsManager.get` (`file-settings-manager.ts:84-91`) makes a
physically absent key read identically to a stored one. **No marker anywhere
distinguishes them.** A migration would discard real choices on exactly the
installs most likely to have made one — the same argument
`auth-providers/CLAUDE.md:181-197` makes about the `modelTier` residue.

| Case | Behaviour after the change |
| --- | --- |
| `authMethod` absent or unrecognised | `route: 'unresolved'`, blocker `authMethod is unset or unrecognized` (`effective-route.ts:102-107`). Page shows **Not configured** and "Choose a provider to start the main agent." (design-spec state table). |
| `authMethod: 'apiKey'`, Anthropic key present | `route: 'api-key'`, `ready: true`. Headline reads "Claude · API key". Resolves the install in context.md. |
| `authMethod: 'apiKey'`, no key, Claude CLI healthy | `ready: false`, blocker `provider 'anthropic' has no API key configured` (`effective-route.ts:156-158`). The page offers **Use CLI subscription**, which opens the reviewed route change. Not a logout, not a key deletion, not an automatic switch. |
| An API key takes precedence over a live CLI login | Report the effective API-key route plus "Your API key currently takes precedence over the CLI login." (design-spec, Main agent). |
| `'claude-cli'` or `'claudeCli'` | Both already resolve (`effective-route.ts:94-95`; `auth-method.utils.ts:36`). No change. |
| `skillSynthesis.judgeModel` holds a free-text id | Read unchanged (`model-resolver.ts:171`). Shown as selected when the catalogue has it, otherwise as "{id} · not in current catalog" (design-spec). **Never cleared** — it may be valid on a provider whose catalogue has not loaded (`auth-providers/CLAUDE.md:199-215`). |
| `skillSynthesis.judgeProvider` absent | Reads `''` = inherit. `ProviderAuthResolver.resolve('')` returns `null` (`provider-auth-resolver.ts:139-141`) and `resolveLaneModel` takes the no-provider branch, so **every existing install behaves byte-identically to today**. This is the untouched-installs guarantee, and it is the same one `lane-resolver.service.ts:152-155` already documents for lanes. |
| `skillSynthesis.enhanceTimeoutMs` absent | Reads `120000` from `FILE_BASED_SETTINGS_DEFAULTS`. No write. |

`normalizeAuthMethod` is **not modified**. The only new rule is that the
effective-route handler bypasses it. Pin that with a test: the obvious cleanup
is to normalise first, and it silently deletes the unset branch.

---

## Component boundaries

### NEW — `libs/frontend/chat/src/lib/settings/providers/`

| Component | Responsibility | Failure behaviour | Verification seam |
| --- | --- | --- | --- |
| `ProvidersSettingsComponent` | Section coordination, read-back, draft ownership, deep-link focus. | Per-section failure. One failed read leaves other sections usable, with Retry in the failed section (design-spec §1). Never renders a default active provider while loading. | Spec with a stubbed RPC service: no active badge during load; two active badges never render. |
| `ProviderConnectionCardComponent` | Presentational `NativeCard` projection: mark, name, auth modality, status, source line, actions. | Renders `unknown` / `skipped` as **Not checked** or **Check unavailable**, never Connected. | Spec over the full state table, one case per row. |
| `ProviderSetupWizardComponent` | Five-step state machine in `NativeDrawer`. Verification must exercise the **draft**, not the persisted route. | A failed probe stays on Verify with non-secret values and the masked in-memory draft intact. Stale results from superseded probes are discarded. | Spec: verify-then-cancel leaves persisted settings unchanged. |
| `SettingScopeRowComponent` | Source strip, override and clear actions, target review, used by every field. | Shows **Mixed sources** rather than guessing a group scope. | Spec: override control hidden when `supportedTargets` is `['global']`. |
| `ProviderConsumerAssignmentsComponent` | Six background rows in fixed order plus the timeout field. | Selecting an unavailable provider shows an inline readiness message and a **Set up** deep link, preserving the draft. | Spec: `''` to and from `'inherit'` translation, both directions. |
| `ProvidersSettingsStateService` (`libs/frontend/core`) | Adapts RPC snapshots, owns commits. No persistence logic in components. | Re-reads effective values before updating badges. | Spec: a partial save names saved and unsaved fields. |

All are standalone, `OnPush`, signals and `inject()`. None imports a backend
lib. `ProviderMarkComponent` and its data table live in `libs/frontend/ui`
(Decision 10).

### MODIFY — `libs/frontend/ui/.../provider-model-picker.component.ts`

Add, as extensions to the **one** picker: fixed-provider mode; externally
supplied connection and CLI identities; catalog refresh and retry; arbitrary
model entry; whole-control disabled state; a content slot for
`SettingScopeRowComponent`. Preserve the existing stale-load generation guard
and the "{id} · not in current catalog" display for a pinned unknown id.
Revision 1's `modelOnly` input is dropped (Decision 4).

### MODIFY — backend

- `auth-rpc.handlers.ts` — add `auth:getEffectiveRoute` to `METHODS`
  (`:164-178`) and register it; move `resolveScopeFromKey` (`:137-157`) to a
  shared module and import it.
- **NEW** `config-scope-rpc.handlers.ts` — the two `config:` methods. Register
  in both composition roots' `phase-3-handlers` and update
  `expected-resolvable.ts` (root `CLAUDE.md`, Composition roots).
- `effective-route.ts` — re-export the promoted types with `export type`; add
  `driverProviderId` to `EffectiveRouteResult`.
- `skill-enhancer.service.ts` — replace `ENHANCE_TIMEOUT_MS` (`:61`) with a read
  of `skillSynthesis.enhanceTimeoutMs`, **passing no `defaultValue`**
  (`FileSettingsManager.get` prefers a caller default over the registered one,
  `file-settings-manager.ts:84-91`). Inject `PROVIDER_AUTH_RESOLVER_TOKEN`
  optional and last; resolve the model through `resolveLaneModel`
  (Decision 4 rules 1 and 2).
- `file-settings-keys.ts` — add `skillSynthesis.judgeProvider` and
  `skillSynthesis.enhanceTimeoutMs` to **both** tables.
- `libs/shared` — the promoted types, the three new DTOs, `SCOPED_SETTING_KEYS`,
  and the `RpcMethodMap` plus boolean-table entries.

---

## Landing strategy (D3): one pull request, ordered internally

**D3 is correct and this plan follows it.** A staged landing would need the eight
old surfaces forced read-only in the interim, which is most of the deletion work
done twice, and in between every intermediate build would ship two writable
editors for the same key — the state `skill-settings-panel.component.ts:4` exists
to prevent.

**I am not arguing against it.** One caveat worth stating, since D3 asks for
reasoning rather than silence: this PR will be large, and a large PR is harder to
revert. The mitigation is not staging but **ordering inside the branch** —
commits stay small and individually reviewable, and the branch is only opened for
review once group D has landed on it. The revert unit is the branch, which is
correct here, because a partial revert is exactly the two-editor state.

### Groups

| Group | Contents | Parallel-safe? | Must land with |
| --- | --- | --- | --- |
| **A — backend contract** | Type promotion into `libs/shared`; `auth:getEffectiveRoute`; `ConfigScopeRpcHandlers`; `SCOPED_SETTING_KEYS`; `resolveScopeFromKey` move; DI phase-3 registration and manifests. | Yes, with A2, B and C. | Standalone. Adds read-only surface; changes no existing behaviour. |
| **A2 — draft verification** | `auth:verifyDraftConnection` + `auth:cancelDraftVerification`; `DraftVerificationService`; `ProviderAuthResolver.buildDraftOverride`; the `ProbeFailureReason` union in `libs/shared`. | Yes, with A, B and C — but **sequence A2 after A** if one person takes both, because both edit `auth-rpc.handlers.ts` `METHODS`. | Standalone. Adds a method nothing calls yet and writes nothing to disk. Split from A because it is the only group that touches `ProviderAuthResolver`, and it wants a `code-logic-reviewer` pass of its own. |
| **B — settings keys and enhancement** | `judgeProvider` + `enhanceTimeoutMs` in both `file-settings-keys.ts` tables; the settings DTO chain; `SkillEnhancerService` timeout read, optional `ProviderAuthResolver` injection, `resolveLaneModel` reuse. | Yes, with A and C. | Standalone. `judgeProvider` defaults to `''`, so behaviour is byte-identical until a user sets it. |
| **C — shared picker extensions + vendor marks** | `ProviderModelPickerComponent` extensions; `ProviderMarkComponent`; `provider-marks.data.ts`. | Yes, with A and B. | Standalone. Additive to `libs/frontend/ui`; no existing consumer changes. |
| **D — the atomic group** | Build all six `providers/` components and `ProvidersSettingsStateService`; mount the page in `SettingsComponent`; **and** apply all eight treatments from Decision 9 in the same commit. | **No.** Internally sequential. | **Must land as ONE commit with the mount.** |

**Why D is atomic and A, A2, B and C are not.** A, A2, B and C add capability
nobody reads yet. None of them creates a second editor for any key, so any
prefix of them is a safe, shippable state. Group D is the only point where an
editor is created while old editors still exist. Splitting it — mount now,
delete later — produces exactly one forbidden intermediate:
`skillSynthesis.judgeModel` writable from both the new Judging & enhancement
row and `skill-settings-panel.component.ts:230-239`, with one of them silently
losing on the next read. Therefore **the mount and the eight removals are one
commit.**

### Commit grouping, stated per batch

The invariant: **no intermediate commit may leave two writable editors for the
same settings key.** Against that invariant each batch falls into exactly one of
three categories.

| Batch | Own commit? | Shares a commit with | Why |
| --- | --- | --- | --- |
| A — backend contract | Yes, freely splittable into several | — | Adds only read-only methods. Creates no editor. Cannot violate the invariant. |
| A2 — draft verification | Yes, freely splittable | — | Adds a method nothing calls and which writes nothing. Creates no editor. |
| B — settings keys and enhancement | Yes | — | Adds two keys at inherit-shaped defaults. No UI reads them yet, so no editor exists for either. |
| C — picker extensions and marks | Yes | — | Additive to `libs/frontend/ui`. The extensions have no consumer until D. |
| D1 — build the six `providers/` components against stubs | Yes | — | Not mounted, therefore not reachable, therefore not an editor. |
| **D2 — mount the page** | **No** | **D3 (all eight treatments)** | The moment the page is mounted it becomes a writable editor for all thirteen keys in the target key map, and the eight old surfaces are still writable. This is the forbidden state. |
| **D3 — the eight treatments from Decision 9** | **No** | **D2 (the mount)** | Landing the removals without the mount leaves every key with **zero** editors. That is not a violation of the invariant, but it is a broken product, so it is not a separable commit either. |

**So exactly one pair must share a commit: D2 and D3.** Everything else is
independently committable and independently revertable. A, A2, B and C are also
**file-disjoint from each other**, so they can be executed in parallel by
different people. Inside D, the six components are file-disjoint from each other
during D1 and can be parallelised, but D2 and D3 are one integration performed
by one person.

**Dependency direction, which is not the same as commit grouping.** D needs A,
A2, B and C to have landed on the branch first in order to compile — D's page
calls `auth:getEffectiveRoute`, `config:getScopes`,
`auth:verifyDraftConnection`, reads `judgeProvider`, and imports the extended
picker. That is a build-order constraint, not a same-commit constraint.

**The rule, stated so a reviewer can check it mechanically:** for every key in
the target key map, `git grep` at every commit on the branch must find at most
one component that **writes** it. Reads may overlap (the Memory tab keeps a
read-only summary; the Skills tab keeps a link). A batch is only complete when
that holds at its own commit, not merely at the branch tip.

### Ordering inside group D

1. **D1 —** the six components built and unit-tested against stubs, not yet
   mounted. No editor exists yet, so this is safe as its own commit, and it may
   itself be several commits (one per component).
2. **D2 + D3 — ONE commit:** mount in `SettingsComponent`, deep-link
   forwarding, the wizard's step-3 wiring onto `auth:verifyDraftConnection`,
   **and** all eight treatments from Decision 9, **and** the
   `LlmProvidersConfigComponent` reference check. This is the only commit in the
   task that must be atomic, and the reason is in the table above.
3. Follow-up commits on the same branch: spec updates, copy, accessibility fixes.
   These are safe to split because the editor count per key is already correct.

---

## Architecture-level quality requirements

- **Functional:** one writable control per key in the target key map. A
  repository search for `ProviderModelPickerComponent` returns `libs/frontend/ui`
  and `settings/providers/` only. The page's route headline equals
  `ptah doctor`'s `effective.route` for the same configuration. Zero hits for
  `LlmProvidersConfigComponent`.
- **Performance:** `auth:getEffectiveRoute` adds no probe and must stay under the
  2,000 ms slow-handler warning on a warm cache. No polling timer.
- **Security:** both `config:` methods are allowlisted. No method returns key
  material — `auth:getEffectiveRoute` returns status verdicts only, matching
  `llm:getProviderStatus` ("without exposing API keys",
  `llm-rpc-app.handlers.ts:263`). No secret reaches local storage, diagnostic
  copy or an error message. `ProviderMarkComponent` never uses `[innerHTML]`.
  **A draft credential is memory-only for the life of one probe.** It must never
  reach `ISettingsStore.writeGlobal` or `IAuthSecretsService`, and
  `AuthVerifyDraftResult.detail` must never echo it, an `Authorization` header,
  or a URL query string.
- **Maintainability:** no frontend lib imports a backend lib. No new lib, so no
  new tags. No new tier-env writer — enhancement reuses writer #3. One picker.
  The vendor allowlist is a data table; no component branches on a provider id.
- **Testability:** pin, as behaviour — (1) the raw, un-normalised `authMethod`
  handed to the resolver; (2) `''` to and from `'inherit'`, both directions;
  (3) both new keys present in both `file-settings-keys.ts` tables;
  (4) `judgeProvider: ''` produces byte-identical enhancement behaviour to
  today; (5) a pinned `judgeProvider` yields a bare tier alias, not a pinned
  dated id; (6) the override control hidden when `supportedTargets` is
  `['global']`; (7) `sdkAdapter.reset()` after clearing an auth-scoped key;
  (8) unknown and skipped probe statuses never render as Connected;
  (9) `vsce ls` shows no non-JS file carrying a flagged token;
  (10) **a failed `auth:verifyDraftConnection` writes nothing** — assert the
  settings file byte-identical and `IAuthSecretsService` never called, for both
  a rejected credential and a cancel;
  (11) **the classification precedence holds**, with at minimum a 401 case
  (must be `credential-rejected`, not `unclassified` — the gap the network
  classifier leaves), a pre-flight `ProviderQuotaError` case
  (`quota-exhausted`) and an in-flight 429 case (`rate-limited`), proving the
  two are not collapsed;
  (12) a superseded `probeId` result is discarded by the frontend and never
  updates the Verify step.

---

## Risks and open questions

1. **Group D is the largest single commit this repository has seen in a while.**
   It is the correct unit (see Landing strategy), but it is a real review
   burden. Mitigate by landing A, A2, B and C first on the branch and reviewing
   them separately.
2. **`SkillEnhancerService` gaining an auth override is the highest-risk change
   in the plan.** Implemented naively it becomes tier writer #5 and sends
   unservable model ids. Decision 4 rules 1 and 2 are the guard; treat them as
   acceptance criteria, not advice. `auth-providers/CLAUDE.md:114-119` records
   that two prior writers were found only by going to look for them, one batch
   apart.
3. **`anthropicProviderId` default disagrees with its own schema** —
   `file-settings-keys.ts:443` says `'openrouter'`, `auth-schema.ts:22` says
   `''`, and `effective-route.ts:118-120` reads it. The new page makes this
   visible for the first time. Out of scope; expect a report.
4. **The `rpc-handler.ts:46` drift is in TWO documents, not one.** Root
   `CLAUDE.md:167` and `libs/backend/rpc-handlers/CLAUDE.md:179` both cite
   `:46`; `ALLOWED_METHOD_PREFIXES` is declared at `rpc-handler.ts:44`. The rule
   both state is correct — only the line number is stale. Trust the source. If a
   docs batch corrects this, correct both: fixing one leaves the other to
   mislead the next reader, and the `rpc-handlers` copy is the one a handler
   author reaches first.
5. **`driverProviderId` widens `EffectiveRouteResult`.** Safe for both CLI
   callers, but `doctor.spec.ts:390-510` asserts on the result and must be
   re-read first.
6. **Reworking `PtahCliConfigComponent` (1,172 lines) in place** may surface
   layout and injection assumptions about the settings page. Its embedded
   nine-entry provider constant must be replaced with the merged registry. This
   is the largest mechanical piece of group D.
7. **RESOLVED — the verification gap revision 1 left open is now closed on all
   three hosts.** Revision 1 verified the "an absent key reads as `'apiKey'`"
   chain on Electron only and labelled the other two hosts an assumption. Both
   have since been read:
   - **CLI:** `platform-cli/src/settings/file-settings-store.ts:42-44` —
     `readGlobal` calls `this.fileSettings.get<T>(key)` unconditionally.
   - **VS Code:** `platform-vscode/src/settings/vscode-settings-adapter.ts:70-75`
     — `readGlobal` branches on `isFileBasedSettingKey(key)`, and `authMethod`
     **is** in `FILE_BASED_SETTINGS_KEYS` (`file-settings-keys.ts:155`), so it
     takes `:72`, `this.workspaceProvider.fileSettings.get<T>(key)`.

   All three adapters converge on `PtahFileSettingsManager.get`
   (`platform-core/src/file-settings-manager.ts:84-91`), which returns the
   registered default `'apiKey'` (`:442`) for a physically absent key.
   **Decision 1 now rests on verified ground on every host**, and Decision 2's
   "do not remove the store default in this task" keeps its full force: the
   removal would change behaviour identically in all three adapters, which is
   exactly why it deserves its own task and test matrix rather than a line in
   this one.

8. **Latent defect, named because this plan fixes it as a side effect:
    testing a credential today overwrites a working one.**
    `AuthConfigComponent.saveAndTest()` (`auth-config.component.ts:414`) calls
    `auth:saveSettings` **before** `auth:testConnection`, per its own docblock
    (`:407-411`). A user who pastes a wrong key to "see if it works" has already
    replaced the working key by the time the failure is reported, and
    `auth:testConnection` (`auth-rpc.handlers.ts:818-874`) cannot tell them
    otherwise because it only polls `sdkAdapter.getHealth()` and never issues a
    request. `CustomProviderFormComponent.testConnection()`
    (`custom-provider-form.component.ts:416-419`) has the same shape for custom
    entries: it can only test something already persisted.
    `auth:verifyDraftConnection` (§4) removes the save-first step for the new
    wizard. It does **not** retroactively fix any surface left outside this
    task — but entry point 1 (`auth-config`) is replaced by Decision 9, so the
    defective path is deleted rather than left beside the new one. Confirm this
    during the group D review: a `git grep` for `saveAndTest` after the mount
    commit should return the state service's own method and no caller that
    saves in order to test.
9. **The `vsce ls` gate has no owner yet.** D2 names it as open verification. It
   is a release blocker, it needs a throwaway extension id, and it belongs to
   `devops-engineer`. If it is not scheduled, D2's compliance is asserted rather
   than measured.
10. **Design-spec items I did not turn into architecture**, because they are
   implementation-level and the spec already specifies them precisely: the exact
   probe-failure copy table, the accessibility contrast exceptions for the
   garden and winter themes, and the wizard's per-credential-variant field
   lists. They are inputs to `frontend-developer`, not open questions.
11. **Scope note — the wizard and the vendor marks are IN scope, not deferred.**
   Revision 1 excluded both because the theSVG licensing question was open. D1
   and D2 closed it, and revision 2 brought both in: the marks as Decision 10
   (data table plus `ProviderMarkComponent` in `libs/frontend/ui`, group C), the
   wizard as `ProviderSetupWizardComponent` in Component boundaries plus
   `auth:verifyDraftConnection` (§4, group A2). Neither is a recommendation to
   defer, and nothing in this plan forecloses them:
   - `ProvidersSettingsComponent` — the page component, renamed from revision
     1's `ModelRoutingPanelComponent` to match `design-spec.md`'s inventory —
     owns section coordination and draft state only. The wizard is a sibling in
     a `NativeDrawer`, not a child of a section, so its five steps can grow
     without touching the sections.
   - Marks enter only through `ProviderMarkComponent`, which takes a provider
     id. No section reads the allowlist, so granting a vendor a mark later stays
     a one-record edit to `provider-marks.data.ts`.
   - `auth:verifyDraftConnection` takes a draft, never a persisted id, so a
     future credential modality is a new `authMode` member rather than a new
     method.

   **One genuine sequencing recommendation, stated as such.** If group D proves
   too large in review, the piece to split out is the **five-step wizard**, not
   the marks and not the deletions. The wizard is the only part of D that
   creates no second editor: with it deferred, "Connect provider" can open the
   existing per-provider flows for one release, and the eight removals and the
   page still land atomically as D3 requires. The marks cannot be split out
   usefully — they are already group C and cost nothing to carry. The deletions
   must not be split out, because that is exactly the two-editor state D3
   rejects. This is a fallback, not the plan: the plan is that D lands whole.

---

## Team-leader handoff

- **Recommended executors:**
  - Group A: `backend-developer` (crosses `shared`, `auth-providers`,
    `rpc-handlers`, the composition roots).
  - Group A2: `backend-developer`, then `code-logic-reviewer` before D consumes
    it. It is the only group that handles an unpersisted credential and the only
    one that adds a method to `ProviderAuthResolver`; both deserve a dedicated
    pass. Brief the executor on `auth-providers/CLAUDE.md:121-138` (the lane
    snapshot must not mutate global `AuthEnv` or `process.env`).
  - Group B: `backend-developer` (`platform-core`, `skill-synthesis`, the
    settings DTO chain). **Assign the same person as group A or brief them on
    `auth-providers/CLAUDE.md:90-138`** — the enhancement override is where this
    task can regress silently.
  - Group C: `frontend-developer` (`libs/frontend/ui` only).
  - Group D: `frontend-developer`, with `ui-ux-designer` available for the
    state-table and scope-affordance copy.
  - After D: `code-style-reviewer` for boundaries and the one-writer-per-key
    rule; `code-logic-reviewer` for the enhancement override and the scope
    clear semantics; `senior-tester` for the twelve behaviour pins;
    `devops-engineer` for the `vsce package` / `vsce ls` gate.
- **Complexity: HIGH.** Eight entry points removed atomically, five new RPC
  methods under dual registration, two new settings keys in a table whose
  documented failure mode is silent, one backend service gaining an auth
  override next to a documented four-writer invariant, and one in-memory
  credential path that must never reach disk.
- **Commit grouping (the D3 invariant):** exactly one pair must share a commit —
  **D2 (mount) and D3 (the eight treatments)**. See "Commit grouping, stated per
  batch" for the per-batch table and the reason. A, A2, B, C and D1 are each
  independently committable and independently revertable; none of them creates a
  second editor for any key.
- **Dependencies and ordering:** A, A2 and C must land before D compiles. B is
  independent of D but must land in the same PR because the Judging &
  enhancement row reads `judgeProvider`. A, B and C run in parallel; D is
  sequential and atomic at its mount commit.
- **Parallel-safe work:** groups A, A2, B and C touch disjoint files, with one
  exception — A and A2 both edit `AuthRpcHandlers.METHODS`
  (`auth-rpc.handlers.ts:164-178`). Either give both groups to one person and
  sequence A2 after A, or expect one trivial conflict in that array. Inside D,
  the six components are file-disjoint during D1 and can be built in parallel;
  D2 and D3 are one integration performed by one person.
- **Files affected:**
  - **CREATE:** `libs/frontend/chat/src/lib/settings/providers/` (five
    components plus specs);
    `libs/frontend/core/src/lib/services/providers-settings-state.service.ts`;
    `libs/frontend/ui/src/lib/native/provider-mark/` (component plus
    `provider-marks.data.ts`);
    `libs/backend/rpc-handlers/src/lib/handlers/config-scope-rpc.handlers.ts`;
    a shared `resolve-scope-from-key.ts` in `rpc-handlers`;
    `libs/backend/auth-providers/src/lib/auth/draft-verification.service.ts`
    (group A2 — the in-memory draft store; it must contain no write to any
    settings or secrets store).
  - **MODIFY:** `libs/shared/src/lib/types/rpc/rpc-auth.types.ts`;
    `libs/shared/src/lib/types/rpc.types.ts`;
    `libs/backend/auth-providers/src/lib/auth/effective-route.ts`;
    `libs/backend/auth-providers/src/lib/auth/provider-auth-resolver.ts`
    (group A2 — add `buildDraftOverride`; do **not** alter `resolve`,
    `buildLaneEnv` or `buildTierValues`);
    `libs/backend/auth-providers/src/lib/di/{tokens,register}.ts`
    (register `DraftVerificationService`);
    `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts`;
    `.../skills-synthesis-rpc.schema.ts`;
    `libs/backend/platform-core/src/file-settings-keys.ts`;
    `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts`,
    `types.ts`, `skill-synthesis.service.ts`;
    `libs/frontend/ui/.../provider-model-picker.component.ts` and
    `libs/frontend/ui/src/index.ts`;
    `libs/frontend/chat/src/lib/settings/settings.component.ts` and `.html`;
    `.../settings/ptah-ai/ptah-cli-config.component.ts`;
    `.../settings/ptah-ai/agent-orchestration-config.component.ts`;
    `.../settings/auth/custom-provider-form.component.ts`;
    `libs/frontend/skill-synthesis-ui/.../skill-settings-panel.component.ts`;
    `libs/frontend/memory-curator-ui/.../memory-diagnostics-accordion.component.ts`;
    `apps/ptah-extension-vscode/src/di/phase-3-handlers*` and
    `apps/ptah-electron/src/di/phase-3-handlers*` with their
    `expected-resolvable.ts` manifests.
  - **DELETE:** `libs/frontend/chat/src/lib/settings/auth/auth-config.component.ts`
    and `.html` (replaced — entry point 1);
    `.../settings/auth/provider-model-selector.component.ts` (UI replaced,
    persistence calls relocated — entry point 2);
    `.../settings/ptah-ai/llm-providers-config.component.ts` and
    `.html` (dead — entry point 8); their specs; any barrel export of the three.
    Delete outright — no `_unused` rename, no commented-out block, no
    re-export "in case".
- **Verification points:**
  - Contracts to honour: `effective-route.ts:86-170` (do not re-implement the
    resolver); `model-resolver.ts:171` (the `'inherit'` sentinel);
    `lane-resolver.service.ts:156-164` (reuse the model rule);
    `provider-auth-resolver.ts:123-168` (reuse the override);
    `auth-providers/CLAUDE.md:90-138` (no fifth tier writer, and the draft
    override is snapshot-only);
    `file-settings-keys.ts:278-284` (both tables, every new key);
    `rpc-handler.ts:44` plus the `RpcMethodMap` entry (dual registration —
    note both `CLAUDE.md` copies say `:46`);
    `CLAUDE.md:180-189` (no non-JS file carrying a flagged token).
  - **The two pins a reviewer must not accept on assertion.**
    1. *Sentinel, both directions.* A test that writes `''` from the picker and
       reads `'inherit'` back off `skillSynthesis.judgeModel`, **and** a test
       that reads `'inherit'` off disk and renders `''` in the picker. One
       direction alone passes while the write path still persists `''` — the
       failure mode described under Decision 4.
    2. *The draft probe writes nothing.* A test that runs
       `auth:verifyDraftConnection` with a bad credential and asserts that
       `ISettingsStore.writeGlobal` and `IAuthSecretsService` were **not**
       called, and that the previously stored credential is unchanged. That is
       the defect in Risk 8 stated as an executable assertion.
  - Data changes: two new settings keys,
    `skillSynthesis.judgeProvider = ''` and
    `skillSynthesis.enhanceTimeoutMs = 120000`. **No migration. No rewrite of
    any existing value.**
  - Commands that must pass:
    `npx nx run-many -t lint -p <touched projects>`;
    `npm run typecheck:all`;
    `npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/auth-providers @ptah-extension/skill-synthesis @ptah-extension/platform-core @ptah-extension/ui @ptah-extension/core @ptah-extension/chat @ptah-extension/skill-synthesis-ui @ptah-extension/memory-curator-ui`.
    **Never run `nx test projA projB`** — Nx runs the first project only and
    turns the rest into Jest path filters, exiting 0 with zero tests run (root
    `CLAUDE.md`). Read the `Running target test for N projects` header and check
    `N`.
    After editing any `project.json`, run `npx nx reset` **before** that batch's
    first command, and never while another executor shares the worktree.
  - Release gate: `vsce package` then `vsce ls` against a **throwaway**
    extension id, asserting zero non-JS files carrying a flagged token.
