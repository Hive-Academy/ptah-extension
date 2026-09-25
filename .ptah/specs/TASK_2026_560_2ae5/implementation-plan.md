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
