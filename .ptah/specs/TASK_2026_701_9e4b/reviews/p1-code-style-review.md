# P1 public API code-style review — TASK_2026_701_9e4b

Review family: codex; implementer family: Claude

Score: **6/10**. Verdict: **REVISE** (NEEDS_REVISION).
Findings: **1 Blocking, 1 Serious, 0 Moderate, 0 Minor**.

## Scope and evidence limits

Reviewed the named P1 contract surfaces in the current worktree: CLI schema/version and kept-count presentation; provenance, wizard decisions, marketplace and clone contracts; origin sidecars and agreement fixtures; plugin-loader initialization and source descriptors; mirror descriptors and scope options; wizard-origin persistence and DI registration; coalescer outcomes, Library notifications, refresher port, and destination scanning. Large existing files were inspected at their relevant contract and implementation sections, not approved in their entirety. Some broad reads were truncated; no clean verdict is inferred for omitted code.

Compared the new persistence boundary with `libs/shared/src/lib/types/origin-sidecar.types.ts:128` and `libs/backend/agent-generation/src/lib/services/wizard-agent-origin.store.ts:43`, and the broadcaster with `apps/ptah-electron/src/activation/boot-readiness-broadcaster.ts:40`. Read root CLAUDE.md, task context, batch decisions and relevant implementation-plan sections. File discovery found no additional instruction files governing these source directories.

No Git commands were run under the reviewer role's restriction. Consequently this is a current-worktree review of the supplied file scope, not an independently verified comparison of `38d9cc427..a96d12d50`. Findings concern the named P1 APIs; historical introduction of supporting validation code was not independently established.

## Findings

### 1. Blocking — persisted-config predicate promises a type it does not validate

**File:** `libs/backend/agent-sdk/src/lib/helpers/plugin-config-home.ts:119`.

`isWellFormedPluginConfig` claims `stored is PluginConfigState`, but accepts an absent `disabledSkillIds` through `isAbsentOrStringList` at line 108. That property is required by `libs/shared/src/lib/types/rpc/rpc-misc.types.ts:548`. It also does not validate `lastUpdated`, whose declared type is optional string at `rpc-misc.types.ts:580`. For example, `{ enabledPluginIds: [], lastUpdated: 42 }` satisfies this predicate while failing the advertised type. This is a type-boundary finding, not a claim that a particular downstream operation crashes.

The new home-record parser relies on this predicate at `plugin-config-home.ts:230`; normalization subsequently copies `stored.lastUpdated` without validation at line 103. Adding a field requires synchronizing an interface, the list-field table, normalization, and handwritten record checks. The casts at lines 225, 231 and 247 conceal that separation instead of proving the persisted shape.

**Fix:** define a Zod schema for the legacy input shape and a schema for the versioned home record. Accept legacy omissions intentionally, then normalize them into a validated `PluginConfigState`; validate the timestamp type or explicitly discard invalid metadata. Infer the persisted shape from the schema rather than narrowing unknown input to the normalized output type. Keep legacy compatibility, but distinguish accepted input from validated output. The nearby sidecar schema/parser (`origin-sidecar.types.ts:128`, `:178`) and wizard store (`wizard-agent-origin.store.ts:50`, `:107`) already establish this pattern. Add focused validation cases for missing legacy arrays and non-string timestamps when implementing the fix.

Severity follows the review template's Blocking definition: the predicate breaks a type-safety guarantee at a persistence boundary.

### 2. Serious — loader options encode an invalid half-configured state

**File:** `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:88`.

`PluginLoaderInitOptions` makes `harnessRootOf` and `homeStorage` independently optional even though its own contract says both are required together. `initialize` at line 553 silently selects `configHome = null` unless both exist. A host can therefore pass either half and compile successfully while receiving legacy configuration behavior. The cost is concentrated at a public integration boundary: a future host adapter or wiring refactor must remember a relationship the type could enforce.

**Fix:** make both fields required within `PluginLoaderInitOptions` and make the entire options argument optional. Omission preserves the legacy path; supplying options guarantees the pair. Keep the existing workspace-storage capability check. `PluginConfigHomeOptions` already expresses the same pair as required at `libs/backend/agent-sdk/src/lib/helpers/plugin-config-home.ts:285`. This needs no new service or configuration layer.

## Five style questions

