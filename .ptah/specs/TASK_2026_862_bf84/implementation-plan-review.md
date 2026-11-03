# Implementation plan review — TASK_2026_862_bf84 (Codex binary unpin)

Author: codex gpt-6-sol (CLI lane)
Reviewer: Glm (ollama-cloud, CLI lane)
Revision: 2
Verdict: REVISE

## Review scope

I reviewed `context.md` (source of truth), `task-description.md`, `parity-inventory.md` and
`implementation-plan.md` against the current source in this worktree. `research-runtime.md` and
`research-models-protocol.md` served as evidence only. I opened 45 source locations named by the
plan and the inventory. I searched the whole repository for every symbol the plan deletes. No
catalogue skill matches a planning-document review, so I loaded none and reconstructed no skill
steps. This lane wrote no source, ran no git, build or test command.

The plan is strong in the areas the user named. Every acceptance criterion 1-7 maps to named
batches and tests. All 45 spot-checked `file:line` citations were correct. The selection contract,
the bounded one-shot fallback, the fixed `CODEX_HOME` policy and the Dependabot grouping are sound.
The defects below are ownership gaps. Files that the deletions break are missing from the batch
table.

## Findings

1. **Blocking — unassigned consumer of the deleted gated resolver.**
   Document: implementation-plan.md, "File-disjoint implementation batches" (batch 4) and
   parity-inventory.md row "ParityGate DI token / gated runtime resolver".
   Evidence: `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:11` imports
   `resolveGatedCodexRuntime` and `codex-chat-adapter.ts:404` calls it when the host supplies no
   `ports.resolveRuntime`. `codex-chat-adapter.spec.ts:9-12,122-126` imports `CodexParityGate` and
   registers `CODEX_RUNTIME_TOKENS.ParityGate` and `DevRouteOverride`. Batch 4 removes the resolver
   and the tokens. Neither file appears in any batch, so the plan does not compile as written.
   Required change: add `codex-chat-adapter.ts` and `codex-chat-adapter.spec.ts` to batch 4 or a
   later batch. Replace the fallback call with a direct `CODEX_RUNTIME_TOKENS.Runtime` resolution.
   Remove the token registrations from the spec. Also state that batch 10 must drop the same token
   registrations in `codex-chat-turn-lifecycle.spec.ts:129-133`, because that file is owned for
   pricing only.

2. **Serious — the lane-model removal spans files that batch 8 cannot touch.**
   Document: implementation-plan.md, batches 6, 7, 8; parity-inventory.md rows "Seven lane fallback
   model IDs" and "Duplicated hardcoded lane default".
   Evidence: batch 8 owns `codex-app-server-lane-models.ts` and `lane-spawn-policy.ts` and must
   remove `CODEX_LANE_FALLBACK_MODELS` and `CODEX_LANE_DEFAULT_MODEL`. The consumers are
   `codex-app-server-lane.adapter.ts:206` (fallback) and `:229` (default), owned by batch 7;
   `apps/ptah-electron/src/di/codex-lane-composition.ts:13,183`, owned by batch 6;
   `libs/backend/cli-engine/src/lib/codex-lane-runtime-composition.ts:14,187`, owned by batch 7;
   and the re-export `libs/backend/cli-agent-runtime/src/index.ts:51`, owned by no batch. Batch 8's
   proof demands "no static fallback" and "omitted model leaves Codex default", but it cannot edit
   any of these files. The proofs of batches 6 and 7 say nothing about model changes.
   Required change: move the model-side edits of `codex-app-server-lane.adapter.ts`,
   `codex-lane-composition.ts`, `codex-lane-runtime-composition.ts` and the
   `cli-agent-runtime/src/index.ts` re-export into batch 8. Keep the adapter's probe and spawn work
   in batch 7 only if the file list is split by concern, or merge both lanes for these files.

