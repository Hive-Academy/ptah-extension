# Implementation Plan - TASK_2026_701_9e4b (revision 3, Gate 2 revise round 2)

Align setup-wizard agent generation, community packs and Marketplace installs with the desktop
skills Library: one guarded write path, one target root, one refresh signal, one provenance label.

All paths are relative to the worktree
`D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment` (branch
`feat/wizard-library-alignment`, base `38d9cc427`). Line numbers were read on that tree.
Findings 1-13 of `implementation-plan-review.md` are answered in "Revise round 1" at the end. The
"Round 1 re-review" items (R1-S1 / D14, R1-M1, the rest of #8 and #11) are answered in "Revise
round 2".

## Inputs and constraints

- Requirements used: `task-description.md` (sections 1-8, NFRs, PM1-PM14), `parity-inventory.md`
  (**77 capabilities**: 41 preview/writer/pack rows, inventory lines 24-64; 36 Marketplace rows,
  lines 70-105), `context.md`, `decisions.md` (D1-D14), `design-spec.md` (revision 1, its
  `## Review responses` table at :298 and its `## Revise round 2` section at :320), `prototype/`.
- Corrections applied:
  - `implementation-plan-review.md` (codex, REVISE: 1 Blocking, 8 Serious, 4 Moderate). Every
    finding is fixed; see "Revise round 1". Its "Round 1 re-review" (REVISE: 1 Serious, 1
    Moderate) is fixed; see "Revise round 2".
  - `design-spec-review.md` findings F1-F12 and the design's "Revise round 2" items R1-1..R1-5
    (binding UI requirements; table below).
- Design handoff used: `design-spec.md` + `prototype/*.html`. Component names C1-C12 are reused as
  Angular component names (F-components).
- Missing decision-critical input: none. The four user-reserved questions of revision 1 are
  answered as D8-D11 (section "Resolved user decisions"). D3 and D7-D14 are applied unchanged.

### Design inputs (binding, frontend entry gate)

Frontend batches start from `design-spec.md` revision 1 including `## Review responses` (:298) and
`## Revise round 2` (:320). The rows below are what the plan carries from them.

| Source | Requirement the plan carries | Component |
| --- | --- | --- |
| Review F1 | Installed view keeps header, harness explanation, search, three groups in order, detail navigation, inspector/drawer, source labels. Additive changes only. | F7c |
| Review F2 | Consent dialog keeps every existing block; the new "Local files this install would replace (N)" section sits after the shadowed block and before the error. The install report keeps its named shadowed list and adds Written/Kept/Shadowed/Skipped. | F7a, F7b |
| Review F3 / R1-5 | Both wizard previews keep source status, model picker, informational rival rows. Three mutually exclusive rival states: rows listed (no warning); "Harness sync is not available" (no rival rows); "Could not check which CLIs are installed" (no rival rows). The "other CLIs sync from a different folder" warning shows only for the opened-folder target. | B5, F2, F3 |
| Review F4 / R1-2 | Every pack install path opens one target-choice prompt, scoped to the whole pack or one file: wizard Install All, Choose location, per-file Install and Retry; sidebar Change, Install All and Retry. The no-conflict case still shows the target. A target change re-plans and resets every choice to Keep. | B8, F4 |
| Review F5 | Visible focus ring on selected Keep (outer ring, 2px offset). Target cards are buttons inside the trap. Modal keyboard parity in every modal, including the consent dialog. | F1, F7a |
| Review F6 | Unreadable = forced Keep everywhere; bulk skips it. | A6, F1, F7 |
| Review F7 | Library and Marketplace use one label function and one fixture set (shadowed, community, plugin-update diverged, orphaned after disable vs uninstall). | B1, A29, F6, F7 |
| Review F8 | Completion counts equal per-file rows; a kept file is never listed as newly diverged; sidebar shows five outcomes. | F5 |
| Review F9 / R1-3 | Each installer family has kept/repair/unreadable/primary-failure states. The repair prompt is bound to the family that opened it: skills.sh lists `tailwind-v4/SKILL.md`; plugin enable lists `release-notes/SKILL.md` and a forced-Keep file; plugin-agent mirroring lists `.claude/agents/release-manager.md` (default Keep, "plugin version" label). | B12, F7h |
| Review F10, F11 | Exact per-host strings; diff colours `bg-success/15`/`bg-error/15`; wrap rules at about 400px; Electron visual review at a narrow window. | F1-F7 |
| R1-1 | Marketplace inspector shows the selected row's description, facts (kind, source, version, provenance, contents), names, kept-file note, sync line and action. Search matches when every query word appears in name, description, source or kind. | F7c |
| R1-4 | The sidebar dialog starts every existing-file row on Keep; first confirm label "Confirm and generate". | F1, F3 |
| Review F12 | Rule provenance labels: documentation. Applied to this plan's decision table (finding 13). | Decisions |

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| Writer overwrites whenever bytes differ. A read error is treated as "absent", so a permission error silently overwrites | `libs/backend/agent-generation/src/lib/services/file-writer.service.ts:211-241` (catch :218-220) | Guard belongs in the writer, the single write point. Unreadable → kept |
| `writeAgentsBatch` rollback deletes every `written` file, including replaced originals. No production caller | `file-writer.service.ts:112-181,244-255`; only caller of `writeAgent` is `orchestrator.service.ts:874` | Delete the batch API (A19) |
| Orchestrator output dir = `projectContext.rootPath/.claude/agents`; rootPath = `options.workspacePath` | `orchestrator.service.ts:324,420-424,792` | Explicit output root option; analysis stays on the opened folder |
| Per-agent loop renders, writes, records outcome | `orchestrator.service.ts:790-900` | Keep decisions applied before rendering (no LLM call for kept) |
| Claude model override resolution is private | `orchestrator.service.ts:1095-1147`; `libs/shared/src/lib/types/agent-models.types.ts:82,97-102,146-153,185-200` | Extract a pure function for orchestrator and preview |
| Preview checks only `lstat`; signature `[target, relPath, willOverwrite]` keyed `tabId\0workspace`; bounded map of 64 | `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts:1083-1099,1223-1244,1889-1906` | Preview extended with state + baseline + revision + token |
| Rival preview is `available` or `unavailable` (with warning, no rows); three causes: no harness, sub-folder, verify failed | `wizard-generation-rpc.handlers.ts:151-170,1121,1128,1176` | R1-5 states already exist; sub-folder cause applies only to the opened-folder target |
| Preview gate only for tab-bound, non-resume submits | `wizard-generation-rpc.handlers.ts:480-501`; `wizard-generation-binding.ts:345-356` | Replace decisions need a valid token on every path |
| Wizard-view modal previews and submits without tab binding | `libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.ts:202-215,229-248` | Token binding must not depend on tabBinding |
| Sidebar re-previews on confirm, compares definite targets | `agent-selection-list.component.ts:307-360` | One shared decision-state helper |
| `resolveHarnessWorkspaceRoot(cwd)`: nearest ancestor with `.ptah`/`.git`, below home | `libs/backend/harness-sync/src/lib/workspace/workspace-root.ts:59-84`; exported `harness-sync/src/index.ts:86-89` | Single root resolver for every new path |
| Checkpoint `isTrusted` requires outputDirectory inside workspaceRoot | `wizard-generation-checkpoint.service.ts:114-116,136-178,296-303`; manifest `agent-generation/src/lib/types/generation-checkpoint.types.ts:23-49,182-237` | Trust rule must allow the harness root |
| Outcome status union repeated in 6 places | `libs/shared/src/lib/types/wizard/phase.ts:205`; `rpc-setup.types.ts:319`; `generation-checkpoint.types.ts:16,175`; `wizard-generation-binding.ts:36`; `completion.component.ts:28` | Extend in one batch |
| Pack install target `{workspaceRoot}/.claude/agents`, no propagate | `libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.ts:920-968` | Plan/confirm split + harness root + propagate |
| Pack download: in-flight dedup keyed by URL + sorted file names only (not target, not decisions) | `libs/backend/platform-core/src/agent-pack-download.service.ts:149-184,475-481` | Must not share a mutation promise across targets/decisions (finding 3) |
| Pack cache: matching manifest hash + all files exist → `success:true, agentsDownloaded:N, fromCache:true` with no content check | `agent-pack-download.service.ts:246-266` | Existence-only short-circuit is removed from installs (finding 3) |
| Pack writes a fixed `.tmp` sibling then renames | `agent-pack-download.service.ts:391-402` | Overlapping installs into one directory must be serialized |
| Claude target never writes `.claude/agents`; rival targets get agents from the user layer | `libs/backend/harness-sync/src/lib/targets/claude-target.ts:13-16,93-102` | Plugin agents in the user layer fan out to rival targets only |
| Hand-edited managed copy is planned as a write with `overwritesLocalEdit` | `targets/harness-target.port.ts:64-70`; `claude-target.ts:376-383,515-520`; `workspace-target.ts:530-539,925-973` | Plan it as kept (A7/D8) |
| Unowned desired path → `foreign`, skipped, logged as blocked | `claude-target.ts:199-205,238-241,288,507-513`; `harness-reconciler.service.ts:900-964` | Already safe; reported as kept |
| Blocked repair re-derives the blocked set from a fresh verify, then moves each occupant to quarantine under the workspace lock, then runs one pass | `libs/backend/harness-sync/src/lib/repair/blocked-repair.service.ts:1-58,119-175,199-229` | The approval-digest check goes inside `moveOccupants`, under the lock, before `moveToQuarantine` |
| `HarnessRepairBlockedPath = {target, relPath}` | `libs/shared/src/lib/types/harness-sync.types.ts:518-535` | Gains an internal-only `expectedDigest?` |
| `hashContent` (UTF-8 sha256), `hashFile` (null when unreadable), `hashDir` (tree digest, null when absent) | `harness-sync/src/lib/hash/content-hash.ts:121,126-136,299-320`; exported `harness-sync/src/index.ts:314-316` | Approval digests for files and skill directories |
| `computeSourceHash(file)` = `'sha256:' + hashFile` (prefixed) | `agent-generation/src/lib/services/user-layer/source-hash.ts:69-75` | Wizard-origin hash must use `computeSourceHash` to compare with sidecar hashes (A-h resolved) |
| Propagation never throws; refresher failure swallowed | `harness-sync/src/lib/propagation/harness-propagation.service.ts:30,93-142` | Needs a user-layer report |
| `IUserLayerRefresher.refresh(): Promise<void>`; `NO_USER_LAYER_REFRESH` | `harness-sync/src/lib/sources/user-layer-refresher.port.ts:24-55`; `harness-sync/src/lib/di/register.ts:194-205` | Port returns a status; three host adapters change together |
| Host refreshers | Electron `apps/ptah-electron/src/activation/plugin-activation.ts:556-568` (DI `apps/ptah-electron/src/di/phase-2-libraries.ts:268`); VS Code `apps/ptah-extension-vscode/src/activation/plugin-activation.ts:212-215` (DI `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:244`); CLI `libs/backend/cli-engine/src/lib/bootstrap/harness-boot.ts:98` (DI `libs/backend/cli-engine/src/lib/container.ts:742`) | All three compile against the new port |
| Electron pass mirror → reconcile → catalog; `refreshUserLayer` returns `request(...)` of a per-root coalescer | `plugin-activation.ts:332-474,492-509,527-537` | Pass returns a status |
| Coalescer: one pending batch per key; skip settles without `run` (:233-235); `request` returns `Promise<void>`; a request during a running pass joins the next batch | `apps/ptah-electron/src/activation/coalesced-job.ts:152-275` | Return a typed per-batch outcome to every joined request (finding 5) |
| No webview push after the pass; push precedent lazily resolves WEBVIEW_MANAGER | `apps/ptah-electron/src/activation/boot-readiness-broadcaster.ts:40-67` | New `library:changed` from the Electron pass only (D3) |
| Frontend push handlers: `MESSAGE_HANDLERS` multi-provider | `libs/frontend/core/src/lib/services/message-router.types.ts:33-51`; `apps/ptah-extension-webview/src/app/app.config.ts:403-407` | Library change feed registered the same way |
| Message registry + host-source baseline guard | `libs/shared/src/lib/types/messages/message-constants.ts:18,302`; `libs/shared/src/lib/types/rpc/host-source-registry.contract.spec.ts` | New names do not match the guarded pattern |
| Agent-sync gate: absent consent → `resolveAgentMirrorSource` returns `{}` (no `workspaceRoot`) | `libs/backend/harness-sync/src/lib/state/agent-sync-gate.ts:70-76,182-193` | Plugin-agent mirroring cannot hang off `MirrorSources.workspaceRoot` (finding 4) |
| `buildAgents` returns `[]` when sync is disabled, reading the scoped user-layer agents root | `harness-sync/src/lib/manifest/harness-manifest.builder.ts:567-574` | A plugin agent in the scoped user layer reaches rival CLIs only with consent; the Library can list it without consent |
| `MirrorSources` fields; `getUserLayerRoots(workspaceRoot)` keys agent clones by root | `user-layer-mirror.service.ts:78-117,332-343` | New independent `libraryScopeRoot` field |
| Mirror handles `skills/`, `commands/`; workspace agents create-if-absent `pluginId:null`; `pluginId = basename(pluginPath)` | `user-layer-mirror.service.ts:363-405,537,1541-1705,2019,2032,2156-2217,2368-2373` | Plugin agents = new collaborator; basename is not a unique identity |
| Sidecar schema (`z.object`, non-strict), no source identity or label | `libs/shared/src/lib/types/origin-sidecar.types.ts:128-153` | Add optional `sourceRef`, `sourceLabel` (finding 9) |
| External plugin dir `external/<owner>/<repo>/<plugin>`; state record has `displayName` | `libs/backend/plugin-marketplace/src/lib/install/external-plugin-id.ts:82-94`; `external-plugin-state.store.ts:56` | Durable source identity = full external id |
| Plugin loader enumerates bundled, skills.sh and external plugin paths and builds `PluginInfo` names | `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:589-613,1274-1286` | Source descriptors come from the loader |
| Plugin config storage: `storageFor(root)` returns the registered folder's storage or `null` in a workspace-scoped host; `save` throws on `null` | `plugin-loader.service.ts:791-818,856,1045-1099` | In Electron, a sub-folder's config lives under the opened folder; the reconciler asks for the harness root and reads `null` → "nothing switched off" (finding 8) |
| Electron reconciler config reader forwards the harness root unchanged | `apps/ptah-electron/src/di/phase-2-libraries.ts:236-257`; `harness-sync/src/lib/sources/plugin-config-source-resolver.ts:46-60,197-230` | Reader passes the harness root; B15 routes it to the harness-root config home (D14) |
| Precedent: nearest folder with storage between cwd and policy root | `libs/backend/cli-agent-runtime/src/lib/capabilities/capability-resolver.service.ts:280-305` | Same idea, made deterministic per harness root |
| Mirror sources and plugin config in Electron read the active workspace (no root) | `apps/ptah-electron/src/activation/plugin-activation.ts:252,297` | Pass the harness root; B15 routes it to the config home (D14) |
| Every plugin-config read/write goes through one private storage lookup; storage is per registered folder; a saved config holds five lists | `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:791-808` (`storageFor`), `:856-870` (lenient read), `:922-972` (strict read, absent = empty), `:1045-1099` (save); key `ptah.plugins.config` at `:75`, read nowhere else (repo search) | D14 routing lives in this one lookup, so every consumer (RPC, mirror, reconciler, session resolver) agrees |
| Workspace-scoped storage registers only opened folders | `libs/backend/platform-core/src/interfaces/workspace-scoped-state-storage.interface.ts:30-52`; `libs/backend/vscode-core/src/services/workspace-aware-state-storage.ts:155-160,222-224` | A harness root that was never opened has no folder storage; a stable home needs another store |
| Global state storage is registered in all three hosts | `libs/backend/platform-electron/src/registration.ts:119`, `platform-cli/src/registration.ts:69`, `platform-vscode/src/registration.ts:67` (`PLATFORM_TOKENS.STATE_STORAGE`, `platform-core/src/di/tokens.ts:16`) | Stable harness-root record keyed by canonical root (D14) |
| Session capability resolution uses the harness root, then walks to the nearest folder with storage | `libs/backend/cli-agent-runtime/src/lib/capabilities/capability-resolver.service.ts:254-277` (`resolveHarnessWorkspaceRoot` + realpath), `:289-305` (`stateRootFor` via `hasWorkspaceState`), `:652` (stored layer read) | When `hasWorkspaceState(R)` answers true for a routed home, sessions read the same home as the Library |
| The RPC manifest must claim every registry method exactly once | `libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts:63-64` | A registry entry lands in the same batch as its handler's `METHODS` (phase compile/test rule) |
| skills.sh roots deliberately not mirrored | `rpc-handlers/src/lib/skills-sh/skills-sh-source-root.ts:35-61` | Change for 8.8 (A9) |
| Catalog status; no provenance column | `libs/backend/skill-synthesis/src/lib/skill-registry-catalog.service.ts:42-86` | Provenance computed at list time |
| `listClones` agent scope = raw `getWorkspaceRoot()`; catalog uses harness root | `skills-synthesis-rpc.handlers.ts:240-266,1172-1245`; `plugin-activation.ts:397-401` | Align scope (2.5) |
| `CloneSummary` and list result have no provenance/scope | `libs/shared/src/lib/types/rpc/rpc-skill-clone.types.ts:19-56,73-80` | Additive optional fields |
| Library refreshes only on init/user action | `skill-clones-view.component.ts:511-525,666-677`; `skill-clones-state.service.ts:69-84` | Feed-driven refresh + epoch guard |
| Empty Agents copy; card status hint | `skill-clones-view.component.ts:133-140`; `clone-card.component.ts:102-121`; `clone-action-gating.ts:89-104` | Copy change; badge first |
| Plugin save-config reconciles with `skipUserLayerRefresh: true` | `plugin-rpc.handlers.ts:376-393` | Background user-layer refresh (A13) |
| External install two-call consent; collisions outside the token | `plugin-rpc.handlers.ts:547-616,728-781`; `external-plugin-installer.service.ts:146-337,518-578` | Local items stored beside the pending plan |
| skills.sh install: rm + move in its own root, then propagate | `skills-sh-rpc.handlers.ts:291-369,380-427,439-450` | Guard = reconciler keep + reporting |
| Plugin and skills.sh RPCs pass the raw workspace root | `plugin-rpc.handlers.ts:640,707,818-840`; `skills-sh-rpc.handlers.ts:778-780` | Resolve at the boundary (8.1) |
| `PluginInfo` has no agent fields | `libs/shared/src/lib/types/rpc/rpc-misc.types.ts:489-527` | Add counts and names |
| `skill-synthesis-ui` already imports `@ptah-extension/marketplace/services` | `skill-clones-view.component.ts:51` | Feed lives there |
| Shared test entry `@ptah-extension/shared/testing` holds pure fixtures (precedent `fixtures/dashboard-spec.ts`); already imported by frontend specs | `tsconfig.base.json:235`; `libs/shared/src/testing/index.ts:1-50`; e.g. `libs/frontend/mcp-apps-page/src/lib/components/apps-page.component.spec.ts` | Agreement fixtures go there (finding 1) |
| `webview-e2e-harness` is `scope:webview,type:test-harness`; its fixture imports Playwright | `libs/frontend/webview-e2e-harness/project.json:6`; `eslint.config.mjs:247,410-417` | Forbidden dependency for feature libs |
| Diff renderer `@ptah-extension/git-ui/diff-renderer` (`scope:webview,type:feature`), lazily imported by a feature lib | `tsconfig.base.json:135-136`; `libs/frontend/git-ui/src/lib/renderer/text-diff-view.component.ts`; `skill-synthesis-ui/.../lazy-diff-view.component.ts:165` | Pack/plugin diffs reuse it the same way (A-diff resolved) |
| Disallowed-tool map; unknown type = no restriction | `agent-generation/src/lib/services/subagent-tool-allowlist.ts:64-111` | Permission gate (6.2, 6.6, 6.7) |
| Prompt and plugin-skill block | `content-generation.service.ts:370-404`; `agent-sdk/src/lib/helpers/plugin-skill-discovery.ts:17-21,33,78` | Rules module + pinned agreement test |
| Rubric headings `## N. Title` | `.claude/skills/skill-creator/references/prompt-authoring-rubric.md:7-66` | Drift test parses these |
| RPC registry true-map | `libs/shared/src/lib/types/rpc.types.ts:1096,3150-3163,3398` | New method entries |
| `SetupRpcHandlers.METHODS` (ends with `wizard:install-pack-agents` at :102); manifest consumes it | `setup-rpc.handlers.ts:~80-103`; `rpc-handlers/src/lib/host-profile/manifest.ts:350-352` | New method must be in METHODS |
| `PluginRpcHandlers.METHODS`; manifest | `plugin-rpc.handlers.ts:130-...`; `manifest.ts:298-300` | Same for the new plugins method |
| Per-method registration test precedent (registry, owner, prefix) | `rpc-handlers/src/lib/rpc-allowlist.spec.ts:134-152`; prefixes `vscode-core/src/messaging/rpc-handler.ts:44,67` (`plugins:`), `wizard:` | One describe block per new method |
| Shared handler-service registration: `container.registerSingleton(Class)` | `rpc-handlers/src/lib/register-shared-rpc-handlers.ts:64-76`; called by `apps/ptah-electron/src/di/phase-4-handlers.ts`, `apps/ptah-extension-vscode/src/di/phase-3-handlers.ts`, `libs/backend/cli-engine/src/lib/container.ts:896` | New rpc-handlers services registered there; all hosts get them |
| `EXPECTED_RESOLVABLE` is a handler list (Setup and WizardGeneration handlers in all three hosts) | `apps/ptah-electron/src/di/expected-resolvable.ts:14-25`; `apps/ptah-extension-vscode/src/di/expected-resolvable.ts`; `apps/ptah-cli/src/di/expected-resolvable.ts` | Services injected into those handlers are proven transitively |
| Host RPC surface specs | `apps/ptah-electron/src/di/rpc-surface.spec.ts:30-56`; `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`; `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts:74-100` (partition + `CLI_EXPECTED_ABSENT_METHODS`) | Explicit new-method assertions per host |

## Architecture decision

- **Chosen approach.** Every write is guarded where the bytes are written, and decisions are bound
  on the server.
  1. Each write path compares the current bytes with a baseline recorded at preview/plan time:
     the wizard writer, the pack downloader, the reconciler, the repair route, the rebase route and
     the agent-source replace route. It writes only on an explicit, server-bound replace decision
     whose baseline still matches, or when the file is new or an unmodified managed copy.
  2. Previews and plans return opaque tokens and an opaque per-file revision. The server keeps the
     baselines and digests; the client only sends ids, decisions and the revision it saw.
  3. The harness root is resolved once at each RPC boundary, and the plugin config is read and
     written through one config home per harness root.
  4. In Electron, one user-layer pass returns a typed outcome to every request merged into its
     batch and broadcasts `library:changed`. Every other surface reacts to that signal.
  5. Provenance is computed when clones are listed. Plugin-sourced clones carry a durable
     `sourceRef` and the last known `sourceLabel` in their sidecar.
- **Rationale.** It satisfies U1/PM14 at the only places that cannot be bypassed and reuses the
  preview-required rejection, the consent-token pattern, the blocked-repair route, the coalesced
  pass, the push-message pattern and the rebase path. It needs no SQLite migration. RPC changes are
  additive optional fields, except D11's approved breaking CLI JSON change
  (`overwrittenLocalEdit` → `keptLocalEdit`).
- **Rejected alternatives.**
  - (a) Generate into a staging area first, then preview real diffs: doubles the run lifecycle and
    spends LLM cost before consent (D7 accepted the preview-before-run model).
  - (b) Guard only in the UI: stale tabs, retry/resume and the CLI bypass it.
  - (c) Guard owned-but-edited files per trigger: the next ordinary pass would overwrite (D8).
  - (d) Provenance in the SQLite catalog: needs a migration for data derivable at list time.
  - (e) Manifest ownership hash as the approval hash: it is the last-write hash, not the current
    content, so successive edits A → B are indistinguishable (finding 2).
  - (f) Gate plugin-agent mirroring on agent-sync consent: plugin agents would vanish from the
    Library in a fresh workspace (finding 4).
  - (g) Move (copy-and-delete) every folder's plugin config into a harness-root store, or union
    the lists: deletes stored data or silently changes enable/disable choices. D14 instead copies
    only when exactly one distinct saved config exists, keeps every folder record, and shows a
    notice with an explicit choice when configs differ (A27).
  - (h) Pick the config home from the set of registered folders (round-1 A27): the home moves when
    a sibling opens or closes or the repository root is opened, and a non-home sibling's saved
    choices silently stop applying (review R1-S1). Replaced by the stable harness-root record.
- **Effect on existing code.**
  - **Replaced:** `willOverwrite`-only preview semantics; the writer's "write when bytes differ"
    rule; `writeAgentsBatch`; the reconciler's rewrite of edited managed copies; the
    `overwrittenLocalEdit` field (D11); skills.sh's not-mirrored rule (A9); the pack downloader's
    existence-only cache short-circuit and its target-blind in-flight dedup; the coalescer's
    `Promise<void>` request result; the Library empty Agents string.
  - **Left alone:** rival-copy informational rows (PM1); consent token derivation; quarantine; the
    orphan reaper; the rebase handler's behaviour (extracted, not changed); the TUI.

## Resolved user decisions (D8-D11, D14, from decisions.md; applied unchanged)

| # | User answer | What the plan does |
| --- | --- | --- |
| D8 (was Q1) | Edited Ptah-managed copies are kept in every sync pass until the user picks "Review and replace". | A7 in B9: every pass, every target. Replace only through the digest-checked repair route (A21). |
| D9 (was Q2) | Pack install from the wizard grants agent-sync consent like a wizard run. | A14 in B8, on harness-root completion only. Plugin agents do not depend on it (A23). |
| D10 (was Q3) | Keep is the default everywhere on re-run; rows unchanged since the wizard wrote them say "Unchanged since the setup wizard wrote it". | B5 `unchangedSinceWizardWrite` from B4; F1 note; default stays Keep. |
| D11 (was Q4) | Breaking CLI JSON change approved: replace `overwrittenLocalEdit` with `keptLocalEdit`. | B16 (phase P1, one batch): the shared type change and every consumer — harness-sync producers and specs, rpc-handlers spec, marketplace source and specs, skill-synthesis-ui specs, the webview-e2e-harness fixture, shared specs, the `apps/ptah-cli` formatter and specs, and `apps/ptah-cli/docs/jsonrpc-schema.md`. Field rename only; B9 changes the keep semantics afterwards in P1. |

| D14 (Gate 2 peer) | A27 must not hide saved sibling sub-folder plugin config: presence-aware fallback / one-time import into the harness-root config, a visible notice when two configs conflict, a stable harness-root home; nothing stored is deleted. | A27 rewritten; B15 owns the home, import and conflict rule; B12 adds `plugins:resolve-config-home`; F7/F6 show the notice. |

D3 (Library desktop-only) and D7 (wizard preview cannot compare content) are applied as written.

## Decisions

Provenance: [user-requested] = task requirement or user answer; [user-decision Dn] = decisions.md;
[project-rule] = repository instruction or established pattern; [lane-proposed] = this plan's
mechanism choice. Status: **settled** = no open question; **settled (user)** = answered by the user.

| # | Decision | Options | Evidence | Provenance | Status | Reversible |
| - | --- | --- | --- | --- | --- | --- |
| A1 | Decisions are bound server-side to a preview token. Submit/retry/resume read decisions from the run manifest, never from a re-sent client list. | client-trusted; token-bound | stale-tab risk (task-description risk row 2); untabbed submit `wizard-rpc.service.ts:229-248` | [lane-proposed] safety elaboration of U1 | settled | yes |
| A2 | A preview token is required for any replace. No token (CLI, "Generate without preview") = create-only. | reject all; create-only | PM3; req 1.5-1.6 | [user-requested] PM3 | settled | yes |
| A3 | Wizard preview states `new`/`exists`/`unreadable`; diff unavailable on wizard rows; "Already current" is a run outcome. | stage first; per-state | `wizard-generation-rpc.handlers.ts:1223-1244` vs `orchestrator.service.ts:835-874` | [user-decision D7] | settled (user) | yes |
| A4 | A kept agent is not rendered (no LLM call); retry of a kept agent returns `kept`. | render then discard | req 1.3, 1.7 | [user-decision D7] | settled (user) | yes |
| A5 | "Changed since preview" = current hash ≠ baseline, or missing→present, checked immediately before the write. | mtime; lock | req 1.12, PM10 | [user-requested] PM10 | settled | yes |
| A6 | Unreadable (non-ENOENT read error) = forced keep in every family; the server rejects replace for it. | treat as absent | req 1.11, 8.5c | [user-requested] | settled | no (safety floor) |
| A7 | The reconciler keeps every owned-but-edited path in every pass and reports it in `keptLocalEdit`; replace goes through the repair route. | per-trigger keep; rewrite | NFR; `harness-propagation.service.ts:93-132` | [user-decision D8] | settled (user) | yes |
| A8 | Plugin agents mirror into the scoped user-layer agents root. On a slug collision the workspace `.claude/agents` agent wins; the plugin agent is shadowed (`conflictsWith`). Two plugins, one slug: first wins. | plugin wins; namespace | `user-layer-mirror.service.ts:1905-1915,2219-2233`; req 8.7 | [lane-proposed] collision rule; [user-requested] 8.3/8.7 | settled | yes |
| A9 | skills.sh roots join the mirror sources, so community skills become Library clones. | overlay-only | req 8.8; `skills-sh-source-root.ts:35-42` | [user-requested] 8.8 | settled | yes |
| A10 | Wizard origin in `{harnessRoot}/.ptah/setup-wizard/agent-origins.json`, written only on `written`, hash = `computeSourceHash`. A pack replace removes the entry. | sidecar field; catalog column | req 3.4, 3.9-3.11; `source-hash.ts:69-75` | [lane-proposed] storage; [user-requested] labels | settled | yes |
| A11 | Diverged reason derived: `setup-wizard` when `pendingSourceHash` equals the wizard's last hash; `plugin` when `pluginId` ≠ null; else `source-changed`. | stored field | `origin-sidecar.types.ts:128-151` | [lane-proposed] | settled | yes |
| A12 | One Electron signal `library:changed {workspaceRoot (harness root), status, reasons}`. VS Code/CLI never broadcast. | per-feature events; polling | D3; `boot-readiness-broadcaster.ts:40-67` | [user-decision D3]; [project-rule] push pattern | settled | yes |
| A13 | `plugins:save-config` keeps its awaited cheap reconcile and fires a non-awaited coalesced user-layer refresh. | remove skip flag; no refresh | `plugin-rpc.handlers.ts:386-393`; req 8.2 | [lane-proposed] | settled | yes |
| A14 | A harness-root pack install grants agent-sync consent like the wizard. | leave to wizard | `agent-sync-gate.ts:94-110`; req 3.2 | [user-decision D9] | settled (user) | yes |
| A15 | Pack flow: new read-only `wizard:plan-pack-install`; `wizard:install-pack-agents` gains optional `planToken`/`decisions`/`target`. | mode flag | mirrors `wizard:preview-generation`; `rpc-allowlist.spec.ts:134-152` | [lane-proposed] | settled | yes |
| A16 | Permission gate: unknown agent type, `Skill` disallowed, or skill disabled → not referenced. | relevance only | PM5, PM11; `subagent-tool-allowlist.ts:64-99` | [user-requested] 6.2/6.6, PM11 | settled | yes |
| A17 | New logic in new files beside the god files; host files only delegate. | grow in place | file sizes (1937, 2407, 1632, 1144, 1425 lines) | [project-rule] | settled | yes |
| A18 | Backend computes facts in every host; frontend hides Library copy outside Electron (`isElectron`). | backend host branching | `skill-clones-view.component.ts:528-529` | [project-rule] no host branching in libs | settled | yes |
| A19 | Delete `writeAgentsBatch` and `rollback`. | guard it | `file-writer.service.ts:112-181,244-255` | [project-rule] delete unused | settled | yes |
| A20 | CLI wizard runs are create-only (no token) and print kept files; no new flag. | `--replace` flag | Electron first; U1 | [project-rule] Electron first | settled | yes |
| A21 | **Approval digest.** Every local item offered for replace (consent plan, no-dialog kept report, pack plan) is recorded server-side with its current content digest (`hashFile` for files, `hashDir` for skill directories, the clone body digest for Library clones) and source identity. The client receives only an `approvalId`. Immediately before the mutation, under the same lock as the mutation, the digest is recomputed; any difference (edited again, deleted, recreated, now unreadable) → kept, `changed-since-approval`. The manifest ownership hash is never the approval hash. | manifest hash + state re-scan | finding 2; `blocked-repair.service.ts:199-229`; `content-hash.ts:126,299` | [user-requested] U1/8.5e; [lane-proposed] mechanism | settled | yes |
| A22 | **Pack installs always evaluate guards.** Incoming bytes come from the fresh plan record or a fresh download; the existence-only cache short-circuit is deleted. Network fetches may be deduplicated by URL; mutations are never shared: installs into one canonical target directory are serialized, each with its own guards and outcomes. | keep cache; key by target+decisions | finding 3; `agent-pack-download.service.ts:149-184,246-266,391-402` | [project-rule] concurrency safety; [user-requested] U1 | settled | yes |
| A23 | **Plugin-agent Library scope independent of consent.** `MirrorSources.libraryScopeRoot` (always the harness root) keys plugin-agent clones; `workspaceRoot`/`agentSourceDir` stay consent-gated for workspace `.claude/agents`. Rival fan-out of any agent stays gated by `buildAgents` (consent). No consent is granted by plugin installs. | gate on consent; grant consent | finding 4; `agent-sync-gate.ts:182-193`; `harness-manifest.builder.ts:567-574` | [user-requested] 8.3/8.8; [project-rule] consent boundary | settled | yes |
| A24 | **Typed batch outcome.** `createCoalescedJob<TPayload, TResult>`: `run` returns `TResult`; `request` returns `Promise<CoalescedOutcome<TResult>>` = `{kind:'ran', result} \| {kind:'skipped'} \| {kind:'threw'}`, the outcome of the exact batch the request joined. | last-result map | finding 5; `coalesced-job.ts:216-275` | [lane-proposed] | settled | yes |
| A25 | **Library pass after any successful harness-root pack completion** (≥ 1 file written, unchanged or kept); all-failed → no pass, `success:false`. | only after a write | finding 6; req 3.2 | [user-requested] 3.2 | settled | yes |
| A26 | **Baseline revision.** Each preview/plan row carries an opaque `revision` (HMAC of state+baseline with a per-process secret). The client carries Replace into a re-preview only when the row's revision is unchanged; a target change resets every choice. Submit/install sends the revision with each replace; the server rejects a replace whose revision ≠ the token's baseline revision (`preview-required`). | carry by state | finding 7; design 3.1 target-change reset | [user-requested] U1/1.12; [lane-proposed] mechanism | settled | yes |
| A27 | **Plugin config home (D14).** In a host with workspace-scoped storage and a harness-root resolver (Electron), the plugin config for harness root `R` lives in one stable record in global state storage, key `ptah.plugins.harnessConfig:<canonicalRootKey(R)>`. It does not depend on which folders are open. Every config read and write for `R` or for any folder whose harness root is `R` goes to that record: RPC get/save, external install/uninstall writes, the Electron mirror and reconciler readers, and session capability resolution. Folder records (`ptah.plugins.config` per opened folder) are legacy. They are never deleted or rewritten. **Import:** if the record is absent and the saved folder configs of `R` are all equal, copy that complete config once. **Conflict:** if two or more saved configs differ, import nothing and show a notice until the user picks one. Single-scope hosts (VS Code, CLI) are unchanged. Full rule in B15. | log-only home by folder set (R1); copy-and-delete; union of lists; home = repository folder only when open | finding 8, R1-S1, D14; req 8.1 (task-description.md:370-371); `plugin-loader.service.ts:791-808,856-870,922-972,1045-1099`; `workspace-aware-state-storage.ts:155-160,222-224`; `capability-resolver.service.ts:289-305,652` | [user-decision D14]; [user-requested] 8.1; [lane-proposed] record key and conflict rule | settled (user) | yes (additive record; folder records stay readable) |
| A28 | **Durable source identity.** The mirror stamps sidecar `sourceRef` (`ptah:<id>`, `external:<owner>/<repo>/<plugin>`, `skills-sh:<root dir>`, `harness:<dir>`) and `sourceLabel` (display name) on every create/reconcile while the source exists. The provenance resolver uses the live descriptor for `sourceRef`, else the sidecar `sourceLabel`, else `pluginId`. | live lookup + pluginId fallback | finding 9; req 8.8b; `external-plugin-id.ts:82-94`; `external-plugin-state.store.ts:56` | [user-requested] 8.8b; [lane-proposed] storage | settled | yes |
| A29 | Library/Marketplace agreement fixtures are pure DTO fixtures in `@ptah-extension/shared/testing` (`libs/shared/src/testing/fixtures/library-agreement.ts`). | webview-e2e-harness; duplicate per lib | finding 1; `tsconfig.base.json:235`; precedent `fixtures/dashboard-spec.ts` | [project-rule] module boundaries | settled | yes |
| A30 | No-dialog families replace kept items through a new `plugins:replace-kept-items {decisions: Record<approvalId, FileDecision>}`; the existing `harness:repairBlocked` keeps its contract (blocked paths only; client-supplied digests are stripped by its schema). | widen `harness:repairBlocked` | R1-3; clone and agent-source items are not harness paths | [lane-proposed] | settled | yes |
| A31 | Rubric agreement uses a pinned table in the spec (rule, title, body sha256, instruction sha256), independent of the rules module. Either side changing alone fails. | module-self comparison | finding 12; req 6.3 | [user-requested] 6.3; [lane-proposed] mechanism | settled | yes |
| A32 | Pack/plugin diff uses `@ptah-extension/git-ui/diff-renderer` by runtime `import()`, as `skill-synthesis-ui` does. | line-count summary | `lazy-diff-view.component.ts:165`; git-ui tags `scope:webview,type:feature` | [project-rule] reuse | settled | yes |
| A33 | **Registry entries travel with their handler.** A method added to `rpc.types.ts` (method map and true-map) lands in the same batch as the `METHODS` entry that claims it: `wizard:plan-pack-install` with B8 (P2), `plugins:replace-kept-items` and `plugins:resolve-config-home` with B12 (P3). B1 (P1) carries only DTO types. | all registry entries in B1 | `rpc-allowlist.spec.ts:63-64` (manifest claims every registry method exactly once) fails in P1 otherwise | [project-rule] each phase compiles and tests green | settled | yes |
| A34 | **No CLI JSON-RPC schema version bump for D11.** `harness.doctor` is not in the documented notification table (`apps/ptah-cli/docs/jsonrpc-schema.md:178-196`). B16 adds the row with `keptLocalEdit` and a "changed 2026-10" breaking note. `JSONRPC_SCHEMA_VERSION` stays `'0.2'` (`apps/ptah-cli/src/cli/jsonrpc/types.ts:32`). | bump to `0.3` or `1.0` per the doc's MAJOR rule (`jsonrpc-schema.md:69`) | D11 lists the type, consumers, formatter and docs, and does not list a version bump; the field was undocumented | [user-decision D11]; [lane-proposed] no bump | settled | yes (a one-line bump can follow if the orchestrator wants one) |

## Component specifications

Backend B1-B16, frontend F1-F8. Each "Files" list is complete for that component.

### B1. Shared contracts (libs/shared)

- Purpose: every new cross-process shape, defined once.
- Responsibilities:
  - **Preview and decision contracts** in new `libs/shared/src/lib/types/rpc/rpc-setup-decisions.types.ts`
    (re-exported where `rpc-setup.types.ts` is; that file is 654 lines, split by domain):
    - `LocalFileState = 'new' | 'exists' | 'unreadable'` (wizard).
    - `PackFileState = 'new' | 'identical' | 'differs' | 'unreadable'`.
    - `FileDecision = 'keep' | 'replace'`; `FileDecisionEntry = {decision: FileDecision; revision?: string}`.
    - `GenerationTargetChoice = 'harness-root' | 'opened-folder'`;
      `GenerationTargetInfo {harnessRoot; openedFolder; chosen; openedIsHarnessRoot}`.
    - `AgentModelPreview {value: string | null; origin: 'workspace' | 'machine' | 'template' | 'none'; ignoredOverride?}`.
    - `FileOutcome = 'written' | 'kept' | 'unchanged' | 'changed-since-preview' | 'failed'`.
    - `PackFilePlan {file; state; revision; incomingText?; localText?}`,
      `WizardPlanPackInstallParams {source; agentFiles; target?}` (one file or the whole pack),
      `WizardPlanPackInstallResult {planToken; target: GenerationTargetInfo; files: PackFilePlan[]}`.
  - **Additive optional fields:**
    - `WizardPreviewGenerationParams.target?`
    - `GenerationPreviewFile.localState?`, `.revision?` (claude target only)
    - `GenerationPreviewAgent.agentModel?`, `.libraryCopyEdited?`, `.unchangedSinceWizardWrite?`
    - `WizardPreviewGenerationResponse.previewToken?`, `.target?`, `.rivalStatus?: 'listed' | 'harness-unavailable' | 'cli-detection-failed' | 'opened-folder-elsewhere'` (R1-5)
    - `WizardSubmitSelectionParams.previewToken?`, `.fileDecisions?: Record<agentId, FileDecisionEntry>`, `.target?`
    - `WizardInstallPackAgentsParams.planToken?`, `.decisions?: Record<file, FileDecisionEntry>`, `.target?`
    - `WizardInstallPackAgentsResult.files?: {file, outcome}[]`, `.libraryPass?`
  - **Outcome union** extended in `wizard/phase.ts:205`, `rpc-setup.types.ts:319` and `:75-88`
    (`counts.kept`, `counts.changedSincePreview`).
  - **Result facts:** `SetupGenerationResultFacts.target?`, `.libraryPass?: 'updated' | 'failed' | 'not-applicable'`, `.libraryDiverged?: string[]`.
  - **Provenance** in new `libs/shared/src/lib/types/library-provenance.ts`:
    `LibraryProvenance`, `DivergedReason`, pure `provenanceLabel()`, `divergedReasonText()`,
    `orphanedText()` with the exact design-spec section 5 strings. `CloneSummary` gains
    `provenance?`, `divergedReason?`, `conflictsWith?`; `SkillSynthesisListClonesResult` gains
    `scopeRoot?` (the harness root the agent list used).
  - **Sidecar:** `OriginSidecarSchema` gains `sourceRef: z.string().optional()` and
    `sourceLabel: z.string().optional()` (A28). Optional; older files parse unchanged.
  - **Harness:** the `overwrittenLocalEdit` → `keptLocalEdit: string[]` rename (D11) is **not** in
    B1; it is B16, one batch with all its consumers. `HarnessRepairBlockedPath.expectedDigest?: string` (internal use, A21);
    `HarnessRepairPathResult.outcome` gains `'changed-since-approval'`.
  - **Marketplace contracts** (`rpc-plugin-marketplace.types.ts`):
    - `ExternalLocalItem {approvalId, target?, relPath, family, kind: 'unowned' | 'owned-edited' | 'library-clone' | 'agent-source' | 'unreadable', recordedVersion?}` (no digest, no hash).
    - `ExternalInstallPlan.localItems?`; `ExternalInstallParams.localItemDecisions?: Record<approvalId, FileDecision>`.
    - `ExternalInstallResult.kept?`, `.replaced?`, `.libraryPass?`.
    - `KeptItem {approvalId, family: 'external' | 'skills-sh' | 'plugin-enable' | 'plugin-agent', target?, relPath, reason: 'unowned' | 'owned-edited' | 'unreadable' | 'shadowed' | 'changed-since-approval'}`.
    - skills.sh install result (`rpc.types.ts:1501`) and `plugins:save-config` result
      (`rpc.types.ts:1281`): `kept?: KeptItem[]`, `libraryPass?`.
    - `PluginsReplaceKeptItemsParams {decisions: Record<approvalId, FileDecision>}`;
      `PluginsReplaceKeptItemsResult {replaced: KeptItem[]; kept: (KeptItem & {error?})[]; libraryPass}`.
    - `PluginInfo`: `agentCount?`, `skillNames?`, `agentNames?`, `commandNames?`.
  - **Plugin config home (D14, A27)** in `rpc-misc.types.ts` beside `PluginConfigState` (`:530`):
    - `PluginConfigHomeCandidate {folder: string; lastUpdated?: string; enabledCount: number;
      disabledCount: number; differsFromHome: boolean}`.
    - `PluginConfigHomeStatus {harnessRoot: string; state: 'home' | 'imported' | 'conflict' |
      'differs'; governingFolder?: string; candidates: PluginConfigHomeCandidate[]}`.
      `governingFolder` is set only in `conflict` (the interim source, B15).
    - `plugins:get-config` result becomes `PluginConfigState & {configHome?: PluginConfigHomeStatus}`
      (`rpc.types.ts:1277-1280`; additive, absent in VS Code/CLI and when nothing needs a notice).
    - `PluginsResolveConfigHomeParams {action: 'adopt' | 'dismiss'; folder: string}`;
      `PluginsResolveConfigHomeResult {configHome?: PluginConfigHomeStatus; libraryPass?}`.
  - **Messages:** `MESSAGE_TYPES.LIBRARY_CHANGED = 'library:changed'`, payload
    `{workspaceRoot: string; status: 'updated' | 'failed'; reasons: string[]}` in
    `message-constants.ts` and `payload-map.ts`.
  - **Registry entries are not in B1 (A33).** `wizard:plan-pack-install` goes in with B8;
    `plugins:replace-kept-items` and `plugins:resolve-config-home` go in with B12. Each is added to
    the `rpc.types.ts` method map (near :1096) and true-map (near :3163) in the same batch as its
    handler's `METHODS` (`rpc-allowlist.spec.ts:63-64`).
  - **Agreement fixtures (A29):** new `libs/shared/src/testing/fixtures/library-agreement.ts`,
    exported from `libs/shared/src/testing/index.ts`. Pure DTOs only (`CloneSummary`,
    `PluginInfo`, `SkillSynthesisListClonesResult`, harness health slices), no Angular, no
    Playwright: plugin with skills+agents; shadowed skill; shadowed agent; community skill;
    disabled plugin with edited clone (orphaned after disable); uninstalled plugin with edited
    clone (orphaned after uninstall, display name ≠ id); plugin-update diverged; two external
    plugins with one basename.
- Dependencies: none (type:util). The fixture file imports only shared types.
- Failure behaviour: types only; Zod schemas at each RPC boundary (B5, B8, B12).
- Quality: no `any`. All new fields optional (the D11 rename is B16).
- Verification seam: `library-provenance.spec.ts` (every variant); `index.spec.ts` of
  `shared/testing` covers the new export; `host-source-registry.contract.spec.ts` stays green;
  `rpc-setup-generation.contract.spec.ts` updated for the outcome union; an origin-sidecar parse
  spec case with and without the new fields.
- Files:
  - CREATE `libs/shared/src/lib/types/rpc/rpc-setup-decisions.types.ts`
  - CREATE `libs/shared/src/lib/types/library-provenance.ts` (+ `.spec.ts`)
  - CREATE `libs/shared/src/testing/fixtures/library-agreement.ts`
  - MODIFY `libs/shared/src/testing/index.ts`
  - MODIFY `libs/shared/src/lib/types/rpc/rpc-setup.types.ts`
  - MODIFY `libs/shared/src/lib/types/wizard/phase.ts`
  - MODIFY `libs/shared/src/lib/types/rpc/rpc-skill-clone.types.ts`
  - MODIFY `libs/shared/src/lib/types/origin-sidecar.types.ts`
  - MODIFY `libs/shared/src/lib/types/harness-sync.types.ts`
  - MODIFY `libs/shared/src/lib/types/rpc/rpc-plugin-marketplace.types.ts`
  - MODIFY `libs/shared/src/lib/types/rpc/rpc-misc.types.ts`
  - MODIFY `libs/shared/src/lib/types/rpc.types.ts`
  - MODIFY `libs/shared/src/lib/types/messages/message-constants.ts`
  - MODIFY `libs/shared/src/lib/types/messages/payload-map.ts`
  - MODIFY the shared index barrels that export these
  - MODIFY `libs/shared/src/lib/types/rpc/rpc-setup-generation.contract.spec.ts`

### B2. Guarded agent writer (agent-generation)

- Purpose: the only place a wizard (or agent-source replace) agent file is written.
- Responsibilities:
  - `writeAgent(agent, guard: AgentWriteGuard)`, with
    `AgentWriteGuard = {mode: 'replace-allowed'; baseline: {state: 'missing'} | {state: 'present'; hash: string}} | {mode: 'create-only'}`.
  - Read the target: `ENOENT` → absent; any other read error → `kept` (A6). Equal bytes →
    `unchanged`.
  - Create-only: absent → write → `written`; present → `kept`.
  - Replace-allowed: baseline `missing` + present → `changed-since-preview`; baseline `present` +
    current `hashContent` ≠ baseline → `changed-since-preview`; else write → `written`.
  - Delete `writeAgentsBatch` and `rollback` (A19).
- Verified contracts: `file-writer.service.ts:28-31,52-53,70-100,211-241`;
  `interfaces/agent-file-writer.interface.ts:31-94`; `hashContent` `content-hash.ts:121`.
- Dependencies: platform-core FS port; `hashContent` from `@ptah-extension/harness-sync` (existing
  edge, `orchestrator.service.ts:32`).
- Integration points: orchestrator (`orchestrator.service.ts:874`); B12 agent-source replace (A21).
- Failure behaviour: a write error is `Result.err` → `failed`, never kept or written (1.13).
- Verification seam: `file-writer.service.spec.ts`: differs, identical, missing, unreadable (EACCES),
  create-only present, missing→present, changed hash.
- Files:
  - MODIFY `libs/backend/agent-generation/src/lib/services/file-writer.service.ts` (+ spec)
  - MODIFY `libs/backend/agent-generation/src/lib/interfaces/agent-file-writer.interface.ts`

### B3. Orchestrator decisions, output root, model resolution (agent-generation)

- Purpose: run generation against a chosen output root with per-agent guards.
- Responsibilities:
  - `OrchestratorGenerationOptions` (`types/core.types.ts:593-608`) gains `outputRoot?` (default
    `workspacePath`), `fileGuards?: Record<agentId, AgentWriteGuard | {mode: 'keep'}>`,
    `onAgentWritten?` (B4 hook).
  - Output directory `{outputRoot}/.claude/agents` (`orchestrator.service.ts:420-424`); analysis
    keeps `workspacePath`.
  - A `keep` guard skips render and write (before `resolveAgentContent`, `:835`) and records `kept`.
    A missing guard = `create-only`.
  - Counts add `keptCount`, `changedSincePreviewCount`; the `successful === 0` error (`:477-479`)
    treats kept/changed-since-preview as non-failures.
  - Extract pure `resolveClaudeAgentModel(layers, templateId, templateModel)` into
    `services/agent-model-resolution.ts`, exported from the lib index.
- Verified contracts: `orchestrator.service.ts:291-530,747-903,1095-1147`;
  `agent-models.types.ts:82-200`.
- Dependencies: B2, B4.
- Failure behaviour: template failure stays `failed`; a kept agent is never `failed`.
- Verification seam: `orchestrator.service.spec.ts` (keep skips `generateContent`; outputRoot;
  all-kept → completed); new `agent-model-resolution.spec.ts` (workspace, machine, template, none,
  ignored `gpt-5`).
- Files:
  - MODIFY `libs/backend/agent-generation/src/lib/services/orchestrator.service.ts` (+ spec)
  - MODIFY `libs/backend/agent-generation/src/lib/types/core.types.ts`
  - CREATE `libs/backend/agent-generation/src/lib/services/agent-model-resolution.ts` (+ spec)
  - MODIFY `libs/backend/agent-generation/src/index.ts`

### B4. Wizard agent-origin store (agent-generation)

- Purpose: record "the wizard wrote this file" and the hash it wrote (3.4, 3.9-3.11, A11, D10).
- Responsibilities:
  - File `{harnessRoot}/.ptah/setup-wizard/agent-origins.json`,
    `{version: 1, agents: {[slug]: {hash, writtenAt}}}`, Zod-validated; corrupt/missing = empty
    with a warn.
  - API `recordWritten(harnessRoot, slug, hash)` (outcome `written` only), `forget(harnessRoot, slug)`
    (pack replace), `read(harnessRoot)`.
  - Atomic tmp+rename via the FS port (`managed-manifest.ts:177-203` pattern).
  - Hash = `computeSourceHash(file)` = `'sha256:' + hashFile` (`source-hash.ts:69-75`), the same
    function the mirror uses for `pendingSourceHash`. A-h is resolved by this citation; a spec
    still compares the store's hash with `reconcileFileClone`'s `pendingSourceHash` for the same
    bytes.
- Registration: token `AGENT_ORIGIN_STORE` in agent-generation `di/tokens.ts` (`Symbol.for`,
  `tokens.ts:4-18`), registered in `di/register.ts`. Resolution is proven transitively by the
  `WizardGenerationRpcHandlers` entry of all three `EXPECTED_RESOLVABLE` lists (B5 injects it).
- Failure behaviour: a failed `recordWritten` is logged and non-fatal; the label degrades to
  "Workspace file".
- Verification seam: store spec (corrupt, round-trip, forget, legacy unmarked → absent, hash equals
  the mirror's `pendingSourceHash`).
- Files:
  - CREATE `libs/backend/agent-generation/src/lib/services/wizard-agent-origin.store.ts` (+ spec)
  - MODIFY `libs/backend/agent-generation/src/lib/di/tokens.ts`
  - MODIFY `libs/backend/agent-generation/src/lib/di/register.ts`
  - MODIFY `libs/backend/agent-generation/src/index.ts`

### B5. Generation preview service (rpc-handlers)

- Purpose: build the preview and own the token record; extracted from the 1937-line handler.
- Responsibilities:
  - Move `previewRivals`/`previewAgent`/`previewFile`/`previewSignature` into
    `handlers/wizard-generation/generation-preview.service.ts` (`@injectable`).
  - **Target:** `harnessRoot = resolveHarnessWorkspaceRoot(opened)`, default `harness-root`;
    `opened-folder` offered only when different (`:1123-1124`).
  - **Rival status (R1-5):** `listed` (rows, no warning); `harness-unavailable` (`:1121`, no rows);
    `cli-detection-failed` (`:1176`, no rows); `opened-folder-elsewhere` (the sub-folder warning,
    `:1128-1130`, only when the chosen target is `opened-folder`). With the harness-root target the
    sub-folder case computes rival rows.
  - **Claude file state:** `ENOENT` → `new`; read OK → `exists`, baseline `hashContent`; other
    error → `unreadable`. `revision = HMAC(processSecret, state + hash)` (A26).
  - `relPath` stays relative to the opened folder; a harness-root path above it renders as `../…`;
    C5 shows the absolute target directory once (design 3.1 "Writing to").
  - **Model preview** via B3's function (template from `TEMPLATE_STORAGE_SERVICE`, layers from
    `AGENT_MODEL_SETTINGS.layersForPath(harnessRoot)`; failure omits `agentModel`).
  - **Library copy edited** via B10 `readCloneEditState('agent', slug, harnessRoot)`; omitted when
    the mirror is not registered.
  - **Unchanged since wizard write (D10)** from B4 hash vs current `computeSourceHash`.
  - **Token record:** `{key: tabKey | 'untabbed', canonicalWorkspace, target, agentIds, signature, baselines: Record<agentId, {state, hash?, revision}>}` in a bounded map of 64 (`:1085-1088`); a newer
    preview for the same key supersedes.
  - **`validateDecisions(token, key, workspace, agentIds, decisions)`** → `{ok, guards}` or
    `preview-required`: rejects an unknown/superseded token with any replace; replace on `new` or
    `unreadable`; replace whose `revision` ≠ the record's revision (A26); agentIds/target mismatch;
    a changed signature. Tab-bound non-resume submits keep the mandatory preview (`:480-501`).
- Registration: `container.registerSingleton(GenerationPreviewService)` in
  `register-shared-rpc-handlers.ts` (precedent :67-69); injected into
  `WizardGenerationRpcHandlers`, so all three hosts' smoke lists cover it.
- Dependencies: harness-sync, agent-generation (B3, B4, B10). Direction unchanged.
- Failure behaviour: per-file read errors → `unreadable`; rival failures keep today's warnings;
  validation failure is the existing `preview-required` rejection (`rpc-setup.types.ts:54-63`).
- Security: random `crypto.randomUUID` tokens; per-process HMAC secret for revisions; Zod
  (`WizardAgentIdSchema`, ≤ 200 entries).
- Verification seam: new `generation-preview.service.spec.ts` and
  `wizard-generation-rpc.handlers.spec.ts` (:2806, :655): states; harness-root default and
  opened-folder alternative; each of the four rival statuses (no rows for the two failure states;
  sub-folder warning only for opened-folder); stale token + replace → `preview-required`; no
  token → create-only; replace on unreadable → rejected; **exists(A) → exists(B) re-preview: new
  revision, old revision's replace rejected**; model origins;
  `wizard-generation.preview-fidelity.spec.ts` stays green.
- Files:
  - CREATE `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation/generation-preview.service.ts` (+ spec)
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts` (+ spec)
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.schema.ts` (+ spec)
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-binding.ts`
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation.preview-fidelity.spec.ts`
  - MODIFY `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`
  - Assumption A-dir: a `handlers/wizard-generation/` subfolder is acceptable; otherwise use the
    flat name `wizard-generation-preview.service.ts`. Check the lib index and neighbours.

### B6. Run manifest decisions, resume and retry (rpc-handlers + agent-generation types)

- Purpose: persist confirmed guards and target per run (1.7).
- Responsibilities:
  - `GenerationCheckpointManifest` (`generation-checkpoint.types.ts:23-49`, Zod `:182-237`) gains
    `target?`, `outputRoot?`, `fileGuards?: Record<agentId, {decision; baseline}>` and the new
    statuses.
  - `createFresh` (`wizard-generation-checkpoint.service.ts:136-178`) writes `outputDirectory` for
    the chosen root; `isTrusted` (`:296-303`) accepts outputDirectory inside
    `resolveHarnessWorkspaceRoot(workspaceRoot)` and refuses any other root.
  - `buildOptions` (`wizard-generation-rpc.handlers.ts:1641-1672`) passes `outputRoot`/`fileGuards`
    from the manifest only. `wizard:retry-item` (`:1368-1510`) applies the item's guard (kept →
    `kept`, no generation).
