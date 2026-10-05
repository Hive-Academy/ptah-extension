# Implementation Plan - TASK_2026_609_c495 (Part B, narrowed, fast track)

W = `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup`. All paths below are relative to W.

## Inputs and constraints

- Requirements: `task-description.md` (Part B, items 1-4); `context.md` "Part B scope change", "fast track", "Batch 1 hold"; `batches.md` (Part A state: 1a/1/2 committed, 3/4 blocked on #634); `plan-review.md` (6 findings, fixed once here, see "Review fixes").
- Coordinator addition (item 1): an empty non-Claude field shows what the subagent inherits: `inherits: <model> (lane default)` from `agent:getConfig`, or `inherits: CLI default` when unset. Per-subagent reasoning effort is out of scope.
- Design handoff: none (no new surface). Missing decision-critical input: Restore destination (scope-changing) is decided by the architect as the recommended option and goes to the user at the combined gate (Decision 1).

## Codebase evidence

| Evidence | Location | Implication |
| --- | --- | --- |
| A read-only verify reports a hand-edited copy only as `missing`. `overwrittenLocalEdit` is always `[]` | `harness-sync/src/lib/health/harness-health.ts:59-79`; drift flag `workspace-target.ts:217,524-529` | Item 2 "edited" needs a new optional field filled from `plan.writes[].overwritesLocalEdit` |
| An overwrite of a hand-edited copy is NOT snapshotted today. Only retirement is (Batch 1a) | `workspace-target.ts:974-976` vs `retireOwned :865`, `snapshotLocalEdit :1113` | Item 2 AC6 requires reusing `snapshotLocalEdit` before an overwrite |
| `harness:health` returns the cache unless `refresh:true`, then runs read-only `verify` (no lock) for the active workspace | `rpc-handlers/.../harness-health-rpc.service.ts:99-136` | Fresh affected-path evidence = `harness:health {refresh:true}` immediately before a mutation (finding 3) |
| `harness:reconcile` runs full propagation (mirror + reconcile) of the active workspace; only filter is `targets` | `harness-health-rpc.service.ts:147-171` | Every reconcile is whole-workspace (all facets); the warning must say so |
| `HarnessHealthStore` (`refresh`, `reconcile(targets?)`, `health`, `busy`, `error`) via `@ptah-extension/marketplace/services` | `marketplace/.../harness-health.store.ts:105-177`; `harness-card.component.ts:10`; eslint exemption `eslint.config.mjs:248-251` | No new store |
| Agent copy paths per target | codex `codex-agent-transformer.ts:65-68`, copilot `:28-31`, cursor `:24-27`, opencode `opencode-agent-transformer.ts:59-62`; claude facet `source-managed` (`claude-target.ts:93-102`) | One shared path rule + drift guard |
| Health has no per-path "present" list | `harness-sync.types.ts:131-133`; `workspace-target.ts:192-206` | Add optional `agentsInSync` |
| Drift is keyed on `sourceHash` | `workspace-target.ts:389-394,515-524`; `:144`; `:1001-1014` | Item 1 folds the model into `sourceHash` |
| Agent mirror is consent-gated: `resolveAgentMirrorSource` returns `{}` when `gate.resolve(root).enabled` is false, so `{ws}/.claude/agents` is not mirrored | `harness-sync/src/lib/state/agent-sync-gate.ts:182-193` | A restored source file does not propagate while the gate is off (finding 2) |
| `AgentSyncGate.resolve` is read-only; `enable` is the wizard's grant | `agent-sync-gate.ts:70-76,103-111` | Preview reads `resolve`; Restore never calls `enable` |
| Wizard grants consent then propagates after generation, both non-fatal; gate via `container.isRegistered(AGENT_SYNC_GATE)` | `wizard-generation-rpc.handlers.ts:745-798` | Post-generation state = gate enabled iff the gate token is registered (finding 5) |
| Quarantine `moveToHistory` snapshots via `snapshotFileToHistory` into `.history/<slug>/<Date.now()>[-n]/<slug>.md`, then the marker `{version:1, completedAt, quarantined[], keptWithLocalWork[], keptUnprovable[]}` is written after all moves | `user-layer-seed-quarantine.ts:261-317`; `user-layer-fs-ops.ts:177-191,263-275` | Quarantine snapshot = latest ts dir ≤ `completedAt` holding `<slug>.md` (finding 6) |
| Existing slug and history-ts schemas | `skills-synthesis-rpc.schema.ts:376-388` (`/^[a-z0-9][a-z0-9._-]*$/i`, `/^\d+(-\d+)?$/`) | Reuse for marker and RPC validation |
| `WorkspaceScopeResolver.write(…,'workspace')` falls back to a GLOBAL write when the active path is absent; `readForPath` exists, no `writeForPath` | `settings-core/src/scope/workspace-scope-resolver.ts:149-161,197-209` | Add `writeForPath` that refuses a missing path (finding 1) |
| `CliModelOption.isFallback` is per entry | `libs/shared/src/lib/types/rpc/rpc-agents.types.ts:135-150` | Only non-fallback entries count as provider-reported (finding 4) |
| `agent:listCliModels` assembles lists from `cliDetection.listModelsForAll()` plus Codex-auth and Copilot-host refinements in private methods | `agent-rpc.handlers.ts:503-549` (#634 file) | Server-side classification needs the same list; C6 (post-#634) extracts it |
| OpenCode drops an agent whose `model` it cannot resolve | `opencode-agent-transformer.ts:24-29` | OpenCode values must pass syntax at save |
| `resolveHarnessWorkspaceRoot` exported | `harness-sync/src/index.ts:86` | Settings workspace key and emission read use the same resolved root |
| RPC wiring = `METHODS` + `RpcMethodRegistry` + `RPC_METHOD_ENTRIES` (`rpc.types.ts:3665`); manifest derives from `METHODS` | `host-profile/manifest.ts:335,409` | No manifest edit |
| PR #634 touches `rpc-agents.types.ts`, `rpc-auth.types.ts`, `agent-rpc.handlers.ts`, `file-settings-keys.ts`, `orchestrator.service.ts` | `git diff --name-only origin/main...origin/fix/task-597-lane-token-burn` | Items 2-4 edit none of them |

## Architecture decision

- Chosen approach: extend existing contracts in place. Optional fields on `HarnessTargetHealth`; new RPCs in existing handler classes (`skillSynthesis:*` quarantine + models, `wizard:preview-generation`). Pure rules in `libs/shared` so backend and webview cannot disagree (precedent `blockedTargetPaths`, `harness-sync.types.ts:334-379`). One frontend reconcile-guard helper used by every caller of `harness:reconcile` on these surfaces.
- Rejected alternatives: a new chips store (`HarnessHealthStore` exists); frontend-only preview (cannot stat); restore into the scoped clone root only (the orphan reaper reaps it, `user-layer-seed-quarantine.ts:13-18`); a facet-filtered reconcile API (finding 3 says the existing op with a clear warning suffices); `getConfiguration` for models (no workspace layer).
- Effect on existing code: no behaviour change while new fields are absent or settings are empty; copies are byte-identical when no model is set.

## Component specifications

### C1. Harness health additions (item 2, backend; NOT a #634 file)
- `HarnessTargetHealth` gains `localEdit?: string[]` (owned copies hand-edited, any facet; a repair would overwrite them) and `agentsInSync?: string[]`.
- Shared `harnessAgentRelPath(target, slug): string | null` and `HARNESS_AGENT_CHIP_TARGETS`.
- `plannedTargetHealth` fills `localEdit` from `plan.writes.filter(w => w.overwritesLocalEdit)`; `HarnessPlan.unchangedAgents?` pushed at `workspace-target.ts:205` for `entry.kind==='agent'`; applied health adds written agent keys.
- `applyWrite` calls `snapshotLocalEdit` before writing when `write.overwritesLocalEdit`; snapshot failure → no write, `writeFailed` reason `could not save local edit before overwrite: …`.
- Files (MODIFY): `libs/shared/src/lib/types/harness-sync.types.ts`; `libs/backend/harness-sync/src/lib/health/harness-health.ts`; `.../targets/harness-target.port.ts`; `.../targets/workspace-target.ts`. CREATE: `.../reconciler/harness-reconciler.local-edit-report.spec.ts`; `.../targets/transformers/agent-rel-path.guard.spec.ts`.
- Failure: fields optional (R12 precedent `adopted?`).
- Tests: (a) verify over hand-edited codex copy → `localEdit=[path]`, no write; (a2) hand-edited non-agent (skill/MCP) owned file → in `localEdit`; (b) reconcile → snapshot then overwrite, `overwrittenLocalEdit=[path]`; (c) snapshot failure → `writeFailed`, original untouched; (d) `agentsInSync` excludes a disabled agent; (e) `harnessAgentRelPath === transformer.relPathFor` for all 4.
- Keep `workspace-target.ts` additions minimal (max-lines warning, batches.md:128).

### C2. Quarantine list + restore (item 3, backend)
- Marker validation (finding 6), pure function in `user-layer-seed-quarantine.ts`: `version === 1`; `completedAt` a string with `Date.parse` finite; the three fields arrays of strings. Any failure → marker treated as absent, plus `recordUnreadable: true` in the list result. Each slug must match the existing slug rule (`skills-synthesis-rpc.schema.ts:376-380`, duplicated as a constant in shared or agent-generation, not imported across libs) and must not equal `.`/`..`; failing slugs are dropped individually with a `logger.warn`.
- Snapshot selection: under `<scopedRoot>/.history/<slug>/`, dirs whose name matches `^\d+(-\d+)?$` (same rule as `:388`), with leading ms ≤ `Date.parse(completedAt)`, containing a regular file `<slug>.md`. Pick the largest. Later dirs are never treated as quarantine history. None, or the history dir is missing/unreadable → no snapshot.
- Per-item state (derived on every list, never stored):
  - `quarantined`: in marker `quarantined`, source `{ws}/.claude/agents/<slug>.md` absent.
  - `source-restored`: source present AND scoped clone `<scopedRoot>/<slug>.md` absent (propagation pending, failed, or gate off). Stays in the list.
  - dropped from the list only when the scoped clone exists (propagation succeeded).
- Contracts in `rpc-skill-clone.types.ts`:
  - `skillSynthesis:listQuarantinedAgents {}` → `{ workspaceRoot: string|null; agentSync: 'enabled'|'disabled'|'unknown'; recordUnreadable?: true; quarantined: { slug; state: 'quarantined'|'source-restored'; quarantinedAt: string|null; hasSnapshot: boolean; sourcePath: string }[]; notOwned: string[] }`. `quarantinedAt` = selected snapshot ts as ISO, else `null` (UI: "date unknown"). `notOwned` = validated `keptWithLocalWork ∪ keptUnprovable` still present in the scoped root.
  - `skillSynthesis:restoreQuarantinedAgent {slug}` → `{ outcome: 'restored'|'already-restored'|'conflict'|'not-quarantined'|'no-snapshot'|'copy-failed'; path: string; reason?: string; agentSync: 'enabled'|'disabled'|'unknown' }`.
- Restore logic (under `withSlugLock('agent', slug)`):
  1. Refuse `not-quarantined` unless the slug is in the validated marker `quarantined`.
  2. Select snapshot; none → `no-snapshot`, no write.
  3. If `<scopedRoot>/<slug>.md` exists → `conflict` (both untouched).
  4. If source `{ws}/.claude/agents/<slug>.md` exists: bytes equal the snapshot → `already-restored` (no write; this is the retry path); else `conflict`.
  5. Copy: write snapshot bytes to `<sourceDir>/.<slug>.md.ptah-restore-<random>.tmp`, verify bytes, then `fs.link(tmp, dest)` (atomic, fails `EEXIST`), then unlink tmp. If `link` is unsupported (`EPERM`/`ENOTSUP`/`EXDEV`), `copyFile(tmp, dest, COPYFILE_EXCL)` and verify; on mismatch remove `dest` (created by this call under the slug lock). Any failure → remove tmp, `copy-failed` with reason; `dest` is never left partial, so retry is never blocked.
  6. Never deletes the snapshot or any other file. Never calls `AgentSyncGate.enable`.
- `agentSync` read in the handler via `AgentSyncGate.resolve(resolveHarnessWorkspaceRoot(ws))`, resolved with the `isRegistered(HARNESS_SYNC_TOKENS.AGENT_SYNC_GATE)` pattern (`wizard-generation-rpc.handlers.ts:781-787`); unregistered or throws → `'unknown'`. agent-generation never imports harness-sync.
- Handler: `skills-synthesis-rpc.handlers.ts` (`METHODS :243-285`, pattern `:1354-1420`, `requireDesktop`, `agentScope() :2027`); zod in `skills-synthesis-rpc.schema.ts` reusing `SlugSchema`.
- Files: MODIFY `libs/shared/src/lib/types/rpc/rpc-skill-clone.types.ts`, `libs/shared/src/lib/types/rpc.types.ts`, `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-seed-quarantine.ts`, `.../user-layer-mirror.service.ts`, `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts`, `.../skills-synthesis-rpc.schema.ts`. Specs: `user-layer-seed-quarantine.spec.ts`, `skills-synthesis-rpc.handlers.spec.ts`.
- Tests: no marker → empty; wrong-shaped marker (parseable JSON, `quarantined: "x"`, bad `completedAt`) → empty + `recordUnreadable`, no write; unsafe slug in marker dropped; history missing/unreadable → `hasSnapshot:false`, `quarantinedAt:null`, restore `no-snapshot` with no source write; a later history dir (ts > `completedAt`) is ignored; restore copies, history kept, flat base and another workspace's scoped root byte-unchanged; conflict in source (different bytes) and in scoped root, both files unchanged; copy failure (injected verify/link failure) leaves no `dest` and no tmp, and a second Restore succeeds; `already-restored` on retry with identical bytes; gate disabled → `restored` + `agentSync:'disabled'`, gate state file unchanged, item listed as `source-restored`; reconcile failure → item stays `source-restored`; after a successful propagation the item leaves the list; non-quarantined slug refused; traversal slug rejected by schema.

### C3. Generation preview (item 4, backend)
- Contract in `rpc-setup.types.ts`: `wizard:preview-generation {selectedAgentIds}` → `{ agents: { agentId; files: { relPath; target: 'claude'|HarnessTargetId; certainty: 'definite'|'conditional'; condition?: string; willOverwrite: boolean }[] }[]; warning?: string }`.
- Eligibility from the post-generation state (finding 5):
  - Claude `.claude/agents/<id>.md`: `definite`.
  - Gate after generation: the wizard grants consent before propagating (`:745-798`), so the gate WILL be enabled when `AGENT_SYNC_GATE` and `PROPAGATION` are both registered. Either missing → every rival path `conditional`, condition "agent sync not available on this host".
  - Targets: from a fresh `reconciler.verify(ws)` (not the cache): `detected && facets.agents==='supported'`, mapped through `harnessAgentRelPath`, apply the same per-agent enablement the manifest builder applies (`harness-manifest.builder.ts:479+`; Assumption A-4). These are `definite`. Undetected targets are not listed.
  - Reconciler absent or verify throws → Claude paths only + `warning` (AC 4.4); no rival path is promised.
- `willOverwrite` = `lstat` exists. Ids validated with the `WizardSubmitSelectionParamsSchema` id rule (`wizard-generation-rpc.schema.ts:36`).
- "Definite" means written unless a write fails; the post-generation result already reports write failures.
- Files: MODIFY `libs/shared/src/lib/types/rpc/rpc-setup.types.ts`, `rpc.types.ts`, `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts`, `.../wizard-generation-rpc.schema.ts`. Specs: `wizard-generation-rpc.handlers.spec.ts`, CREATE `wizard-generation.preview-fidelity.spec.ts`.
- Tests: detected codex + opencode → 3 definite paths; existing file → `willOverwrite`; no reconciler → warning + Claude only; gate token unregistered → rivals `conditional`. Fidelity fixture (temp workspace, real `HarnessPropagationService` + reconciler + gate; the LLM/content step of generation stubbed at its boundary, Assumption A-6): run preview, then the real `wizard:submit-selection` handler; the set of agent paths written equals the `definite` set exactly; gate initially disabled → still equal (wizard grants); provider detected after preview → covered by C5 re-check; preview failure → generation still runs and writes Claude files.

### C4. Agents tab: chips, Sync, quarantine panel (items 2 + 3, frontend)
- Pure `agent-sync-chips.ts`: states in order `unknown`, `not-detected`, `source` (Claude), `unsupported`, `failed` (with reason), `edited`, `missing`, `in-sync`, else `not-synced`.
- Reconcile guard (finding 3), one helper `reconcile-guard.ts` used by every caller on this surface (Sync, post-Restore, post-model-save in C6):
  1. `store.refresh({refresh:true})` (fresh verify; existing op).
  2. Collect `localEdit` across ALL targets and facets of that fresh report.
  3. Show a `NativeModalComponent` stating: "This updates every Ptah-managed file in this workspace (agents, skills, commands, MCP config) for all detected providers", listing the edited paths (if any) with "a copy is saved to `.ptah/harness/.history/` first". Shown always for Sync and Restore; for model save only when edited paths exist (the save row already carries the whole-workspace line).
  4. Cancel → returns `false`; the caller performs NO mutation (no reconcile, and for Restore/model save, no restore or settings write, because the guard runs before them).
  5. Confirm → caller performs its mutation, then `store.reconcile()`.
  - An edit made between the fresh verify and the reconcile is still snapshotted by C1 (recoverable). Residual, disclosed.
- Sync button → guard → `store.reconcile()`. `writeFailed` path + reason on the chip.
- Quarantine panel: count; per item slug, date or "date unknown", state.
  - Restore confirm text (Decision 1) always names the destination: "Adds `.claude/agents/<slug>.md` to this workspace as a source file it owns (visible to git); the quarantine snapshot is kept."
  - `agentSync:'disabled'`: also states "Agent sync is off here: only Claude will see it until agent sync is enabled by the setup wizard. Ptah will not turn sync on." Restore runs without reconcile and no whole-workspace guard.
  - Otherwise: guard → restore RPC → `store.reconcile()` → re-list + `refreshClones()`.
  - `source-restored` items show "restored, not yet synced" and a "Finish restore" action = guard → reconcile (restore RPC returns `already-restored`). `no-snapshot` items: Restore disabled, "no snapshot found".
  - `conflict`/`copy-failed` → error toast naming `path`/`reason`. `recordUnreadable` → muted note, not an error.
- `CloneCardComponent` inputs `syncChips`, `notOwned`. `SkillClonesViewComponent` (agent tab only) injects `HarnessHealthStore`; `actionsLocked` includes `store.busy()`.
- Files: CREATE `libs/frontend/skill-synthesis-ui/src/lib/components/clones/agent-sync-chips.ts`, `.../clones/reconcile-guard.ts`, `.../clones/quarantined-agents-panel.component.ts` (+ specs). MODIFY `clone-card.component.ts`, `skill-clones-view.component.ts`, `services/skill-synthesis-rpc.service.ts`.
- Tests: risk-table fixture exact chips; undetected cursor; guard: cancel → no reconcile/restore RPC; an edit made after tab load appears (fresh refresh used, not the cached report); an unrelated edited skill/MCP path is listed; post-Restore reconcile goes through the guard; gate-disabled Restore makes no reconcile call; `source-restored` shows "Finish restore"; conflict toast; empty panel copy; non-agent tabs make no harness call.

### C5. Wizard preview step (item 4, frontend)
- `onGenerateAgents()` → `previewGeneration(ids)` → modal listing agent, path, "will overwrite", and conditional paths in a separate "may also write, if …" group with their condition.
- Confirm → re-run `previewGeneration`; if the `definite` set changed (provider state change), re-show the modal with "Targets changed since preview" and require a second confirm. Then the unchanged existing body (`confirmGenerate()`).
- Cancel → closes, no RPC, selection kept (AC 4.3). Preview throws → modal shows the reason and Generate stays enabled (AC 4.4).
- Files: MODIFY `libs/frontend/setup-wizard/src/lib/components/agent-selection.component.ts` (`:466-488`, `:883-946`), `.../services/wizard-rpc.service.ts`, `agent-selection.component.spec.ts` (existing submit cases now confirm first; reason recorded).
- Tests: cancel → `submitAgentSelection` not called; preview failure → warning + Generate submits; definite set changed on confirm → second modal, no submit until reconfirmed; conditional group rendered apart.

### C6. Agent model control (item 1; AFTER #634 + Part A Batch 3)
- Settings: key `agentGeneration.models`, value `AgentModelMap = Record<slug|'*', Partial<Record<Provider, string>>>`. Machine = global key; workspace = `workspace.<hash>.agentGeneration.models`, appScopable=false.
- Workspace identity (finding 1):
  - `WorkspaceScopeResolver.writeForPath(globalKey, workspacePath, value)` + `inspectForPath`. `writeForPath` throws when `normalizeActivePath(workspacePath)` is undefined; it never falls back to the global key (contrast `:197-201`).
  - The workspace path everywhere is `resolveHarnessWorkspaceRoot(root)`, so save and emission (`PluginConfigSourceResolver`) hash the same path.
  - `skillSynthesis:getAgentModels {}` → `{ workspaceRoot: string|null, machine, workspace, lists, classification }`.
  - `skillSynthesis:setAgentModel { workspaceRoot: string, slug|'*', provider, scope:'machine'|'workspace', value: string|null, confirmUnlisted?: boolean }`. Handler refuses (`RpcUserError`) when `workspaceRoot` is missing/empty, or when it differs from the resolved active root at entry ("workspace changed; reload"). The write then uses the request's path, never the ambient one.
  - `AgentModelSettings.update(workspacePath, scope, slug, provider, value)`: per-physical-key in-process promise queue; inside it, re-read the raw physical key (not the merged view), deep-clone, set/delete only `[slug][provider]`, drop an emptied slug object, write. Unrelated slugs/providers preserved.
- Classification (finding 4), one shared pure contract `agent-models.types.ts` used by UI, save handler and emission:
  - `providerReported(list)` = entries with `isFallback !== true`. Empty → list unavailable. Fallback-only entries never make a value Listed.
  - `classifyAgentModelValue(provider, value, list|null)`: trim empty → Empty; contains a newline/control char → Malformed (always); exact match in provider-reported ids → Listed (no syntax check), EXCEPT OpenCode, whose documented `provider/model` format is required by emission, so an OpenCode value failing syntax is Malformed even if listed; fails syntax → Malformed; provider-reported list non-empty → Unlisted; else Unverifiable. Known-invalid is empty for all providers.
  - Syntax: OpenCode `^[^\s/]+\/\S+$` (A-3); Codex/Copilot/Cursor non-empty, no whitespace; Claude `opus|sonnet|haiku|inherit` (Part A R8).
  - `isAgentModelEmittable(provider, value)` = not Empty, no newline/control char, and for OpenCode the syntax rule. Invariant (spec-tested over every class): `classify` accepts ⇒ `isAgentModelEmittable` is true. Emission writes every emittable value, quoted/escaped per format; a non-emittable stored value (only possible by hand-editing settings) is skipped with a `logger.warn`, and the card shows it as "not written: <reason>".
  - Server-side enforcement: `setAgentModel` builds the list from the same source as `agent:listCliModels` (extract its body, `agent-rpc.handlers.ts:510-539`, into a small `CliModelListService` used by both; post-#634 edit). Malformed → refused; Unlisted without `confirmUnlisted:true` → refused "needs confirmation"; provider whose emission format is unconfirmed (A-2) → refused "not supported for <provider>" and the editor disables that row up front. Server list differs from the UI's (e.g. list fetch failed) → server classification wins; the UI shows the refusal.
- Emission: `HarnessSourceState.agentModels?` from `PluginConfigSourceResolver` (factory wired at `apps/ptah-electron/src/di/phase-2-libraries.ts:215`, `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:173`, `libs/backend/cli-engine/src/lib/container.ts:670`); builder sets `HarnessDesiredAgent.models?` with `isAgentModelEmittable` values; `sourceHash` folds the model only when present (AC8); 4 transformers emit `model` only when given. Claude: F2 reads `AgentModelSettings.layersForPath(ws)` + `resolveAgentModel` (revises batches.md Task 3.2).
- `resolveAgentModel(layers, slug, provider)`: ws[slug], ws['*'], machine[slug], machine['*']; never across providers.
- UI: inline model section (agent cards). Effective value + source; empty non-Claude rows show the inherits text; datalist from `agent:listCliModels`; labels via the shared classifier; Unlisted asks confirmation; machine scope states "applies to every workspace without its own value" (AC7). Save = reconcile guard (C4) → `setAgentModel` → `store.reconcile()`. Cancel → nothing saved. Save failure keeps the previous value and shows the reason; reconcile failure after a successful save → "saved; provider copies not updated: <reason>", with Sync to retry.
- Files: CREATE `libs/shared/src/lib/types/agent-models.types.ts` (+spec), `libs/backend/settings-core/src/repositories/agent-model-settings.ts` (+spec), `libs/backend/rpc-handlers/src/lib/services/cli-model-list.service.ts` (+spec), `clones/agent-model-editor.component.ts` (+spec). MODIFY: shared barrel, `rpc-skill-clone.types.ts`, `rpc.types.ts`; `workspace-scope-resolver.ts` (+spec), `settings-core/src/di/tokens.ts`, `settings-core/src/index.ts`, 3 settings registrations; `agent-rpc.handlers.ts` (list extraction only); `harness-source.port.ts`, `plugin-config-source-resolver.ts`, `desired-state.types.ts`, `harness-manifest.builder.ts`, `workspace-target.ts`, `agent-transformer.port.ts`, 4 transformers (+specs); 3 host wirings; skills-synthesis handler + schema; `clone-card.component.ts`, `skill-clones-view.component.ts`, `skill-synthesis-rpc.service.ts`.
- Tests: precedence rows (Claude + codex); non-Claude empty with Claude set → no field (AC4); missing `workspaceRoot` → refused and the global key unchanged; `writeForPath('')` throws, no global write; active workspace switched between load and save → refused, neither workspace's key changed; two concurrent `update`s on different providers of one slug → both persist; unrelated slug entries preserved; two workspaces isolated (AC6); listed-but-syntax-failing Codex value accepted, saved and emitted (end-to-end through reconcile); OpenCode listed-but-malformed refused at save; Unlisted without confirmation refused server-side, with confirmation saved and emitted; mixed fallback/live list: a fallback-only id classifies Unlisted, not Listed; save failure keeps prior settings bytes; classify⇒emittable invariant; model change rewrites the copy with no `overwrittenLocalEdit`; hosts without the factory byte-identical.

## Integration architecture

- (2) tab → `harness:health{refresh}` → chips. Sync → guard (fresh verify) → `harness:reconcile` → chips.
- (3) tab → `listQuarantinedAgents` → [gate enabled/unknown: guard] → restore (source file) → [gate enabled/unknown: `harness:reconcile`] → re-list (`source-restored` until the scoped clone exists) → `refreshClones`.
- (4) Generate → `wizard:preview-generation` → modal → confirm → re-preview (changed → reconfirm) → existing `wizard:submit-selection`.
- (1) card save → guard → `setAgentModel {workspaceRoot}` → queued read/modify/write of one physical key → `harness:reconcile` → resolver → builder → emission.
- State: report in root `HarnessHealthStore`; quarantine list and model maps are view-local; quarantine state is derived from files every list, never stored.
- Boundaries: zod at every new handler; slug and ts rules reused; marker fields validated; restore via tmp + exclusive link; workspace path explicit on every settings write.
- Failure: read RPCs degrade to empty/warning; writes leave previous state; Restore and preview never delete user files; no action enables agent-sync consent except the existing wizard grant.
- Observability: `logger.info` on restore (slug, outcome, agentSync); `logger.warn` on dropped marker slugs and on emission skips.

## Preserve list check

| Preserve item | How it stays working |
| --- | --- |
| Electron-only notice, Refresh, legend, tabs, diverged filter, bulk rebase | No change to `:123-250` structure; new harness calls gated by `isElectron()` and `currentKind()==='agent'` |
| Card open / Enhance / Rebase / Keep | Card outputs unchanged (`clone-card.component.ts:227-231`); new inputs default empty |
| Detail drawer, history, revert, scorecard; empty copy | Untouched; quarantine panel renders outside the empty `<p>` |
| Wizard selection + Generate + submit-selection + progress | Existing body moved verbatim into `confirmGenerate()` |
| Existing specs | Any edited assertion carries a one-line reason |

## Architecture-level quality requirements

- Functional: all ACs of items 1-4 and the tests above.
- Performance: one verify per tab entry, Refresh, or guarded mutation; no polling, no per-card timer.
- Security: zod at handlers; slug/ts rules; exclusive link; explicit workspace path; no webview path reaches fs unvalidated.
- Maintainability: frontend↔backend only via `libs/shared`; `scope:webview` import rule (`eslint.config.mjs:263-266`); agent-generation never imports harness-sync; no new lib.
- Testability: pure rules unit-tested; harness and restore tested on temp workspaces; preview fidelity through the real submit path.

## UI evidence step

Before from `21c27d17f`, after from this branch: Agents tab dark + light (chips incl. missing + edited, guard modal, quarantine panel incl. `source-restored` and gate-disabled copy, not-owned label, model section with an inherited row); wizard preview modal dark + light. Stored as `.ptah/specs/TASK_2026_609_c495/screenshots/{before,after}-{agents,wizard}-{dark,light}.png`.

## Decisions made by architect

1. Restore writes `{ws}/.claude/agents/<slug>.md` as an owned workspace source, disclosed before Restore (recommended option from `plan-review.md`; user confirms at the combined gate). Alternative held: confine recovery to quarantine/scoped storage without durable ownership.
2. Claude chip = "source".
3. Every reconcile is whole-workspace and guarded by one policy (C4).
4. Sync over an edited copy snapshots it first (C1).
5. "In sync" only via `agentsInSync`.
6. Known-invalid class empty; only non-fallback list entries are provider-reported.
7. OpenCode syntax: `provider/` + non-empty model id (may contain `/`); required even for listed OpenCode values because emission depends on it.
8. Claude "nothing set" shows source "template".
9. Restore never enables agent-sync consent; with the gate off the item stays `source-restored` and says why.

## Assumptions (implementer checks)

- A-1: VS Code's settings store persists arbitrary `workspace.<hash>.*` keys. Check `vscode-settings-registration.ts` before C6.
- A-2: Codex TOML `model = "…"`, Copilot `.agent.md` and Cursor frontmatter `model:` are accepted. Add a transformer test per format; unsupported → row disabled and save refused (never accepted then dropped).
- A-3: OpenCode id syntax per https://opencode.ai/docs/models.
- A-4: the per-agent enablement rule the builder applies is reachable from the preview handler without duplicating it; if not, expose it as a pure function in harness-sync.
- A-5: settings writes are in-process serialized only; two hosts writing the same settings file concurrently is out of scope (existing behaviour for every key). A workspace switch between save and the following reconcile is not guarded beyond the entry check; check whether Electron reloads the view on workspace switch.
- A-6: the generation step can be stubbed at its LLM/content boundary in a handler-level spec while file writing and propagation stay real. If not, stub at the orchestrator but keep the Claude path from the orchestrator's own path function.
- A-7: the skills-synthesis handler can reach the DI container (or accept an optional `AGENT_SYNC_GATE` injection); else `agentSync:'unknown'`.

## Team-leader handoff

- Executors: C1, C2, C3, C6-backend → backend-developer; C4, C5, C6-frontend → frontend-developer; screenshots → visual-reviewer.
- Complexity: MEDIUM for items 2-4, HIGH for item 1.
- Ordering: C1 before C3, C4; C2 and C3 share `rpc.types.ts` (sequential or one executor); C4 after C1 + C2; C5 after C3; C6 after #634 merges, the rebase, and Part A Batch 3 revision.
- Parallel-safe: C4 ∥ C5.
- PR #634 overlap: items 2-4 edit none of the #634 files. C6 edits `agent-rpc.handlers.ts` (list extraction only) after #634 merges.
- Proposed batches: B-1 (C1); B-2 (C2 + C3 backend); B-3 (C4); B-4 (C5, ∥ B-3); B-5 (C6 backend, post-#634); B-6 (C6 frontend); B-7 screenshots + QA.
- Verification: `npx nx run-many -t typecheck,lint -p @ptah-extension/shared,@ptah-extension/harness-sync,@ptah-extension/agent-generation,@ptah-extension/rpc-handlers,@ptah-extension/skill-synthesis-ui,@ptah-extension/setup-wizard[,@ptah-extension/settings-core]`, then `-t test … --maxWorkers=2`, tailed; `manifest.spec.ts` totality passes; `git diff --name-only` shows no #634 file in B-1..B-4.

## Review fixes (plan-review.md)

| # | Change |
| --- | --- |
| 1 | C6: `writeForPath` refuses a missing path (no global fallback); `setAgentModel` requires and checks `workspaceRoot`; write uses the request path; per-key queued read/modify/write preserving unrelated entries; tests for missing workspace, switch, concurrent updates, preserved entries |
| 2 | C2: derived `source-restored` state kept in the list until the scoped clone exists; gate-disabled restore never enables consent and says so; tmp + exclusive link so no partial `dest`; `already-restored` makes retry work; Decision 1 + C4 disclosure of the source destination; tests for gate disabled, copy failure, reconcile failure, retry |
| 3 | C4 reconcile guard: one policy for Sync, post-Restore, post-model-save; fresh `harness:health{refresh}`; `localEdit` across all facets; whole-workspace disclosure; cancel = no mutation (guard runs first); existing ops only; tests listed |
| 4 | C6 classification contract: listed exception (except OpenCode, documented format), fallback entries never Listed, server-side `confirmUnlisted` and list via shared `CliModelListService`, classify⇒emittable invariant, unsupported formats refused up front; end-to-end tests listed |
| 5 | C3: post-generation gate state, fresh verify, `definite` vs `conditional`; C5 re-preview on confirm; fidelity spec through real `wizard:submit-selection` with exact equality; gate-disabled, provider-change, preview-failure, cancel tests |
| 6 | C2: validated marker fields, per-slug safe rule, snapshot = latest ts ≤ `completedAt` holding `<slug>.md`, `quarantinedAt:null` → "date unknown"; tests for wrong-shaped marker, missing history, `no-snapshot` |