3. **Serious — tolerant `model/list` entries change shared consumers that no batch updates.**
   Document: implementation-plan.md, "Contracts" (inbound parsing policy) and batch 3.
   Evidence: batch 3 relaxes the entry schema at
   `libs/backend/codex-runtime/src/lib/codex-protocol-methods.ts:160-207` to "id and model
   required, other fields optional". Two consumers re-require the old fields.
   `libs/backend/codex-runtime/src/lib/codex-context.ts:1019-1029` maps `displayName`, `isDefault`
   and `supportedReasoningEfforts` as always present. It is a batch 2 file.
   `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane-models.ts:17-21`
   runs a private zod schema that requires `displayName` and `isDefault` per entry. It is a batch 8
   file. The plan does not define how an absent optional field maps into `CodexModelInfo`. A future
   entry without the old fields would pass chat and fail the lane catalog.
   Required change: state the `CodexModelInfo` optionality contract and the defaulting rule (for
   example, `displayName` falls back to `model`, `supportedEfforts` to an empty array). Add the
   `codex-context.ts` mapping update to batch 2's scope and the lane-models schema update to batch
   8's scope.

4. **Moderate — the CLI host DI guard spec is unassigned.**
   Document: implementation-plan.md, batches 4 and 7; the plan assigns only the four Electron guard
   specs.
   Evidence: `libs/backend/cli-engine/src/lib/codex-runtime-composition.spec.ts:78-80` iterates
   `CODEX_RUNTIME_TOKENS`, `:86-87` handles `PTAH_CODEX_RUNTIME_DEV`, and `:93-110` asserts
   source patterns over the CLI production files. Batch 4 removes tokens and batch 7 rewrites
   `codex-lane-runtime-composition.ts`. The spec guards exactly those registrations and is owned by
   no batch.
   Required change: assign it to batch 7 (or 4) and update its assertions with the selector
   changes.

5. **Moderate — index.ts export removal is not sequenced against the deletions.**
   Document: implementation-plan.md, batches 1, 2 and 4.
   Evidence: batch 1 owns `libs/backend/codex-runtime/src/index.ts`. It re-exports the modules that
   batches 2 and 4 delete: `:61` from `codex-dev-route`, `:79` from `codex-parity-gate`, `:106`
   `CodexBinaryIdentity` from `codex-protocol-manifest`, `:107` `findCodexExecutablePin` and
   `:108` `export *` from `codex-executable-inspection`. Batch 1 cannot drop these exports before
   the consumer batches (4-7) stop importing them. No later batch owns the file.
   Required change: state that these exports drop at integration, after the consumer batches land
   and with the file deletions. Or move `index.ts` to the last codex-runtime batch.

6. **Moderate — the status propagation mechanism is unnamed across batches 7 and 9.**
   Document: implementation-plan.md, "Status and model flow" and batches 7, 9.
   Evidence: batch 9 adds `codexSource` and `codexReason` to `CliDetectionResult`
   (`libs/shared/src/lib/types/agent-process.types.ts:416-424`) and to the RPC handler
   (`agent-rpc.handlers.ts:1252-1267`). The population site is the lane adapter `detect()`
   (`codex-app-server-lane.adapter.ts:162-163`), a batch 7 file that lands first. The plan says the
   RPC result comes from "the host's active selection" but names no port or token that carries the
   host-scoped selection service into the adapter or the handler.
   Required change: name the port or probe result that supplies source and reason. Land the shared
   type change together with batch 7, or sequence batch 9's type addition before batch 7's
   verification.

7. **Moderate — the tolerant server-request envelope has no owner in a proof.**
   Document: parity-inventory.md row "Unknown server requests with extra fields"; implementation-
   plan.md batches 2 and 3.
   Evidence: the change targets `codex-app-server-process.ts:379-403`. The `z.strictObject`
   pre-check at `:379-387` rejects a server request that carries one additive field, so the
   `-32601` reply never fires for it. The file belongs to batch 2, but batch 2's proof omits this
   change and batch 3 cannot edit the file.
   Required change: add "a server request with extra fields still replies -32601" to batch 2's
   scope and proof.