- Failure behaviour: a pre-change manifest (no `fileGuards`) resumes create-only.
- Verification seam: resume keeps kept files byte-identical; retry never replaces a kept file; a
  changed-content resume (file edited after confirm) → `changed-since-preview`; pre-change
  manifest → create-only; `isTrusted` accepts harness root, rejects sibling.
- Files:
  - MODIFY `libs/backend/agent-generation/src/lib/types/generation-checkpoint.types.ts`
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-checkpoint.service.ts` (+ spec)
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts`
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-run.supervisor.ts`, only if
    `afterSettled` (`:896`) builds the counts (check).

### B7. Post-run Library outcome (rpc-handlers)

- Purpose: fill `libraryPass`, `libraryDiverged`, counts and target.
- Responsibilities:
  - `propagateGeneratedAgents` (`:1769-1814`) calls B9 `propagateWithReport(harnessRoot)`.
    `libraryPass` = `updated` (`refreshed`) / `failed` (`failed`) / `not-applicable` (`skipped`, or
    target `opened-folder`).
  - Diverged list (4.3): for `written` agents only, clone `diverged` AND `pendingSourceHash` equals
    B4's hash. Kept agents are never listed (4.5).
  - Pure functions in `handlers/wizard-generation/generation-library-outcome.ts` (no DI).
- Verified contracts: `rpc-setup.types.ts:65-96`; `readCloneOrigin` (`user-layer-mirror.service.ts:513`).
- Failure behaviour: read failure → agent omitted with a warn; `libraryPass: 'failed'` never changes
  per-file outcomes (3.7).
- Verification seam: failed refresher after writes → outcomes intact + `failed`; skipped batch →
  `not-applicable` even when a previous batch succeeded (A24); kept agent never in the list.
- Files:
  - CREATE `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation/generation-library-outcome.ts` (+ spec)
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts`

