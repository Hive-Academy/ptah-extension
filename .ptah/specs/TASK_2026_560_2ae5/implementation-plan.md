# Implementation Plan - TASK_2026_560_2ae5 (revision 2 + bounded correction r3)

## Inputs and constraints

- Read: `task.md`, `task-description.md` (28 ACs), `research-report.md`, `implementation-plan-review.md` (round 1),
  `implementation-plan-review-r2.md` (round 2), `CONVENTIONS.md`.
- User decisions (unchanged):
  - D1: global + workspace scopes. A toggle writes exactly one scope. Effective = workspace ?? global ?? default.
  - D2: skills and plugins get the same scopes, and `PluginConfigState` keeps loading.
  - D3: ptah is ON by default and can be turned OFF with a warning.
  - Q1: repository-declared servers are OFF, with a one-time import of user-authored approvals.
  - A Marketplace install writes an explicit workspace ON.
  - Two PRs (approved): the task is complete only when both merge, and PR 1 labels the rival lanes "not enforced"
    until PR 2 lands.
- Hard limits:
  - No edit to `vscode-lm-tools/.../mcp-core/protocol-dispatcher.ts` (TASK_2026_559).
  - Under 100 files per PR; PR 1 target is 92 or fewer including task docs.
  - No `*.generated.*` files.
  - New backend services log through `IOutputChannel` (`PLATFORM_TOKENS.OUTPUT_CHANNEL`).
- Missing decision-critical input: none.

## Review resolution