8. **Minor — the import-boundary rule is inverted.**
   Document: implementation-plan.md, batch preamble ("Do not add an import from `codex-runtime`
   into a higher-level lib").
   Evidence: `libs/backend/cli-agent-runtime/package.json:12` already depends on
   `@ptah-extension/codex-runtime`, and batch 7 must import `selectCodexExecutable` from it. Read
   literally, the sentence forbids the required direction.
   Required change: rewrite it as "do not add an import into `codex-runtime` from a higher-level
   lib", which matches the Contracts section.

9. **Minor — the prerelease version policy is ambiguous.**
   Document: implementation-plan.md, "Contracts" (parsing).
   Evidence: the text says "reject malformed or prerelease versions below the corresponding stable
   minimum". It does not say whether a prerelease numerically above the minimum, for example
   `0.166.0-beta.1` against a floor of `0.165.0`, is accepted.
   Required change: state one rule (numeric X.Y.Z compare, prerelease accepted only above the
   stable minimum) and cover it in the batch 1 parser spec.

10. **Minor — the cached version can go stale after an in-place upgrade.**
    Document: implementation-plan.md, "Contracts" (selection caching).
    Evidence: re-probe happens only on explicit refresh or a failed spawn. An npm upgrade replaces
    the file in place, so the spawn then runs a newer binary while status keeps the cached version.
    "Report the source actually launched" covers the source, not the version.
    Required change: re-read `--version` at spawn, or state the staleness window and the recovery
    path in the status copy.

11. **Minor — the `-32601` reply code from Codex is assumed, not evidenced.**
    Document: implementation-plan.md, "Contracts" and "User-facing failure behavior".
    Evidence: the one-shot fallback triggers only when Codex answers an unknown client method with
    JSON-RPC `-32601`. Neither research file shows Codex's actual reply code for an unknown client
    method. A different code degrades the design to the terminal message without the automatic
    fallback.
    Required change: verify the code against a real Codex when a live check is authorized, or
    state the degradation as accepted behaviour.

12. **Minor — two release-maintained version floors will coexist.**
    Document: implementation-plan.md, "Contracts" and "Dependency bump plan".
    Evidence: the new `CODEX_MIN_SUPPORTED_VERSION` is 0.165.0. Account discovery keeps its own
    floor `0.162.0` at
    `libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.ts:233`. The plan
    does not state their relationship.
    Required change: note that they serve different purposes (binary support versus server model
    visibility), or align them in this task.

13. **Minor — the lane factory callers are unassigned and must keep stable signatures.**
    Document: implementation-plan.md, batches 6 and 7.
    Evidence: `apps/ptah-electron/src/di/phase-2-libraries.ts:304-310` calls
    `registerElectronCodexLaneFactory` and `libs/backend/cli-engine/src/lib/container.ts:769` calls
    `registerCliCodexLaneFactory`. Batches 6 and 7 rewrite both factories. No batch owns the
    callers.
    Required change: require the exported registration signatures to stay stable, or assign the
    two callers.

## Claim spot-checks

I opened each location below. No wrong citation was found. Two searches found consumers that the
plan missed; they drive findings 1 and 2.

| Claim | Verified? | Note |
| --- | --- | --- |
| `codex-executable-pin-data.ts:5-12` one win32/x64 0.165.0 row | Yes | Row at :5-14, SHA at :10-13 |
| `codex-executable-pin.ts:8-27` platform-gated lookup, TS data at :2,23 | Yes | Returns undefined off win32/x64 |
| `codex-protocol-manifest.ts:3-40` literal `codex-cli <ver>` plus SHA compare | Yes | Literal compare at :29, SHA at :33-37 |
| `codex-dev-route.ts:1-28` env flag, unpackaged only, never lanes | Yes | `:19-21`, lane excluded at :10 |
| `codex-electron-admission.ts:9-21` dev override or packaged win32/x64 | Yes | Lane also admitted when unpackaged at :20 |
| `codex-runtime-ports.ts:9-22` pin row in runtime contracts | Yes | `IProcessSpawner` re-exported from platform-core at :8, so the plan's claim holds |
| `bootstrap.ts:588-615` routing input, chat bound only when nativeCodex | Yes | Errors logged, startup continues |
| `codex-runtime-composition.ts:108-216,427-458` bundled-only, SHA, `--version` 10 s | Yes | Bundle containment at :146-153, recheck at :427-447 |
| `codex-runtime-composition.ts:831-841` raw versus gated runtime | Yes | Packaged chat bypass at :833-840 |
| `codex-runtime-composition.ts:889-958` session admission binding | Yes | `RUNTIME_ADMISSION_PORT` at :871, admission at :919 |
| `codex-app-server-process.ts:163-210` pin recheck, spawn, SHA launch guard | Yes | Env allowlist at :182-201, `CODEX_HOME` at :200 |
| `codex-app-server-process.ts:379-403` unknown server request replies -32601 | Yes | `strictObject` pre-check at :379-387 blocks additive fields (finding 7) |
| `codex-app-server-process.ts:405-429` unknown notifications tolerated | Yes | Bounded, redacted, once per method |
| `codex-lane-runtime-composition.ts:91-105` CLI lane gate and early return | Yes | `resolveGatedCodexRuntime('lane')` at :96, return at :105 |
| `codex-app-server-lane-binary.ts:31-67` pin, hash and version probe | Yes | Native basename check at :49-50 |
| `lane-spawn-policy.ts:20,22-35,53-64` default, mimo block, duplicated default | Yes | Exactly as cited |
| `codex-app-server-lane.adapter.ts:183-207,228-235` fallback and default | Yes | Fallback at :206, default at :229 (finding 2) |
| `codex-home-auth.service.ts:479-493,496-504` visibility filter, `/codex\|gpt-5/i` regex | Yes | OAuth keeps `visibility === 'list'` |
| `provider-rpc.handlers.ts:369-420` static-ID filter and static fallback | Yes | Set filter at :375-378, fallback at :413-419 |
| `codex-provider-entry.ts:49-61,93` seven static models | Yes | Tier mapping at :67-71 stays, as the plan says |
| `pricing.utils.ts:472-524` exact lookup, null on absent rate | Yes | `unknown` result at :517-521, no substitute rate |
| `codex-chat-turn-stream.ts:194-297` tokens kept with null cost | Yes | Stats emission at :254-297 |
| `cost-badge.component.ts:57-64` "cost unavailable" copy | Yes | Copy at :63 |
| `agent-process.types.ts:416-420` detection has path/version, no source/reason | Yes | `CliDetectionResult` at :416-424 |
| `agent-rpc.handlers.ts:1252-1267` serves `agent:detectClis` | Yes | Cache invalidated per call |
| `cli-matrix-rows.ts:366-399` renders detection rows | Yes | `systemRows` at :360-405 |
| `codex-app-server-protocol.manifest.json:1-17` pinned version, machine path, SHA | Yes | Developer-machine `binaryPath` at :5 |
| `generate-protocol-manifest.mjs:149-156` writes pinned 0.165.0 manifest | Yes | Offline only, no runtime import |
| `codex-protocol-methods.ts:160-207,185-189` strict `model/list`, closed enums | Yes | `inputModalities` and `multiAgentVersion` at :185-189 |
| `codex-protocol-schemas.ts:201-420` closed item union | Yes | `discriminatedUnion` at :201 |
| `codex-context.ts:1005-1040` listModels, 100 pages, no allowlist | Yes | Failure collapses to one message at :1038 |
| `codex-executable-inspection.ts:119-124` synthetic `codex-cli ${pin}` version | Yes | Synthetic string at :123 |
| `di/registration.ts:55-73,112-139` dev-route and parity tokens, gated resolver | Yes | Resolver throws at :125 |
| `package.json:95` and `apps/ptah-electron/package.json:16` SDK ^0.165.0 | Yes | Both exact |
| `electron-builder.yml:39-58` six platform packages unpacked | Yes | Six `@openai/codex-*` entries at :53-58 |
| `patch-windows-hide-deps.js:20-61` exact-text SDK patch pinned 0.165.0 | Yes | Spec fails on drift, as the plan says |
| `expected-resolvable.ts:107-126` Codex chat and admission tokens | Yes | Lists at :105-127 |
| `container.smoke.spec.ts:1415-1431` packaged linux unavailable, win32 available | Yes | Platform assertions must change in batch 5 |
| `codex-lane-composition.ts:103-120,245-263` lane admission, gated runtime | Yes | Throw at :257-258 |
| `codex-home-resolver.ts:15-25` override, `CODEX_HOME`, `~/.codex` | Yes | Order confirmed at :25 |
| `codex-account-usage.service.ts:570-575` separate native launch, broad env | Yes | Full `process.env` plus `CODEX_HOME` |
| Verify project names `ptah-electron` and `@ptah-extension/codex-runtime` | Yes | `apps/ptah-electron/project.json:2`, `codex-runtime/project.json:2`. Batch 5's command is valid despite the package name `ptah-desktop` |
| Every spec and tsconfig named in the batches exists | Yes | Includes `rpc-session.types.ts`, `session-stats-summary.component.ts`, both `tsconfig.spec.json` files |
| `codex-chat-adapter.ts` uses the gated resolver | Gap | `:11` import, `:404` call. No batch owns it (finding 1) |
| `cli-agent-runtime/src/index.ts:51` re-exports `CODEX_LANE_DEFAULT_MODEL` | Gap | No batch owns it (finding 2) |

Correctness-risk checks requested for this review, all against source:

- Windows shims: the plan resolves `codex.cmd`/`codex.ps1` to the platform `codex.exe` by npm
  layout, never by shell or script parsing. This matches the existing warning at
  `codex-native-binary-path.ts:100-104` and the resolver layouts at `:95-124`. Unresolved shims
  fall to the bundle. Feasible and safe.
- Version parsing: tolerant parser plus numeric minimum compare replaces the literal
  `codex-cli <pin>` compare at `codex-protocol-manifest.ts:29` and
  `codex-app-server-lane-binary.ts:60`. The synthetic version at
  `codex-executable-inspection.ts:123` disappears with the pin. Sound, except the prerelease rule
  (finding 9).
- Fallback loops: one fallback, second failure terminal, cached selection switches to the
  already-probed bundle, no replay after a receipt, no fallback on auth, malformed data, timeout,
  cancellation or home mismatch. Bounded and sound.
- `CODEX_HOME`: both binary sources spawn with `CODEX_HOME=profile.normalizedHome`
  (`codex-app-server-process.ts:200`) and returned-home verification (`:240-251`). The plan never
  derives the home from the binary source. Auth stays identical for both binaries.
- CLI/TUI lanes: batch 7 removes the early return at
  `codex-lane-runtime-composition.ts:105` and rewires the probe. `platform-cli` is untouched and
  supplies host services only. The cli-engine guard spec gap is finding 4.
- Module boundaries: the selector sits in host-neutral `codex-runtime` with injected probes.
  `codex-runtime` keeps importing `platform-core` only. The inverted sentence is finding 8.

## Lane-introduced constraints

Rules the plan adds beyond the user request, for the user to see:

1. One automatic bundled retry when a required method is missing before a turn receipt. The user
   asked only for a clear message.
2. An omitted lane model delegates the default to Codex. Ptah stops choosing `gpt-6-sol`.
3. Discovery failure shows an explicit empty or unavailable state. No stale fallback catalog.
4. A narrow pricing reason (`rateMissing` versus `usageIncomplete`/`billingUnknown`) enters
   `ExactCostResult` and the session stats RPC shape, so "Not priced" labels only an absent rate.
5. The offline protocol manifest JSON and its exact-version generator are deleted. This goes
   beyond the runtime pin the user named. The plan already asks for approval.
6. The alternate `codex debug models` parser is deleted if no production caller remains. My search
   confirms only its spec imports it.
7. The account API-key model regex `/codex|gpt-5/i` is removed. API-key discovery will accept
   future non-`gpt-5` IDs.
8. Probe details are new policy: 5-10 s timeout per candidate, PATH order before standard
   locations, reject unresolved shims, never parse `.cmd` text.
9. Dependabot bumps are never auto-merged. The exact-text SDK patch needs a human review per bump.
10. Batch model: at most 12 files per lane, integration before scoped typechecks, only the
    coordinator runs verification and git. The last item comes from the user's rules.

The author lane also reported that the `angular-frontend-patterns` skill was not loadable in its
environment. The UI lane (batch 9) must load it before it touches the Angular components.

## Items for the user

1. Confirm the minimum version 0.165.0, or name a later floor and the method that needs it. The
   plan already asks this. It changes which installed Codex Ptah accepts.
2. Confirm deletion of the offline protocol manifest JSON and generator. The plan already asks
   this. The runtime never reads them.
3. Confirm the lane default change: with no model named, Codex picks its own default. Today Ptah
   forces `gpt-6-sol`. This is a user-visible behaviour change (finding 2 covers its wiring).
4. Confirm that provider discovery loses the static seven-model fallback. A failed discovery
   shows an empty state instead.
5. Confirm the "Not priced" split: only an absent rate-card row shows "Not priced". Other null
   costs keep "Cost unavailable". The user text said "cost shows as not priced" without this
   distinction.
6. Decide whether the provider-status projection (round-2 finding 15) belongs to this task. The
   detection RPC and the CLI matrix line already satisfy the acceptance criteria without it. If
   you want it, `llm-rpc-app.handlers.ts` and `llm-provider-state.service.ts` need a batch.

Revision 2 closed two former items: the prerelease rule (round-1 finding 9) is now defined and
tested in batch 1, and the account discovery floor (round-1 finding 12) is now aligned to the one
0.165.0 constant, as `task-description.md` requests.

Verdict: REVISE. Findings 1 to 3 must be resolved before decomposition. The rest can be resolved
inside the affected batches.

## Round 2

Re-review of `implementation-plan.md` (Revision 2, with its `## Revision log`), `parity-inventory.md`
and `task-description.md`. Scope: the 13 round-1 findings, batch file-disjointness and typecheck
order, new Blocking or Serious problems, and the new `file:line` claims the revision added. I
opened 12 new source locations and ran two repository searches over the removed symbols. No
citation was wrong. This lane wrote no source and ran no git, build or test command.

### Resolution of round-1 findings

| # | Resolved? | Note |
| --- | --- | --- |
| 1 | Yes | Batch 4 owns `codex-chat-adapter.ts` and its spec, replaces the gated fallback with direct `CODEX_RUNTIME_TOKENS.Runtime` resolution, and removes the gate fixtures; batch 11 removes the same fixtures from `codex-chat-turn-lifecycle.spec.ts`; batch 13 deletes the tokens last. Verified at `codex-chat-adapter.ts:11,18,83,404`, `codex-chat-adapter.spec.ts:9-12,122-126,149`, `codex-chat-turn-lifecycle.spec.ts:129-133,153`. The same edit adds a new blast radius; see round-2 finding 14. |
| 2 | Yes | The consumer edits stay in the batches that own the files (6 and 7), and batch 8 removes the constants and the `index.ts:51` re-export after batches 6-7 remove the callers. Each file has one owner and the order is safe. |
| 3 | Yes | The Contracts section defines the normalization: `displayName` falls back to `model`, `isDefault` to false, efforts to `[]`. Batch 2 owns the `codex-context.ts` mapping and batch 8 mirrors the defaults in the lane schema. `codex-runtime.types.ts:371-379` keeps the required `CodexModelInfo` fields, so the public shape does not change. |
| 4 | Yes | Batch 7 owns `codex-runtime-composition.spec.ts` and updates its token and source assertions. Verified at `:78-110`. |
| 5 | Yes | `codex-runtime/src/index.ts` moved to batch 13 and changes with the module deletions. Batches 1-13 are one typecheck checkpoint, so no integrated state dangles. |
| 6 | Yes | The plan names `CodexSelectionSnapshotPort` and binds it as `CODEX_RUNTIME_TOKENS.SelectionSnapshot`. The shared optional fields land in batch 1, the adapter populates them in batch 7, and the RPC forwards them in batch 10. |
| 7 | Yes | Batch 2's proof now includes "a server request with an extra envelope field still gets `-32601`". |
| 8 | Yes | The rule now forbids imports into `codex-runtime` from a higher-level lib. |
| 9 | Yes | The rule is defined: a prerelease at the floor tuple is rejected, a prerelease with a higher numeric tuple is accepted. Batch 1 tests both. |
| 10 | Yes | The plan re-selects and re-reads `--version` on every new runtime open. No long-lived cache survives an in-place upgrade. |
| 11 | Yes | The plan states `-32601` as a protocol assumption. Other codes stay terminal until a live check classifies them. `task-description.md` AC 3 and the risk list match. |
| 12 | Yes | Batch 9 aligns the account floor to the one exported constant and keeps the newer-cache rule. Verified at `codex-home-auth.service.ts:226-233`. `task-description.md` already puts account discovery under the one minimum. |
| 13 | Yes | Both lane factory signatures stay stable and the plan names both callers. See round-2 finding 16 for the input-field caveat. |

### Round-2 findings

14. **Blocking — the `platform` port-field removal breaks files that no batch owns.**
    Document: implementation-plan.md, batch 4 and revision log entry 1.
    Evidence: batch 4 removes the `CodexParityPlatform` port field from `CodexChatAdapterPorts`
    (`codex-chat-adapter.ts:83`). The field is picked and passed through by the rpc-handlers chat
    chain: `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:59-67`
    declares `CodexChatHostPortsDeps` with `Pick<CodexChatAdapterPorts, 'logger' | 'platform' |
    ...>`, and `:281` passes `platform: deps.platform` into a `CodexChatHostPorts extends
    CodexChatAdapterPorts` literal. Four unowned specs construct the same field:
    `libs/backend/agent-sdk/src/lib/di/register.codex-runtime.spec.ts:46-48` (typed
    `CodexChatAdapterPorts` literal),
    `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.spec.ts:122-133`,
    `codex-chat-host-ports.resume-permission.spec.ts:108-111`, and
    `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.native.spec.ts:210-214` (deps
    literals). Removing the field makes the `Pick` key invalid and the literals excess-property
    errors. Batch 4's own agent-sdk spec typecheck and the rpc-handlers typecheck then fail, and
    no lane owns the fix.
    Required change: add `codex-chat-host-ports.ts` and the four unowned specs to batch 4 or a
    dedicated adjacent batch (batch 4 then holds 7 files, still within the 12-file cap). Drop
    `'platform'` from the deps `Pick`, stop the pass-through at `:281`, and remove the field from
    the spec literals. Also state in batch 14 that its two owned files drop the same field:
    `codex-chat-native-contract.spec.ts:442` and
    `chat-continue-codex-resume-once.spec.ts:279-281`.

15. **Moderate — the provider-status projection names files that no batch owns.**
    Document: implementation-plan.md, "Status and model flow".
    Evidence: the plan's condition holds. `llm:getProviderStatus` is served by
    `libs/backend/rpc-handlers/src/lib/handlers/llm-rpc-app.handlers.ts:188,281` and consumed by
    `libs/frontend/core/src/lib/services/llm-provider-state.service.ts:102,181`. Batch 9 owns
    `provider-rpc.handlers.ts` and batch 10 owns `agent-rpc.handlers.ts`; neither is the
    provider-status handler, and no batch owns these two files or the settings component that
    would render the new field.
    Required change: assign the two files to a batch, or mark the projection out of scope for this
    task. Without an owner, a lane either edits unowned files or the projection never happens.

16. **Minor — the lane factory input `platform` field must be retyped, not removed.**
    Document: implementation-plan.md, batches 6 and 7.
    Evidence: the lane factory inputs still declare the field: `codex-lane-composition.ts:48` and
    `codex-lane-runtime-composition.ts:44`. Unowned code passes it today:
    `apps/ptah-electron/src/di/phase-2-libraries.ts:309` (`platform: process`) and
    `libs/backend/cli-engine/src/lib/surface-composition.spec.ts:166-169`
    (`platform: { platform: 'unsupported', arch: 'unsupported' }`). `container.ts:769` passes no
    input and stays safe. "Remove obsolete `CodexParityPlatform`" together with "keep the exported
    signature stable" is ambiguous: a lane that deletes the input field breaks the unowned files.
    Required change: state that batches 6-7 keep the input field and retype it to a host-local
    platform shape, or assign the unowned callers and the cli surface spec.

### Round-2 claim spot-checks

| Claim new in Revision 2 | Verified? | Note |
| --- | --- | --- |
| `codex-chat-adapter.ts:11,18,83,404` | Yes | Resolver import `:11`; type import `:18`; port field `:83`; fallback call `:404` |
| `codex-chat-adapter.spec.ts:9-12,122-126,149` | Yes | Imports `:9,:12`; ParityGate register `:122-124`; DevRouteOverride register `:125-132`; `platform` `:149` |
| `codex-chat-turn-lifecycle.spec.ts:129-133,153` | Yes | ParityGate `:129-131`; DevRouteOverride `:132-136`; `platform` `:153` |
| `codex-runtime-composition.spec.ts:78-110` CLI guard | Yes | Token loop `:78-80`; env guard `:86-87`; source pins `:93-110` |
| `codex-home-auth.service.ts:226-233` account floor | Yes | Floor `0.162.0` at `:233`; newer-cache rule stated `:226-232` |
| `pricing.utils.ts:517-588` null-cost reasons | Yes | Unknown billing `:522`; absent rate `:524`; incomplete usage `:545-588` |
| `index.ts:57-61,72-84,104-108` dead exports | Yes | Dev route `:57-61`; parity and registration `:72-84`; pin exports `:106-108` |
| `codex-binding.types.ts:11-32` parity and dev-route aliases | Yes | Imports `:12-13`; `platform` `:27`; `devRoute` `:31` |
| `codex-runtime.types.ts:371-379` `CodexModelInfo` | Yes | Required fields stay; the batch 2 normalization keeps the public shape |
| `rpc.types.ts:1635` restates the detection result | Yes | Restated by import; optional fields need no change there |
| `cli-agent-runtime/src/index.ts:51` re-export | Yes | Exact line; batch 8 owns the file |
| `codex-parity-gate.ts:18-228` gate span | Yes | Evidence array `:18`; class `:193`, inside the range |

The two searches found the consumers behind round-2 findings 14 and 16. No other unowned consumer
of the removed symbols remains: every importer of `CodexParityPlatform`, `resolveGatedCodexRuntime`,
`registerCodexRuntime` and `CodexRuntimeRegistrationPorts` sits in an owned batch (4-7, 11, 13) or
a batch-owned spec.

### Batch checks (round 2)

The batch table stays file-disjoint: no file appears in two rows, and the conditional
`rpc.types.ts` belongs to batch 10 only. The order stays typecheck-safe under the plan's single
checkpoint for batches 1-13: the shared type change (1) precedes the adapter population (7) and the
RPC forwarding (10); the consumer edits (6-7) precede the constant removal (8); the agent-sdk
consumers (4, 11) precede the token deletion (13); the pin callers (2, 5-7) precede the port rework
(12); the `index.ts` change lands with the deletions (13). Batch 14 follows the checkpoint.

### Round-2 verdict

REVISE. Round-1 findings 1 to 13 are resolved or acceptably justified. Round-2 finding 14 is
Blocking: the same edit that resolves finding 1 breaks the rpc-handlers chat chain, and no batch
owns those files. Findings 15 and 16 should be fixed in the same revision. The revision introduced
no other Blocking or Serious problem.