### B8. Community pack plan and guarded install (platform-core + rpc-handlers)

- Purpose: the keep/replace contract for packs (1.8, 1.9, 1.12, 2.x, 3.2, 3.2a), on every pack path
  (R1-2).
- Responsibilities:
  - **Plan.** `AgentPackDownloadService.planDownload(manifestUrl, files, targetDir)` fetches into
    memory and returns per file `{file, state, baselineHash?, bytes}`; writes nothing. Validation
    and traversal checks as `agent-pack-download.service.ts:213-245,286-292`. `files` may be one
    file (per-file Install/Retry) or the whole pack.
  - **Install.** `installFiles(targetDir, items: {file, bytes, guard}[])` applies per file the B2
    rules re-implemented locally in platform-core (it cannot import agent-generation; the rules are
    small and specified once here): create-only default; replace only with matching baseline;
    unreadable → kept; equal bytes → `unchanged`. Returns per-file outcomes.
  - **Concurrency (A22).** Delete the existence-only cache short-circuit (`:246-266`) and the
    target-blind `inFlightPromises` mutation dedup (`:149-184,475-481`). Keep URL-keyed dedup only
    for network fetches (manifest and file bytes). Serialize `installFiles` per canonical
    `targetDir` with a per-key promise chain; each call evaluates its own guards. The fixed `.tmp`
    sibling (`:391-402`) is then never shared by two writers.
    - Assumption A-cache: the cache metadata (`getCacheEntry`, `loadCacheMetadata`) has no other
      reader. Check with `ptah_lsp_references`; delete it if unused, otherwise keep it as fetch
      metadata only.
  - **Plan RPC** `wizard:plan-pack-install {source, agentFiles, target?}` in a new
    `handlers/setup/pack-install.service.ts` (`@injectable`): curated allowlist and workspace
    authorization (`setup-rpc.handlers.ts:931-957`); target = harness root by default, or the
    opened folder; mints a `planToken` (bounded map of 64, single workspace) holding per-file
    bytes, baselines and revisions (A26). Bytes are bounded by the existing manifest file limits;
    `incomingText`/`localText` for the UI are capped at 256 KiB each.
  - **Install RPC** `wizard:install-pack-agents` accepts optional `planToken`, `decisions`, `target`:
    - no token → fetch fresh bytes, create-only;
    - replace requires a valid token, a `differs` baseline and the matching `revision`;
    - a token's bytes are used when the token is fresh; otherwise re-fetched with guards intact;
    - **harness-root completion with ≥ 1 non-failed file (A25)**: grant agent-sync consent (D9),
      `propagateWithReport(harnessRoot, 'wizard:install-pack-agents')`, return `libraryPass`;
      call B4 `forget` for each pack-written slug;
    - all files failed → `success:false`, no consent grant, no pass;
    - opened-folder target → no consent, no pass, `libraryPass: 'not-applicable'` (3.2a).
  - `setup-rpc.handlers.ts` (1425 lines) registers and delegates only.