Round 1 items marked RESOLVED by the round 2 review (#1, #2, #4, #7, #8, #9, #11, #12, #13, #14, #16) keep their
design and are not restated. #12 and #16 move to PR 2; see the handoff.

| # | Section | Resolution |
| --- | --- | --- |
| 3 / N1 / N8 | C2 | Replaced by a LOCK-FREE per-item store (user decision, r3).<br>• Each toggle is its own small file, written by one atomic temp + rename. There is no read-modify-write and no lock, so there is no lost update, no lock owner, no stale-lock recovery and no PID identity (N8 disappears).<br>• Same-item concurrent writes are last-writer-wins.<br>• The C2a lock hardening, its tests, `requireLock` and A6 are dropped from both PRs.<br>• Existing harness-sync callers' locking is unchanged by this task. |
| N2 | C2, C4 | There is no lock to nest.<br>• The import publishes one complete `imported.json` (see D1).<br>• `set` awaits `ensureImported`, then does its own atomic write.<br>• Tested: the first `set()` in a fresh workspace. |
| #3 / #5 / D1 | Resolution rules, C2, C4 | Imported values move to a separate IMPORTED layer below explicit decisions: `explicit workspace ?? imported ?? global ?? default`.<br>• One `imported.json` per workspace, published by atomic temp + rename. Its existence is the marker, so the separate marker is dropped.<br>• A crash leaves only a temp file, so the import re-runs.<br>• Corrupt → unverified; a source failure publishes nothing and surfaces an error.<br>• A clear writes an explicit `inherit` tombstone, which skips the imported layer, so the import can never undo a clear. The round-3 exception is removed.<br>• Concurrent imports: last complete rename wins, and both are user-authored. |
| D2 | C2 codec | Disjoint namespaces: literal `l_<pct>` vs hashed `h_<sha40>`.<br>• The reader validates the full canonical file name recomputed from the content.<br>• The delta-review pair (`"x"×121` vs `h_79072a47…d1`) is a fixed codec and independent-toggle test. |
| 5 / N3 / N9 | Fail-closed policy, C3, C4, C5 | "Unknown" is never treated as "no exclusions":<br>• The harness source resolver returns a frozen state, and the reconciler performs no skill, plugin or agent writes or removals (`sources: 'policy-unknown'`).<br>• Claude sessions launch with `skills: []`, which suppresses every skill, and with strict MCP limited to ptah.<br>• `resolveCurrentPluginPaths` returns `[]`, the restrictive answer, to other consumers.<br>• Every rival lane refuses to launch.<br>• Tested: a corrupt store while a plugin was previously disabled; the plugin and its children stay absent.<br>• N9: `CodexTomlMcpFacet` gains a status-bearing `readStatus` that separates ENOENT from other errors. PR 1 `inspect` uses it, legacy `readAll` is unchanged, and an EACCES regression test is added (in PR 1). |
| 6 / N7 | Resolution rules | The physical root is `realpathSync.native(resolveHarnessWorkspaceRoot(cwd))` and is used for all I/O. The storage and comparison key is the physical root, lower-cased on win32 only (the `isSamePath` rule, `workspace-root.ts:112-116`). There is no Darwin folding; `realpath.native` already canonicalizes case on case-insensitive volumes.<br>• Tested: distinct case-sensitive `Repo` and `repo` roots; a win32 alias; a sub-folder; a worktree. |
| 10 / N4 | C5a `HarnessPolicySync` | A policy fingerprint is computed over the effective harness inputs (overlay paths, disabled skills, plugins and agents), which already include `PluginConfigState` and the global layer. The reconciler stamps the fingerprint it processed on `HarnessHealth`.<br>• A pass is acknowledged only when the fingerprint matches, `sources === 'ok'`, and no target has `writeFailed`.<br>• A joined or older pass triggers one more forced pass.<br>• Ptah CLI resolves the policy before its preflight (`ptah-cli-registry.ts:657-659` is reordered).<br>• Tested: concurrent fingerprints, a non-null failure report, and a legacy CLI `plugins:save-config` write. |
| 15 / N5 | C7 (PR 2) | Each measurement runs `mcpServerStatus()` and `getContextUsage` together under one 3 s bound. A figure is kept only for servers `connected` right now, and the session token is re-checked after the awaits.<br>• The memo is keyed by `(token, server, config hash)` and dropped when the server is not connected or its config changes.<br>• Tested: in the same session connected→failed shows unknown, and pending→connected shows a figure. |
| N6 | Resolution rules, C8 | `setExplicit(root, 'mcp', key, true)` keeps the workspace entry even when it equals the inherited value; ordinary toggles still normalize. Install uses it.<br>• Tested: a workspace install with the same name in global Codex and native auto-approval off ends up approved. |

## Codebase evidence (new this round; earlier citations re-verified in round 2)

| Evidence | Location | Implication |
| --- | --- | --- |
| Atomic replace rethrows final errors and uses unique temp names; Windows retry is exported | `harness-sync/src/lib/fs/atomic-write.ts:36-70`; `harness-sync/src/index.ts:296,301` | C2 item and import writes |
| The Codex facet swallows every read error as empty text | `harness-sync/src/lib/targets/mcp/codex-toml-mcp-facet.ts:109-110,187-195` | N9 status read |
| Read failure → unfiltered overlay (`overlayPluginPathsKnown` omitted) | `sources/plugin-config-source-resolver.ts:136-150`; `harness-source.port.ts:90-102` | Needs a distinct frozen state (N3) |
| `HarnessHealth` shape; `HarnessSourcesStatus` union | `shared/src/lib/types/harness-sync.types.ts:70-73,159-169` | Adds `policyFingerprint?` and `'policy-unknown'` |
| Health assembled in the reconciler | `harness-reconciler.service.ts:238-245,431-436` | Fingerprint stamped there |
| Preflight joins an in-flight pass before `force` | `harness-preflight.service.ts:157-163` | Mismatched fingerprint → second pass |
| Ptah CLI runs preflight before resolving policy | `ptah-cli-registry.ts:657-659` | Reorder |
| Case folding is win32-only | `workspace-root.ts:112-116` | N7 identity rule |
| `Query.mcpServerStatus()` is a current query | `sdk.d.ts:2836-2841` | N5 |
| Init `servers` status is published once | `stream-transformer.ts:519-530`; `session-mcp-status-callback-registry.ts:29-33` | Not used for validity (N5) |

## Architecture decision (unchanged core)

- **The policy is enforced by denial and fails closed.**
  - `libs/shared` holds the contract and the pure rules.
  - `cli-agent-runtime` owns the lock-free per-item toggle store, the single declaration inventory, the import and the resolver
    behind `SDK_TOKENS.SDK_CAPABILITY_RESOLVER`.
  - Claude builders emit flag-tier `deniedMcpServers`/`disabledMcpjsonServers`, explicit-only
    `enabledMcpjsonServers` and `skillOverrides`. An unknown policy becomes strict MCP + `skills: []`, and rival
    lanes refuse to start.
- **Lock-free per-item store instead of any cross-process lock** (user decision after r3).
  - A lock needs owner identity, lease recovery and fencing, and review rounds 2 and 3 showed each of those can
    fail on real filesystems (residual N1, N8).
  - One file per toggle makes every mutation a single atomic rename. Nothing is read-modify-written, so there is
    nothing to lock.
  - Blast radius: two new files in cli-agent-runtime. No harness-sync lock code changes, and existing callers keep
    today's behaviour.
- **Rejected alternatives:**
  - `strictMcpConfig` as the normal path; it is kept only for the fail-closed mode.
  - An SDK `skills` allowlist on the verified path.
  - A single JSON document under a lock (rounds 1-2): it needs a provably safe lock, which rounds 2-3 could not
    establish.
  - Per-workspace rewrites of the Antigravity global file.
  - A last-good snapshot for N3. It duplicates state, and full native suppression already exists.

## Resolution rules (pinned by C1/C4 unit tests)

- **Identity:** the key is `${kind}:${id}`. For MCP the id is the server name.
- **Policy root:** `physicalRoot = realpathSync.native(resolveHarnessWorkspaceRoot(cwd))`, falling back to the
  resolved path if realpath fails. `policyKey = win32 ? physicalRoot.toLowerCase() : physicalRoot`.
  - Every file read, git call, facet call and `storageFor` call uses `physicalRoot`.
  - Only store lookups and comparisons use `policyKey`.
  - A worktree is its own root. The spawn `cwd` is unchanged.
- **Effective:** `effective = explicitWorkspace ?? imported ?? global ?? default`. An explicit workspace
  `inherit` (tombstone) skips `imported` and resolves to `global ?? default`. Defaults:
  - ptah: ON.
  - Any user-scope declaration (`~/.claude.json` user or project map, `~/.codex`, `~/.copilot`, `~/.gemini`,
    Smithery/OAuth): ON.
  - Declared only in repository files (`.mcp.json`, `.vscode/mcp.json`, `.cursor/mcp.json`, `opencode.json`): OFF
    and denied.
  - skill: ON. plugin: `isOptOutPluginSource`. A skill whose parent plugin is OFF is OFF.
- **Writes:**
  - A workspace toggle to `v` always writes an explicit item. It writes `inherit` when `v` equals `global ?? default`
    (AC-1.3, "follows global"); otherwise it writes `on` or `off`. Ptah never deletes an item.
  - A global write touches only global.
  - `setExplicit` (install only) always writes `on`, even when that equals the inherited value (N6).
- **Skill/plugin workspace layer:** `PluginConfigState` as in round 1: `enabledSkillIds?` is new and preserved when
  omitted; deny wins over enable.
- **Import:**
  - Trusted sources only: `~/.claude.json` `projects[<physicalRoot>]` (key-matched with the reader's existing
    folding rule), plus `.claude/settings.local.json` only when git reports it untracked and ignored. Git runs as an
    argument array with a 2 s timeout, and an expected non-zero exit is distinguished from a git failure.
  - Mapping: `enableAll` → every `.mcp.json` name at import time ON; enabled names ON; disabled names OFF (wins).
    The result is the IMPORTED layer (C2), never item files, global or any user file.
  - Outcome: missing sources or non-git → an `imported.json` is published (possibly with no entries); parse error,
    EACCES or git failure → nothing published, an error surfaced, and a retry on the next resolve.
  - Concurrency: the IMPORTED layer sits below every explicit item, so a user toggle or clear beats the import in
    any order. Concurrent imports resolve by last complete rename (C2).

## Fail-closed policy

- **When it applies:** `EffectiveCapabilitySet.status` is `'unverified'`, with `reasons: {path, error}[]`, when:
  - any explicit item or `imported.json` is unparseable, empty or mismatched, or unreadable, or a store directory is unreadable
    for a reason other than ENOENT;
  - a relevant declaration source returns `error`;
  - `PluginConfigState` cannot be read;
  - the resolver throws or is unregistered.
- **Claude chat, one-shot and Ptah CLI agents:**
  - `strictMcpConfig: true` with ptah only; ptah is omitted only if a readable store says it is OFF.
  - `skills: []`.
  - No harness preflight; the reconciler freezes.
  - Notice `capability-policy-unverified` in the chat MCP chip: "Only Ptah tools are loaded and skills are off:
    Ptah couldn't read <path> (<reason>). Fix the file and start a new session."
- **Harness:** `PluginLoaderService.getEffectivePluginConfig` throws `CapabilityPolicyUnknownError` (an `SdkError`).
  - The source resolver maps it to `{policyUnknown: true}`.
  - The reconciler returns health `sources: 'policy-unknown'` and writes or removes no skill, plugin or agent
    entries.
  - `resolveCurrentPluginPaths` and `getDisabledSkillIds` return `[]` and all known skill ids respectively.
- **Rival lanes (PR 2):** refused with `CapabilityPolicyUnavailableError`: "Ptah couldn't read <path> (<reason>), so
  it can't guarantee your disabled servers and skills stay off. Fix or remove the file, then retry."
- **CLI proxy (PR 2):** ptah tools only.
- **Marketplace:**
  - A banner lists the unreadable paths. Affected entries show "Unknown".
  - Writes to a healthy item still work, because each item is its own file. The banner names each bad item file,
    and deleting that file restores its default.

## Component specifications

### C1. Shared contract (`@ptah-extension/shared`) — PR 1

- **Types:**
  - `CapabilityEntry {kind, id, label, parentId?, sources, globalEnabled?, workspaceEnabled?,
    effectiveEnabled|null, inheritedFrom, defaultReason?, importedFromClaude?, suppressedByBackoff?, schemaTokens?}`.
  - `EffectiveCapabilitySet {physicalRoot, policyKey, status, reasons, ptahEnabled, deniedMcpServers,
    approvedProjectMcpServers, deniedSkillNames, disabledPluginIds, harnessFingerprint}`.
  - `ICapabilityResolver`, `ICapabilityGlobalLayer`.
  - `CAPABILITY_ENFORCEMENT`: PR 1 marks the codex, opencode and antigravity MCP rows AND the `ptah-cli-proxy` row
    `not-enforced`.
  - Id codec: `encodeCapabilityId`/`decodeCapabilityId` (see C2).
- **Pure functions:** `defaultEnabled`, `resolveEffective`, `nextWorkspaceValue`, `pluginConfigLayer`,
  `classifyMcpScope`, `definitionInEffect`, `planApprovalImport`, `isMcpServerEnabled`, `tomlKeySegment`,
  `harnessPolicyFingerprint` (sorted canonical JSON → FNV-1a; no crypto, because shared also ships to the browser),
  `isHarnessPassAcknowledged`.
- **RPC:** `capabilities:getState`, `capabilities:getEffective`, `capabilities:setEnabled`.
- **Additions to existing types:** `InstalledMcpServer.scope?`, `PluginConfigState.enabledSkillIds?`,
  `SessionMcpNoticeCode |= 'capability-policy-unverified'`, `HarnessHealth.policyFingerprint?`,
  `HarnessSourcesStatus |= 'policy-unknown'` (the health reducer maps it to `degraded`).
- **Tests:** every rule in the Resolution rules, plus fingerprint stability and the acknowledgement predicate.
- **Files (9):**
  - C `capability-toggle.types.ts` + `.spec.ts`, C `rpc/rpc-capability.types.ts`
  - M `rpc.types.ts`, `index.ts`, `mcp-directory.types.ts`, `rpc/rpc-misc.types.ts`,
    `messages/session-mcp-status.ts`, `harness-sync.types.ts`

### C2. `CapabilityToggleStore`, lock-free per-item (`@ptah-extension/cli-agent-runtime`, `lib/capabilities/`) — PR 1

- **Layout** (under `~/.ptah/capabilities/`):
  - explicit global items: `global/<kind>__<enc>.json`;
  - explicit workspace items: `workspaces/<wsKey>/items/<kind>__<enc>.json`;
  - the IMPORTED layer: `workspaces/<wsKey>/imported.json`, one file per workspace, whose existence is the import
    marker;
  - diagnostics only (never read for policy): `workspaces/<wsKey>/root.json`.
- **Workspace key:** `wsKey = sha256(policyKey).hex.slice(0, 32)`, where `policyKey` is the physical root lower-cased
  on win32 only (N7).
- **Filename codec** (pure, in C1; D2). The two namespaces are disjoint:
  - literal form `l_<pct>`: `pct` keeps `[a-z0-9_-]` and writes every other UTF-8 byte (upper-case, `.`, space, `%`,
    Windows-reserved and control characters) as upper-case `%XX`;
  - hashed form `h_<sha256(id).hex.slice(0, 40)>`, used when `pct` exceeds 120 characters.
  - Every literal name starts with `l_` and every hashed name with `h_`, so the two can never be equal.
  - The `<kind>__` prefix and `.json` suffix rule out device names.
  - On every read, the reader recomputes `canonicalFilename(kind, id)` from the file CONTENT and requires it to equal
    the actual file name. A mismatch → `error` → unverified.
  - The collision pair from the delta review is a fixed test vector: `"x".repeat(121)` →
    `mcp__h_79072a47bfaa54e6057a9ee21e0dea64b9edbfd1.json`, while id `h_79072a47bfaa54e6057a9ee21e0dea64b9edbfd1` →
    `mcp__l_h_79072a47bfaa54e6057a9ee21e0dea64b9edbfd1.json`.
- **Explicit item content:** `{v: 1, kind, id, value: 'on' | 'off' | 'inherit', source: 'user' | 'install', at}`,
  validated by zod.
  - `'inherit'` is the tombstone for "clear workspace override". It skips the imported layer and falls through to
    global ?? default.
- **Writes:** every user toggle, clear and install is one `atomicWriteWithRetry` of an explicit item file (unique
  temp + rename, Windows retry, rethrows; `atomic-write.ts:36-70`).
  - There is no read-modify-write. Same-item concurrent writes are last-writer-wins, and different items (including
  the D2 pair) never share a file.
  - A failure throws `CapabilityToggleStoreError` → RPC error → UI revert (AC-1.4).
  - Ptah never deletes item files. A plain delete is no longer used by any code path; a file deleted by hand simply
    means "no explicit decision".
- **IMPORTED layer (D1):**
  - `publishImport(wsKey, doc)`: `doc = {v: 1, createdAt, sources: [{path, kind: 'claude-project' |
    'settings-local'}], entries: Record<key, 'on' | 'off'>}`.
  - If `imported.json` already exists, it does nothing. Otherwise it writes the complete document with
    `atomicWriteWithRetry`, so readers see either no file or a complete one.
  - A crash before the first byte or mid-payload leaves only a `.tmp` file, which is ignored, so the next session
    re-runs the import. A crash after the rename leaves the complete layer.
  - A source read failure publishes nothing and surfaces an `IOutputChannel` error plus the Marketplace banner
    reason, and the import retries on the next resolve.
  - Concurrent imports: both publish complete files by rename, and the last rename wins. Each file derives only
    from user-authored approval records, possibly from different snapshots if those files changed in between.
    Whichever wins is a complete, user-authored snapshot, and explicit items always override it. No
    order-independence is claimed.
  - An unparseable `imported.json` → `error` → unverified (fail closed). It is never treated as absent.
- **Read:** fresh `readdir` of `global/` and `workspaces/<wsKey>/items/`, plus `imported.json`, parsed on every call
  with no cache.
  - ENOENT → empty.
  - Any unparseable file, a 0-byte file, a content/filename mismatch, or an unreadable directory → `status: 'error'`
    with the path → unverified.
  - Names outside the pattern (sync-tool conflict copies, `.tmp`) are ignored and logged.
- **Fingerprint input:** sorted `(file name, content)` of skill and plugin explicit items, combined by C3 with
  `PluginConfigState` (N4). `imported.json` holds only MCP keys, so it is excluded, like MCP items.
- **Implements `ICapabilityGlobalLayer`** and is registered as `SDK_TOKENS.SDK_CAPABILITY_GLOBAL_LAYER`.
- **Not guaranteed:**
  - (a) a `~/.ptah` synced across machines: per-file last-writer-wins, conflict copies ignored, and the UI shows the
    disk;
  - (b) network filesystems without atomic rename;
  - (c) same-item simultaneous clicks: last-writer-wins.
  - None of these can turn a user's OFF into ON except by replaying another value that user explicitly set.
- **Tests (real temp directory):**
  - codec: case pair; reserved and control characters; `.`, space, `%`, non-ASCII; long id → `h_`; round trip;
  - the D2 pair maps to different files, and toggling or clearing one leaves the other intact;
  - a content/filename mismatch → `error`;
  - `wsKey` on a win32 alias vs case-sensitive roots;
  - EACCES or rename failure → reject, with the prior file byte-identical;
  - two instances, 200 interleaved writes on different items → all present;
  - import interruption before the first byte, mid-payload (only `.tmp` left) → the next resolve re-imports; after
    publish → no re-import;
  - an imported OFF with an inherited (global or user-scope) ON stays OFF;
  - a clear (tombstone) written during and after an import stays cleared;
  - two concurrent `publishImport` calls with different snapshots → one complete file, never a mix;
  - a corrupt `imported.json` → unverified;
  - a global snapshot is unchanged after a workspace write (AC-2.3).
- **Files (2):** C `capability-toggle-store.ts` + `.spec.ts`.

### C3. Effective skill/plugin layering and harness freeze — PR 1

- **`PluginLoaderService` (agent-sdk):**
  - optional inject of `SDK_CAPABILITY_GLOBAL_LAYER`;
  - `getEffectivePluginConfig(root)` throws `CapabilityPolicyUnknownError` when the global layer or the workspace
    storage is unreadable;
  - `resolveCurrentPluginPaths` and `getDisabledSkillIds` are effective, and restrictive on unknown;
  - `saveWorkspacePluginConfig(config, root?)` captures `storageFor(root)` once (#8);
  - optional `enabledSkillIds` is preserved when omitted.
- **harness-sync:**
  - `HarnessPluginConfigReader` gains `getEffectivePluginConfig`.
  - `PluginConfigSourceResolver` maps `CapabilityPolicyUnknownError` to `policyUnknown: true`; other read failures
    keep today's unfiltered semantics.
  - `HarnessSourceState.policyUnknown?`.
  - The reconciler, when `policyUnknown`, skips skill, plugin and agent planning (MCP intents are unaffected) and
    reports `'policy-unknown'`. It stamps on every health the `policyFingerprint` carried by the source state.
  - `PluginLoaderService.getEffectivePluginConfig` returns `fingerprint = harnessPolicyFingerprint(store
    fingerprintEntries + PluginConfigState)` from the same snapshot it read. The source resolver copies it into
    `HarnessSourceState.policyFingerprint`, and the resolver's `harnessFingerprint` uses the same function (N4).
- **Tests:**
  - loader: pre-task config unchanged (AC-3.2); global OFF / workspace ON; save during an A→B switch; unknown throws;
  - resolver spec: unknown → frozen;
  - new reconciler spec: a frozen pass writes and removes nothing while a previously disabled plugin and its skill
    copies stay absent; fingerprint stamped.
- **Files (7):**
  - M `plugin-loader.service.ts`, C `plugin-loader.service.capabilities.spec.ts`
  - M `plugin-config-source-resolver.ts` + `.spec.ts`
  - M `sources/harness-source.port.ts`
  - M `reconciler/harness-reconciler.service.ts`, C `harness-reconciler.capability-policy.spec.ts`

### C4. Inventory, import and resolver — PR 1 (codex quoted-key facet and #16 reader move to PR 2)

- **Facets:** `IHarnessMcpFacet.inspect(root) → {status, error?, servers}`, implemented by `JsonMcpFacet` and
  `CodexTomlMcpFacet`.
  - The Codex facet (N9) gets a new private `readStatus(root) → {status: 'ok' | 'missing' | 'error', text, error?}`
    that separates ENOENT from every other error. `inspect` uses it.
  - Legacy `readAll` keeps returning an empty map on any error.
  - Quoted-key parsing stays in PR 2 (C4b).
- **One inventory:** `McpInstallService.listDeclarations(root) → {declarations, sourceStatus}` feeds both `list` and
  `resolve`. `listInstalled` maps from it and dedupes including scope. Claude user rows use the existing
  `entry.scope`; PR 2 adds non-collapsing declarations (#16).
- **`ClaudeApprovalReader`:** the trusted sources with argument-array git calls. It never throws and returns
  `{status, approvals}`.
- **`CapabilityResolverService`:**
  - `resolve(cwd)`: physical root and key, `ensureImported`, then store, inventory, `getEffectivePluginConfig` and
    back-off. It computes the denied, approved (explicit or imported ON only), `deniedSkillNames` (disabled skills
    plus the children of disabled plugins, bare and `plugin:skill`), `harnessFingerprint` and `status`.
  - `list(root)` shares the same inputs.
  - `set` and `setExplicit` per the Resolution rules. Skill/plugin workspace writes go to
    `saveWorkspacePluginConfig(…, physicalRoot)`.
- **Tests (resolver spec):**
  - parity of `list` and `resolve` across source combinations;
  - roots: sub-folder, worktree, win32 alias, distinct case-sensitive `Repo`/`repo`, and I/O on the physical path
    (N7);
  - AC-4.1 fixtures with `imported.json` present;
  - import from a `~/.claude.json` project entry;
  - `settings.local.json` imported only when git-ignored and untracked; tracked, non-git and git-timeout cases;
  - untrusted fresh clone;
  - missing sources → an empty layer is published; a source error → nothing published, and a retry imports;
  - a server added later is OFF;
  - two concurrent `resolve` calls in one process → one import (single-flight);
  - **first `set()` in a fresh workspace:** the import publishes, then `set` writes its explicit item; the toggle
    wins (N2);
  - a toggle made before a failed import survives a later import;
  - an `.mcp.json` error and an unreadable `~/.codex/config.toml` (EACCES) → `unverified`;
  - `setExplicit` with a same-name Codex-global declaration → approved (N6);
  - A vs B (AC-1.2); on-again writes an `inherit` tombstone and the UI shows inheriting (AC-1.3); files unchanged (AC-2.3); unknown id rejected.
- **Files (13):**
  - C `capability-resolver.service.ts` + `.spec.ts`
  - C `claude-approval.reader.ts` + `.spec.ts`
  - M `mcp-install.service.ts` + `.spec.ts`
  - M cli-agent-runtime `di/register.ts`, `src/index.ts`
  - M harness-sync `mcp-facet.port.ts`, `json-mcp-facet.ts`, `opencode-mcp-facet.spec.ts`,
    `codex-toml-mcp-facet.ts`, `codex-toml-mcp-facet.spec.ts` (an EACCES regression test: `inspect` → `error`,
    and `readAll` still returns empty)

### C5. Claude SDK enforcement — PR 1

- **Tokens:** agent-sdk `di/tokens.ts` adds `SDK_CAPABILITY_RESOLVER`, `SDK_CAPABILITY_GLOBAL_LAYER`,
  `SDK_HARNESS_POLICY_SYNC` and `SDK_MCP_SCHEMA_SIZE` (the last is implemented in PR 2 and injected optionally).
- **C5a `HarnessPolicySync`** (agent-sdk, N4): `apply(physicalRoot, fingerprint)`.
  1. `ensure(root, {force: fingerprint !== lastAck[key]})`.
  2. If the returned health's fingerprint differs from the expected one, or the pass was joined, call
     `ensure(root, {force: true})` again, at most once.
  3. Record `lastAck` only when `isHarnessPassAcknowledged(health, fingerprint)`.
  4. Return `acknowledged: boolean`.
- **Builder:**
  - verified policy: flags; ptah filtered; denied overrides removed;
  - `HarnessPolicySync.apply` runs in `SessionQueryExecutor` before the build. Unacknowledged is non-fatal for
    Claude, because `skillOverrides` already denies disabled skills natively; it is logged;
  - unverified policy: strict MCP + `skills: []`, preflight skipped, notice.
- **Model probe:** `strictMcpConfig: true`, `mcpServers: {}`, `skills: []`.
- **One-shots:** the same flags, or strict when unverified.
- **Ptah CLI registry:** resolve the policy first, then `HarnessPolicySync.apply`, then `assembleSpawnOptions`
  (reorders `:657-659`). The assembly carries the flags or the strict mode.
- **Tests:**
  - builder spec: repository OFF denied under a user `enableAll`; explicit ON approved; proxied parity; ptah
    default and OFF; back-off; parent-off children; unverified → strict + `skills: []` + notice;
  - `HarnessPolicySync` spec: acknowledged; fingerprint mismatch → second pass; `writeFailed` not acknowledged;
    null not acknowledged; a legacy CLI save changes the fingerprint → forced;
  - executor preflight spec;
  - runner spec;
  - model probe spec;
  - registry spec: ordering and flags.
- **Files (17):**
  - agent-sdk:
    - M `di/tokens.ts`
    - M `sdk-query-options-builder.ts`, C `.capabilities.spec.ts`
    - M `sdk-query-runner.service.ts` + `.spec.ts`
    - M `sdk-model-service.ts` + `.spec.ts`
    - M `session-query-executor.service.ts`, M `session-query-executor.harness-preflight.spec.ts`
    - C `harness/harness-policy-sync.ts` + `.spec.ts`
    - M `di/register.ts`, M `src/index.ts`
  - cli-agent-runtime: M `ptah-cli-spawn-options.service.ts`, M `ptah-cli-registry.ts`,
    C `ptah-cli-registry-capabilities.spec.ts`
  - chat: M `mcp-status-chip.component.ts`

### C8. RPC and hosts — PR 1

- `CapabilityRpcHandlers`:
  - `getState`, `getEffective` and `setEnabled` as in round 1;
  - the root comes from `canonicalPolicyRoot`;
  - `getState` attaches `schemaTokens` only if the optional `SDK_MCP_SCHEMA_SIZE` is registered (PR 2).
- `McpDirectoryRpcHandlers` install calls `setExplicit` (N6); on failure it returns `capabilityWarning`.
- **Files (11):**
  - C `capability-rpc.handlers.ts` + `.spec.ts` + `capability-rpc.schema.ts`
  - M `handlers/index.ts`, `src/index.ts`, `host-profile/manifest.ts`
  - M `mcp-directory-rpc.handlers.ts` + `.spec.ts`
  - M electron `phase-4-handlers.ts`, vscode `phase-3-handlers.ts`, `cli-engine/container.ts`

### C10. Marketplace UI — PR 1

- As in round 1:
  - store with optimistic update and revert;
  - `CapabilityToggleComponent` badges: new workspace server, imported, parent-off, unknown, inheriting/override;
  - the policy banner;
  - enforcement marks: PR 1 shows the rival MCP rows and the `ptah` CLI proxy row as "not enforced". A UI spec and
    the C11 e2e assert both labels;
  - duplicate-scope disclosure (#16): until PR 2, the detail view lists one `~/.claude.json` declaration per name
    (the definition in effect). The PR 1 description's release-notes section states that a name present in both
    `~/.claude.json` maps shows only its winning scope until the next update;
  - the figure renders when `schemaTokens` is present, otherwise "size unknown", which is always the case in PR 1.
- **Files (18):**
  - store + spec, toggle + spec
  - shell
  - provider-list-view ts, html, spec, testing
  - server-detail ts, html, spec
  - installed-servers-page + spec
  - installed-skills-page + spec
  - skill-detail + spec

### C11. Webview e2e — PR 1

- **Scenarios:** toggle write and reload; revert on failure; scope; "size unknown"; ptah OFF warning; the new
  repository server badge, where ON sends `{scope: 'workspace', enabled: true}`; imported badge; unverified banner;
  skill and plugin toggles; the rival lane and CLI proxy "not enforced" labels.
- **Files (2):** C `capability-toggles.spec.ts`, M `marketplace.fixtures.ts`.

### PR 2 components

- **C6 CLI lanes** (round 1 design plus N3): unverified → every rival lane is refused. The spawn path uses
  `HarnessPolicySync.apply`, and an unacknowledged pass → a warning with `partial` skill/plugin labels. Antigravity
  gets the ownership-gated cleanup. PR 2 flips the enforcement-table rows. **Files (10).**
- **C4b Codex quoted keys (#12):** `codex-toml-mcp-facet.ts` quoted-header parsing plus spec. **Files (2).**
- **C4c Claude declarations (#16):** `readClaudeUserMcpDeclarations` plus the reader spec; `mcp-install` switches to
  it. **Files (3):** M `claude-user-mcp.reader.ts` + `.spec.ts`, M `mcp-install.service.ts`.
- **C7 `McpSchemaSizeService` (N5):**
  - bounded `Promise.all([mcpServerStatus(), getContextUsage({detail: 'summary'})])` within 3 s;
  - figures only for servers currently `connected`, with the token re-checked after the awaits;
  - memo keyed by `(token, server, configHash)` and invalidated on disconnect or reconfiguration;
  - no cross-session reuse;
  - tests: connected→failed in one session → unknown; pending→connected → figure; ended → unknown; timeout; AC-5.3
    fixture pair.
  - **Files (4):** C service + spec, M agent-sdk `di/register.ts`, M `src/index.ts`.
- **C9 CLI proxy collector** (#14, #9): the round 1 design, plus known ptah OFF preserved on unverified.
  **Files (2).**

## Integration architecture

- **Toggle flow:**
  1. UI (optimistic) → `capabilities:setEnabled` → validate.
  2. Resolver `ensureImported` (one atomic `imported.json`), then one atomic explicit-item write, or
     `saveWorkspacePluginConfig(physicalRoot)`.
  3. Harness propagate for skill/plugin.
  4. Entry returned → UI reconciles.
- **Session flow:** `resolve(cwd)` → verified: flags plus `HarnessPolicySync.apply(fingerprint)`; unverified:
  strict MCP + `skills: []`, frozen harness, rival lanes refused.
- **State ownership:**
  - `~/.ptah/capabilities/**`: one explicit file per toggle, plus one `imported.json` per workspace. Only
    `CapabilityToggleStore` writes them, all by atomic rename and with no lock.
  - `PluginConfigState`: workspace storage, owned by `PluginLoaderService`.
  - Acknowledged fingerprints: memory in `HarnessPolicySync`, per process. A new process re-verifies on its first
    session, which is safe.
- **Boundaries:**
  - zod at RPC entry;
  - ids validated against the inventory;
  - git runs as argument arrays with timeouts;
  - Codex key quoting (PR 2);
  - no user file is written.
- **Observability:** `IOutputChannel` lines name root, item, provider, reason and fingerprint; the chat notice and
  the Marketplace banner cover unverified policy.

## Quality requirements and AC map

- **Security:**
  - No repository-authored file makes a server start.
  - Unknown policy never widens the MCP, skill or plugin set.
  - No lost update across processes: every mutation is a single-item atomic rename; the import is one complete file in a
    lower layer (C2 tests).
- **Performance:** resolve does two `readdir`s plus tens of tiny item reads and about ten declaration reads, with no
  git after `imported.json` exists (under 20 ms warm). A toggle is one atomic write, with no lock wait.
- **AC map:**

  | AC | Proven in |
  | --- | --- |
  | 1.1 | C2, C11 |
  | 1.2 | C4 |
  | 1.3 | C1, C4 |
  | 1.4 | C2, C8, C10, C11 |
  | 1.5 | C10 |
  | 2.1 | C1, C4 (C4c in PR 2), C11 |
  | 2.2 | C10 |
  | 2.3 | C2, C4 |
  | 2.4 | C10 |
  | 2.5 | C1 |
  | 3.1 | C4, C8, C10, C11 |
  | 3.2 | C1, C3 |
  | 3.3 | C3, C5a |
  | 3.4 | C3, C5 |
  | 4.1 | C4, C1 |
  | 4.2/4.3 | C5, plus a live proxied capture |
  | 4.4 | C6 (PR 2) |
  | 4.5 | C6 (PR 2), C5 (Ptah CLI) |
  | 4.6 | C5, C10 |
  | 4.7 | C5 |
  | 4.8 | C10 (PR 1 labels), C6 |
  | 4.9 | C5a, C10 |
  | 5.1-5.4 | C7 (PR 2), C8, C10 |

- **Assumptions to verify live (senior-tester):**
  - A1: flag-tier deny and approve behaviour.
  - A2: `skillOverrides`, `deniedMcpServers` and `skills: []` are honoured on CLI 0.3.278.
  - A3: Codex `enabled=false` with quoted keys (PR 2).
  - A4: `mcpServerStatus` and `getContextUsage` are safe mid-turn (PR 2).
  - A5: the AC-5.3 method agreement (PR 2).

## Dependencies and follow-ups

- **TASK_2026_559_8ca9** consumes the shared `EffectiveCapabilitySet`, `ICapabilityResolver` and
  `isMcpServerEnabled`, plus `SDK_CAPABILITY_RESOLVER` or `capabilities:getEffective`. There is no edit to
  `protocol-dispatcher.ts`.
- **Follow-ups outside this task:**
  - `PtahFileSettingsManager` defects (object flattening, swallowed persist errors, non-transactional writes).
  - The harness-sync `file-lock.ts` ownership and stale-recovery weaknesses found in reviews r2 and r3 (empty-lock
    window, path-based release, PID reuse). This task no longer uses or changes that lock, and existing callers'
    locking behaviour is unchanged.
  - Native Claude and Codex desktop plugins are not in Ptah's inventory and are labelled "not managed by Ptah".
  - An isolated `CODEX_HOME`.
- **Nothing from either review is deferred beyond PR 2.**

## Team-leader handoff

- **Executors:**
  - backend-developer: C1-C9.
  - frontend-developer: C10.
  - senior-tester: C11, the C2 concurrency tests, the AC report and A1-A5.
- **Complexity:** HIGH.
- **Ordering:** C1 → C2 → C3 → C4 → C5 → C8 → C10 → C11. PR 2 starts after PR 1 merges.
- **PR 1:** C1 9 + C2 2 + C3 7 + C4 13 + C5 17 + C8 11 + C10 18 + C11 2 = **79 code files**, plus about 11 task
  docs, for about 90. The change: minus C2a's 4 lock files, plus the Codex facet and its spec (N9).
- **PR 2:** C6 10 + C4b 2 + C4c 3 + C7 4 + C9 2 = **21 code files**, plus docs (unchanged). PR 2 re-touches files
  already in PR 1 (agent-sdk register and index, mcp-install, the Codex facet and its spec), and they are counted in
  its 21.
- **Moved from PR 1 to PR 2 to meet the ≤92 target:** C7 schema size (AC-5.x completes in PR 2), C9 proxy
  collector, C4b Codex quoted keys and C4c `~/.claude.json` duplicate declarations. Each is labelled in PR 1's UI
  (size unknown; rival and proxy rows "not enforced") and needed for task completion.
- **Batches (Nx projects):**
  1. `@ptah-extension/shared`.
  2. `@ptah-extension/harness-sync` (facets including the Codex `readStatus`, source resolver, reconciler).
  3. `@ptah-extension/cli-agent-runtime` (store, reader, inventory, resolver).
  4. `@ptah-extension/agent-sdk` (tokens, loader, `HarnessPolicySync`, builder, runner, model, executor).
  5. cli-agent-runtime Ptah CLI files and the `@ptah-extension/chat` chip.
  6. `@ptah-extension/rpc-handlers`, `@ptah-extension/cli-engine`, `ptah-electron`, `ptah-extension-vscode`.
  7. `@ptah-extension/marketplace`.
  8. `ptah-electron-e2e`, `@ptah-extension/webview-e2e-harness`.
  9. PR 2: cli-agent-runtime lanes, the harness-sync Codex facet, agent-sdk schema size, `ptah-cli` collector.
- **Verification:**
  - `npx nx run-many -t lint,typecheck,test -p <projects>`;
  - the harness-sync facet and reconciler specs;
  - `manifest.spec.ts`;
  - `nx e2e ptah-electron-e2e`;
  - `git diff --stat origin/main | tail -1` under the per-PR budget.
- **Open user decisions:** none.

---

## Appendix A: review rounds (was implementation-plan-review.md)

Moved here verbatim by budget lever D2 (batches.md, running count).

# Implementation plan reviews - TASK_2026_560_2ae5

All four design-review rounds, merged into one file by budget lever L1 (batches.md, running count).
Each round below is the original file's content, verbatim, under its own heading.

## Round 1 (was implementation-plan-review.md)

# Implementation plan review — TASK_2026_560_2ae5

Verdict: REVISE

Reviewed requirements, research, the complete 829-line plan, the cited implementation paths, Claude SDK 0.3.278 types and Codex SDK 0.155.1 serialization. References below are worktree-relative. This is a design review, not an implementation verdict. Existing user decisions remain unchanged.

## Defects

### 1. Blocker — Toggle objects and import markers disappear on reload
- Plan: C2, lines 266–278; persistence/restart guarantee.
- Evidence: `libs/backend/platform-core/src/file-settings-manager.ts:83` reads only an exact cache key; `:460` loads through `flattenObject`; `:529` recursively flattens every plain object. `libs/backend/platform-vscode/src/settings/vscode-settings-adapter.ts:70` delegates to this manager; CLI/Electron do likewise.
- Scenario: save `{items:{'mcp:repo':false}, importedAt:...}` at the workspace key. Restart or receive an external file-watch update: the cache contains descendant keys, not the workspace object. Both the override and marker read as absent. Global maps have the same problem. Imports repeat and disabled capabilities can return.
- Fix: specify an atomic leaf encoding supported by this store, such as a versioned serialized string/array, or explicitly implement opaque-object keys in the manager. Test real manager round trips and watcher reloads, not just an in-memory `ISettingsStore`.

### 2. Blocker — Disk failures cannot reach the proposed rollback handler
- Plan: C2 failure behaviour and C8/C10 write-error reversion, lines 290–299, 581–584, 617–618.
- Evidence: `libs/backend/platform-core/src/file-settings-manager.ts:98` mutates the cache before persistence; `:497–502` catches persistence errors without rethrowing; `:103–105` subsequently reports success to listeners.
- Scenario: a permissions error or full disk prevents saving an OFF toggle. `writeGlobal` resolves, so the UI reports success, subsequent reads use the unsaved value, and restart restores the old state. An unsaved import marker also suppresses retries within that process.
- Fix: add an acknowledged, rejecting persistence operation with cache rollback/commit-after-success, wire all adapters to it, and include the manager changes in C2. Inject actual manager I/O failures in tests.

### 3. Blocker — Re-reading before writing does not make imports or toggles cross-process safe
- Plan: one-time import idempotency, lines 167–174; C2 concurrency test.
- Evidence: `libs/backend/platform-core/src/file-settings-manager.ts:83` reads a process-local cache; `:49` serializes only that instance; `:486` writes its entire snapshot; `:494` uses the same `settings.json.tmp` in every process. The watcher is delayed by 50 ms (`:37`). `ISettingsStore` has no transactional update (`libs/backend/settings-core/src/ports/settings-store.interface.ts:10–15`).
- Scenario: process A reads before import; B finishes import and saves a user's OFF; A writes its earlier ON plus marker afterward. A's `set()` awaiting its own import does not order B. Even writes to different workspace/global keys can overwrite each other, and simultaneous renames contend for the same temporary file.
- Fix: perform fresh disk read, absent-key merge/compare and durable commit inside one cross-process transaction/lock shared by every settings writer; use unique temporary files. Test interleaved import versus toggle and different-key writes across two manager instances/processes.

### 4. Blocker — Repository-controlled approvals can bootstrap their own trust
- Plan: one-time import sources and union, lines 142–153; security promise, lines 765–768.
- Evidence: `libs/backend/harness-sync/src/lib/targets/mcp/mcp-facet.registry.ts:119–130` reads repository `.mcp.json`; `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:6538` exposes approvals by name; `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:988–992` retains project/local settings sources. The proposed reader includes repository `.claude/settings.json` without a provenance/trust check.
- Scenario: a newly cloned repository contains `.mcp.json` launching a program and committed `.claude/settings.json` with `enableAllProjectMcpServers:true` (or an enabled-name list). On first resolution the plan imports these as the user's approvals, persists ON, and explicitly approves startup, despite no user approval ever occurring.
- Fix: distinguish user-recorded approval from repository-authored settings. Import repository-file approvals only after a verified prior user trust/approval decision for that workspace, or import exclusively from user-owned approval records. Add a fresh-untrusted-clone fixture alongside existing-user import fixtures.

### 5. Blocker — Enforcement deliberately fails open, including unreadable declarations
- Plan: C4 lines 395–397, C5 lines 461–465, C6 lines 517–518, C9 lines 602–604.
- Evidence: `libs/backend/harness-sync/src/lib/targets/mcp/json-mcp-facet.ts:188–195` silently turns parse/read errors into `{}`; `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:392–403` emits no deny keys for an empty list, while `:988–992` still enables native discovery. The display facet cannot tell the resolver that discovery failed.
- Scenario: `.mcp.json` is transiently unreadable during resolution, then readable when Claude starts with an existing enable-all setting. The server is absent from Ptah's deny set and starts. A resolver failure also restores explicitly disabled servers/ptah; C9 returns unfiltered definitions after its policy lookup fails.
- Fix: give enforcement readers an explicit unknown/error state, distinct from empty inventory. On unresolved policy, launch only a verified safe set using strict discovery suppression, or refuse the affected launch with an actionable error. Proxy collection should omit unverified tools. Logging alone does not enforce OFF.

### 6. Major — Session cwd is not the workspace policy identity
- Plan: C4 `resolve(root)`, C5 `resolve(cwd)`, C6 `resolveCapabilities(workingDirectory)`.
- Evidence: `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:250–256` explicitly permits sub-package working directories. `libs/backend/harness-sync/src/lib/preflight/harness-preflight.service.ts:148–151` resolves them to a workspace root; `libs/backend/settings-core/src/scope/workspace-scope-resolver.ts:20–40` merely resolves/hashes the supplied path.
- Scenario: Marketplace disables ptah at `D:/repo`; a lane starts in `D:/repo/libs/backend`. The proposed resolver hashes a different workspace and reads declarations from the subfolder, so it sees default ON. Harness and SDK policy now describe different workspaces.
- Fix: specify one canonical policy-root resolver at every session boundary, preserving cwd separately. Reuse the exported harness root resolver where appropriate and pin root/subfolder, worktree and Windows path-alias cases.

### 7. Major — Discovery used for enforcement disagrees with discovery used for display
- Plan: default rule lines 127–135 versus C4 inputs lines 368–370 and `list` at 376.
- Evidence: `libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-install.service.ts:239–244` includes all facet, Claude-user, Smithery and OAuth rows; `:280–284` enumerates every target. C4's enforcement inventory omits user-global Codex/Copilot/Antigravity facets and Smithery/OAuth declarations unless represented by an intent.
- Scenario: the same name exists in `.mcp.json` and a hand-authored global Codex config, without a Ptah entry. `list` classifies it as user-scope/default ON, while `resolve` sees only the repository declaration and denies it. The UI and spawned lanes disagree about the effective set.
- Fix: use one declaration/provenance inventory for both resolution and display, retaining target-specific definitions. Test identical effective results from `list` and `resolve` for every supported source combination.

### 8. Major — Plugin/skill writes do not accept the resolved workspace root
- Plan: C4 `set(root,...)` delegates to `saveWorkspacePluginConfig`; C3 changes only its optional fields.
- Evidence: `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:707–708` can read an explicit root, but `:760–768` accepts no write root, `:777` reads the active config, and `:791` updates active `workspaceState`.
- Scenario: a request resolves workspace A, then the active workspace changes to B during awaited import/inventory work. The handler computes A's list changes but saves them into B; recomputing A's entry can even report the old state after corrupting B's configuration.
- Fix: add an optional explicit workspace root to the save operation, capture `storageFor(root)` for the complete operation, and preserve old callers' active-scope behavior. Add an A-to-B switch-during-save test.

### 9. Major — Parent plugin OFF is not carried through the session/proxy contract
- Plan: C4 disabled lists, C5 `CapabilityFlagInput`, C9 filters.
- Evidence: `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:1143–1156` excludes disabled plugins only from harness paths; `:944` returns the skill denylist separately. `apps/ptah-cli/src/services/proxy/workspace-mcp-collector.ts:111–139` enumerates all listed plugins and requests their skills. SDK native plugin control exists at `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:6964–6969`.
- Scenario: turn a plugin OFF while its child skills have no explicit OFF entries. The planned per-skill C9 filter still exposes those skills because their default is ON. C5 receives no `disabledPluginIds`, so it also has no fallback for an existing native plugin or stale copied skills when harness cleanup has not occurred.
- Fix: define parent-disabled behavior explicitly; exclude children of disabled plugins in every consumer. Translate plugin identities into native `enabledPlugins:false` where applicable, and expand affected skill invocation names for Claude fallback filtering. Label unsupported native inventories honestly rather than claiming full plugin enforcement.

### 10. Major — Harness preflight is not proof that disabled copies were removed
- Plan: C6 lines 506–514 and integration lines 697, 722 rely on preflight for full skill/plugin enforcement.
- Evidence: `libs/backend/harness-sync/src/lib/preflight/harness-preflight.service.ts:85` throttles for 60 seconds; `:167–171` can skip the pass and stamps before completion; `:201–209` continues on timeout. `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-spawn-environment.service.ts:419–429` ignores failure.
- Scenario: workspace B recently ran a preflight; a global plugin OFF is saved from A. C8 reconciles A only. A new B lane within the throttle window loads B's old copies. A failed reconcile can leave them indefinitely even though the enforcement table says enforced.
- Fix: include the effective capability revision in preflight freshness, invalidate affected workspaces after global changes, and require acknowledged cleanup or a provider-native deny fallback. Test skipped, timed-out and failed reconciliation before claiming enforcement.

### 11. Major — Skipping Antigravity setup must also skip its cleanup
- Plan: C6 line 504 says to skip the per-run ptah write when OFF.
- Evidence: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts:628–634` captures the prior entry only during setup; `:826–829` independently schedules cleanup whenever `mcpPort` exists; `:573–579` removes the global key when prior is undefined.
- Scenario: implement the specified setup guard, leave `mcpPort` set, and finish an OFF lane. No prior entry was captured, so cleanup deletes the persistent global ptah entry used by other workspaces. This is separate from the explicitly accepted not-enforced limitation.
- Fix: track successful setup/ownership and guard restoration with that same state. Test OFF lanes leave the global file unchanged both at launch and at exit, including alongside an ON lane.

### 12. Major — Codex configuration-name handling is not the claimed safe contract
- Plan: C6 lines 496–498 and integration lines 706–707.
- Evidence: `libs/backend/harness-sync/src/lib/targets/mcp/codex-toml-mcp-facet.ts:423–428` splits table headers at the first dot without TOML quoted-key parsing. `node_modules/@openai/codex-sdk/dist/index.js:346–350` interpolates map keys into dotted paths without quoting; `toTomlValue` protects values, not these path segments.
- Scenario: a valid config table `[mcp_servers."team.search"]` is discovered with the wrong name and/or emitted as an override for nested `team.search`, leaving the real server enabled or producing invalid config. RPC's proposed control-character check does not prevent this.
- Fix: use a TOML-correct discovery path and explicitly quote each override path segment, using the SDK's raw config override facility where needed. Test quoted names, dots and whitespace through actual serialized arguments.

### 13. Major — Native SDK model discovery remains outside the policy boundary
- Plan: C5's assertion that every Claude SDK session is covered.
- Evidence: `libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.ts:817–842` starts a separate `query()` with user/project/local sources and only `PTAH_DISABLE_SDK_AUTO_MEMORY`; it does not use the main builder or one-shot runner. Its cwd is the home directory (`:833`).
- Scenario: globally disable a user-configured MCP server, then refresh the native Claude model list. This query still permits native MCP discovery independently of the capability resolver.
- Fix: make metadata probes explicitly tool-free/discovery-free (`strictMcpConfig` plus an empty map, with plugins/skills appropriately suppressed), or route them through the same policy builder. Include this file and a probe-options assertion in the inventory.

### 14. Major — The proxy cache can re-expose an OFF capability in the next session
- Plan: C9 adds filtering but no cache policy change; AC-4.9 applies to the next session.
- Evidence: `apps/ptah-cli/src/services/proxy/workspace-mcp-collector.ts:89–91` returns cached tools before any RPC; `:152–154` caches them for ten seconds by workspace only.
- Scenario: collect with a server ON, switch it OFF, immediately start a new session in the same workspace. The collector returns its old tool definitions without checking the new policy.
- Fix: key/cache collections by a policy revision or filter the cached inventory against a current session capability snapshot. Invalidate on local and cross-process changes, and test a new session inside the TTL.

### 15. Major — Cached schema figures violate the explicit no-stale-number criterion
- Plan: C7 lines 543–550 returns cached success on no session, timeout or rejection; C8 attaches it to enabled entries.
- Evidence: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2843–2854` measures a particular query's context; `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:56–64` gives each query a distinct registration token/config. C7 keys only by workspace, not that identity or server definition.
- Scenario: measure server X, end that query, change X's config or let its next connection fail, then open Marketplace. It shows the previous numeric figure instead of AC-5.2's “size unknown”; the total includes it too.
- Fix: attach query/config identity and connection validity to figures, invalidate on replacement/failure and return unknown when no current measurement exists. If historical figures are useful, show them separately as historical, excluding them from the current total.

### 16. Major — Adding scope to rows cannot recover declarations already discarded
- Plan: C4 only adds `scope` to `McpInstallService` rows; resolution requires all source scopes and the winning definition.
- Evidence: `libs/backend/cli-agent-runtime/src/lib/mcp-directory/claude-user-mcp.reader.ts:90–106` stores user entries by name and then overwrites them with project entries. `libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-install.service.ts:252` deduplicates by origin/path/name without scope.
- Scenario: `~/.claude.json` contains the same name in its user and project maps with different definitions. Only the project row survives; adding its scope cannot display “Global + Workspace” or explain the overridden definition as AC-2.1/2.5 require.
- Fix: preserve declarations with scope/location identity separately from winner selection, and include scope in downstream deduplication. Test duplicate names in both maps of the same file.

## Verified claims and limits

- Claude SDK 0.3.278 really defines `enabledMcpjsonServers`, `disabledMcpjsonServers`, `skillOverrides` and cross-scope `deniedMcpServers` (`sdk.d.ts:6538–6600`). `:6897` confirms denials merge across sources. Their existence is verified; the proposed live direct/proxied A1/A2 checks still need execution, including explicit ON after a previously imported/native OFF.
- The existing builder emits both denial forms (`sdk-query-options-builder.ts:392–396`), receives only back-off names (`:914–961`), and merges caller MCP overrides last (`:1549–1556`). Direct and custom-base-URL builds share that flag-settings call.
- The one-shot and Ptah CLI injection sites cited by C5 exist (`sdk-query-runner.service.ts:394–442`; `ptah-cli-registry.ts:787–822`). Rival lanes share `AgentProcessManager`'s options boundary (`agent-process-manager.service.ts:336–356`).
- SDK summary context usage and per-server tool-token fields exist (`sdk.d.ts:2846–2854`, `:3768–3773`). No server-spawning measurement service is necessary for that source, but A5's same-method accuracy claim remains unproven.
- The new agent-sdk → settings-core edge is permitted: `eslint.config.mjs:260–261,365–372`, `libs/backend/agent-sdk/project.json:7`, `libs/backend/settings-core/project.json:6`. Inspection found no settings-core reverse import of agent-sdk/harness-sync/cli-agent-runtime/vscode-core. Shared wire types and platform-port logging preserve the proposed boundaries.
- The existing workspace hash/write separation is real (`workspace-scope-resolver.ts:34–40,197–229`); the plan correctly avoids using active-only writes for arbitrary MCP roots.
- The listed component counts total 82 before optional fixtures/task documents. The current estimate fits the cap, but persistence and identity fixes require re-counting; moving mandatory lane enforcement to a later PR must not be described as completing this task.
- Read-only verification: executed the actual file-manager class after TypeScript transpilation with an in-memory filesystem substitute. Reproduced missing object keys after reload, a resolved write despite injected EACCES, and loss of another manager's unrelated key. No source or user settings were written. Scoped `ptah_get_diagnostics` for the builder reported zero errors. No live provider sessions, network requests, or workspace-wide checks were run. File/AGENTS/CLAUDE searches returned no applicable instruction files; native reads supplemented the available AST tool.

## Round 2 (was implementation-plan-review-r2.md)

# Implementation plan review — round 2

Verdict: REVISE

Reviewed the complete revised plan (655 lines). RESOLVED means the design now specifies an adequate correction, not that unimplemented code has passed testing. D1–D3 and Q1 are unchanged. All paths are worktree-relative; plan line numbers refer to `implementation-plan.md`.

## Original findings

| Defect# | Status | Evidence |
| --- | --- | --- |
| 1 | RESOLVED | C2, plan 210–225: dedicated JSON document, fresh reads, real round-trip tests. This avoids `libs/backend/platform-core/src/file-settings-manager.ts:460–464,529–535`, which flattened the former object values. |
| 2 | RESOLVED | C2, plan 217–226: no premature cache mutation; rename errors reject. `libs/backend/harness-sync/src/lib/fs/atomic-write.ts:50–70` really rethrows final errors and cleans the temporary file. Export exists at `libs/backend/harness-sync/src/index.ts:296`. |
| 3 | PARTIAL | C2/import, plan 140–143,217–230, replaces cached read/write with locked fresh transactions. Helpers are exported at `libs/backend/harness-sync/src/index.ts:115–121`; unique temporary names exist at `fs/atomic-write.ts:36–40`. However, `lock/file-lock.ts:157–218,298–310` is not safe against lock-initialization/ownership races and is not reentrant. N1/N2 below. |
| 4 | RESOLVED | Import, plan 123–137, excludes tracked local settings, committed project settings and unscoped global approvals. `libs/backend/cli-agent-runtime/src/lib/mcp-directory/claude-user-mcp.reader.ts:109–129` supplies the per-project matching precedent. Argument-array git execution is feasible in this Node backend (`cli-agents/cli-adapters/cli-adapter.utils.ts:8–12,280–290` already uses process spawning); `git --version` succeeded. Distinguish expected “not tracked/not ignored” exit statuses from git failures as the plan requires. The proposed git checks themselves are not implemented or live-tested here. |
| 5 | PARTIAL | Fail-closed policy/C4/C5, plan 147–165,263–264,335–337, closes the MCP-discovery hole using status-bearing readers and `strictMcpConfig`. The installed SDK supports this (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2193–2200`). It does not suppress unknown disabled skills/plugins; C3 explicitly treats failed global policy as empty. N3. |
| 6 | PARTIAL | Policy root/C4, plan 94–96,293, fixes subfolder identity using the exported root resolver (`libs/backend/harness-sync/src/index.ts:86`; `src/lib/workspace/workspace-root.ts:66–85`). But folding the physical root on every Darwin filesystem introduces a new path failure. N7. |
| 7 | RESOLVED | C4, plan 269–285, makes all facets, Claude, Smithery and OAuth one inventory for display and resolution. This covers the disparate sources currently joined by `libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-install.service.ts:239–244,280–284`. Parity tests are specified. |
| 8 | RESOLVED | C3, plan 241–254, captures explicit-root storage for both read and update. That directly addresses the existing active-only write at `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:777–791` while reusing `:661–679` for scoped storage. |
| 9 | RESOLVED | Resolution/C4/C5/C9, plan 105,281–282,327–331,464–466, explicitly propagates parent OFF into bare/qualified skill denials and the proxy's parent filter. Existing child identity is available at `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:1228–1235`; current proxy enumeration is at `apps/ptah-cli/src/services/proxy/workspace-mcp-collector.ts:111–139`. Native inventories are explicitly marked unmanaged rather than represented as covered. |
| 10 | PARTIAL | C5/C6, plan 339–340,377–381, adds forced preflight and honest partial labels for rivals. `IHarnessPreflight` already accepts force (`libs/backend/agent-sdk/src/lib/harness/harness-preflight.port.ts:30–50`). But a non-null report is not successful cleanup, force can join an older pass, and workspace skill writes do not change the file revision. N4. |
| 11 | RESOLVED | C6, plan 391–404, now gates cleanup on successful setup ownership. This directly covers `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts:628–634,826–829,573–579`. Launch/exit/concurrent-lane tests are specified. |
| 12 | RESOLVED | C4/C6, plan 265,383–401, specifies quoted TOML header parsing and pre-quoted SDK key segments. The latter fits the actual verbatim join at `node_modules/@openai/codex-sdk/dist/index.js:346–350`; the former corrects `libs/backend/harness-sync/src/lib/targets/mcp/codex-toml-mcp-facet.ts:423–428`. Actual serialized-argv tests cover the boundary rather than only an object assertion. |
| 13 | RESOLVED | C5, plan 342,357, adds strict empty MCP configuration and an empty skill set to the independent model probe at `libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.ts:829–842`. SDK strict-MCP and skill filter contracts exist at `sdk.d.ts:2193–2200,2157–2174`. |
| 14 | RESOLVED | C9, plan 462–469, checks policy before every cache hit and filters cached inventory. This directly replaces the bypass at `apps/ptah-cli/src/services/proxy/workspace-mcp-collector.ts:89–91`; the TTL test is specified. Preserve known ptah OFF when filtering an unverified result, consistently with plan 152–153. |
| 15 | PARTIAL | C7, plan 416–429, removes cross-session reuse and returns unknown on measurement failure. But its connection source only reports session init; it does not establish current connection validity. N5. |
| 16 | RESOLVED | C4, plan 266–271,308–311, preserves declarations separately from winner selection and includes scope in deduplication. This directly fixes `libs/backend/cli-agent-runtime/src/lib/mcp-directory/claude-user-mcp.reader.ts:90–106` and `mcp-install.service.ts:252`. |

## New defects and remaining defects in the replacement mechanisms

### N1 — blocker — The reused lock can admit two owners
- Plan: review resolution #3; C2, lines 217–230.
- Evidence: `libs/backend/harness-sync/src/lib/lock/file-lock.ts:159–162` creates an empty file before writing its payload; `:188–203` immediately deletes an unreadable/unparseable payload; `:200` checks age only, not whether the owner is alive; `:216–218` releases by unconditional path deletion. `withFileLock` also allows the task to run on `no-lock-directory` (`:303–308`).
- Failing scenario: A creates the lock and is descheduled before writing its payload. B reads the empty file, removes it and acquires a new lock. A resumes and enters its transaction too; A's eventual release can delete B's lock. A live holder paused beyond 30 seconds can similarly lose ownership. Atomic renames then lose acknowledged toggle updates.
- Fix: harden the primitive or use a proven cross-process locking implementation before relying on it for capability policy. Require acquired ownership, safe initialization/stale handling, ownership-checked release and a live-owner/lease strategy. Add deterministic two-process interleaving tests, not merely two sequential store instances. Include helper changes in the file budget.

### N2 — major — Import and mutation acquire the same non-reentrant lock twice
- Plan: import lines 140–143 and integration 535–537 say `set` holds the lock while awaiting `ensureImported`; C2 lines 217–218 says `importWorkspace` and setters acquire that lock themselves.
- Evidence: `libs/backend/harness-sync/src/lib/lock/file-lock.ts:234–264,298–310` has no reentrancy/owner token and times out while a fresh lock exists. Its separate `serializeByKey` queue (`:135–150`) does not make nested locking reentrant either.
- Failing scenario: first toggle in a workspace takes the outer lock, calls `ensureImported`, and awaits `importWorkspace`, which waits for the outer lock. It fails after the timeout; similarly, calling a locking setter inside the described outer transaction repeats the problem.
- Fix: define one transaction owner. Inside it use explicit non-locking read/mutate helpers over the already-read document, or finish an independently locked import before a separately locked mutation that re-reads and preserves current state. Do not hold the lock while awaiting a single-flight promise whose completion needs that lock. Test the first `set`, not just first `resolve`.

### N3 — blocker — “Unverified” still widens the skill/plugin set
- Plan: C3 lines 248–249; fail-closed policy lines 151–154; security line 561.
- Evidence: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2193–2200` limits strict mode to MCP configurations; `:6548–6551` says absent skill overrides mean ON. `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:1143–1156` derives copied plugins from the effective configuration, which C3 now defaults to an empty global layer on read failure.
- Failing scenario: a plugin is globally OFF, then `capability-toggles.json` becomes unreadable. C3 can restore its default-enabled harness copies and C5 knows no names to deny. Claude starts with strict MCP but still discovers those skills. The advertised fail-closed guarantee therefore covers only part of the requested policy.
- Fix: distinguish unknown skill/plugin policy from an empty layer. Preserve a validated restrictive snapshot or suppress all discoverable skills/plugins on that path using the supported native controls; if complete suppression cannot be guaranteed, refuse the affected launch. Do not reconcile unknown state as “no exclusions.” Test corrupt-store behavior for a previously disabled plugin and its children.

### N4 — major — The revision acknowledgement does not identify a successful pass over that policy
- Plan: C2 revision lines 217–218; C3 workspace writes 241–245; C5 lines 339–340; C6 lines 377–381.
- Evidence: `libs/backend/harness-sync/src/lib/preflight/harness-preflight.service.ts:157–159` joins an existing pass before checking force. A non-null `HarnessHealth` can contain `writeFailed`, missing content or unavailable sources (`libs/shared/src/lib/types/harness-sync.types.ts:134–137,159–169,185–189`). Workspace `PluginConfigState` writes currently update only workspace storage (`plugin-loader.service.ts:783–791`); the revision is specified only for the separate capability file.
- Failing scenario: revision R's reconcile is running when an OFF produces R+1. The forced call joins R's pass, returns non-null, and C5 records R+1 as applied. Alternatively, failed deletion returns a non-null error report and is acknowledged. A workspace skill OFF may not change the revision at all, especially through the existing CLI save path, so a failed immediate propagation is followed by a throttled next session.
- Fix: include every effective input, including `PluginConfigState`, in a policy generation/fingerprint. Bind acknowledgements to the actual snapshot processed and successful target-specific cleanup; a joined older pass must trigger a subsequent pass. Apply that contract to Ptah CLI preflight too (`ptah-cli-registry.ts:657–659` currently runs before assembly resolves policy). Test concurrent revisions, non-null failure reports and legacy CLI writes.

### N5 — major — Init-time status cannot validate a live schema figure
- Plan: C7 lines 418–422, claimed resolution #15.
- Evidence: `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:519–530` publishes `servers` once at init; `session-mcp-status-callback-registry.ts:29–33` documents that limitation. `callback-registry.base.ts:22–44,51–52` is an event fan-out, not a current-state query. The SDK provides a current query at `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2836–2841`.
- Failing scenario: a server reports connected at init, is measured, and disconnects during the same query. Its stored init status still says connected; a later successful context estimate or memoized result can show a number when AC-5.2 requires unknown. Conversely, pending-at-init followed by connection can remain unknown forever.
- Fix: obtain bounded current `mcpServerStatus()` alongside measurement, or introduce a real continuously updated status source. Recheck session token/connection validity after awaits and invalidate memoized figures on disconnect/reconfiguration. Add a same-session connected-to-failed test.

### N6 — major — The install path does not always write the promised explicit ON
- Plan: new install rule lines 12–13,109–111 and C8 lines 444–445 calls generic `set`; generic workspace writes at 107 remove values equal to the inherited default.
- Evidence: the existing install inventory can contain the same key across targets (`libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-install.service.ts:246–255,280–284`). The installed SDK has separate project approval settings (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:6538–6542`), and plan 280 approves only explicit/imported ON entries.
- Failing scenario: a name already exists in global Codex configuration, making its inherited default ON. Install that server into workspace `.mcp.json`. Calling `set(..., true)` clears the workspace entry instead of recording explicit ON; the resolver therefore omits it from `approvedProjectMcpServers`. With native project auto-approval off, the just-installed server is not approved despite the new install guarantee.
- Fix: give install acknowledgement an explicit-ON mutation that retains a workspace entry even when equal to the inherited value, while preserving normalization for ordinary toggles. Test a workspace install with a same-name user-scope declaration and native auto-approval off.

### N7 — major — Case-folded policy identity is reused as a physical path
- Plan: policy-root rule lines 94–96 and C4/C8 pass that root to file reads, git and storage resolution.
- Evidence: `libs/backend/harness-sync/src/lib/workspace/workspace-root.ts:66–85` preserves the resolved filesystem path; `:112–116` folds comparisons only on Windows. `libs/backend/cli-agent-runtime/src/lib/mcp-directory/claude-user-mcp.reader.ts:175–182` uses folding for matching JSON keys, not for opening those paths. `JsonMcpFacet.configPath` joins the supplied root directly (`libs/backend/harness-sync/src/lib/targets/mcp/json-mcp-facet.ts:85–90`).
- Failing scenario: `/Volumes/CaseSensitive/Repo` on case-sensitive APFS becomes `/volumes/casesensitive/repo` on Darwin. Declarations look missing, git checks fail, and two distinct `Repo`/`repo` workspaces can share one policy key.
- Fix: keep the real/canonical filesystem path separate from the comparison/storage identity; do not assume all Darwin volumes are case-insensitive. Test distinct case-sensitive roots and preserve physical paths for every I/O operation.

## Verification and delivery limits

- Reused earlier repository/type-contract evidence and re-read the replacement helpers, preflight contract/implementation, status producer/registry and changed plan sections. Executed the actual lock helper after transpilation with an in-memory filesystem substitute: it stole a fresh empty lock, removed a replacement owner's lock on release, and rejected nested acquisition with `FileLockTimeoutError`. No test files or user data were created.
- Atomic-write export, final-error propagation and `<path>.<pid>.<sequence>.tmp` naming are verified. These solve atomic replacement, not mutual exclusion. No new dependency cycle is required by placing the store in cli-agent-runtime; agent-sdk consumes the shared interface/token instead of importing harness-sync.
- The split now explicitly keeps the task incomplete until both PRs merge (plan 631–635), resolving the previous delivery concern. The stated 79/10 code-file arithmetic is consistent, but N1/N4 and their tests require a revised count before asserting PR 1 remains below 100. PR 1 must retain its explicit not-enforced rival labels.
- No live provider sessions or A1–A5 checks were run. No source changes, git state changes, or workspace-wide checks were made. This final design review does not claim implemented behavior or approval of untested SDK runtime assumptions.

## Round 3 (was implementation-plan-review-r3.md)

# Implementation plan review - final round

Verdict: REVISE

Reviewed the 497-line plan. RESOLVED means adequately specified in the design, not implemented or runtime-tested. Remaining items below go to the user; no further architecture round is presumed. Paths are worktree-relative. `P` = `implementation-plan.md` in this task directory; `H` = `libs/backend/harness-sync/src`; `A` = `libs/backend/agent-sdk/src`; `C` = `libs/backend/cli-agent-runtime/src`; `SDK` = `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`.

| Item | Status | Evidence |
| --- | --- | --- |
| N1 | PARTIAL | C2a, P:165-198 improves publication, required acquisition and ownership checks. Existing `H/lib/lock/file-lock.ts:159-162,200-218,303-308` needs all those changes. The replacement still permits ownership races and an unsafe timed fallback; see residual N1 below. |
| N2 | RESOLVED | Import/C2, P:109-112,208-210,277-279 specifies completed import followed by a separate fresh transaction with pure mutators. This avoids the non-reentrant acquisition at `H/lib/lock/file-lock.ts:234-264,298-310`. First-set regression is explicitly required. |
| N3 | RESOLVED | Unverified/C3/C5, P:114-134,227-243,304 suppresses Claude skills, freezes managed copies, and refuses rival launch in PR 2. `SDK:2160-2174` supports an empty explicit skill set; `SDK:2193-2200` supports explicit-only MCP. This is a context filter, not file-access isolation, as `SDK:2163-2166` states. Live A2 remains a release check. |
| N4 | RESOLVED | Fingerprint/C5a, P:33,153-154,294-308 ties acknowledgement to processed inputs, includes PluginConfigState, rejects failed health and re-passes a mismatch. This addresses joining before force at `H/lib/preflight/harness-preflight.service.ts:157-162` and the separate storage update at `A/lib/helpers/plugin-loader.service.ts:783-791`. The existing API returns only health, not a joined flag (`preflight.service.ts:140`); the fingerprint-mismatch branch is implementable without adding that flag. |
| N5 | RESOLVED | C7, P:376-383 queries current status with bounded measurement and rechecks session identity. `SDK:2836-2852` supplies both methods; it replaces init-only status from `A/lib/helpers/stream-transformer.ts:519-530`. Same-session disconnect coverage is specified. Delivered in PR 2. |
| N6 | RESOLVED | Resolution/C4/C8, P:96-98,264,281,337 adds retained explicit workspace ON for install. This addresses same-name multi-source inventory at `C/lib/mcp-directory/mcp-install.service.ts:246-255` and separate native approval keys at `SDK:6538-6542`. |
| N7 | RESOLVED | Root/C4, P:81-85,268-269 separates physical I/O path from Windows-only folded identity. This matches `H/lib/workspace/workspace-root.ts:66-85,112-116`; `H/lib/targets/mcp/json-mcp-facet.ts:85-90` receives the physical path. Case-sensitive roots are tested explicitly. |
| #3 | PARTIAL | C2, P:203-211 supplies fresh, single-owner import/marker transactions and rejecting writes. Atomic replacement really rethrows (`H/lib/fs/atomic-write.ts:50-70`) and has unique temp names (`:36-40`). Mutual exclusion still depends on residual N1. |
| #5 | PARTIAL | Unverified/C3 resolves the skills/plugin widening defect (N3). C4, P:253 still cannot obtain an error by wrapping the swallowing Codex reader at `H/lib/targets/mcp/codex-toml-mcp-facet.ts:109-110,187-194`; see N9. |
| #6 | RESOLVED | Root/C4, P:81-85,259-269 uses the exported workspace resolver and physical root consistently (`H/index.ts:86`; `H/lib/workspace/workspace-root.ts:66-85`). Import, git, storage and SDK calls no longer use a lowercased Darwin pathname. |
| #10 | RESOLVED | C5a/C6, P:294-308,370-372 gives policy-specific acknowledgement and honest rival partial enforcement. Current force support exists at `A/lib/harness/harness-preflight.port.ts:30-50`; Ptah CLI ordering explicitly corrects `C/lib/ptah-cli/ptah-cli-registry.ts:657-659`. This resolution assumes the locking defect is fixed before concurrent writes are called safe. |
| #15 | RESOLVED | C7, P:376-383 replaces init-only validity with `SDK:2841` current status, token/config memo identity and timeout-to-unknown. P:351,446 explicitly keeps numeric measurements out of PR 1. |

## Remaining N1 - blocker - publication safety does not make lease recovery safe

- Section: C2a, P:171-184; existing primitive being replaced: `H/lib/lock/file-lock.ts:181-218`.
- Scenario: cross-host holder A checks its token for release and pauses. B expires A's lease, takes `.break`, renames A's lock away, then acquires the vacant path. A resumes its deletion and deletes B's lock. Checking the token before a separate unlink is not conditional unlink. The same gap exists between refresh's token check and rename: a displaced A can overwrite B's lock. Only breakers take `.break`, so the assertion at P:182 is false for release and refresh.
- Further failure: even perfectly serialized token operations cannot let an expired holder resume its protected JSON write after B has committed without fencing the write. The five-second fallback also reproduces the original empty-file race when A pauses longer than five seconds between `open('wx')` and payload write (`file-lock.ts:159-162`); the planned test only waits within the grace (P:192).
- Fix: use a proven process-lock primitive with a clearly bounded filesystem support contract, or specify a protocol that coordinates all ownership transitions and fences displaced writers before commit. Reject unsupported acquisition rather than substituting a timed empty-file guess for C2's required lock. Add deterministic pauses between check/delete, check/rename, lease loss/commit, and beyond the fallback grace. Existing P:194 tests displacement before release, which does not cover displacement inside release.

## New findings

### N8 - major - PID existence cannot establish owner identity

- Section: C2a, P:168,173,188; replacing `H/lib/lock/file-lock.ts:161,186-200`.
- Scenario: the lock owner crashes; its PID is reused, including after a reboot, by a long-running unrelated process on the same host. `kill(pid, 0)` succeeds, so the proposed same-host rule never reclaims the orphan. Every toggle write times out until that unrelated process exits. A UUID in the file does not identify the process answering the PID probe.
- Evidence: [Node's process contract](https://nodejs.org/api/process.html#processkillpid-signal) tests existence, not process creation identity. There is no birth/boot identity in P:168's payload.
- Fix: use verifiable process-instance identity or an OS-owned lock that is released on process death; define a safe recovery path when identity cannot be proved. Never kill the PID to reclaim this lock. Test an orphan whose PID now belongs to another process.

### N9 - major - the PR 1 Codex inspection wrapper cannot report read failure

- Section: C4, P:252-253,283-288.
- Evidence: `H/lib/targets/mcp/codex-toml-mcp-facet.ts:109-110` calls `readFile`; `:187-194` catches every read error and returns empty text. Wrapping `readAll` observes an empty map, not EACCES. This facet is also absent from C4's PR 1 file list; only its PR 2 parser edit is budgeted (P:373).
- Scenario: the global Codex configuration becomes unreadable. The shared inventory reports no declarations instead of unverified; Marketplace silently loses sources and the resolver treats an incomplete inventory as verified, contrary to P:114. Rival not-enforced labels do not repair shared discovery.
- Fix: add a status-bearing low-level read that distinguishes ENOENT from other errors, use it in PR 1 `inspect`, retain compatibility for legacy `readAll`, and include the facet and an EACCES regression in the PR 1 budget. Quoted-key parsing can still remain in PR 2.

## Windows and existing-caller compatibility

- The successful-link publication step is appropriate for one local supported filesystem: the initialized file is published before contenders can read it; EEXIST must be treated as contention. [Node documents linkSync](https://nodejs.org/api/fs.html#fslinksyncexistingpath-newpath); [Microsoft documents same-volume hard links, NTFS and sharing restrictions](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createhardlinkw). These contracts do not validate the later lease/release algorithm.
- A6 remains untested on actual NTFS/APFS, antivirus interference and OneDrive-backed homes. EPERM is not proof that hard links are unsupported; permission/sharing failures need bounded failure and diagnostics. Inference: separate cloud-synchronized copies do not become one atomic cross-host lock merely because each local copy supports hard links. Either exclude that topology or use actual shared coordination.
- Keeping `requireLock` opt-in preserves the old `withFileLock` API (`H/lib/lock/file-lock.ts:298-310`) and `acquireWorkspaceLock` handle contract (`H/lib/lock/workspace-lock.ts:57`). It does not make all existing consumers exclusive: `H/lib/reconciler/harness-reconciler.service.ts:393-423` logs and writes without an acquired handle; removal at `:277-317` and repair at `H/lib/repair/blocked-repair.service.ts:206-214,287-290` also proceed. This is existing behavior, not a newly introduced finding, but compatibility must not be described as a cross-process safety guarantee for those callers.
- Mixed-version callers also need a rollout test: the current `file-lock.ts:200-203,216-218` ignores the new token and can break/release by path. Upgrading one host does not retrofit a concurrently running old host. No source edits to these callers were made during review.

## PR 1 honesty and verification limits

- Schema deferral is honest: C8/P:336 and C10/P:351 always produce "size unknown" in PR 1; AC-5.x explicitly completes in PR 2 (P:446).
- #12 is assigned to C4b/P:373 and rival enforcement to C6/P:370-372, with PR 1 "not enforced" at P:150,350. Proxy deferral is stated at P:478-480, although C1/C10's detailed lists mention only rivals; retain the explicit proxy label in implementation and UI tests.
- #16 is explicitly deferred, and AC-2.1 names C4c/PR 2 (P:429). The old reader really collapses duplicate scopes (`C/lib/mcp-directory/claude-user-mcp.reader.ts:90-106`). PR 1 cannot claim complete source-scope coverage; its release notes/UI must disclose this limitation. AC-2.5's C1 unit rule (P:433) is not evidence of complete end-to-end inventory coverage; its UI verification must include C4/C10 and the PR 2 duplicate fixture. The two-PR split itself is accepted.
- No live SDK/provider sessions, filesystem mutation probes, builds or tests were run in this read-only review. Installed SDK types and current source support the resolved design contracts; A1-A6 remain execution gates. Only this deliverable was written. No git state was changed.

## Five logic questions - final disposition

1. Silent success: residual N1 can lose an acknowledged toggle; N9 can return a success-looking empty inventory.
2. Unexpected user action: the first toggle no longer nests locks (N2 resolved); a toggle after owner crash/PID reuse still times out (N8).
3. Wrong-answer input: unreadable Codex config is currently indistinguishable from empty input (N9); duplicate source coverage is explicitly PR 2.
4. Dependency failure: unknown policy is restrictive by design (N3 resolved); unsupported/blocked link creation must not fall back to residual N1's unsafe grace protocol.
5. Missing operational contract: displaced writers, mixed-version hosts and synchronized-home topology still need explicit safe handling before concurrency approval.

## Delta review (was implementation-plan-review-delta.md)

# Implementation plan delta review

Verdict: REVISE

Scope: changed store, error handling, fingerprint and disclosure sections only. RESOLVED means adequately specified, not implemented. `P` denotes this task's `implementation-plan.md`; `H` denotes `libs/backend/harness-sync/src`. The approved lock-free architecture and earlier resolved items are not reopened.

| Item | Status | Evidence |
| --- | --- | --- |
| Residual N1 | RESOLVED | P:29,61-67,182-189 removes locks from capability writes and drops C2a. The ownership operations at `H/lib/lock/file-lock.ts:181-218` are no longer dependencies of the new store. Ordinary updates use atomic replacement at `H/lib/fs/atomic-write.ts:50-70`. Import has a different publication defect, D1 below. |
| N8 | RESOLVED | P:29,164-189 has no PID-based owner or stale recovery. PID remains only a temporary-name component (`H/lib/fs/atomic-write.ts:39-41`), so PID reuse no longer strands a capability lock. |
| N9 | RESOLVED | C4, P:271-275,303,312 specifies direct status-bearing reads and an EACCES test in PR 1 while retaining legacy behavior. It explicitly bypasses the error-swallowing read at `H/lib/targets/mcp/codex-toml-mcp-facet.ts:187-194`. |
| #3 | PARTIAL | C2, P:182-198 avoids shared-document lost updates, but interrupted exclusive creates are permanently skipped and the marker can certify attempted rather than completed imports. D1 prevents approval of crash recovery and migration completeness. |
| #5 | PARTIAL | C4 closes N9; C2/P:205-206 makes malformed non-empty items unverified. However P:194-195 treats empty import artifacts as absent, which can discard an imported OFF and restore an ON default. D1 remains a fail-closed gap. |

## New store defects

### D1 - blocker - interrupted imports can permanently discard OFF decisions

- Section/evidence: C2, `P:191-198,230-232`; defaults at `P:84-90`. Exclusive creation precedes payload writing, existing files are skipped, and the marker follows attempts. This is not the complete-payload publication used by `H/lib/fs/atomic-write.ts:58-63`.
- Scenario: import plans OFF from `disabledMcpjsonServers`. A creates the file and dies before writing. B retries, skips the empty file on EEXIST and writes the marker. Every later read treats the file as absent. A repository-only name remains OFF, but a same-name user-scope declaration or global ON makes effective state ON; the trusted disabled decision was lost. For imported ON, the approval is permanently lost even in the repository-only case.
- Partial payloads are also visible to concurrent readers. A reader fails closed while a write is incomplete, which is safe; after a crash, that non-empty fragment remains unverified indefinitely because retries skip it. A second importer can publish the marker while the first importer still holds an unfinished item. Marker creation itself also needs a defined crash/empty-payload rule.
- Fix: publish complete import payloads atomically without overwriting explicit user state, and mark completion only after every planned entry is valid or superseded by a valid user decision. Treat incomplete publication as unknown, not default. Do not repair by unconditional delete/rewrite, which would race a user replacement. Test interruption before the first byte, during the payload, before marker completion, and an imported OFF whose inherited value is ON.

### D2 - blocker - hashed and literal IDs share a filename namespace

- Section/evidence: C2, `P:171-179,205-206`. Literal `h_` is allowed, and the long-ID fallback uses the same prefix without a reserved namespace.
- Concrete collision: ID `x` repeated 121 times hashes to suffix `79072a47bfaa54e6057a9ee21e0dea64b9edbfd1`. The distinct short ID `h_79072a47bfaa54e6057a9ee21e0dea64b9edbfd1` stays literal. Both map to `mcp__h_79072a47bfaa54e6057a9ee21e0dea64b9edbfd1.json`. Computed with SHA-256 in memory during this review; no filesystem probe was needed.
- Scenario: toggling either server overwrites the other's file; clearing either deletes the other's decision. The content/filename check does not catch this because both IDs legitimately generate that filename. An OFF can silently disappear.
- Fix: use disjoint filename namespaces, e.g. tag every literal encoding and every hash encoding differently, then validate the complete canonical filename from content. Add the exact long/literal pair above to the codec and independent-toggle tests. Ordinary percent encoding correctly distinguishes case and escapes reserved characters; this defect is the fallback namespace, not percent decoding.

## Remaining checks and explicit limitations

- **Clear/import exception:** P:199-201 openly allows stale import to undo a clear. Example: global OFF, old imported ON, another process clears to inherit OFF, delayed import restores workspace ON. This is broader than simultaneous user clicks: the later writer is replaying an older approval. It is an acknowledged limitation, not proof that the current decision is preserved. Marker-last retries mean the window can persist through repeated failures, not just one process lifetime. If clear must supersede migration, retain an explicit inherit tombstone or separate imported state below explicit user decisions. The approved per-item architecture does not require this exception.
- **Concurrent source snapshots:** P:197's claim that two imports necessarily have identical plans is not established: they read mutable approval/declaration files separately (P:98-104). Different snapshots can compete per item. Define that outcome explicitly and test it; do not claim order-independent migration when sources change during import.
- **Windows writes:** P:182-185,226 correctly requires retry then rejection through RPC/UI. `H/lib/fs/atomic-write.ts:63-70` rethrows final rename errors; `H/lib/fs/windows-retry.ts:86-97` retries recognized errors then throws. No additional defect found for EPERM/EBUSY rejection. Actual antivirus/open-handle behavior was not exercised. Import's direct `wx` path must likewise surface failures without committing its marker.
- **MCP fingerprint exclusion:** no new enforcement gap found within this delta. P:209-211 excludes toggle items, not native MCP install intents. Existing harness output reads separate `mcpIntents` (`H/lib/sources/plugin-config-source-resolver.ts:137,150,172`); capability MCP enforcement remains freshly resolved session flags/direct lane configuration (P:58-60,424). Skills/plugins and PluginConfigState remain in the fingerprint (P:255-257). Keep that distinction in tests if future code starts filtering harness MCP output by capability toggles.
- **Disclosure:** proxy not-enforced labels now appear in both the contract and UI/tests (P:145-146,375,394). The cloud-sync and network-filesystem exclusions are explicit (P:213-220); they do not establish the stronger assertion that a crash never widens state, as D1 demonstrates.
- Five logic checks: silent failure = D1/D2; unexpected user action = colliding toggle/clear; wrong-answer input = empty import artifact; dependency failure = rename rejects but interrupted import cannot recover; missing contract = precedence of clear and differing concurrent import snapshots.
- No source or git state changes, live provider sessions, or filesystem mutation tests. Only this deliverable was written. This is a delta review, not a fresh approval of the entire plan.

---

## Appendix B: research report (was research-report.md)

Moved here verbatim by budget lever D3 (batches.md, running count).

# Research Report - TASK_2026_560

## Question

- Decision this supports: how to implement per-workspace/global on-off enforcement
  for MCP servers, skills and plugins across every session build path (Claude SDK
  direct, proxied, Codex, OpenCode, Antigravity, Ptah CLI, one-shots).
- Question: where is the MCP/skill/plugin set built today per provider, what pin
  mechanism already exists to enforce an explicit subset, and what already exists
  in Ptah for scope resolution, schema-size measurement and Marketplace UI.
- Bounds: no design proposal, no code changes. Copilot/Cursor/GLM/pi-cli adapters
  were located but not read in depth (out of the named provider list).

## Answer

Every non-Claude-SDK path already builds MCP config as `{ ptah: {...} }` only, in
code Ptah owns; the gap is that none of them read an explicit allow/deny list —
they either omit third-party servers entirely (Codex/OpenCode/one-shots, but Codex
still inherits `~/.codex/config.toml`'s own `mcp_servers`/plugins because it never
sets `CODEX_HOME`) or let the CLI's own file resolution decide (Claude SDK direct,
which relies on `.mcp.json` + `enableAllProjectMcpServers`/`enabledMcpjsonServers`
in `.claude/settings*.json`, files Ptah does not read or write). The Claude SDK
`disabledMcpServers` pin mechanism (`sdk-query-options-builder.ts:373-411`) is
already wired end-to-end but only fed from MCP back-off, never from a user
toggle. Skills/plugins already have a full per-workspace enable/disable model
(`PluginLoaderService`, `disabledSkillIds`/`disabledPluginIds`/`enabledPluginIds`)
but it is VS Code `workspaceState`-only (no global scope) and gates only the
harness-sync file copies, not the Claude SDK `skills`/`plugins` options, which
Ptah never populates.

## Evidence

| Claim | Source | Date | Verified how |
|---|---|---|---|
| Claude SDK direct: `buildMcpServers` returns only `{ ptah: {...} }`; other servers reach the session through `.mcp.json`/`.claude/settings*.json` read by the CLI itself via `settingSources` | `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1508-1539` | current HEAD | read |
| `disabledMcpServers` pin mechanism exists: `buildFlagSettings` turns a name list into `disabledMcpjsonServers`/`deniedMcpServers` in the flag-tier `settings` string | `sdk-query-options-builder.ts:373-411` | current | read |
| That pin is fed only from `mcpBackoffService.getBackingOffServers()`, not from any user/workspace toggle | `sdk-query-options-builder.ts:914-920, 956-962` | current | read |
| `settingSources` is `['user','project','local']` when the base URL implies a user-tier style is visible, else `['project','local']` — no `skills`/`plugins`/`strictMcpConfig` set anywhere in this builder | `sdk-query-options-builder.ts:988-992`, grep for `strictMcpConfig`/`plugins?:`/`skills?:` in this file returned 0 hits | current | read + grep |
| SDK type defs confirm `skills?: string[] \| 'all'`, `plugins?: SdkPluginConfig[]`, `strictMcpConfig?: boolean`, `settings.enabledPlugins` exist as real options | `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1939,2174,2200,6964` | installed pkg | read |
| Ptah never passes `skills` or `plugins` to the SDK; `ptah-cli-spawn-options.service.ts` deliberately assembles no `plugins` entry, relying on file copies the harness reconciler writes, because double-loading (bare + `plugin:skill`) breaks unqualified slash commands | `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.service.ts:1-17` | current | read |
| Codex lanes: `mcp_servers` set to `{ ptah: {...} }` only; `features.tool_search_always_defer_mcp_tools: false`; no `CODEX_HOME` override, so the process inherits the user's `~/.codex/config.toml` (its own `mcp_servers`, plugins, skills catalog) via `process.env` | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts:592-643` | current | read |
| No `enabled_tools` allowlist or isolated `CODEX_HOME` is set — matches Wave 2 item 2.2 of the prior audit, marked not-yet-shipped | `codex-cli.adapter.ts:592-643` vs `research-report.md` (TASK_2026_557) §Wave 2 item 2 | 2026-09-25 | read + cross-check |
| OpenCode lane: builds an inline `mcp: { ptah: {...} }` JSON string; no read of any global OpenCode config for scoping | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:33,534,605-607` | current | read |
| Antigravity lane: writes `~/.gemini/config/mcp_config.json` (a GLOBAL, cross-workspace file) before each spawn via `mcpFacet()`; a prior version "deleted the whole `mcpServers` map once it looked empty" (fixed) | `antigravity-cli.adapter.ts:481-575` | current | read |
| Ptah CLI lanes (`ptah-cli-registry.ts`): `mcpServers: assembly.mcpServers` (from `PtahSpawnAssembly`, itself `{ ptah: {...} }` only) and `settingSources: ['user','project','local']` always | `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:696,787,822` | current | read |
| Background one-shots (curator, sdk-query-runner): `buildOneShotMcpServers` returns `{ ptah: {...} }` only, keyed to `/workspace/{cwd}` not `/session/{id}` | `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:394-398,529-544` | current | read |
| Skills/plugins already have a full per-workspace enable/disable state: `enabledPluginIds`, `disabledSkillIds`, `disabledPluginIds`, `disabledAgentIds`, persisted via VS Code `workspaceState` keyed `ptah.plugins.config`, resolved per explicit `workspaceRoot` | `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:68,683-727,753-796` | current | read |
| That config store has no global/user scope — `storageFor(workspaceRoot)` only resolves VS Code's per-workspace storage; a workspace with no registered storage reads the empty default | `plugin-loader.service.ts:670-714` | current | read |
| `WorkspaceScopeResolver` (settings-core) is a generic global/app/workspace key-hash resolver already used elsewhere in Ptah, with `read`, `write(target: 'global'\|'app'\|'workspace')`, `hasOverride`, `clearMoreSpecific` — a ready-made scope primitive not yet applied to MCP/skills/plugins | `libs/backend/settings-core/src/scope/workspace-scope-resolver.ts:1-283` | current | read |
| `harnessNamespace.listInstalledMcpServers()` reads only `.vscode/mcp.json` and `.mcp.json` in the workspace root — no `~/.claude.json`, no `.claude/settings.json`/`settings.local.json` (`enableAllProjectMcpServers`/`enabledMcpjsonServers`/`disabledMcpjsonServers`), no `~/.codex/config.toml`, no `~/.ptah` | `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts:785-846` | current | read |
| `enableAllProjectMcpServers`/`enabledMcpjsonServers`/`disabledMcpjsonServers` appear nowhere in the repo except as the user-owned `.claude/settings.local.json:2` key Ptah never reads/writes | grep for those 3 identifiers across `libs/` returned 0 hits | current | grep |
| `installed-servers-page.component.ts` already distinguishes a row's `statusSource === 'session'` (live) vs other sources, and `mcpConnectorRows`/`marketplace-inventory.store.ts` are workspace-scoped (`WorkspaceScopeService`, `scope.generation()`) but carry no "global vs workspace config file" scope label | `libs/frontend/marketplace/src/lib/pages/servers/installed-servers-page.component.ts:18-25,97`, `libs/frontend/marketplace/src/lib/data/marketplace-inventory.store.ts:264,361-430` | current | read |
| `ptah_count_tokens` MCP tool exists and calls `ptahAPI.context.countTokens` — a reusable char/token estimator, but for arbitrary file content, not for a live `tools/list` payload | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:44,114,749-756` | current | read |
| No code in `libs/` calls a third-party MCP server's `tools/list` and measures its response size; the 63.0k-char/53-tool figure in the prior audit came from external scripts (`proxy_defer.py`) against recorded proxy transcripts, not from repo code | grep for `tools/list\|listTools\|toolsList\|McpClient` in `libs/` (71 files, none is a generic tools/list-size measurer) + TASK_2026_557 report §RC6, §5 | 2026-09-25 | grep + cross-check |

## Options

Not applicable in the usual sense — this report answers "what exists," not "which
of several designs to pick." Below are the reusable primitives found, with fit.

| Option | Fit here | Cost to adopt | Known failure mode |
|---|---|---|---|
| Reuse `WorkspaceScopeResolver` (global/app/workspace) for the new MCP/skill/plugin toggle setting | Exact match for requirement 2's "workspace override never changes the global entry" — it already separates write targets and has `clearMoreSpecific` for override precedence | Needs a new settings-core schema entry + repository (pattern already followed by `cli-subagent-settings.ts` etc.) | None observed; it is unused by MCP/plugins today, so no migration risk |
| Feed `disabledMcpServers` (already wired at `sdk-query-options-builder.ts:373-411,956-962`) from the new toggle instead of only from `mcpBackoffService` | Lowest-cost enforcement point for the Claude SDK direct/proxied path — no new plumbing, just a second source merged into the same array | Must union backoff-disabled + user-disabled without losing either list | If the union is wrong, a user-enabled server that is mid-backoff could re-appear, or a healthy server the user disabled could stay listed by CLI-side `.mcp.json` resolution if `settingSources` still exposes it |
| Extend `PluginLoaderService`'s `disabledSkillIds`/`disabledPluginIds` model with a global scope (today workspace-only via `workspaceState`) | Skill/plugin per-workspace toggle already exists; only the global tier is missing | Needs a second storage tier (VS Code `globalState` or `~/.ptah/settings.json`) and precedence merge, mirroring `WorkspaceScopeResolver` | This config only drives harness-sync file copies today — does not touch the Claude SDK `skills`/`plugins` options, so "enforced for every session build path" for skills additionally needs a second wire into `sdk-query-options-builder.ts`/spawn options |
| Extend `harnessNamespace.listInstalledMcpServers()` to also read `~/.claude.json`, `.claude/settings.json`/`settings.local.json`, `~/.codex/config.toml`, `~/.ptah` | Needed for requirement 2 ("clear distinction between global and workspace servers... UI shows the source") | Moderate — several file formats (JSON vs TOML), several precedence rules to encode (`enableAllProjectMcpServers` overriding `enabledMcpjsonServers`, already true in the user's own `.claude/settings.local.json`) | Getting Claude Code's own precedence wrong would show the UI as authoritative when the CLI actually computes something else |

## Disagreements

- None found between sources — all evidence is first-party (repo code and
  installed `sdk.d.ts`), and the prior audit report (RC6, Wave 2 items 2.1-2.2)
  matches the current code exactly except that 2.1 (Claude SDK `disabledMcpServers`
  for proxies) and 2.2 (Codex `enabled_tools`/isolated `CODEX_HOME`) are described
  there as recommendations, and this read confirms neither has shipped yet.

## Local consequences

- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:373-411,914-962`: the `disabledMcpServers` parameter is the mechanism to reuse for Claude SDK direct and proxied enforcement; it needs a second input source (user/workspace toggle) merged with `backingOffServers`.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts:592-643`: `runSdk` has no allowlist and no `CODEX_HOME` isolation; enforcing "ptah on by default, does not depend on user files" for Codex lanes requires either an `enabled_tools` config key or spawning with an isolated `CODEX_HOME` that Ptah controls.
- `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:670-796`: the skill/plugin toggle model is workspace-only; a global tier must be added, and its consumers (harness-sync copy step, not yet located in this pass) must be identified so a toggle actually removes a skill/plugin from what gets copied into `.claude/skills`/`.claude/agents` etc.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts:785-846`: `listInstalledMcpServers` is the natural extension point for reading `~/.claude.json`/`~/.codex/config.toml`/`~/.ptah`/`.claude/settings*.json`, currently reads only `.vscode/mcp.json` and `.mcp.json`.
- `libs/frontend/marketplace/src/lib/pages/servers/installed-servers-page.component.ts` and `libs/frontend/marketplace/src/lib/data/marketplace-inventory.store.ts`: already workspace-scoped and already have a `source`/`statusSource` concept to extend with a global-vs-workspace label and a toggle write target, per task.md's anchor.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:44,114,749-756`: `ptah_count_tokens`/`formatTokenCount` is a reusable char/token estimator for a fetched `tools/list` payload once one is obtained; it does not fetch that payload itself.

## Unknowns

- Where exactly the harness-sync reconciler reads `PluginLoaderService`'s
  `disabledSkillIds`/`disabledPluginIds` to decide what gets copied into
  `.claude/skills`, `.claude/agents`, etc. was not located in this pass (only the
  writer/reader of the config state was confirmed) — needed to know whether the
  existing per-workspace skill toggle already reaches Ptah CLI lanes, or only the
  Marketplace/harness UI.
- Whether Codex SDK lanes (`@openai/codex-sdk`, used via `runSdk`) read
  `~/.codex/config.toml` at all, versus only the native `codex` CLI binary path —
  the prior audit's "open question" (§6.2) is not settled by this read; `runSdk`
  passes `env: { ...process.env }` unchanged, which is consistent with either
  answer.
- No live mechanism to fetch a third-party MCP server's `tools/list` and measure
  its size was found; whether to build one (a session-scoped MCP client call) or
  read it from an already-connected session's cached tool list was not resolved —
  needs a decision on where such a probe would run (backend service vs. inside an
  active session) and how it avoids doubling as another connection attempt against
  flaky servers.
- Antigravity's `~/.gemini/config/mcp_config.json` is a single global file
  rewritten "before each spawn" (`antigravity-cli.adapter.ts:481-575`); whether it
  currently merges with or replaces third-party entries the user configured
  outside Ptah was not traced past the empty-map bug-fix comment, and matters for
  whether a per-workspace pin can coexist with a shared global file across
  concurrent workspaces.