1. **What breaks when requirements change in six months?** Adding configuration metadata requires parallel edits to handwritten validation and normalization; the mismatch already exists for `lastUpdated` (`plugin-config-home.ts:119`, `:103`). A schema-derived boundary removes that drift point.
2. **What would a new team member misread?** Independently optional loader fields imply independently useful capabilities, although initialization requires both (`plugin-loader.service.ts:88`, `:553`).
3. **What maintenance cost would a simpler shape avoid?** A single optional, complete options object eliminates host-by-host reasoning about partial configuration (`plugin-loader.service.ts:549`). Schema-derived persisted types eliminate assertions in the record parser (`plugin-config-home.ts:225`).
4. **Where is it inconsistent with sibling implementations?** Home-record validation uses assertions and manual field checks, whereas sidecar and wizard-origin persistence derive types from Zod (`origin-sidecar.types.ts:166`; `wizard-agent-origin.store.ts:55`). The Library broadcaster does follow the existing activation broadcaster's lazy lookup and error-reporting pattern (`library-change-broadcaster.ts:41`; `boot-readiness-broadcaster.ts:44`).
5. **What would I do differently, and why is it better?** Apply the two fixes above: enforce actual invariants in the types and parser. Preserve the narrow refresher port (`libs/backend/harness-sync/src/lib/sources/user-layer-refresher.port.ts:38`) and discriminated coalescer result (`apps/ptah-electron/src/activation/coalesced-job.ts:86`), which make integration outcomes explicit without a cross-library implementation dependency.

## Pattern checks

| Contract or convention | Assessment and evidence |
| --- | --- |
| CLI version and renamed field | Schema constant is `1.0` (`apps/ptah-cli/src/cli/jsonrpc/types.ts:32`); health declares required `keptLocalEdit` (`harness-sync.types.ts:151`); formatter reads that field (`formatter.ts:521`). Batch decision TL9 explicitly authorizes the schema bump. |
| Discriminated public results | Provenance distinguishes origin-specific fields (`library-provenance.ts:25`); coalescer attaches a result only to `ran` (`coalesced-job.ts:86`). |
| DI token and registration | Wizard-origin token uses `Symbol.for` (`libs/backend/agent-generation/src/lib/di/tokens.ts:175`) and singleton registration (`di/register.ts:180`). |
| Public exports | Loader options/descriptors are exported at `libs/backend/agent-sdk/src/index.ts:425`; mirror descriptors at `libs/backend/agent-generation/src/index.ts:131`; provenance at `libs/shared/src/index.ts:57`. This is a check of these exports, not a complete dependency-graph audit. |
| Responsibility split | Plugin-agent descriptors and pass contracts have a separate module (`user-layer-plugin-agents.ts:47`, `:87`); wizard decisions have a separate contract file (`rpc-setup-decisions.types.ts:38`). File size alone is not recorded as a defect. |

## Verification and remaining uncertainty

No builds, tests, package scripts, source edits or Git operations were run. Scoped `ptah_get_diagnostics` was requested for six representative files across shared, agent-sdk, agent-generation, harness-sync, Electron and CLI. It returned **unavailable**, with all six files unchecked because the TypeScript check was still running after 45 seconds; it reported that the check was not cancelled. No diagnostic pass is claimed and the check was not restarted.

The AST inspection of plugin-loader succeeded with no parse errors. The initial AST request used an incorrect `services/` path and returned ENOENT; file discovery located the actual `helpers/` path. Static inspection cannot certify all consumers of the breaking field rename, runtime propagation behavior, or revision identity. Those remain outside this verdict's proof.

## Decisions

- **Do not flag the CLI bump as an unauthorized breaking change.** Options: preserve 0.2 or accept 1.0. Evidence: `batches.md` TL9 records D16 overriding the older plan assumption; `jsonrpc/types.ts:32` implements it. Reversible only through the owning team's version policy.
- **Do not introduce a shared descriptor abstraction solely for two matching shapes.** Options: centralize or keep boundary-local contracts. Evidence: `plugin-loader.service.ts:96` and `user-layer-plugin-agents.ts:47` remain structurally compatible without an agent-generation dependency on agent-sdk. Reversible: yes.

## Score rationale and verdict

**6/10, REVISE; confidence medium.** Explicit outcome unions, narrow ports and conventional DI keep this above the 3–4 band (`coalesced-job.ts:86`; `user-layer-refresher.port.ts:38`; `di/register.ts:180`). The false validation guarantee and incomplete initialization states prevent the sound 7–8 band (`plugin-config-home.ts:119`; `plugin-loader.service.ts:88`). Resolve those two contract issues, obtain scoped diagnostic evidence, and verify the exact revision scope before approval. This review does not approve unread portions of the larger files.