- Registration (finding 10):
  - Add `'wizard:plan-pack-install'` to `SetupRpcHandlers.METHODS` (`setup-rpc.handlers.ts:91`)
    and register it in the handler's `register()`; the manifest picks it up (`manifest.ts:350`).
  - Registry entries (method map and true-map) in `rpc.types.ts` in this batch (A33), not B1.
  - `container.registerSingleton(PackInstallService)` in `register-shared-rpc-handlers.ts`.
  - `rpc-allowlist.spec.ts`: new describe block like :134-152 (in registry; owned by `setup` only;
    `wizard:` prefix).
  - Explicit `arrayContaining(['wizard:plan-pack-install'])` in `apps/ptah-electron/src/di/rpc-surface.spec.ts`,
    `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts` and
    `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts` (served in every host; the CLI
    partition test fails if it is neither registered nor listed absent).
  - Container smoke: covered by `SetupRpcHandlers` in all three `EXPECTED_RESOLVABLE` lists; no
    list change.
- Failure behaviour: fetch/download failure → that file `failed`, others proceed; RPC `success` is
  false only when every requested file failed; refresh failure after success →
  `libraryPass: 'failed'` (3.7).
- Security: allowlist and traversal unchanged; plan texts bounded; token random and server-held.
- Verification seam:
  - `agent-pack-download.service.spec.ts`: kept file never renamed over; changed-since-plan kept;
    unreadable kept; **cached pack + hand-edited local file: Keep leaves it byte-identical, Replace
    with a matching revision writes it**; **two concurrent installs of the same pack into different
    roots with different decisions each get their own outcomes**; two concurrent installs into one
    root are serialized; identical bytes → `unchanged`.
  - `pack-install.service.spec.ts` + `setup-rpc.handlers.spec.ts` (:1123): sub-folder default →
    harness root; opened-folder → no propagate, `not-applicable`; replace without token rejected;
    differs(A) → differs(B) revision mismatch rejected; **all-unchanged, all-kept and re-install
    completions run the pass and return `libraryPass`**; refresh failure → `failed` notice; all
    failed → no pass; single-file plan scope.
- Files:
  - MODIFY `libs/backend/platform-core/src/agent-pack-download.service.ts` (+ spec)
  - CREATE `libs/backend/rpc-handlers/src/lib/handlers/setup/pack-install.service.ts` (+ spec)
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.ts` (+ spec)
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.schema.ts` (+ spec)
  - MODIFY `libs/shared/src/lib/types/rpc.types.ts` (registry entries only, A33)
  - MODIFY `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`
  - MODIFY `libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts`
  - MODIFY `apps/ptah-electron/src/di/rpc-surface.spec.ts`
  - MODIFY `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`
  - MODIFY `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts`

### B9. Harness keep policy, scanner, digest-checked repair, propagation report (harness-sync)

- Purpose: protect edited managed copies everywhere (D8); give callers the user-layer outcome;
  make every replace check its approval digest.
- Responsibilities:
  - **Plans.** Claude target `planEntry` (`claude-target.ts:515-520`) and workspace target
    (`workspace-target.ts:530-539`): `actual !== null && actual !== owned.hash` → `keptLocalEdit`, not
    a write. The manifest keeps the old hash so later passes are stable. `localEdit` still lists it.
  - **Health:** `harness-health.ts:142` and the reconciler fill `keptLocalEdit` (field already
    renamed by B16) with kept paths instead of overwritten ones.
  - **Remove the dead overwrite branch** (`claude-target.ts:376-383`; `workspace-target.ts:925-973`).
    Assumption A-retire: `detachForOverwrite` has other callers; check with `ptah_lsp_references`.
  - **Destination scanner.** New `HarnessDestinationScanner.scan(harnessRoot, items: {kind: 'skill' | 'command' | 'agent'; slug}[])`
    → per detected target with the facet `{target, relPath, state: 'absent' | 'unowned' | 'owned-unmodified' | 'owned-edited' | 'unreadable', digest: string | null}`.
    `digest` is the current content digest (`hashFile` for a file, `hashDir` for a skill
    directory), never the manifest hash. Read-only; never throws.
    - Assumption A-paths: each target can derive the relPath for a skill/command slug the way
      `harnessAgentRelPath` does (`harness-sync.types.ts:436`); otherwise add one path function per
      target beside its planner. No duplicated layout strings.
  - **Digest-checked repair (A21).** `repair(cwd, consented)` accepts paths in
    `blocked ∪ keptLocalEdit` from a fresh verify. A `keptLocalEdit` path requires `expectedDigest`
    (refused otherwise). In `moveOccupants` (`blocked-repair.service.ts:199-229`), under the
    workspace lock and before `moveToQuarantine`, any path with `expectedDigest` is re-digested; a
    mismatch or `null` → outcome `changed-since-approval`, not moved. The quarantine/restore steps
    are unchanged.
  - **Port and propagation.** `IUserLayerRefresher.refresh` returns
    `Promise<'refreshed' | 'failed' | 'skipped'>`; `NO_USER_LAYER_REFRESH` → `'skipped'`.
    `propagateWithReport(cwd, reason, options)` → `{health, userLayer}`; `propagate` delegates and
    returns `.health`. New `refreshUserLayerInBackground(cwd, reason): void` (logs failures).
  - Register the scanner in `di/register.ts` with a token in `di/tokens.ts`.
- **Lands together with** the three host refresher adapters (B11 Electron, VS Code and CLI edits),
  because the port change compiles only with all three.
- Dependencies: shared types only.
- Failure behaviour: scanner never throws; propagation never throws (`:30`); repair keeps its
  per-path isolation.
- Verification seam: `harness-reconciler.local-edit-report.spec.ts`, `.foreign-edits.spec.ts`
  (edited copy byte-identical and listed; unmodified managed file still replaced);
  `workspace-target.overwrite-detach.spec.ts`; `blocked-repair.service.spec.ts` (kept-local-edit
  path without digest refused; with matching digest repaired; **edited A → edited B before repair
  → `changed-since-approval`**; deleted, recreated and now-unreadable → `changed-since-approval`);
  `harness-propagation.service.spec.ts` (report statuses); new `harness-destination-scanner.spec.ts`
  (rival-CLI fixture, directory digest, unreadable).
- Files:
  - MODIFY `libs/backend/harness-sync/src/lib/targets/claude-target.ts`
  - MODIFY `libs/backend/harness-sync/src/lib/targets/workspace-target.ts`
  - MODIFY `libs/backend/harness-sync/src/lib/targets/harness-target.port.ts`
  - MODIFY `libs/backend/harness-sync/src/lib/targets/mcp/mcp-facet-planner.ts`
  - MODIFY `libs/backend/harness-sync/src/lib/health/harness-health.ts`
  - MODIFY `libs/backend/harness-sync/src/lib/reconciler/harness-reconciler.service.ts`
  - MODIFY `libs/backend/harness-sync/src/lib/repair/blocked-repair.service.ts`
  - MODIFY `libs/backend/harness-sync/src/lib/sources/user-layer-refresher.port.ts`
  - MODIFY `libs/backend/harness-sync/src/lib/propagation/harness-propagation.service.ts`
  - CREATE `libs/backend/harness-sync/src/lib/health/harness-destination-scanner.ts` (+ spec)
  - MODIFY `libs/backend/harness-sync/src/lib/di/register.ts`, `di/tokens.ts`, `src/index.ts`
  - MODIFY the reconciler/target/repair/propagation specs named above
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.schema.ts` (strip
    `expectedDigest` from client input, A30)
  - The D11 field rename and every consumer are B16 (runs before B9 in P1). B9 changes only what
    the renamed field means (kept instead of overwritten) and the specs that assert it.
  - Assumption A-outcome: consumers of `HarnessRepairPathResult.outcome` (marketplace harness
    store/UI) handle the new outcome; check with `ptah_lsp_references` and render it as "Kept:
    changed since approval".

### B10. User-layer mirror: plugin agents, clone edit state, source identity, skills.sh sources (agent-generation + hosts)

- Purpose: plugin agents and community skills become Library clones (8.3, 8.8) without agent-sync
  consent; a read API for clone edits (4.2, 8.5d); durable source identity (8.8b).
- Responsibilities:
  - **`MirrorSources` gains** `libraryScopeRoot?: string` (A23) and
    `pluginDescriptors?: Record<pluginPath, {sourceRef: string; label: string}>` (A28).
  - **Plugin agents.** New collaborator `user-layer/user-layer-plugin-agents.ts`: for each plugin
    root (`allPluginRoots()`, `:376-378`) mirror `<plugin>/agents/*.md` into
    `getUserLayerRoots(libraryScopeRoot).agents` (`:332-343`).
    - Runs whenever `libraryScopeRoot` is set, independent of `workspaceRoot`/consent. Rival
      fan-out stays consent-gated by `buildAgents` (`harness-manifest.builder.ts:567-574`).
    - Create-if-absent with sidecar `pluginId = basename(pluginPath)`, `sourceRef`, `sourceLabel`.
    - Collision (A8): an existing clone owned by `pluginId:null` or another source → skip and
      record `conflictsWith` via `recordConflict` (`:2219-2233`).
    - Reconcile through `reconcileFileClone`, so edited clones diverge and unedited ones
      fast-forward.
    - `mirrorAll` (`:350-410`) and `reconcile` (`:531`) delegate in one line each.
  - **Source identity.** Every sidecar write for a plugin-sourced clone (skills, commands, agents)
    sets `sourceRef`/`sourceLabel` from `pluginDescriptors` when present and carries the existing
    values forward otherwise. The reaper's orphan path leaves them untouched.
    - Assumption A-sidecar: every sidecar write path spreads the existing sidecar. Check the
      writers (`writeSidecarAtomic` callers) and add the carry-forward where one rebuilds it.
  - **Clone edit state.** New `user-layer/user-layer-clone-state.ts`:
    `readCloneEditState(kind, slug, scopeRoot): Promise<{exists, edited, pluginId, sourceRef?, contentDigest} | null>`,
    `edited = hash(body) !== sidecar.sourceHash`; `contentDigest` is the approval digest for
    clones (A21). Exposed through the mirror facade.
  - **skills.sh roots in mirror sources** (A9): `discoverSkillsShPluginPaths()`
    (`plugin-loader.service.ts:1351`) added to `harnessPluginRoots` in each host's sources builder:
    Electron `plugin-activation.ts:299-308`; VS Code `apps/ptah-extension-vscode/src/activation/plugin-activation.ts`;
    CLI `harness-boot.ts:51-98`. Each host also sets `libraryScopeRoot =
    resolveHarnessWorkspaceRoot(workspace)` and `pluginDescriptors` from B15. Doc block
    `skills-sh-source-root.ts:35-42` updated.
    - Assumption A-reap: `reapDeletedUpstream` (`:677`) treats a vanished skills.sh root like a
      vanished harness root; check with a reap spec.
    - Assumption A-disabled: `disabledPluginIds` filtering applies to skills.sh roots as to harness
      roots; check how `harnessPluginRoots` is filtered.
- Dependencies: no new lib edges (descriptors are plain data supplied by hosts).
- Failure behaviour: per-file errors counted in `MirrorResult.errors`, never thrown.
- Verification seam:
  - New `user-layer-mirror.service.plugin-agents.spec.ts`: mirrored with `pluginId`, `sourceRef`,
    `sourceLabel`; **fresh workspace with no consent flag and explicitly disabled sync: plugin
    agents are still Library clones, and `buildAgents` still returns `[]`**; workspace collision;
    two-plugin collision; edited plugin-agent clone diverges on update; orphan after removal keeps
    `sourceLabel`.
  - New `user-layer-clone-state.spec.ts`.
  - `user-layer-mirror.service.reap.spec.ts`: skills.sh root case; orphan keeps source fields.
- Files:
  - CREATE `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-plugin-agents.ts` (+ spec)
  - CREATE `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-clone-state.ts` (+ spec)
  - MODIFY `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts`
  - MODIFY `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.reap.spec.ts`
  - MODIFY sidecar writers found by A-sidecar (inside `user-layer/`)
  - MODIFY `libs/backend/agent-generation/src/index.ts`
  - MODIFY `apps/ptah-electron/src/activation/plugin-activation.ts`
  - MODIFY `apps/ptah-extension-vscode/src/activation/plugin-activation.ts`
  - MODIFY `libs/backend/cli-engine/src/lib/bootstrap/harness-boot.ts`
  - MODIFY `libs/backend/rpc-handlers/src/lib/skills-sh/skills-sh-source-root.ts` (doc only)

### B11. Electron Library pass outcome and `library:changed` (apps/ptah-electron + host refreshers)

- Purpose: one Electron-only signal, and an outcome correlated to each request (A12, A24).
- Responsibilities:
  - **Coalescer (A24).** `createCoalescedJob<TPayload, TResult = void>`; `run` returns
    `Promise<TResult>`; `request` returns `Promise<CoalescedOutcome<TResult>>`:
    - admitted batch whose `run` resolved → `{kind:'ran', result}` for every request merged into it;
    - admission skip (`:233-235`) → `{kind:'skipped'}` for that batch only;
    - `run` threw → `{kind:'threw'}` (still reported through `onError`);
    - a request arriving while a pass runs joins the next batch (existing rule) and receives that
      batch's outcome, never an older one.
  - **Pass.** `mirrorUserLayer`, `reconcileUserLayer`, `syncSkillRegistryCatalog`
    (`plugin-activation.ts:332-474`) keep swallowing errors and return `'ok' | 'failed' | 'skipped'`.
    `runUserLayerPass` (`:492-509`) aggregates to `'updated' | 'failed'`, broadcasts
    `LIBRARY_CHANGED` with `resolveHarnessWorkspaceRoot(workspaceRoot)` (the same function B13 uses
    for `scopeRoot`) and returns the status. Broadcaster in new
    `activation/library-change-broadcaster.ts` (lazy `TOKENS.WEBVIEW_MANAGER`, `isRegistered`,
    `void`, catch; `boot-readiness-broadcaster.ts:40-67`).
  - `refreshUserLayer` returns `Promise<UserLayerPassOutcome>`; `createUserLayerRefresher`
    (`:556-568`) maps `ran:updated` → `refreshed`, `ran:failed`/`threw` → `failed`, `skipped` →
    `skipped`. Existing callers that ignore the result are unchanged.
  - **Config home in Electron (A27, D14):** `pluginLoader.initialize(pluginsPath,
    workspaceStateStorage)` (`plugin-activation.ts:246`) gains the B15 options
    `{harnessRootOf: (folder) => resolveHarnessWorkspaceRoot(folder), homeStorage:
    container.resolve(PLATFORM_TOKENS.STATE_STORAGE)}`. `resolveHarnessWorkspaceRoot` is
    `harness-sync/src/lib/workspace/workspace-root.ts:66`; Electron already depends on harness-sync.
    The mirror-source config reads (`plugin-activation.ts:252,297`) pass `libraryScopeRoot` (the
    harness root) instead of no root. The reconciler reader (`phase-2-libraries.ts:236-257`)
    already forwards `workspaceRoot` and needs no code change; B15 routes it. VS Code
    (`apps/ptah-extension-vscode/src/activation/plugin-activation.ts`) and CLI pass no options, so
    their single storage keeps answering every root.
  - VS Code and CLI refreshers return `refreshed`/`failed` from their own try/catch; they never
    broadcast.
- Failure behaviour: broadcast failure swallowed and logged; a failed pass still settles requesters.
- Verification seam:
  - `coalesced-job.spec.ts` (contract changes, update it): success → `ran`; **success then a
    skipped batch → the second request gets `skipped`, not the earlier success**; overlapping pass
    (request during a running pass gets the next batch's outcome); merged requests share one
    outcome; throw → `threw` + `onError`.
  - `plugin-activation.spec.ts`: step failure → refresher `failed` and broadcast `failed`; success
    → `updated`; mirror sources include `libraryScopeRoot` and descriptors.
  - New `library-change-broadcaster.spec.ts` (no WEBVIEW_MANAGER → no throw).
  - `plugin-activation.spec.ts`: `initialize` receives `harnessRootOf` and the global storage;
    mirror sources read config for `libraryScopeRoot`. A phase-2 reader case: sub-folder opened,
    harness root not registered → reader returns the harness-root home config (imported from that
    sub-folder on first read).
  - Electron `container.smoke.spec.ts` unchanged (no new DI token).
- Files:
  - MODIFY `apps/ptah-electron/src/activation/coalesced-job.ts` (+ spec)
  - MODIFY `apps/ptah-electron/src/activation/plugin-activation.ts` (+ spec)
  - CREATE `apps/ptah-electron/src/activation/library-change-broadcaster.ts` (+ spec)
  - MODIFY `apps/ptah-electron/src/di/phase-2-libraries.ts` (spec case only if the reader needs
    none; keep the forwarding comment accurate)
  - MODIFY `apps/ptah-extension-vscode/src/activation/plugin-activation.ts`
  - MODIFY `libs/backend/cli-engine/src/lib/bootstrap/harness-boot.ts`

### B12. Marketplace installer families: root, config home, guard, reporting (rpc-handlers + plugin-marketplace)

- Purpose: 8.1, 8.2, 8.5-8.5f, 8.6, 8.7, 8.10, 8.10a for every family.
- Destinations per family (enumerated; none excluded):

  | Family | Ptah-owned (not a local item) | Local-item destinations (guarded) |
  | --- | --- | --- |
  | External plugin | `~/.ptah/plugins/external/<owner>/<repo>/<plugin>` (`external-plugin-id.ts:82-94`); state `~/.ptah/plugins/external/.ptah-external.json` | user-layer clones `~/.ptah/user/{skills,commands}` and the scoped `agents/` (create-if-absent, edited → diverged); `{harnessRoot}/.claude/skills/<slug>`, `.claude/commands/*` (`claude-target.ts:68-69`); rival target skill/command/agent paths (`workspace-target.ts`); MCP config files written by reconcile (`external-plugin-mcp.service.ts:23-30`); `{harnessRoot}/.claude/agents/<slug>.md` when a workspace agent shadows a plugin agent (`agent-source`, R1-3) |
  | Community skill | `~/.ptah/plugins/ptah-skillssh-<owner>-<repo>/skills/<slug>` (`skills-sh-source-root.ts:58`); legacy adoption (`skills-sh-legacy-adoption.ts:98-178`, unchanged) | user-layer skill clone (A9); `.claude/skills/<slug>`; rival skill paths |
  | Ptah plugin enable | `~/.ptah/plugins/<id>` (bundled) | same as the external row for its skills/commands/agents |

  Guard: B9 keep (reconcile destinations), the mirror's create-if-absent/diverge rule (clones),
  unowned paths refused (`foreign`), and A21 digests for every replace.
- Responsibilities:
  - **Harness root and config home at the boundary (8.1, A27).** `reconcileHarness`
    (`plugin-rpc.handlers.ts:818-840`) and skills.sh `propagate` (`skills-sh-rpc.handlers.ts:439-450`)
    resolve `harnessRoot = resolveHarnessWorkspaceRoot(getWorkspaceRoot())`. Every plugin-config
    call passes `harnessRoot` and B15 routes it to the home (D14): `plugins:get-config`
    (`plugin-rpc.handlers.ts:250-255`), `plugins:save-config` (existing read `:340`, save `:376`),
    the external install write (`:756-761`) and the uninstall write (`:796-798`). Mirror (B10
    `libraryScopeRoot`), catalog (`plugin-activation.ts:397-401`) and reconcile all use
    `harnessRoot`.
  - **Config-home status and choice (D14).** `plugins:get-config` adds
    `configHome = pluginLoader.getConfigHomeStatus(harnessRoot)` to its result when that is not
    null. New `plugins:resolve-config-home {action, folder}` (Zod: `action` enum, `folder` a
    non-empty string). The server accepts `folder` only when it is one of
    `getConfigHomeStatus(harnessRoot).candidates[].folder`. Any other value →
    `RpcUserError('That folder has no saved plugin settings for this repository.')`; it is never used
    as a path. `adopt` → `pluginLoader.adoptFolderConfig(harnessRoot, folder)`, then the same awaited
    cheap reconcile and background refresh as save-config (A13). `dismiss` →
    `pluginLoader.dismissFolderConfig(harnessRoot, folder)`. Both return the new status.
    Registration matches `plugins:replace-kept-items`: `METHODS`, `register()`, the `rpc.types.ts`
    registry entries in this batch (A33), allowlist describe block, and the three
    `rpc-surface.spec.ts` assertions (or the CLI expected-absent list, per A-cli-plugins).
  - **Approval registry (A21).** New `handlers/marketplace/local-item-approvals.ts`
    (`@injectable`): bounded map (256 entries, oldest evicted) of `approvalId → {harnessRoot,
    family, kind, target?, relPath?, cloneKind?, slug?, sourceRef, digest: string | null, createdAt}`.
    Entries expire with the consent token (external) or after 30 minutes (kept reports). Never
    serialized to the client beyond `approvalId`.
  - **Consent plan.** In `buildConsentResponse` (`:728-742`), `localItems` from: B9 scanner over the
    plugin's skill/command/agent slugs (`unowned`, `owned-edited`, `unreadable`); Library clones of
    those slugs whose `sourceRef` matches this plugin and that have edits (B10, when the mirror is
    registered); workspace agents shadowing this plugin's agents (`agent-source`). Each item is
    registered for an `approvalId` with its digest. Assumption A-plan: the installer gains
    `attachLocalItems(token, items)` and `takePlan` returns them; collisions stay outside the token
    (`:226-229`).
  - **Confirm.** After `confirmInstall` + `activateExternalPlugin` succeed (`:753-781`), apply the
    replace decisions through `InstallLocalItemsService.apply(approvalIds)`:
    - file items → `HarnessBlockedRepairService.repair(harnessRoot, [{target, relPath, expectedDigest}])`;
    - clone items → `CloneRebaseService.rebase(kind, slug, {expectedDigest})`, extracted from
      `skillSynthesis:rebaseClone` (`skills-synthesis-rpc.handlers.ts:505-556`) into
      `handlers/skill-synthesis/clone-rebase.service.ts`, which re-digests the clone immediately
      before the rebase write (Assumption A-rebase-lock: check whether the rebase path holds a
      lock; if not, re-digest directly before its first write);
    - `agent-source` items → B2 `writeAgent` with `replace-allowed` and baseline = the approval
      digest (writes the plugin agent's bytes to `{harnessRoot}/.claude/agents/<slug>.md`);
    - unreadable or digest mismatch → kept with `changed-since-approval`; a route failure → kept
      with its error. Report `kept`/`replaced`/`collisions`/`libraryPass`.
  - **No-dialog families (R1-3, A30).** skills.sh install and `plugins:save-config` report
    `kept: KeptItem[]` = `blockedTargetPaths ∪ keptLocalEdit` from the returned health, filtered to
    the action's slugs by the scanner, each registered with a digest; plugin-agent mirroring
    reports `agent-source` shadow items. New RPC `plugins:replace-kept-items {decisions}` applies
    them through the same `apply` path (family-bound: an approvalId only replaces through its own
    family's route).
  - **save-config background refresh (A13):** add
    `refreshUserLayerInBackground(harnessRoot, 'plugins:save-config')`.
  - **Failure semantics (8.10, 8.10a):** a primary failure (`confirmInstall` throw, skills.sh
    `success:false`, uninstall error, config save throw) returns failure with the error, with no
    replace step and no kept report; existing cleanup stays (`external-plugin-installer.service.ts:292-297`);
    propagation/refresh failure after primary success → success + `libraryPass: 'failed'`.
- Registration (finding 10):
  - Add `'plugins:replace-kept-items'` to `PluginRpcHandlers.METHODS` (`plugin-rpc.handlers.ts:130`)
    and register it; the manifest picks it up (`manifest.ts:298`). Registry entries in
    `rpc.types.ts` in this batch (A33). Same for `'plugins:resolve-config-home'`.
  - `container.registerSingleton(LocalItemApprovals)`, `(InstallLocalItemsService)`,
    `(CloneRebaseService)` in `register-shared-rpc-handlers.ts`.
  - `rpc-allowlist.spec.ts`: describe block (registry; owned by the plugins entry only; `plugins:`
    prefix, `rpc-handler.ts:67`).
  - Explicit new-method assertion in the Electron and VS Code `rpc-surface.spec.ts`; in
    `cli-engine/.../rpc-surface.spec.ts` assert it is registered, or add it to
    `CLI_EXPECTED_ABSENT_METHODS` if `PluginRpcHandlers` is not in the CLI profile (Assumption
    A-cli-plugins: check `createCliRpcHostProfile`).
  - Container smoke: `PluginRpcHandlers` and `SkillsSynthesisRpcHandlers` are not in the
    handler-only `EXPECTED_RESOLVABLE` lists. Add a resolution assertion for each of them to the
    hosts' `container.smoke.spec.ts` beside the existing non-handler guards (Electron's begin at
    `expected-resolvable.ts:27`), only in hosts that register them (Assumption A-smoke: check
    each host's handler phase). This proves the new services resolve.
- Dependencies: rpc-handlers → harness-sync, agent-generation, plugin-marketplace, agent-sdk
  (existing edges).
- Security: decisions accept only server-issued approvalIds (Zod); repair receives only
  server-scanned paths and server-held digests; `harness:repairBlocked` strips client digests;
  MCP verbatim rendering unchanged.
- Verification seam: `plugin-rpc.handlers.spec.ts`, `skills-sh-rpc.handlers.spec.ts`,
  `external-plugin-installer.service.spec.ts`, new `install-local-items.service.spec.ts`,
  `local-item-approvals.spec.ts`, `clone-rebase.service.spec.ts`. Per family (external, skills.sh,
  plugin enable, plugin-agent):
  - unowned refusal; owned-but-edited kept byte-identical at a `.claude/skills` path and at a rival
    target path; unmodified managed file replaced;
  - consent replace → repair with the digest; edited clone replace → rebase after success only;
    agent-source replace → writer;
  - **file and clone: edited A at plan → edited B before confirm → kept `changed-since-approval`;
    deleted then recreated; unreadable after plan; edited while the install is in flight**;
  - failed write → failure, no report; failed removal; failed config save; failed refresh after
    success → `libraryPass: 'failed'`;
  - **sub-folder workspace: enable, disable and install write config to the harness-root home and
    the mirror, catalog and reconcile all use the same harness root** (8.1);
  - **config home (D14):** `get-config` returns `configHome` in conflict and absent when there is
    nothing to show; `resolve-config-home` adopt copies the chosen folder's full config and runs
    reconcile + background refresh; dismiss hides that folder's notice; an unknown folder or a
    path outside the candidates → `RpcUserError` and nothing written; adopt persistence failure →
    error, home unchanged;
  - save-config fires a background refresh;
  - `plugins:replace-kept-items` rejects an approvalId from another family.
- Files:
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts` (+ spec)
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.schema.ts`
  - MODIFY `libs/shared/src/lib/types/rpc.types.ts` (registry entries only, A33)
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/skills-sh-rpc.handlers.ts` (+ spec)
  - CREATE `libs/backend/rpc-handlers/src/lib/handlers/marketplace/local-item-approvals.ts` (+ spec)
  - CREATE `libs/backend/rpc-handlers/src/lib/handlers/marketplace/install-local-items.service.ts` (+ spec)
  - CREATE `libs/backend/rpc-handlers/src/lib/handlers/skill-synthesis/clone-rebase.service.ts` (+ spec)
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts`
  - MODIFY `libs/backend/plugin-marketplace/src/lib/install/external-plugin-installer.service.ts` (+ spec)
  - MODIFY `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`
  - MODIFY `libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts`
  - MODIFY `apps/ptah-electron/src/di/rpc-surface.spec.ts`, `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`,
    `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts`
  - MODIFY `apps/ptah-electron/src/di/container.smoke.spec.ts`, `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts`,
    `apps/ptah-cli/src/di/container.smoke.spec.ts` (per A-smoke)

### B13. Library provenance and scope (rpc-handlers)

- Purpose: `CloneSummary.provenance`, `divergedReason`, `conflictsWith`; agent scope = harness root
  (2.5); `scopeRoot` in the list result.
- Responsibilities:
  - New `handlers/skill-synthesis/clone-provenance.resolver.ts` (`@injectable`):
    - `sourceRef` `skills-sh:*` → `skills-sh` with the root's `.ptah-skillssh.json` source
      (`skills-sh-source-root.ts:61`) when present, else the sidecar `sourceLabel`;
    - other `sourceRef` → plugin label from B15's live descriptors, else the sidecar `sourceLabel`,
      else `pluginId` (A28). Two external plugins with one basename resolve by `sourceRef`, never
      by basename;
    - legacy sidecar without `sourceRef` (pre-change clone) → live descriptor by `pluginId` only
      when exactly one source matches, else `pluginId`;
    - `pluginId:null` agent in B4's store → `setup-wizard`; otherwise `workspace`.
  - Orphaned clones keep their former label from `sourceLabel` (8.8b).
  - Diverged reason per A11. `agentScope()` (`skills-synthesis-rpc.handlers.ts:1235-1245`) resolves
    `resolveHarnessWorkspaceRoot`; `toCloneSummary` (`:1172-1216`) fills the fields; the list result
    returns `scopeRoot`.
  - Assumption A-rows: `registry.listAll()` may return agent rows from other workspaces
    (`0022_skill_registry.ts:16`); if TASK_2026_662 did not scope it, filter agent rows to clones in
    the current scoped root inside the handler.
- Registration: `container.registerSingleton(CloneProvenanceResolver)` in
  `register-shared-rpc-handlers.ts`; resolution covered by B12's smoke assertion for
  `SkillsSynthesisRpcHandlers`.
- Failure behaviour: resolver failure → `provenance` omitted → "Workspace file" (3.9).
- Verification seam: resolver spec + `skills-synthesis-rpc.handlers.spec.ts`: legacy wizard file →
  workspace; wizard-written → setup-wizard; hand edit keeps setup-wizard; pack-kept → workspace;
  plugin and skills.sh labels; **uninstall of a plugin whose display name differs from its id
  keeps the display name**; **two external plugins with the same basename show their own names**;
  wizard vs plugin reason; sub-folder lists harness-root agents; `scopeRoot` equals the broadcast
  root for the same workspace.
- Files:
  - CREATE `libs/backend/rpc-handlers/src/lib/handlers/skill-synthesis/clone-provenance.resolver.ts` (+ spec)
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts` (+ spec)
  - MODIFY `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`

### B14. Generation prompt rubric alignment (agent-generation)

- Purpose: req 6.1-6.7 with a CI-enforced, two-sided agreement.
- Responsibilities:
  - **Rules module** `services/generation-prompt-rules.ts`:
    `GENERATION_RUBRIC_RULES: readonly {rule: 2 | 3 | 5 | 6 | 7 | 8; title; instruction}[]`.
  - **Prompt.** `content-generation.service.ts:370-392` appends a "RUBRIC RULES" block from the
    module; existing FORBIDDEN/REQUIRED text stays where it does not duplicate rule 7.
  - **Permission gate** `selectInvocablePluginSkills(agentType, skills, disabledSkillIds)`: unknown
    type or `Skill` disallowed → `[]` (PM11); otherwise minus disabled skills.
  - **Plugin-skill block** (`:397-404`): uses the gate; wording "Reference only skills relevant to
    this agent's role; every skill listed here is one this agent may invoke"; empty → no block.
    - Assumption A-type: `fillDynamicSections` (`:302-310`) can reach the template id; else pass it
      through `ContentGenerationSdkConfig`.
    - Assumption A-dis: `disabledSkillIds` reaches the generator through the sdk config. If it must
      be added in `wizard-generation-rpc.handlers.ts:1850-1868`, that edit belongs to the B5-B7
      batch owner (shared file), read from the B15 config home.
- Verification seam (A31):
  - `generation-prompt-rules.spec.ts` holds a **pinned table** `{rule, title, bodySha256, instructionSha256}`
    written by hand in the spec (not imported from the module). It asserts: each rubric heading
    exists with the pinned title and its whitespace-normalized body hashes to `bodySha256` (a
    rubric-only edit fails); each module `instruction` hashes to `instructionSha256` (a
    prompt-only edit fails); the built system prompt contains every module instruction verbatim
    (the builder cannot drop one). Changing either side requires a reviewed edit of the pinned
    table in the same change.
  - `invocable-plugin-skills.spec.ts`: unknown type → none; `Skill` disallowed → none; disabled
    skill excluded.
  - **6.7 representative case:** a fixture agent type that may not invoke `Skill`, with a plugin
    skill relevant to its role: (a) the built prompt contains no plugin-skill block and no mention
    of that skill; (b) the generation pipeline run with a stubbed LLM that returns representative
    content derived from the prompt's skill block produces output with no reference to that skill;
    (c) the authored fallback content for that template contains no reference to it. Limits
    stated in the spec: this proves Ptah never supplies the forbidden skill and that no
    deterministic step injects it; it does not prove an arbitrary LLM never invents a reference,
    and no output filter is added (6.4 keeps the validator unchanged).
  - Generated-output check over a representative stubbed response: no `TASK_\d{4}_\d+`, no date
    (6.5). `generated-section-validator` specs unchanged (6.4).
- Files:
  - CREATE `libs/backend/agent-generation/src/lib/services/generation-prompt-rules.ts` (+ spec)
  - CREATE `libs/backend/agent-generation/src/lib/services/invocable-plugin-skills.ts` (+ spec)
  - MODIFY `libs/backend/agent-generation/src/lib/services/content-generation.service.ts` (+ spec)
  - MODIFY `libs/backend/agent-generation/src/lib/services/subagent-tool-allowlist.ts` (export the
    has-type check if needed)

### B15. Plugin loader: harness-root config home (D14), source descriptors, plugin contents (agent-sdk)

- Purpose: one place that answers "where is this harness root's plugin config" (8.1, D14), "what
  is each plugin source called" (8.8b) and "what does it contain" (8.9).
- Responsibilities:
  - **Options.** `initialize(pluginsBasePath, workspaceState, options?: {harnessRootOf?: (folder:
    string) => string; homeStorage?: IStateStorage})` (`plugin-loader.service.ts:529`). The home
    is active only when `isWorkspaceScopedStateStorage(workspaceState)` is true and both options are
    given (Electron). Otherwise every method behaves exactly as today. `harnessRootOf` is injected
    so agent-sdk takes no harness-sync dependency.
  - **Routing (A27).** The private `storageFor(root?)` (`:791-808`) is the single lookup behind
    `getWorkspacePluginConfig` (`:856-870`), `readWorkspaceLayer` (`:922-972`),
    `saveWorkspacePluginConfig` (`:1045-1099`) and `hasWorkspaceState` (`:816-818`). When the home
    is active, the lookup first maps the request to a harness root:
    `R = harnessRootOf(root ?? workspace.getWorkspaceRoot())`, using the injected
    `IWorkspaceProvider` (`:513-514`) for a call without a root. It then answers with the
    **home view** of `R` below. The view is an `IStateStorage` adapter over the single key
    `ptah.plugins.config`: `get` returns the governing config, and `update` writes the home record
    (serialized). Any other key throws; `storageFor` serves only this key (`:857,923,1061`), so
    the three call sites stay unchanged. `hasWorkspaceState(x)` is true whenever `R` resolves. So the
    session resolver's `stateRootFor` (`capability-resolver.service.ts:289-305`) returns the
    harness root, and sessions read and toggle the same home as the Library and Marketplace. No
    code change is needed in cli-agent-runtime (Assumption A-session below).
  - **Home record.** Key `ptah.plugins.harnessConfig:<canonicalRootKey(R)>` (`:821-830`) in
    `homeStorage`. Value `{version: 1; harnessRoot; config: PluginConfigState; origin: 'saved' |
    'imported' | 'adopted'; sourceFolders: string[]; dismissed: Record<folderKey, string>}`.
    `dismissed` maps a folder to the legacy `lastUpdated` that the user dismissed.
  - **Legacy records.** The candidates of `R` are the registered folders
    (`getAllWorkspacePaths()`) with `canonicalRootKey(harnessRootOf(f)) === canonicalRootKey(R)`.
    This includes `R` itself when it is open. A candidate counts only when its folder storage has
    `ptah.plugins.config` **present**: `get` returns neither `undefined` nor `null`. A saved config
    whose lists are all empty is present; it is an intentional choice, not an absence. Legacy
    records are read only. Nothing in B15 writes or deletes them.
  - **Equality.** Compare `normalizeStoredConfig` output (`:876`) as sorted sets of the five
    lists. Absent `enabledSkillIds` equals `[]` (its documented meaning, `:880-905`).
    `lastUpdated` is ignored.
  - **Conflict rule (the home view of `R`):**
    1. Home record present → it governs. Each present candidate that is not equal to it and not
       dismissed at its current `lastUpdated` makes the state `differs`. Otherwise the state is
       `home`, or `imported` until the import notice is dismissed.
    2. Home absent, no present candidate → empty default (today's "nothing saved"). The first save
       creates the record (`origin: 'saved'`).
    3. Home absent, every present candidate equal → **import**. The read immediately returns that
       config, so effective behaviour is unchanged. One serialized write creates the record
       (`origin: 'imported'`, `sourceFolders` = those folders). The write runs only if the record
       is still absent, which makes it idempotent. State `imported` (one notice, dismissible).
    4. Home absent, two or more present candidates that differ → **conflict**. Nothing is
       imported or written. Reads use the candidate with the latest `lastUpdated`; a tie goes to
       the lowest folder key. This is `governingFolder`, shown in the notice. Every candidate stays
       recoverable through `adopt`. A save in this state creates the record from the submitted
       config (`origin: 'saved'`). The other candidates then show as `differs`; none is lost.
  - **Strict read.** `readWorkspaceLayer` applies the same view. A home record that is present
    and malformed → `status: 'error'` (policy unknown, as today for a bad folder record). In
    states 3 and 4 the chosen candidate's strict-read result is passed through.
  - `getConfigHomeStatus(root?): PluginConfigHomeStatus | null`. Null when the home is inactive,
    or when the state is `home` with nothing differing. Candidates carry `folder`, `lastUpdated`,
    counts and `differsFromHome`. Never a config body.
  - `adoptFolderConfig(R, folder)`: copy that candidate's full normalized config into the record
    (`origin: 'adopted'`, `sourceFolders: [folder]`), with no union. `dismissFolderConfig(R,
    folder)`: record `dismissed[folderKey] = candidate.lastUpdated ?? ''`. Both throw `SdkError`
    for a folder that is not a present candidate.
  - **Serialization.** Writes to one root's record (import, save, adopt, dismiss) are chained per
    record key in an in-process promise map. A save waits for a pending import. Reads are sync and
    never wait. `saveWorkspacePluginConfig` keeps its contract (`:1037-1043`): the target record is
    chosen once before anything is read, and the preserved lists come from that record.
  - `getPluginSourceDescriptors(): Record<pluginPath, {sourceRef, label}>` over bundled
    (`AVAILABLE_PLUGINS`, `ptah:<id>`), harness (`harness:<dir>`), skills.sh (`skills-sh:<dir>`, label
    from the same source as `PluginInfo.name`, `:589-613`) and external (`external:<record.pluginId>`,
    label = state record `displayName`) paths (`:1274-1286`).
  - `PluginInfo` gains `agentCount`, `skillNames`, `agentNames`, `commandNames` by directory listing
    where `skillCount`/`commandCount` are computed (A-info: locate with
    `ptah_code_search_symbols "skillCount"`; `:599-600` is one site).
- Verified contracts: `plugin-loader.service.ts:75,513-514,529-536,589-613,791-830,856-905,922-972,1037-1099,1274-1286`;
  `workspace-scoped-state-storage.interface.ts:30-68`; `state-storage.interface.ts:17-29`
  (`get`/`update`/`keys`); `capability-resolver.service.ts:254-305,652`.
- Assumptions:
  - A-session: the session resolver reads config on each resolve. It holds no cached copy beyond
    its fingerprint. Check `effectivePluginConfig` and `recordRoot` in
    `capability-resolver.service.ts`. If it caches, invalidate on the same save path.
  - A-global-sync: after `update` resolves, Electron's global `IStateStorage` `get` returns the
    new value synchronously. Check `platform-electron` state storage. If not, keep the last
    written record in memory per key.
- Dependencies: existing (`plugin-marketplace` state store, platform-core storage interfaces). No
  new project edge: `harnessRootOf` and `homeStorage` are passed in by the host.
- Failure behaviour: descriptor read failure → that path omitted (label degrades to `pluginId`).
  Import write failure → logged warn. The read still returns the sole candidate's config (the
  presence-aware fallback), so behaviour is unchanged. The import is retried on the next read and
  no `imported` state is reported. Save, adopt or dismiss persistence failure → `SdkError`
  (today's save contract); the record is unchanged. `harnessRootOf` throws → treated as `root`
  itself (never throws to readers). A malformed home record makes the strict read return
  `error`; the lenient read returns the empty default (as today, `:856-870`).
- Quality: no timer or watcher. The work per read is one global `get` plus one `get` per
  registered folder of `R`, which is bounded by the open folders.
- Verification seam: `plugin-loader.service.spec.ts` with a fake workspace-scoped storage, a fake
  global storage and a fake `harnessRootOf`:
  - home inactive (single-scope storage; no options) → today's results byte for byte;
  - sole legacy config in a sub-folder, empty home → read returns it; the record is written once
    (`imported`); a second read writes nothing (idempotent);
  - sub-folder holds an intentionally saved empty config → it is present, imported as empty, and
    not treated as absent;
  - home present and empty, sibling holds non-empty → home governs, state `differs`, sibling bytes
    unchanged;
  - **two sibling sub-folders `repo/a` and `repo/b` open at once with conflicting enable/disable
    lists** → state `conflict`; reads use the later `lastUpdated`; nothing is written; both records
    unchanged; `adopt('repo/b')` → home equals `b` exactly (no union); `a` then shows as
    `differs`; `dismiss('repo/a')` hides it until `a`'s `lastUpdated` changes;
  - transitions keep the home: change the active folder; open a lexically earlier sibling; close
    the folder that was imported; open the repository root itself. In each case the governing
    config is the same record;
  - a save in conflict creates the record from the payload; the other candidates stay `differs`;
  - import `update` rejects → read still returns the candidate; the next read retries; save
    `update` rejects → `SdkError`, record unchanged;
  - concurrent save during a pending import → serialized, save wins, no lost list;
  - nested repository (different `harnessRootOf`) is never a candidate;
  - `hasWorkspaceState(subFolder)` and `hasWorkspaceState(R)` are true when the home is active;
  - descriptors for all four families including two external plugins with one basename; agent
    counts and names.
  - Consumer agreement (in the B11/B12 specs and one `capability-resolver.service.spec.ts` case,
    cli-agent-runtime): config, mirror sources, catalog, reconcile reader and session resolution
    read the same config for `repo/a`, `repo/b` and `repo`. A toggle saved through the session
    resolver from `repo/a` is read back by `plugins:get-config` from `repo/b`.
- Files:
  - CREATE `libs/backend/agent-sdk/src/lib/helpers/plugin-config-home.ts` (+ spec):
    `PluginConfigHome` holds the home record, the candidate scan, equality, the conflict rule,
    import/adopt/dismiss and per-key serialization. It is a plain class built by the loader in
    `initialize` when the home is active, not a DI service. The loader file is 1736 lines (A17).
  - MODIFY `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts` (+ spec): options,
    the routing branch in `storageFor`/`hasWorkspaceState`, delegating methods, and
    descriptors/contents.
  - MODIFY `libs/backend/cli-agent-runtime/src/lib/capabilities/capability-resolver.service.spec.ts`
    (agreement case only; no production change unless A-session fails)

### B16. D11 field rename, all consumers in one batch (shared + every consumer project)

- Purpose: D11 (`decisions.md:14`). Replace `overwrittenLocalEdit` with `keptLocalEdit` in the
  shared type and in every consumer at the same time, so every phase compiles and the CLI never
  emits an obsolete count. This batch renames only. It does not change what the producers do;
  B9 changes the semantics later in P1.
- Responsibilities:
  - `HarnessTargetHealth.keptLocalEdit: string[]` replaces `overwrittenLocalEdit`
    (`libs/shared/src/lib/types/harness-sync.types.ts:147`; doc reference `:178`), and the harness
    port result (`harness-target.port.ts:169`).
  - Producers rename the field: `claude-target.ts:326,382`, `workspace-target.ts:256,965`,
    `mcp/mcp-facet-planner.ts:185`, `harness-health.ts:42,74,117`,
    `harness-reconciler.service.ts:329,626`.
  - `apps/ptah-cli/src/cli/output/formatter.ts`: `countField(target, 'keptLocalEdit')` (`:521`).
    The column header `'overwritten'` becomes `'kept'` (`HARNESS_DOCTOR_COLUMNS`, `:156-168`), and
    the doc comment at `:483` is updated. Today this reads through an untyped record, so it
    compiles either way. That is why it has to be in this batch.
  - `apps/ptah-cli/docs/jsonrpc-schema.md` section 1.5 (`:178-196`): add the `harness.doctor` row
    (`ptah harness doctor [--fix]`, payload `{ health: { targets: [{ target, ..., keptLocalEdit:
    string[] }] }, summary }`). Add a note: "Breaking (2026-10): `overwrittenLocalEdit` was
    renamed to `keptLocalEdit`. Ptah now keeps edited managed copies instead of overwriting them."
    No schema version bump (A34).
  - Typed fixtures and specs: rename the field in every file listed below. Test names that say
    "overwrites … reports overwrittenLocalEdit" keep their assertions on the renamed field; B9
    rewrites them for the keep policy.
- Verified contracts: repository search for `overwrittenLocalEdit` outside `.ptah` (2026-10-25)
  returns exactly the 40 code files below; the doc is the 41st edit and has no hit today. There
  are no hits in `apps/ptah-tui`,
  `apps/ptah-extension-vscode` or `apps/ptah-electron`.
- Dependencies: none new.
- Failure behaviour: not applicable (rename). The approved break is the JSON field name.
- Verification seam: a repository search for `overwrittenLocalEdit` outside `.ptah` returns
  nothing. `formatter.spec.ts` asserts the `kept` column, and a `harness.doctor` JSON line carries
  `keptLocalEdit`. All listed projects pass verify.
- Files (all MODIFY):
  - shared: `libs/shared/src/lib/types/harness-sync.types.ts`, `harness-sync.types.spec.ts`,
    `harness-sync.blocked.spec.ts`, `capability-id-codec.spec.ts` (all under
    `libs/shared/src/lib/types/`)
  - harness-sync (`libs/backend/harness-sync/src/lib/`): `health/harness-health.ts`;
    `targets/claude-target.ts`, `targets/harness-target.port.ts`, `targets/workspace-target.ts`,
    `targets/mcp/mcp-facet-planner.ts`; `reconciler/harness-reconciler.service.ts`; specs
    `targets/rival-targets.agent-model.spec.ts`, `targets/workspace-target.overwrite-detach.spec.ts`,
    `reconciler/harness-reconciler.{cancellation,capability-policy,foreign-edits,idempotency-removal,local-edit-report,manifest-recovery,verify-agreement,write-failure}.spec.ts`
  - rpc-handlers: `libs/backend/rpc-handlers/src/lib/harness/health/harness-health-rpc.service.spec.ts`
  - marketplace (`libs/frontend/marketplace/src/lib/`): `data/attention.ts`, `data/attention.spec.ts`,
    `data/coverage.spec.ts`, `harness/harness-health.model.ts`,
    `harness/harness-target-row.component.ts`, `harness/harness-blocked-paths.spec.ts`,
    `harness/harness-health-badge.component.spec.ts`, `harness/harness-health.store.spec.ts`,
    `harness/harness-repair-dialog.spec.ts`, `pages/overview/overview-kpis.spec.ts`,
    `pages/overview/overview-page.component.spec.ts`, `pages/skills/skill-detail.component.spec.ts`
  - skill-synthesis-ui (`libs/frontend/skill-synthesis-ui/src/lib/components/clones/`):
    `agent-sync-chips.spec.ts`, `reconcile-guard.spec.ts`, `skill-clones-view.component.spec.ts`
  - webview-e2e-harness: `libs/frontend/webview-e2e-harness/src/lib/scenarios/marketplace/marketplace.fixtures.ts`
  - ptah-cli: `apps/ptah-cli/src/cli/output/formatter.ts`, `formatter.spec.ts`,
    `apps/ptah-cli/src/cli/commands/harness.spec.ts`, `apps/ptah-cli/docs/jsonrpc-schema.md`

### F1. Setup-wizard decision components (setup-wizard)

- Purpose: one implementation of C1-C6 for both previews and the pack prompt.
- Responsibilities:
  - Standalone OnPush components with signal inputs/outputs: `KeepReplaceControlComponent` (C1:
    radiogroup of two `<button role=radio>`, roving tabindex, arrows/Space/Enter, path in the
    accessible name, `forcedKeep` → Replace `aria-disabled`, `tabindex=-1`);
    `FileDecisionRowComponent` (C2); `DiffDisclosureComponent` (C3: `unavailable` for wizard rows;
    for packs, `@ptah-extension/git-ui/diff-renderer` via runtime `import()` (A32), with diff colours
    `bg-success/15`/`bg-error/15`); `BulkDecisionBarComponent` (C4, skips forced-keep);
    `TargetRootChoiceComponent` (C5, button cards in the trap); `ModelOriginNoteComponent` (C6,
    `isElectron` input).
  - Pure `preview-decisions.state.ts`:
    - builds rows from the preview/plan DTO; every row starts on Keep (both surfaces, R1-4);
    - carries a Replace into a re-preview only when the row's `revision` is unchanged (A26); a
      target change resets every row to Keep and sets the "Target changed…" status line;
    - computes the summary and the confirm label (design section 5 templates, including
      "Confirm and generate");
    - sends `{decision, revision}` for each replace;
    - builds the shared targets-changed signature (replaces `agent-selection.component.ts:1038-1045`
      and `agent-selection-list.component.ts:350-360`).
  - Focus ring: 2px `base-content` outline outside the segment, 2px offset.
  - Copy from design section 5; provenance/diverged strings from B1.
- Verified contracts: dialog trap `agent-preview-dialog.component.ts:126-145` (needs
  `:not([hidden] *)` per design 3.1); warning fill `agent-selection.component.ts:497-499`.
- Dependencies: `@ptah-extension/shared`, `@ptah-extension/core`, `@ptah-extension/git-ui/diff-renderer`
  (lazy; see acyclicity table).
- Failure behaviour: unknown state → forced keep; diff renderer load failure → the "unavailable"
  state.
- Verification seam: component specs (keyboard, forced keep, aria names, bulk skips forced);
  `preview-decisions.state.spec.ts`: default Keep; **exists(A) → exists(B) re-preview resets
  Replace to Keep**; same revision keeps Replace; target change resets all; pack differs(A) →
  differs(B) resets.
- Files: CREATE under `libs/frontend/setup-wizard/src/lib/components/preview-decisions/`:
  `keep-replace-control.component.ts`, `file-decision-row.component.ts`,
  `diff-disclosure.component.ts`, `bulk-decision-bar.component.ts`,
  `target-root-choice.component.ts`, `model-origin-note.component.ts`, `preview-decisions.state.ts`,
  and a spec for each. MODIFY `libs/frontend/setup-wizard/jest.config.ts` only if the lazy import
  needs a `moduleNameMapper` mock (precedent `skill-synthesis-ui/src/__mocks__/ptah-git-ui-diff-renderer.ts`).

### F2. Wizard-view preview modal (setup-wizard)

- Purpose: 1.1-1.6, 1.14, 2.2-2.3, 4.2, 5.1-5.5 in the wizard view.
- Responsibilities: extract the modal body (`agent-selection.component.ts:470-600`, logic
  `:1001-1060`) into `generation-preview-modal.component.ts` using F1; keep every parity behaviour
  (Generate disable rules, "Checking generation targets...", targets-changed alert, "Generate
  without preview", warning banners, conditional rows, Cancel dropping replies, warning fill);
  render the four rival statuses (R1-5); send `target` with the preview and
  `previewToken + fileDecisions + target` with submit; "Generate without preview" sends no token.
- Verification seam: `agent-selection.component.spec.ts` keeps passing; new modal spec for
  1.1-1.4, 1.6, 2.3, the R1-5 states and the exists(A) → exists(B) reset.
- Files:
  - CREATE `libs/frontend/setup-wizard/src/lib/components/generation-preview-modal.component.ts` (+ spec)
  - MODIFY `libs/frontend/setup-wizard/src/lib/components/agent-selection.component.ts` (+ spec)
  - MODIFY `libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.ts` (+ spec)

### F3. Sidebar preview dialog (setup-wizard)

- Purpose: the same requirements in the generation sidebar.
- Responsibilities: `agent-preview-dialog.component.ts` renders F1 rows (all starting on Keep,
  R1-4), the Target line with "Change" revealing C5 (`aria-expanded`/`aria-controls`), the
  "Writing model" label and the R1-5 states; `agent-selection-list.component.ts` keeps its sequence
  guard and preview-required reopen (`:307-348`) and passes token, decisions and target;
  `generation-workflow.store.ts:96-129` and `wizard-rpc.service.ts:121-149` gain the optional
  params; source status and model picker untouched.
- Verification seam: `agent-preview-dialog.component.spec.ts` (initial Keep, keyboard reach,
  warnings), `agent-selection-list.component.spec.ts`, `generation-agent-sidebar.component.spec.ts`.
- Files:
  - MODIFY `libs/frontend/setup-wizard/src/lib/components/agent-preview-dialog.component.ts` (+ spec)
  - MODIFY `libs/frontend/setup-wizard/src/lib/components/agent-selection-list.component.ts` (+ spec)
  - MODIFY `libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.ts` (+ spec)

### F4. Pack install prompt (setup-wizard)

- Purpose: 1.8, 1.9, 2.x, 3.2a on every pack path (R1-2).
- Responsibilities:
  - New `PackInstallPromptComponent` with `scope: 'pack' | 'file'`: title and scope line per design;
    C5 always shown; "Writing to"; conflicts branch (C4 + C2 rows "Differs from local file",
    "Replace with pack version", working diff, forced keep for unreadable, "N other files are
    new…") or the no-conflict branch; confirm "Install pack" / "Install pack, replace N file(s)".
  - Opened from every entry: wizard Install All, Choose location, per-file Install and Retry;
    sidebar Change, Install All and Retry. Flow: `planPackInstall(scope files)` → prompt →
    `installPackAgents(token, decisions, target)`. A target change re-plans and resets to Keep.
  - Results: Installed/Kept/Failed counters; Kept rows say "Kept" with the design note; Retry never
    replaces a kept file; opened-folder completion notice per host.
  - Hosts: `agent-selection.component.ts:838-960` and `community-packs-panel.component.ts:120-164`.
    `wizard-rpc.service.ts:635-655` gains `planPackInstall` and the new params.
- Verification seam: prompt spec (scope pack/file, both branches, target change reset); both host
  specs (every entry opens the prompt, kept row, per-host notice).
- Files:
  - CREATE `libs/frontend/setup-wizard/src/lib/components/pack-install-prompt.component.ts` (+ spec)
  - MODIFY `libs/frontend/setup-wizard/src/lib/components/community-packs-panel.component.ts` (+ spec)
  - MODIFY `libs/frontend/setup-wizard/src/lib/components/agent-selection.component.ts`
  - MODIFY `libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.ts`

### F5. Completion surfaces (setup-wizard)

- Purpose: 1.3, 1.13, 3.7, 4.3, 7.1-7.3, review F8.
- Responsibilities: shared `OutcomeSummaryComponent` (C9), `LibraryStaleNoticeComponent` (C10),
  `GradeExpectationComponent` (C11) used by `completion.component.ts` (`:28`, `:160-200`, `:424`)
  and `agent-next-steps.component.ts`; Electron-only items gated on `isElectron` AND
  `target === 'harness-root'`; all-kept state per design 3.9.
- Verification seam: counts equal rows; no grade copy in VS Code or for opened-folder; all-kept text;
  kept agent never in the diverged list; failed distinct; stale notice only for
  `libraryPass === 'failed'`.
- Files:
  - CREATE `libs/frontend/setup-wizard/src/lib/components/completion/outcome-summary.component.ts`,
    `library-stale-notice.component.ts`, `grade-expectation.component.ts` (+ a spec each)
  - MODIFY `libs/frontend/setup-wizard/src/lib/components/completion.component.ts` (+ spec)
  - MODIFY `libs/frontend/setup-wizard/src/lib/components/agent-next-steps.component.ts` (+ spec)

### F6. Library UI (skill-synthesis-ui)

- Purpose: 3.3-3.6, 4.4, 5.4, 8.2a, 8.2b, 8.3, 8.4, 8.8b.
- Responsibilities:
  - `ProvenanceBadgeComponent` (C7) first in the card meta row and in the drawer, text from
    `provenanceLabel`; `DivergedReasonComponent` (C8) in card and drawer
    (`clone-detail-drawer.component.ts:243-277`).
  - Empty Agents copy (`skill-clones-view.component.ts:137`) and "Open setup wizard".
    Assumption A-nav: launch via `setup-wizard:launch` (`wizard-rpc.service.ts:195`) or a route;
    check how the Library opens other surfaces.
  - `SkillClonesStateService` (`:69-84`): subscribes to `LibraryChangeFeed` (F7d) and refreshes
    the current workspace's list on every signal (out-of-order replies dropped by a request epoch,
    8.2b; the view's workspace-switch effect `:511-525` also refreshes); the "Library updated: …"
    toast comes from the added-clone diff of the current list only; the C10 failure notice is
    shown only when the message's `workspaceRoot` equals the last list `scopeRoot` (B13).
  - Model editor helper text (`agent-model-editor.component.ts`, `aria-describedby`, 5.4).
  - **Plugin settings pointer (D14).** When `PluginCatalogService.configHome` (core, F7i) is in
    `conflict` or `differs`, the Library header shows one `role=status` line, Electron only: "This
    repository has plugin settings that need a choice. Open Skills & Plugins". The link uses the
    same navigation as A-nav. It is hidden otherwise. The choice itself is made only in the
    Marketplace (F7i).
  - Card hint no longer says "no upstream source" when provenance exists. Assumption A-hint:
    `hasUpstreamSource` gating (`clone-action-gating.ts:102-104`) unchanged.
- Verification seam: card, drawer, view (empty copy, workspace-switch refresh), state service (feed
  refresh, stale reply discarded, other-root failure notice suppressed, out-of-order replies),
  model editor, `clone-action-gating.spec.ts` (orphan with former label); view spec: the
  plugin-settings pointer is shown for `conflict`/`differs` and hidden for null; agreement specs import
  `@ptah-extension/shared/testing` fixtures (A29).
- Files:
  - CREATE `libs/frontend/skill-synthesis-ui/src/lib/components/clones/provenance-badge.component.ts` (+ spec)
  - CREATE `libs/frontend/skill-synthesis-ui/src/lib/components/clones/diverged-reason.component.ts` (+ spec)
  - MODIFY `clone-card.component.ts`, `clone-detail-drawer.component.ts`,
    `skill-clones-view.component.ts`, `agent-model-editor.component.ts` (each + spec) under
    `libs/frontend/skill-synthesis-ui/src/lib/components/clones/`
  - MODIFY `libs/frontend/skill-synthesis-ui/src/lib/services/skill-clones-state.service.ts` (+ spec)
  - MODIFY `libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-action-gating.spec.ts`

### F7. Marketplace UI (marketplace)

- Purpose: 8.4-8.12 in the Marketplace, and the change feed.
- Responsibilities:
  - **(a) Consent dialog** (`external-consent-dialog.component.ts`): "Local files this install
    would replace (N)" after the shadowed block, rows with the four reasons + "Edited Library copy"
    ("Replace (rebase)"/"Keep my copy") + agent-source rows; forced keep for unreadable; re-approval
    resets to Keep; label suffix only when N > 0; `confirmed` emits decisions keyed by `approvalId`;
    every existing block stays; modal keyboard trap. The control is a marketplace-local copy of C1
    (Assumption A-share: move to `@ptah-extension/ui` at a third use).
  - **(b) Install report** (`external-install-report.component.ts`): Written/Kept/Shadowed/Skipped
    counters; named shadowed and skipped lists kept; "Kept (your files were not changed)" with
    reasons incl. "Kept: changed since approval"; "Review and replace…" opens (h); C10 in Electron.
  - **(c) Installed view** (`installed-skill-rows.ts`, `installed-skills-page.component.ts`,
    `skill-detail.component.ts`): provenance badge; "N skills · M commands · K agents" + names;
    shadowed/kept notes; orphaned line; C10; **inspector facts follow the selected row**
    (description, kind, source, version, provenance, contents, names, kept note, sync line, action;
    R1-1); **search matches when every query word appears in name, description, source or kind**
    (R1-1; Assumption A-search: today's matcher in `installed-skill-rows.ts:152-193` — extend it,
    keep the existing search parity row green); every existing group/state unchanged.
  - **(d) `LibraryChangeFeed`** in `libs/frontend/marketplace/src/lib/services/`, exported from
    `@ptah-extension/marketplace/services`; `MessageHandler` for `library:changed`, signal
    `{workspaceRoot, status, reasons, at}`, `providedIn: 'root'`; registered in
    `apps/ptah-extension-webview/src/app/app.config.ts` next to `:403-407`. Inert in VS Code (D3).
  - **(e) Agreement fixtures** come from `@ptah-extension/shared/testing` (A29). No import of
    `webview-e2e-harness`.
  - **(f) Agent shadow state in Electron:** join plugin `agentNames` with `skillSynthesis:listClones`;
    a clone with another provenance → "Shadowed".
  - **(g) Failure states** (review F9): failed uninstall/config save/fetch through the per-group
    `actionError` (`installed-skills-page.component.ts:180-187`); consent dialog stays open with
    "Retry install".
  - **(i) Plugin settings notice (D14)** `PluginConfigHomeNoticeComponent`. This is an addition
    D14 requires; design-spec.md is not edited. It is rendered at the top of the installed page
    body (`installed-skills-page.component.ts`, under the header at `:121`). It reads
    `PluginCatalogService.configHome` (below) and renders nothing when that is null. It uses the
    page's existing solid-warning notice styling (design 3.x warning tokens, contrast row at
    design-spec.md:224). Copy (new, D14):
    - `conflict` (`role=alert`): "Folders in this repository have different plugin settings.
      Ptah is using the settings saved in <folder> on <date> until you choose." One button per
      candidate: "Use settings from <folder>".
    - `differs` (`role=status`): "<folder> has its own saved plugin settings that differ from this
      repository's. They are kept but not applied." Buttons: "Use settings from <folder>",
      "Dismiss".
    - `imported` (`role=status`): "Plugin settings saved in <folder> now apply to the whole
      repository." Button: "Dismiss".
    Buttons call `plugins:resolve-config-home` and then reload the catalog. They are busy and
    disabled while the call runs. A failure appears in the page's existing config-change failure
    state (`actionError`, `:180-187`). Folder paths are shown relative to the harness root
    (`overflow-wrap:anywhere`). Electron only: VS Code and CLI never receive `configHome`.
  - **(h) Kept-items repair prompt** `KeptItemsRepairPromptComponent` (design 3.4, R1-3): bound to
    the opening family; title "Replace kept files?", C4, one row per kept item, family replace
    label, forced keep for unreadable, confirm "Replace N file(s)" / "Close without replacing";
    calls `plugins:replace-kept-items`; result rows show replaced / kept-with-reason.
- Verification seam: consent dialog (8.12 regressions + list + reset + trap); new
  `external-install-report.component.spec.ts`; rows/page/detail specs (agent counts, names,
  inspector follows selection, multi-word search across the four fields); inventory store
  (workspace-switch drop); `external-marketplaces.component.spec.ts` (decisions sent; failed confirm
  keeps dialog); new `library-change-feed.spec.ts`; new repair prompt spec (each family's items,
  `.claude/agents/release-manager.md` row for plugin-agent); agreement specs on the shared
  fixtures; new `plugin-config-home-notice.component.spec.ts` (each state's copy and role; adopt
  and dismiss call the RPC with the candidate folder; busy state; failure shown in `actionError`;
  null status renders nothing); `plugin-catalog.service.spec.ts` (core) exposes `configHome` from
  `plugins:get-config` and clears it on a workspace switch.
- Files:
  - MODIFY `libs/frontend/marketplace/src/lib/external-consent-dialog.component.ts` (+ spec)
  - MODIFY `libs/frontend/marketplace/src/lib/external-install-report.component.ts`
  - CREATE `libs/frontend/marketplace/src/lib/external-install-report.component.spec.ts`
  - MODIFY `libs/frontend/marketplace/src/lib/external-marketplaces.component.ts` (+ spec)
  - MODIFY `libs/frontend/marketplace/src/lib/pages/skills/installed-skill-rows.ts` (+ spec)
  - MODIFY `libs/frontend/marketplace/src/lib/pages/skills/installed-skills-page.component.ts` (+ spec)
  - MODIFY `libs/frontend/marketplace/src/lib/pages/skills/skill-detail.component.ts` (+ spec)
  - MODIFY `libs/frontend/marketplace/src/lib/data/marketplace-inventory.store.ts` (+ spec)
  - CREATE `libs/frontend/marketplace/src/lib/services/library-change-feed.ts` (+ spec)
  - CREATE `libs/frontend/marketplace/src/lib/kept-items-repair-prompt.component.ts` (+ spec)
  - CREATE `libs/frontend/marketplace/src/lib/pages/skills/plugin-config-home-notice.component.ts` (+ spec)
  - MODIFY `libs/frontend/core/src/lib/services/plugin-catalog.service.ts` (+ spec): a read-only
    `configHome` signal set from the `plugins:get-config` result (`:206`). It is scoped and
    cleared like the existing config (`:41`, scope-key guard at `:212-214`).
  - MODIFY `libs/frontend/marketplace/src/services.ts`
  - MODIFY `apps/ptah-extension-webview/src/app/app.config.ts`

### F8. CLI wizard kept-file output and host compile keep-alive (ptah-cli, ptah-tui)

- Responsibilities: `apps/ptah-cli/src/cli/commands/agent.ts`/`wizard.ts` print kept files (A20),
  using the B6/B7 outcome DTO. The ptah-tui consumers (`PluginsSection.tsx`,
  `thoth/skills-library.ts`, `SkillsPanel.tsx`) are typecheck-only: the new `configHome` field on
  `plugins:get-config` is optional and ignored. The D11 formatter, docs and spec changes are in
  B16 (P1), not here.
- Verification seam: ptah-cli agent/wizard specs; typecheck and test for ptah-cli and ptah-tui.
- Files:
  - MODIFY `apps/ptah-cli/src/cli/commands/agent.ts` (+ spec)
  - MODIFY `apps/ptah-cli/src/cli/commands/wizard.ts` (+ `wizard.spec.ts`)

## Integration architecture

- **Data flow, wizard:** preview (B5: root, states, baselines, revisions, models, edit flags, token)
  → F1/F2/F3 → submit `{previewToken, fileDecisions{decision, revision}, target}` → B5 validate →
  B6 manifest → B3 run (kept skipped; B2 guarded writes) → B4 origin → B7
  `propagateWithReport(harnessRoot)` → Electron B11 pass (B10 mirror incl. plugin agents, B9 keep,
  catalog) → typed outcome to B7 + `library:changed` → F5; open Library refreshes (F7d → F6).
- **Data flow, pack:** any pack entry → `wizard:plan-pack-install` (scope pack/file, target) → F4 →
  `wizard:install-pack-agents` → serialized guarded writes → (harness root, ≥ 1 non-failed) consent
  grant + `propagateWithReport` → same signal.
- **Data flow, Marketplace:** external: plan (B12 scanner + clones + agent-source → approvals) →
  consent dialog → confirm with approvalId decisions → install + enable (harness-root config home) → propagate
  (B9 keeps edits) → `apply` (repair/rebase/writer, each re-digested) → report. skills.sh and
  save-config: action → propagate (save-config: background refresh) → kept report with approvalIds
  → optional `plugins:replace-kept-items` → signal.
- **Data flow, plugin config (D14, Electron):** any read or write for folder `f` or root `R` →
  B15 `storageFor` → `harnessRootOf` → home view of `R`. Record present → read it. One distinct
  saved folder config → read it and import it once. Configs differ → read the latest, write
  nothing. `plugins:get-config` → `{...config, configHome}` → core `PluginCatalogService` → F7i
  notice / F6 pointer → `plugins:resolve-config-home` → adopt/dismiss → reconcile + background
  refresh → `library:changed`. Session capability resolution reads the same view through
  `hasWorkspaceState`/`getWorkspacePluginConfig`.
- **State and persistence:** preview/plan tokens (64 each) and approvals (256) in memory, owned by
  rpc-handlers singletons, lost on restart (forces a new preview/plan: safe). Run guards in the
  checkpoint manifest. Wizard origins in `{harnessRoot}/.ptah/setup-wizard/agent-origins.json`.
  Sidecar `sourceRef`/`sourceLabel` with each clone. Kept harness paths implicit in the manifest
  hash mismatch. Plugin config (Electron) in the harness-root record in global state storage,
  owned by B15 `PluginConfigHome`. It lives until the user changes it. Per-folder records are kept
  read-only and are never deleted (D14). VS Code/CLI: unchanged single storage. No per-root
  "last result" state: outcomes travel with each request (A24).
- **External boundaries:** every new RPC param is Zod-parsed; pack sources keep the curated
  allowlist; paths and digests are server-side only; client ids are looked up, never trusted as
  paths; `plugins:resolve-config-home.folder` must equal a server-computed candidate and is never
  joined or opened as a path; plan texts bounded; no secrets.
- **Failure and rollback:** primary write failure → `failed` per file (wizard, pack) or RPC failure
  (Marketplace), never followed by a kept or success report. Downstream refresh failure after
  success → success + `libraryPass: 'failed'` + C10; the next pass heals. A replace-route failure
  after a successful install leaves the item kept with its error; no install rollback (8.10a). No
  rollback of written agent files (A19). Config home: no step deletes or rewrites a folder record.
  A failed import leaves reads on the legacy record and retries. A failed save, adopt or dismiss
  leaves the home record as it was and surfaces the error.
- **Observability:** existing pass logs; new warn lines for unreadable baselines,
  changed-since-preview/approval, kept local edits (`harness-reconciler.service.ts:940-963` style),
  config-home import write failure and its retry, broadcast failure. A config-home conflict or
  difference is never log-only: it shows as the F7i notice and the F6 pointer (D14).
  `keptLocalEdit` is visible in the harness view and in `ptah harness doctor` (B16).

## Architecture-level quality requirements

- **Functional:** each criterion maps to a named test in the component seams and the parity table;
  the data-safety NFR is proven by per-family 8.5f fixtures (B9, B12), writer/pack keep tests (B2,
  B8) and digest tests (B9, B12).
- **Performance:** a kept agent costs one read and no LLM call; a plugin toggle stays one awaited
  reconcile with a background coalesced pass (300 ms window); the preview adds one read+hash per
  selected agent (≤ 200); pack installs always fetch bytes (curated packs are small; fetches are
  URL-deduplicated); no per-item timers or observers.
- **Security:** decisions bound to server tokens and approval ids; repair accepts only
  server-verified paths and digests; allowlist and MCP disclosure unchanged.
- **Maintainability:** no `vscode`/`electron` imports and no host branching in libs (A18); god files
  delegate (A17); new services registered through `register-shared-rpc-handlers.ts` or lib
  `di/register.ts`; no new project; one new lib edge (setup-wizard → git-ui/diff-renderer, lazy),
  checked below.
- **Testability:** behaviours listed per component; senior-tester adds one acceptance test per
  preview surface (1.1-1.4) and the per-family 8.5f and digest fixtures.

### Dependency direction and acyclicity (re-checked)

Edges were read from each project's `src` imports (`from '@ptah-extension/...'`) and tags from each
`project.json`. "Below" lists what the target imports, to show no path returns to the source.

| Edge | Status | Tags | Transitive check |
| --- | --- | --- | --- |
| agent-generation → harness-sync | existing (`orchestrator.service.ts:32`) | extension/feature → extension/feature | harness-sync imports only shared, vscode-core; vscode-core imports only platform-core, shared |
| agent-generation → agent-sdk, platform-core, shared | existing | allowed | agent-sdk imports no agent-generation/harness-sync/rpc-handlers |
| rpc-handlers → agent-generation, harness-sync, agent-sdk, plugin-marketplace, platform-core, shared | existing | allowed | only cli-engine and thoth-runtime import rpc-handlers; none of rpc-handlers' targets do |
| agent-sdk → plugin-marketplace (state store) | existing | allowed | plugin-marketplace imports only shared, vscode-core |
| platform-core (pack) → nothing new | unchanged | shared/util | guard rules re-implemented locally; no feature import |
| apps (Electron, VS Code) and cli-engine → harness-sync, agent-sdk, agent-generation | existing | app/cli scope rules | apps are leaves |
| setup-wizard → `@ptah-extension/git-ui/diff-renderer` (runtime `import()`) | **new** | webview/feature → webview/feature (allowed; precedent skill-synthesis-ui) | git-ui imports core, git-ui/services, markdown, shared, ui; core → shared; ui → shared; markdown imports nothing; none imports setup-wizard |
| skill-synthesis-ui → marketplace/services | existing (`skill-clones-view.component.ts:51`) | allowed | marketplace imports chat-state, chat-ui, core, shared, ui and its own entries; never skill-synthesis-ui |
| marketplace, skill-synthesis-ui specs → `@ptah-extension/shared/testing` | existing entry; new fixture file | webview/feature → shared/util (allowed) | shared imports only its own entries |
| any feature lib → webview-e2e-harness | **removed from the plan** | forbidden (type:test-harness) | n/a |
| agent-sdk → harness-sync for the config home (D14) | **not added**: `harnessRootOf` and the global storage are passed into `initialize` by the Electron app | n/a | Electron already imports harness-sync and platform-core (`plugin-activation.ts:2`) |
| marketplace, skill-synthesis-ui → core `PluginCatalogService` | existing (`marketplace-inventory.store.ts`, `skill-clones-view.component.ts:50` imports core) | allowed | core imports only shared |
| cli-agent-runtime → agent-sdk (resolver reads the loader) | existing (`capability-resolver.service.ts:95-110` `Pick<PluginLoaderService, ...>`) | unchanged | spec-only change |

## Parity mapping

All **77** inventory rows keep their capability (A1-A41 = inventory lines 24-64; B1-B36 = lines
70-105). "Location" is the owning component after the change; "Test" is the existing spec that must
keep passing plus the new case.

| # | Capability (inventory row) | Location after change | Test |
| - | --- | --- | --- |
| A1 | Preview read-only, no consent | B5 | handlers spec :2806 + "preview writes nothing" |
| A2 | One entry per agent, Claude source path | B5 (chosen root) | handlers spec; preview-fidelity spec |
| A3 | Rival target paths definite/conditional | B5 (moved) | preview-fidelity spec |
| A4 | Reserved/disabled slugs excluded | B5 | handlers spec |
| A5 | `willOverwrite` → states + decision + revision | B1, B5, F1 | state cases + revision cases |
| A6 | Warning: harness sync unavailable (no rows) | B5 (`harness-unavailable`) | handlers spec + R1-5 case |
| A7 | Warning: could not check CLIs (no rows) | B5 (`cli-detection-failed`) | handlers spec + R1-5 case |
| A8 | Sub-folder warning → opened-folder only | B5, F1 C5 | 2.2/2.3 cases |
| A9 | Conditions | B5 | preview-fidelity spec |
| A10 | Preview-required gate + signature (+ decisions, revision, target) | B5 | handlers spec :655 + stale token + revision mismatch |
| A11 | Resume skips gate, applies decisions | B6 | resume-keeps + changed-content resume |
| A12 | Retry one item honours decision | B6 | retry-never-replaces |
| A13 | Wizard view Generate + disable rules | F2 | `agent-selection.component.spec.ts` |
| A14 | "Checking generation targets..." | F2 | same |
| A15 | Targets-changed detection incl. decisions | F1 state + F2 | same + state spec |
| A16 | Generate without preview (create-only) | F2, B5/B2 | same + no-preview keeps files |
| A17 | Backend warning banner | F2 | same |
| A18 | "will overwrite" → C1 | F1, F2 | modal spec 1.1-1.4 |
| A19 | Conditional rows informational | F2 | conditional-files spec |
| A20 | Cancel drops pending reply | F2 | same |
| A21 | Solid warning fill | F1, F2 | Electron visual review |
| A22 | Sidebar "Generate N agents" | F3 | `agent-selection-list.component.spec.ts` |
| A23 | Sidebar source status | F3 (untouched) | same |
| A24 | Generation-model picker | F3 (untouched; "Writing model" label) | same + picker spec |
| A25 | Catalog-mode list | F3 (untouched) | same |
| A26 | Preview load/confirm/sequence guard | F3 | same + decisions passed |
| A27 | preview-required reopens | F3 | same + sidebar spec |
| A28 | Definite-target signature compare | F1 state | state + list specs |
| A29 | Dialog title/description/model line | F3 | `agent-preview-dialog.component.spec.ts` |
| A30 | Dialog changed/loading/error alerts | F3 | same |
| A31 | Dialog backend warning | F3 | same + R1-5 states |
| A32 | Dialog files, certainty badge, "Replaces existing file" → C1 (initial Keep) | F1, F3 | dialog spec 1.1-1.4 + R1-4 |
| A33 | Cancel/confirm disabled while loading | F3 | same |
| A34 | Focus trap, Escape, restore | F3 | same + keyboard reach |
| A35 | Packs (wizard view) list/expand/Install/All/status/Retry | F4 + host | `agent-selection.component.spec.ts` + every entry opens prompt |
| A36 | Packs panel browse/install/retry | F4 + panel | `community-packs-panel.component.spec.ts` + Change/Install All/Retry |
| A37 | Pack curated allowlist + authorization | B8 | `setup-rpc.handlers.spec.ts` |
| A38 | Pack target → harness root default, opened-folder choice | B8, F4 | default/alternative cases (3.2a) |
| A39 | Pack download validation/traversal/atomic; cache no longer skips guards | B8 (A22) | downloader spec + cached local edit + concurrency |
| A40 | Writer `written`/`unchanged` + `kept` | B2 | `file-writer.service.spec.ts` |
| A41 | Post-run propagation (harness root) | B7, B9, B11 | handlers spec + 3.7 + skipped-batch case |
| B1 | Page header + harness explanation | F7c (unchanged) | page spec |
| B2 | Search (now every word across name, description, source, kind) | F7c (R1-1) | rows spec + multi-word case |
| B3 | Three groups in order | F7c | rows spec |
| B4 | Per-group load/error/empty/no-match | F7c | page spec |
| B5 | Per-group action error | F7c, F7g | page spec + failed removal |
| B6 | Row name/version/source/detail (+ agents) | F7c, B15 | rows spec + agent count |
| B7 | Source labels | F7c + badge | rows spec |
| B8 | Ptah plugin "Manage" | F7c | page spec |
| B9 | Uninstall with "Removing…" | F7c, B12 | page/store/plugin-rpc specs + Library refresh |
| B10 | Stale row message + reload | F7c | page spec |
| B11 | Inspector/drawer + route (facts follow selection) | F7c (R1-1) | page spec + `skill-ref.spec.ts` + selection case |
| B12 | Roving tab stop | F7c | page spec |
| B13 | Workspace-switch drop | F7c store | `marketplace-inventory.store.spec.ts` |
| B14 | Detail kind/source/issues/facts (+ names) | F7c | `skill-detail.component.spec.ts` |
| B15 | Detail harness targets | F7c (unchanged) | same |
| B16 | Detail Manage/Uninstall | F7c | same |
| B17 | Two-call consent with token | B12 (token unchanged) | installer + plugin-rpc specs |
| B18 | Install vs Update title, upgrade disclosure | F7a | consent spec |
| B19 | Approval-expired explanation (+ reset to Keep) | F7a | consent spec + reset |
| B20 | MCP verbatim, env names, non-execution | F7a (unchanged) | consent spec |
| B21 | Second-call error, dialog stays | F7a | consent spec + failed write |
| B22 | Busy disables Cancel/Install | F7a | consent spec |
| B23 | Cancel sends nothing | F7a | consent + external-marketplaces specs |
| B24 | Predicted shadowing notice + local-items list | F7a, B12 | consent spec |
| B25 | Install enables + reconciles at harness root + config home + Library refresh | B12, B11, B15 | plugin-rpc spec + sub-folder case + B15 home cases (sole legacy import, two siblings conflict, transitions); no saved folder config stops applying silently (D14) |
| B26 | Report shadowed list + kept list | F7b | report spec |
| B27 | Uninstall removes tree/record/toggle, propagates | B12 | plugin-rpc spec |
| B28 | External write failure cleanup | B12 (unchanged) | installer spec + RPC/dialog failure |
| B29 | skills.sh install + guard/report | B12, F7h | skills-sh spec + refusal + failed install |
| B30 | skills.sh uninstall + Library refresh | B12 | skills-sh spec + failed removal |
| B31 | Ptah plugin enable/disable + background refresh (config home) | B12, B15, F7i | plugin-rpc spec + toggle refresh + sub-folder + resolve-config-home adopt/dismiss + notice spec; session toggle from `repo/a` read back from `repo/b` (B15 agreement case) |
| B32 | Reconciler refuses unowned paths | B9 (unchanged) | reconciler specs + per-family refusal |
| B33 | Edited managed copy: rewrite → keep + report | B9 (D8) | reconciler specs; per-family 8.5f; unmodified replaced |
| B34 | Blocked-path repair (explicit replace route, digest-checked) | B9 (widened), B12 | `blocked-repair.service.spec.ts` + digest cases |
| B35 | Library orphaned state (former label) | F6, B13, B10 | gating spec + uninstall-with-edits + id≠name |
| B36 | Re-install replaces own tree; edited clones diverge/rebase | B12, B10 | installer spec + plugin-agent diverge spec |

## Team-leader handoff

- **Recommended executors:** backend-developer for B1-B16 and F8 (precise cross-lib types and
  guards; B16 is a mechanical rename across 40 files plus the doc); frontend-developer for F1-F7
  (Angular signals/OnPush); senior-tester for the per-family 8.5f and digest fixtures, the B15
  config-home matrix (two siblings at once, transitions, failures), the two per-surface acceptance
  tests and the agreement specs; visual-reviewer for Electron only, dark and light, at a real
  narrow width, including the F7i notice states and the F6 pointer.
- **Complexity: HIGH.** 16 backend and 8 frontend components across 16 projects and 3 hosts,
  including a harness policy change, a port return change in three hosts, a coalescer contract
  change, a stable harness-root config home with import and conflict handling, a breaking CLI
  JSON rename and a new mirror capability.
- **Dependencies and ordering** (component level):
  - B1 precedes everything. B16 follows B1 and precedes B9 (B9 edits the renamed field's
    producers and specs).
  - B15 precedes B10 (descriptors), B11 (config-home options), B12 (status and resolve RPC) and
    B13. F7i and F6's pointer need B12's `plugins:resolve-config-home`.
  - B9 and the three host refresher adapters in B11 (Electron coalescer/refresher, VS Code, CLI)
    land together; B9 precedes B7, B8 and B12.
  - B2 and B4 precede B3; B10 and B4 precede B5; B3 and B5 precede B6; B6, B9 and B11 precede B7.
  - B8 needs B4 (forget) and B9 (report); B2's rules are re-implemented in platform-core, so no code
    dependency on B2.
  - B12 needs B2, B9, B10, B11, B15. B13 needs B4, B10, B15.
  - B14 is independent except A-dis: if A-dis needs `wizard-generation-rpc.handlers.ts`, that edit
    is done by the B5-B7 owner, or B14 runs after B7.
  - F1 before F2-F4; F7d before F6; F5 after B7's DTO is final (B1 carries it).
- **Phases** (each compiles and passes its tests on its own; one review gate each):
  - **P1 foundation:** B1 (DTO types only, no registry entries, A33), B16 (D11 rename with every
    consumer, CLI formatter and docs in one batch), B15, B9 + B11 (all three host adapters,
    coalescer, broadcaster, config-home options), B2, B4, B10.
  - **P2 wizard and packs:** B3, B5, B6, B7, B8 (with the `wizard:plan-pack-install` registry
    entry) + F1, F2, F3, F4, F5, F8 (CLI kept-file output, A20).
  - **P3 Library and Marketplace:** B13, B12 (with the `plugins:replace-kept-items` and
    `plugins:resolve-config-home` registry entries) + F6, F7.
  - Why each phase stands alone: no field is removed in one phase while a consumer is updated in
    a later phase (B16). No registry method exists without its claiming handler (A33). The
    `configHome` and `PluginInfo` additions are optional, so P1 consumers compile unchanged.
  - **P4 rubric:** B14 (parallel with P2/P3 unless A-dis requires the shared handler file; then
    after P2).
- **Parallel-safe work:** B2/B4 with B9 (file-disjoint); F1 with B3-B6; F5 with B7; F6 with B12
  except `skills-synthesis-rpc.handlers.ts` (B12 extraction, B13): one batch or ordered.
  Shared files that must be in one batch or ordered: `wizard-generation-rpc.handlers.ts` (B5, B6,
  B7, maybe B14); `register-shared-rpc-handlers.ts` (B5, B8, B12, B13); `rpc-allowlist.spec.ts` and
  the three `rpc-surface.spec.ts` (B8, B12); `agent-selection.component.ts` and
  `wizard-rpc.service.ts` (F2, F4); Electron `plugin-activation.ts` (B10, B11); VS Code
  `plugin-activation.ts` and `harness-boot.ts` (B10, B11); agent-generation `index.ts` (B3, B4,
  B10).
- **Files affected:** the union of every component's "Files" list above (CREATE, MODIFY), plus
  DELETE inside MODIFY: `writeAgentsBatch`/`rollback` (A19), the pack existence-only cache
  short-circuit and target-blind in-flight dedup (A22), `overwrittenLocalEdit` (D11, B16). Nothing
  stored is deleted (D14). REWRITE: none. Shared files edited by more than one batch, in phase
  order: `rpc.types.ts` (B1 P1 types; B8 P2 and B12 P3 registry entries); `plugin-rpc.handlers.ts`
  (B12 only); `formatter.ts` (B16 only); harness-sync targets and reconciler (B16 rename, then B9).
  Guard files and their owners: `rpc-allowlist.spec.ts` (B8, B12); Electron, VS Code and cli-engine
  `rpc-surface.spec.ts` (B8, B12); Electron, VS Code and CLI `container.smoke.spec.ts` (B12, per
  A-smoke); `expected-resolvable.ts` in all three hosts — no change (handler lists already contain
  Setup/WizardGeneration; new services are not handlers); `surface-composition.spec.ts` (Electron,
  VS Code, cli-engine) — no change expected, must stay green; `coalesced-job.spec.ts` (B11).
- **Verification points.** Only `npm run verify -- -p <projects>` (or `-t <target> -p ...`); never
  workspace-wide, never build/serve/e2e. Confirm the "Running target … for N projects" header.

  | Batch scope | Command |
  | --- | --- |
  | B1 (incl. shared/testing fixtures) | `npm run verify -- -p @ptah-extension/shared` |
  | B16 (D11 rename, one batch) | `npm run verify -- -p @ptah-extension/shared,@ptah-extension/harness-sync,@ptah-extension/rpc-handlers,@ptah-extension/marketplace,@ptah-extension/skill-synthesis-ui,@ptah-extension/webview-e2e-harness,ptah-cli` |
  | B15 | `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/cli-agent-runtime` |
  | B9 + host adapters (B11) | `npm run verify -- -p @ptah-extension/harness-sync,@ptah-extension/cli-engine,ptah-electron,ptah-extension-vscode,ptah-cli` |
  | B2, B3, B4, B10, B14 | `npm run verify -- -p @ptah-extension/agent-generation` |
  | B10 host edits | `npm run verify -- -p ptah-electron,ptah-extension-vscode,@ptah-extension/cli-engine` |
  | B5, B6, B7, B8, B12, B13 | `npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/platform-core` |
  | B8/B12 guard specs | `npm run verify -- -p ptah-electron,ptah-extension-vscode,@ptah-extension/cli-engine,ptah-cli` |
  | B12 extra lib | `npm run verify -- -p @ptah-extension/plugin-marketplace` |
  | F1-F5 | `npm run verify -- -p @ptah-extension/setup-wizard` |
  | F6 | `npm run verify -- -p @ptah-extension/skill-synthesis-ui` |
  | F7 (incl. core `PluginCatalogService`) | `npm run verify -- -p @ptah-extension/marketplace,@ptah-extension/core,ptah-extension-webview` |
  | F8 | `npm run verify -- -p ptah-cli,ptah-tui` |
  | Host keep-alive after each phase | `npm run verify -- -t typecheck,test -p ptah-electron,ptah-extension-vscode,ptah-tui,ptah-cli` |

  `host-source-registry.contract.spec.ts` (shared) stays green without a baseline change. Pre-push
  di-lint and the Electron `validate-deps` gate run in the hook; no new runtime dependency.
- **Assumptions to resolve** (each names its check in its component): A-dir (B5); A-cache (B8);
  A-retire, A-paths, A-outcome (B9); A-sidecar, A-reap, A-disabled (B10); A-plan, A-rebase-lock,
  A-cli-plugins, A-smoke (B12); A-rows (B13); A-type, A-dis (B14); A-info, A-session,
  A-global-sync (B15); A-nav, A-hint
  (F6); A-share, A-search (F7). Resolved this round: A-h (B4, `source-hash.ts:69-75`), A-gate
  (replaced by A23), A-cfg (replaced by A27), A-id (replaced by A28), A-diff (A32), A-rel (design
  "Writing to" line).

## Revise round 1

Review: `implementation-plan-review.md` (codex, REVISE). Each finding and the plan change.

| # | Severity | Finding | Plan change |
| - | --- | --- | --- |
| 1 | Blocking | Agreement fixtures imported from `webview-e2e-harness` (`scope:webview,type:test-harness`), which feature libs may not depend on; the file also imports Playwright | A29: pure DTO fixtures in `libs/shared/src/testing/fixtures/library-agreement.ts`, exported from `@ptah-extension/shared/testing` (`tsconfig.base.json:235`, precedent `fixtures/dashboard-spec.ts`). Imported by marketplace and skill-synthesis-ui specs (F6, F7e). Verified by `@ptah-extension/shared` (B1). The forbidden alternative and the "no new edges" claim are removed; the acyclicity table lists the real edges. `marketplace.fixtures.ts` only gets the D11 rename. |
| 2 | Serious | Consent snapshot used the manifest hash; edit A → edit B was indistinguishable | A21: server-held approval registry (B12 `local-item-approvals.ts`) with the current content digest (`hashFile`/`hashDir`/clone body digest) and source identity; client sees only `approvalId`. Digest recomputed under the mutation lock: repair (`moveOccupants`, B9), rebase (B12 `clone-rebase.service.ts`), agent-source writer (B2). New outcome `changed-since-approval`. Tests: A → B, delete/recreate, unreadable-after-plan, edit during install (B9, B12). |
| 3 | Serious | Pack cache short-circuit and URL-keyed in-flight dedup bypass guards and mix targets/decisions | A22 in B8: existence-only cache short-circuit deleted; mutation dedup deleted; fetch-only URL dedup kept; installs serialized per canonical target; each call evaluates its own guards. Tests: cached local edit Keep/Replace, concurrent different roots/decisions, same-root serialization, honest `unchanged`. |
| 4 | Serious | Plugin agents gated on agent-sync consent vanish in a fresh workspace | A23 in B10: `MirrorSources.libraryScopeRoot` (always the harness root) keys plugin-agent clones independent of consent; workspace `.claude/agents` mirroring and rival fan-out stay consent-gated (`agent-sync-gate.ts:182-193`, `harness-manifest.builder.ts:567-574`). No consent is granted. Tests: fresh workspace and explicitly disabled sync. No reserved decision needed. |
| 5 | Serious | Refresh results not correlated to requests | A24 in B11: coalescer returns a typed per-batch outcome (`ran`/`skipped`/`threw`) to every request merged into that batch; the per-root map is removed. `coalesced-job.spec.ts` is updated (success → skip, overlapping pass, merged requests, throw). `library:changed` carries the harness root; the Library refreshes the current workspace with an epoch guard and shows the failure notice only for its own `scopeRoot` (B13, F6). |
| 6 | Serious | No-write pack completions skipped the Library pass | A25 in B8: pass after any harness-root completion with ≥ 1 non-failed file (written, unchanged or kept); all-failed defined separately. Tests: all-current, all-kept, cached/re-install completion, refresh failure notice. D9 consent grant applies on the same condition. |
| 7 | Serious | Re-preview could carry Replace onto changed content | A26: per-row opaque `revision` (B5, B8); F1 carries Replace only on an equal revision and resets all on target change; the server rejects a replace whose revision differs (`preview-required`). Tests on both surfaces (exists A → B) and packs (differs A → B). |
| 8 | Serious | Plugin config root alignment deferred | (Superseded by Revise round 2 / D14: `resolveConfigHome` is gone.) A27 + new B15 `resolveConfigHome`: one deterministic config home per harness root, used by get/save config, external install/uninstall config writes, Electron mirror-source read and reconciler reader (B11, B12). Evidence: `storageFor` returns `null` for an unregistered harness root in Electron (`plugin-loader.service.ts:791-818`) while the reconciler asks for it (`phase-2-libraries.ts:236-257`). No storage migration; the sibling-sub-folder limit is stated. Sub-folder enable/disable/install test checks config, mirror, catalog and reconcile (B12). |
| 9 | Serious | Surviving pluginId cannot keep an orphan's display name; basename ambiguity | A28: sidecar `sourceRef` + `sourceLabel` stamped while the source exists (B10, descriptors from B15), used by the resolver (B13). Tests: two external plugins with one basename; uninstall of a plugin whose name ≠ id; card/drawer and Marketplace agreement via shared fixtures. |
| 10 | Moderate | Registration and host guards not assigned | Assigned per component: B8 (`SetupRpcHandlers.METHODS`, registry, `register()`, `PackInstallService` registration, allowlist describe, three `rpc-surface.spec.ts`); B12 (`PluginRpcHandlers.METHODS` for `plugins:replace-kept-items`, three service registrations, allowlist, rpc-surface incl. CLI partition, smoke assertions per A-smoke); B5/B13 registrations; B4 token; B11 no DI. `expected-resolvable.ts` stays a handler list (no service tokens added). Guard-file owners listed in the handoff. |
| 11 | Moderate | Phases contradicted dependencies | New phases P1-P4 with B15 and B10 in P1 before B5/B12/B13; B9 with all three adapters; B14's conditional shared-file ownership stated; explicit verify commands for the fixture owner (`@ptah-extension/shared`) and cli-engine/CLI guard specs. |
| 12 | Moderate | Rubric verification one-sided | A31: pinned table in the spec (title, body sha256, instruction sha256) independent of the module, plus prompt-contains check; 6.7 representative case covering prompt, stubbed pipeline output and fallback, with its limits written down (B14). |
| 13 | Moderate | Provenance and pending-choice labels | Decision table has Provenance and Status columns; Q1-Q4 are resolved as D8-D11 (user); the "all RPC changes additive" claim now names the D11 breaking change; the frontend entry gate cites `## Review responses` and `## Revise round 2`. |

Also applied this round: the parity table maps all 77 inventory rows; design-spec "Revise round 2"
items R1-1..R1-5 are carried (F7c inspector and search, F4 every pack entry, F7h family-bound repair
incl. `.claude/agents/release-manager.md` and B12 `agent-source` items, F1/F3 initial Keep, B5 rival
statuses); transitive acyclicity re-checked from source imports and project tags (table above).

## Revise round 2

Review: `implementation-plan-review.md` "Round 1 re-review" (codex: REVISE, 0 Blocking, 1 Serious,
1 Moderate) and its "A27 assessment"; decision D14 (`decisions.md:17`). D3, D7-D13 and the approved
design (design-spec.md, Revise round 2) are unchanged. All 77 parity rows stay mapped (A1-A41,
B1-B36). B25 and B31 now name the D14 tests.

| Item | Severity | Finding | Plan change |
| --- | --- | --- | --- |
| R1-S1 / #8 | Serious | A27 stopped reading a non-home sibling's saved config (log only). The home depended on which folders were registered. | D14 applied in **A27** (rewritten) and **B15**. Stable home: one record per harness root in global state storage, key `ptah.plugins.harnessConfig:<canonicalRootKey(R)>`. It does not depend on which folders are open, so opening a sibling, closing the imported folder or opening the repository root does not move it. Presence-aware import: copy once when every saved folder config is equal; an intentionally saved empty config counts as present. Conflict rule: configs differ → nothing imported, reads use the latest `lastUpdated` (tie → folder key), and the F7i notice offers "Use settings from <folder>" per candidate. Home present and a folder differs → `differs` notice with adopt/dismiss. No union of lists. Folder records are never rewritten or deleted. Touch points: `plugin-loader.service.ts:529` (options), `:791-808` (routing in `storageFor`), `:816-818` (`hasWorkspaceState`), `:856-870`, `:922-972`, `:1045-1099` (unchanged call sites through the view); Electron `plugin-activation.ts:246,252,297`; `plugin-rpc.handlers.ts:250-255,340,376,756-761,796-798` (corrected from the stale `:640,707,745-805`); new `plugins:resolve-config-home` (B12); core `plugin-catalog.service.ts:206`; F7i notice; F6 pointer. |
| R1-S1 session consequence | Serious | The UI could show the home while sessions used a sibling's policy (`capability-resolver.service.ts:280-305,649-653`). | B15 routes every lookup, including `hasWorkspaceState`, to the home view, so `stateRootFor` returns the harness root and sessions read and write the same record. A toggle saved by a session from `repo/a` is read back from `repo/b` (B15 agreement case in `capability-resolver.service.spec.ts`; A-session assumption with its check). |
| R1-S1 tests | Serious | Required: sole legacy + empty home; intentional empty config; two siblings in conflict; active-folder change; open/close home or open root; idempotent import; failed persistence; config/mirror/catalog/reconcile agree; legacy recoverable; conflict visible. | B15 verification seam lists each one, including **`repo/a` and `repo/b` open at once with conflicting lists**, adopt (no union), dismiss, save during conflict, concurrent save during import, and import/save write failures. B11 phase-2 reader case, B12 `resolve-config-home` cases (unknown folder rejected, adopt failure) and the F7i/core specs cover the consumers and the visible notice. |
| R1-M1 / #11 | Moderate | D11 was split: the shared field went in P1, the CLI formatter in P3, and the marketplace typed fixtures were unassigned. | New **B16** in P1 renames the field in one batch: shared type and specs, harness-sync producers and specs, the rpc-handlers spec, marketplace source and the 9 specs (incl. `attention.spec.ts`), 3 skill-synthesis-ui specs, the webview-e2e-harness fixture, `apps/ptah-cli` formatter (`:156-168,483,521`) and its 2 specs, and `jsonrpc-schema.md` section 1.5. That is 40 code files from a repository search, plus the doc. B9 changes only the semantics afterwards. F8 keeps only the A20 CLI wizard output and moves to P2. A34 records that there is no schema-version bump. |
| #11 remainder | Moderate | Claim "each phase compiles on its own" not yet accepted. | A33: registry entries now land with their handler (B8 P2, B12 P3), because `rpc-allowlist.spec.ts:63-64` requires the manifest to claim every registry method. With B1 carrying them in P1, rpc-handlers tests would fail until P3. The phase list states why each phase stands alone, and the handoff names the shared files edited by more than one batch in order. Stale `setup-rpc.handlers.ts:102-103` corrected to `:91`. |

New decisions this round: A33 (registry entries with handlers), A34 (no CLI schema-version bump;
reversible, and a one-line bump can follow if the orchestrator wants it). New assumptions:
A-session and A-global-sync (B15), each with its check. The F7i notice copy and the F6 pointer are
D14 additions, not edits to the approved design. They need an Electron visual review (dark, light,
narrow).
