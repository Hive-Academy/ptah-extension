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
  - **Amendment (2026-09-26, B9 re-review):** the chip notice ships in PR 1 for Claude chat and one-shots only.
    A Ptah CLI agent is a background worker with no chip. Its SDK session id does not exist at spawn time, and
    posting the notice under the parent session id would wrongly tell the parent tab that it runs Ptah-only.
    In PR 1, the Ptah CLI spawn path enforces the same strict options and logs a warn with `cwd` and the reasons.
    The user-visible notice for Ptah CLI agents moves to PR 2, through the agent monitor.
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

---

## Appendix C: batches and execution record (was batches.md)

Moved here verbatim by budget lever L5 (batches.md, Batch 17 completion checklist).

# Batches - TASK_2026_560_2ae5

Total tasks: 27 batches (PR 1: 18 = B1-B14, B14b, B16, B17, B25; PR 2: 9 = B15, B18-B24, B26) | Complete: 18/27 (all of PR 1)

Design authority: `implementation-plan.md` (revision 2 + r3, user-approved). The review files are history.
Base: `main @ c4bdc87dd`. Branch: `feat/task-2026-560-mcp-skill-toggles`. PR 2 will be a stacked branch
planned later. PR 1 batches run first, and PR 2 starts after PR 1 merges (plan line 510).

Check command form (every batch): `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p <projects> --parallel=2`.
Project names were checked against each `project.json` `name`. Projects without a `test` target (the e2e
projects) run only lint and typecheck under this form, so those batches add an e2e command.

Executors: every batch runs as a sequential sub-agent. The batches are coupled internally, and parallelism
comes from the waves below, not from lanes inside a batch. Reviewers: code-logic-reviewer on every batch,
plus code-style-reviewer on every batch that touches UI.

## Plan issues

None blocking; no design contradiction was found. The corrections below change file mechanics only, and no
design decision.

| # | Plan text | Finding (evidence) | Resolution in this decomposition |
| --- | --- | --- | --- |
| P1 | C1 extends `HarnessSourcesStatus` with `'policy-unknown'` | `libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.ts:259-267` is an exhaustive `switch` returning `string \| null`, and it has no default. The new member breaks the marketplace typecheck (TS2366). The file is not in the plan. | Added to Batch 1 with its existing spec (+2 files). PR 1 now has **81** code files. |
| P2 | C3: "M `plugin-config-source-resolver.ts` + `.spec.ts`" | `libs/backend/harness-sync/src/lib/sources/plugin-config-source-resolver.spec.ts` does not exist | It is **C** (create). The file count is unchanged. |
| P3 | C11: C `capability-toggles.spec.ts` | The harness Playwright config uses `testMatch: ['**/*.e2e.spec.ts']` (`libs/frontend/webview-e2e-harness/playwright.config.ts:22`). A plain `.spec.ts` would never run. | The file is named `capability-toggles.e2e.spec.ts`, next to `marketplace.fixtures.ts`. |
| P4 | Handoff verification: "`manifest.spec.ts`" | No such file. The host-profile spec is `libs/backend/rpc-handlers/src/lib/host-profile/resolve-handler-plan.spec.ts`. | Batch 10 runs that spec, which is inside the rpc-handlers `test` target. |
| P5 | C3: "PluginConfigSourceResolver maps `CapabilityPolicyUnknownError`" | harness-sync must not import agent-sdk (`libs/backend/harness-sync/src/index.ts:10`, `sources/harness-source.port.ts:6`) | Detection is structural. Batch 1 adds a shared discriminator (error `name`/`code` constant + `isCapabilityPolicyUnknownError` guard) in `capability-toggle.types.ts`. Batch 5 sets it on the agent-sdk error, and Batch 3 checks it. |
| P6 | Handoff batch order puts cli-agent-runtime (3) before agent-sdk (4) | cli-agent-runtime imports agent-sdk (27 imports). The store registers under `SDK_TOKENS`, and the resolver calls `getEffectivePluginConfig`. | Batch 5 (agent-sdk tokens + loader) runs before Batch 7 (resolver). The C1→C3→C4 component order is unchanged. |
| P7 | C6 "Files (10)" is not enumerated in the final plan | The round-1 list is not on disk | Derived from the adapters on disk (Batches 22-23). **ASSUMPTION A-PR2**: re-verify this list against the code when PR 2 starts. |
| P8 | NFR: e2e specs in `apps/ptah-electron-e2e/src/specs/marketplace/` | The plan's fixtures file and RPC auto-responder live in `libs/frontend/webview-e2e-harness/src/lib/scenarios/marketplace/`, which is the only place a failing `setEnabled` (revert) can be driven | The new spec goes to the harness location, which the plan chose. The PR 1 description states this deviation from the NFR path. |

### P9: global skill/plugin layer is unreachable from the synchronous callers (found by the Batch 5 logic review)

The plan's C3 text says "`resolveCurrentPluginPaths` and `getDisabledSkillIds` are effective". As implemented,
both methods stay synchronous and read only the WORKSPACE layer (`plugin-loader.service.ts:1220-1230`,
`:1482-1492`). Only the async `getEffectivePluginConfig(root)` applies `workspace ?? global ?? default`.

Resolution (no design change; D1 is kept as written):

- The two synchronous methods stay workspace-only, and their JSDoc says so.
- Every caller that affects a session moves to the async `getEffectivePluginConfig`, assigned to a PR 1 batch
  in the table below.
- Enforcement of this gap never moves to PR 2.

How layering reaches callers (from `layerGlobalItems`, `plugin-loader.service.ts:175-212`):

- A global item applies only to an id the workspace records nothing about. A global `on` goes into
  `enabledPluginIds` or `enabledSkillIds`, and a global `off` goes into `disabledPluginIds` or
  `disabledSkillIds`.
- So a caller that uses only the workspace `enabledPluginIds` can MISS a global ON (it narrows), but it can
  never admit a globally-OFF item (it cannot widen).
- A caller that uses `resolveCurrentPluginPaths` or `getDisabledSkillIds` DOES widen. Those include the opt-out
  (default-ON) plugins and a skill's default ON, so a global OFF is ignored.

#### Global-layer caller assignment

| # | Caller | Effect | Batch (PR) | Change | Acceptance test |
| --- | --- | --- | --- | --- | --- |
| G1 | `libs/backend/harness-sync/src/lib/sources/plugin-config-source-resolver.ts:169-177` (`resolve`) | **Widens**: its overlay and disabled-skill ids feed the reconciler, which writes the `.claude/skills` copies and junctions that Claude sessions and every CLI lane load | **B3** (PR 1), already owned | When `reader.getEffectivePluginConfig` exists, `resolve` awaits it once, and takes `overlayPluginPaths`, `config.disabledSkillIds`, `config` and `fingerprint` from that single result. `resolve` returns `HarnessSourceState \| Promise<HarnessSourceState>`, and the reconciler awaits it at `harness-reconciler.service.ts:200,383`. A reader without the method keeps today's synchronous path. | New reconciler spec: a global OFF on an opt-out plugin with no workspace entry → the plugin is absent from the overlay, and its skill copies are absent after a reconcile. A global OFF skill → its copy is absent. A global ON on an opt-in plugin → present. A workspace entry beats a global one. |
| G2 | `apps/ptah-electron/src/di/phase-2-libraries.ts:200-231` (hand-written `HarnessPluginConfigReader` wrapper) | **Widens**: without forwarding, G1's new branch is unreachable on Electron | **B3** (PR 1), added (+1 file) | Add `getEffectivePluginConfig: async (root) => …` that forwards `workspaceRoot` and folds `readDormantSkillSlugs(container)` into the effective `config.disabledSkillIds`, exactly as the sync `getDisabledSkillIds` wrapper does today | The `ptah-electron` typecheck passes. The reviewer traces the wrapper and confirms that dormant slugs are still folded and that the root is forwarded. The G1 spec covers the behaviour. |
| G2b | `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:173-178`, `libs/backend/cli-engine/src/lib/container.ts:645-650` | Would widen, but these hosts pass the `PluginLoaderService` instance itself as the reader, so it already has `getEffectivePluginConfig` | none (no change) | none | The B3 reviewer confirms that both hosts pass the loader instance through without wrapping it |
| G3 | `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts:429-431` (`searchSkills`, in-session code-execution tool) | **Widens**: a globally-OFF skill is listed as invocable inside a running session | **B25** (PR 1), new | The already-async `searchSkills` awaits `getEffectivePluginConfig(root)` and uses its `overlayPluginPaths` and `config.disabledSkillIds`. If the policy is unknown (`isCapabilityPolicyUnknownError`), it lists no local plugin skills and logs. The structural loader interface (`:273-284`) gains the method. | Spec: a global OFF skill → reported disabled or absent. A global OFF opt-out plugin → none of its skills are listed. Unknown policy → no local skills. The remote search is unaffected. |
| G4 | `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts:242-255` (`PluginLoaderLike`) and `:668-683` (`getPluginPaths`, the plugin paths handed to spawned agents via `agent-namespace.builder.ts:289-292`) | The interface is what G3 flows through. `getPluginPaths` only narrows (it misses a global ON). | **B25** (PR 1), same file | Add `getEffectivePluginConfig` to `PluginLoaderLike`. `getPluginPaths` uses the effective `config.enabledPluginIds`, and returns `undefined` on unknown (restrictive). | A B25 spec case: a global ON opt-in plugin's path is passed to a spawned agent. Unknown → no plugin paths. |
| G5 | `libs/backend/rpc-handlers/src/lib/harness/workspace/harness-workspace-context.service.ts:350,353` (`discoverAvailableSkills`, harness wizard summary) | Display only: the wizard can show a globally-OFF skill as available. It cannot load one, because sessions are governed by G1/G3 and the B8 flags. | **B26** (PR 2) | Await `getEffectivePluginConfig(root)` | Spec: a global OFF skill is not offered as available |
| G6 | `libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts:873-874` (`activeSkillOwners` → `predictCollisions` at install) | Display only: it may over-report a shadowing skill, which errs cautious | **B26** (PR 2) | Same | Spec: a globally-OFF plugin's skills do not appear as collision owners |
| G7 | `plugin-rpc.handlers.ts:255,340,756,796` (legacy Plugins panel get/save and external activate/deactivate) | Intentionally WORKSPACE: these read-modify-write the workspace `PluginConfigState` | none (documented) | No change. Writing the layered config back would copy global items into the workspace and break inheritance (D1). The legacy panel shows the workspace layer, and the Marketplace shows the effective state; AC-3.3 is about the workspace layer. | The B17 write-path trace confirms that no workspace save path persists a layered config |
| G8 | `setup-rpc.handlers.ts:140-147`, `wizard-generation-rpc.handlers.ts:804-811`, `enhanced-prompts-rpc.handlers.ts:714-718`, `harness-rpc.handlers.ts:827` | Generation inputs only (skill discovery for wizard and prompt generation). They read the workspace `enabledPluginIds`: they narrow and never widen, and no session is built from them. | none (documented) | No change | n/a |
| G9 | `libs/backend/cli-engine/src/lib/bootstrap/harness-boot.ts:71`, `apps/ptah-electron/src/activation/plugin-activation.ts:253,298`, `apps/ptah-extension-vscode/src/activation/plugin-activation.ts:83` | User-layer mirror SOURCE lists and a boot log count; they are not policy. Per-workspace policy is applied afterwards by the reconciler through G1's overlay and disabled ids, which include global ONs. | none (documented) | No change | Covered by the G1 spec |
| G10 | `libs/backend/rpc-handlers/src/lib/chat/session/chat-sdk-context.service.ts:83-95` (`resolvePluginPaths`) | No caller found in the repository (grep across `libs` and `apps`, 2026-09-26); chat sessions get plugins and skills through the G1 harness copies | none (documented) | No change. Its removal as dead code is out of scope for this task. | n/a |

## Plan validation

Status: PASSED WITH RISKS

Assumptions:

- A1 (flag-tier deny and approve behaviour): unit-covered in Batch 8, then **closed live in Batch 17** by the
  senior-tester. Check: in this repository, with `.claude/settings.local.json` `enableAllProjectMcpServers: true`,
  turn davinci-resolve, firecrawl and shopify-dev-mcp off, keep ptah on, and start a proxied session (custom base
  URL). The captured first request body must contain none of their tool schemas, and the init `mcp_servers` must
  list only ptah plus the explicitly approved servers. Turning firecrawl on explicitly must make it load.
- A2 (`skillOverrides`, `deniedMcpServers` and `skills: []` honoured on CLI 0.3.278): the installed
  `@anthropic-ai/claude-agent-sdk` is 0.3.278 (verified). Unit-covered in Batch 8, then **closed live in Batch 17**.
  Check: a disabled skill is absent from the system-init `skills`. A corrupted item file gives init `skills: []`
  with ptah as the only MCP server, and the chat chip shows `capability-policy-unverified`.
- A3 (Codex `enabled=false` with quoted keys), PR 2: unit-covered in Batch 18 (parse) and Batch 22 (serialised
  argv), then **closed live in Batch 24**. Check: a Codex lane with a disabled global server whose name needs
  quoting (for example `my.server`) does not start that server, as shown by the lane's MCP startup events and
  tool list.
- A4 (`mcpServerStatus` and `getContextUsage` safe mid-turn), PR 2: unit-covered in Batch 20 (bounded 3 s,
  timeout → unknown), then **closed live in Batch 24**. Check: call a measurement during an active streaming turn;
  the turn completes with no stream error, and the figure or "unknown" is returned within 3 s.
- A5 (AC-5.3 method agreement), PR 2: a Batch 20 fixture test puts ptah's measured figure within 10% of a direct
  count of its `tools/list` fixture. **Closed live in Batch 24** by comparing the live ptah figure with a direct
  count of the live `tools/list` payload.
- A-PR2 (C6 file list derived by the team-leader): verified at PR 2 kickoff before Batch 22 starts.
- A-UI (UI reads enforcement labels and declarations from data): Batch 13 and Batch 14 render
  `CAPABILITY_ENFORCEMENT` and a declaration LIST, never literals. PR 2 can then flip rows and add the #16
  declarations without touching UI files or tests. Checked by the Batch 13/14 reviewer.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| R1: the `'policy-unknown'` union member breaks the marketplace typecheck (P1) | HIGH | Task 1.6 in Batch 1 adds the case; the Batch 1 check includes `@ptah-extension/marketplace` |
| R2: harness-sync cannot import the agent-sdk error class (P5) | HIGH | Task 1.1 adds the shared discriminator; Tasks 3.1 and 5.2 use it; the Batch 3 spec throws a structurally-matching error |
| R3: PR 1 budget is tight (81 code + ~13 docs = ~94; hard cap 99) | MEDIUM | Running count below. Before and after screenshots are NOT committed (kept outside the repo, with paths in visual-review.md). Every unplanned file must be counted in the batch report, and the team-leader stops at 97. |
| R4: the Marketplace shell banner may need `marketplace-shell.component.html` (the plan lists "shell" as one file) | LOW | Allowed as +1 in Batch 13 when the banner cannot be done in the `.ts` template; it is counted |
| R5: parallel batches editing projects that another in-flight batch reads (cli-agent-runtime reads agent-sdk and harness-sync) give transient typecheck noise | MEDIUM | Parallelism map: separate worktrees are REQUIRED for the same project and RECOMMENDED for producer/consumer pairs |
| R6: the PR 2 enforcement flip would break PR 1 UI/e2e assertions if they hard-code "not enforced" | MEDIUM | A-UI: tests derive the expected labels from `CAPABILITY_ENFORCEMENT` or from fixture data (Tasks 13.3, 16.1) |
| R7: a first `set()` in a fresh workspace races the import (N2) | HIGH | Task 7.1: `set` awaits `ensureImported`, then does its own atomic write; a named test proves it |
| R8: an unknown policy is silently widened anywhere | HIGH | Fail-closed tests in Batches 3, 4, 5, 7, 8 and 9; the reviewer must check each for the unknown path |
| R9: `protocol-dispatcher.ts` must not be edited (TASK_2026_559) | HIGH | No batch lists it; every batch commit is checked with `git diff --name-only` |
| R10: new backend services must log through `IOutputChannel` | LOW | Stated in Tasks 6.1, 6.2, 7.1 and 20.1; checked by the reviewer |
| R11 (P9): a global skill/plugin OFF is shown OFF but ignored by the harness copies and the in-session skill list | HIGH | G1 and G2 in B3, and G3 and G4 in B25, both in PR 1. The reviewer acceptance items are in each batch. B17 re-tests live: a global OFF skill is absent from `.claude/skills` and from `ptah.harness.searchSkills`. |
| R12: making `PluginConfigSourceResolver.resolve` async ripples into about 20 reconciler specs whose fakes return synchronously | MEDIUM | The port type is `HarnessSourceState \| Promise<HarnessSourceState>`, and the reconciler `await`s it, so the existing sync fakes stay valid. No existing spec file is edited (budget). |

Edge cases:

- Crash mid-import (only `.tmp` left) → re-import on the next resolve. Handled in Task 6.1.
- A clear (`inherit` tombstone) written before, during or after an import stays cleared. Task 6.1 (D1).
- The D2 collision pair `"x".repeat(121)` vs `h_79072a47bfaa54e6057a9ee21e0dea64b9edbfd1`. Tasks 1.1 and 6.1.
- win32 alias, case-sensitive `Repo`/`repo`, sub-folder and worktree roots (N7). Tasks 6.1 and 7.1.
- A corrupt item file or `imported.json` → unverified (strict MCP + `skills: []`). Tasks 6.1, 7.1 and 8.1.
- A corrupt store while a plugin was previously disabled → the plugin and its child skills stay absent (N3).
  Task 3.2.
- Codex config EACCES → `inspect` error, while legacy `readAll` stays empty (N9). Task 4.3.
- A same-name Codex-global server at workspace install → approved (N6). Tasks 7.1 and 11.1.
- A back-off server toggled ON stays suppressed (AC-4.7). Task 8.1.
- Ptah OFF → the warning (AC-4.6); ptah is present by default in every built session. Tasks 8.1 and 13.2.
- A legacy CLI `plugins:save-config` write changes the fingerprint → forced pass (N4, AC-3.3). Task 5.3.
- A toggle-write failure → UI revert and an error naming the server (AC-1.4). Tasks 6.1, 10.1, 13.1 and 16.1.

## Running changed-file count

PR 1 (code files + task docs; must stay under 100):

**Budget rules (set at the Batch 1 commit):**

- Review evidence is kept in two ROLLING files: `reviews/code-logic-review.md` and `reviews/code-style-review.md`.
  - The Batch 1 reviews were renamed into them, with their content unchanged.
  - From Batch 2 on, each reviewer APPENDS a `# ... Batch N` section to the matching file. Reviewers must never
    create per-batch files: at 17 batches, per-batch files would add about 21 files and push PR 1 to about 117.
- The visual evidence is written as a section of `test-report.md`, not as a separate `visual-review.md`
  (saving 1 file). Screenshots stay uncommitted (R3).
- Batch 1 landed 10 code files instead of 8: the executor split out `capability-id-codec.ts` and its spec during
  revise round 1, which the style review asked for.

| After batch | Code files added | PR 1 code total | Docs total | PR 1 total |
| --- | --- | --- | --- | --- |
| 1 (actual `4876206a7`) | 10 | 10 | 8 (after L1: task.md, task-description.md, research-report.md, implementation-plan.md, implementation-plan-review.md, batches.md, reviews/code-logic-review.md, reviews/code-style-review.md) | 18 |
| 4 (actual `5f6a750e8`; +1 `harness-sync/src/index.ts`) | 6 | 16 | 8 | 24 |
| 6 (actual `d003642a9`) | 4 | 20 | 8 | 28 |
| 5 (actual `1e7aab5bb`) | 7 | 27 | 8 | 35 |
| 2 (actual `e0ba036f0`; +2 unplanned: `session-mcp-status.spec.ts`, vscode-core `rpc-handler.ts`) | 5 | 32 | 8 | 40 |
| 8 (actual `f68419e63`; +2 unplanned: `session-lifecycle-manager.ts`, `sdk-query-options-builder.output-style.spec.ts`) | 10 | 42 | 8 | 50 |
| 7 (committed on its branch; +1 unplanned `capabilities/capability-policy-model.ts`) | 7 | 49 | 8 | 57 |
| 3 (+1 Electron wrapper, P9 G2; +2 selection service and spec; +1 `agent-workspace-scope.spec.ts`) | 9 | 58 | 8 | 66 (later rows +1; see Update 2) |
| 10 (-1: schema inlined) | 5 | 62 | 8 | 70 |
| 13 | 5 | 67 | 8 | 75 |
| 9 | 4 | 71 | 8 | 79 |
| 14 | 9 | 80 | 8 | 88 |
| 25 (new, P9 G3/G4) | 3 | 83 | 8 | 91 |
| 11 | 3 | 86 | 8 | 94 |
| 12 | 2 | 88 | 8 | 96 |
| 16 (-1: fixtures kept in the spec) | 1 | 89 | 8 | 97 |
| 17 | 0 | 89 | 8 + test-report.md = 9 | **98** |

(Rows are in actual or expected commit order. B15's 4 files moved to PR 2.)

- **Correction and recount (2026-09-26):** 95 (after L1) + 1 (B7 `capability-policy-model.ts`) + 2 (B3 third-caller
  fix) = **98**. That is over the 97 re-plan threshold, so the team-leader is returning options to the
  orchestrator (see the next bullets) and is not accepting further unplanned files.
- Worst case at 98 with the known contingencies:
  - R4 shell html (+1) → 99;
  - a B11 surface file outside `container.ts` (+1) → 100, which BREACHES the limit;
  - `registry.md` (+1).
- **Proposed levers (orchestrator decision needed):**
  - **L2 (docs, -1):** merge `reviews/code-style-review.md` into `reviews/code-logic-review.md` as one rolling
    `reviews/code-review.md` in the next task-specs commit. This is the same mechanism as L1: files added on this
    branch drop out of the diff.
  - **L3 (policy, removes a contingency):** never stage `.ptah/specs/registry.md` in PR 1 commits. The
    team-leader stages only explicit paths, so this costs nothing.
  - **L4 (-1, conditional):** B14 leaves `provider-list-view.testing.ts` unmodified if the helper needs no change.
  - With L2 + L3, the plan is **97**, and the worst case is 99 (R4 + B11 surface). With L4 as well, the worst
    case is 98.
  - **Update (same day):** the B12 DI-order spec adds +2 (the two existing container smoke specs), so the plan is
    **100 before levers**. That needs one more lever:
    - **L5 (docs, -1):** append `implementation-plan-review.md` to `implementation-plan.md` as an
      "Appendix: review rounds" section, copied verbatim, and `git rm` the review file. It is added on this branch,
      so it drops out of the diff.
  - Totals with the levers applied:
    - L2 + L3 + L5 → **98**. With L4 as well → **97**.
    - The worst case with R4 and a B11 surface file → **99**.
  - Recommendation: apply L2, L3 and L5 in the next task-specs commit, take L4 if it proves possible, and treat
    any further unplanned file as a scope decision for the user.
  - **Update 2 (same day):** B3 needs +1 test-only file (`agent-workspace-scope.spec.ts`).
    - Plan: **101 before levers**.
    - With L2 + L3 + L5: **99**. With L4 as well: **98**.
    - The worst case with R4 and a B11 surface file is **100, which breaches the limit**.
  - **A scope decision is REQUIRED before B11 or B13 commits an extra file.** Options, in the team-leader's order of
    preference:
    - (i) CLI host DI coverage already avoids a file. Also drop the Electron and VS Code DI smoke-spec additions
      from B12, and pin the invariant in B17's per-host live check instead (-2, but it weakens a regression guard);
    - (ii) move B16 (e2e, 1 file) to PR 2 with B15 (-1, NFR coverage lands in PR 2);
    - (iii) forbid the R4 shell html in B13: the banner goes in the component `.ts` template (removes a
      contingency).
  - With (iii) plus L2, L3, L4 and L5, the plan is 98 and the worst case is 99 (only the B11 surface file
    remains).
  - **Update 3 (same day): B13 used the R4 file** (`shell/marketplace-shell.component.html`, +1), so option (iii)
    is gone.
    - Full recount from the post-L1 base of 95:
      - +1 (B7 `capability-policy-model.ts`)
      - +3 (B3: selection service, its spec, `agent-workspace-scope.spec.ts`)
      - +2 (B12 DI-order smoke specs)
      - +1 (B13 shell html)
      - = **102 before levers**.
    - With L2 + L5: **100**. With L4 as well: **99**.
    - With option (i) (drop the B12 DI smoke specs, -2) plus L2, L4 and L5: **97**.
    - With L3, `registry.md` never counts. The one remaining contingency is a B11 surface file (+1).
    - **Without option (i) or (ii), a B11 surface file breaches the limit.**
  - The orchestrator's figure of 97 does not include the B3 +3 or the B12 +2.
- **DECISION (orchestrator, 2026-09-26): Option 1, docs only.**
  - B16 STAYS in PR 1, because the user asked for webview e2e specs for the new controls.
  - The user's limit is under 100. The 95 margin was the orchestrator's own.
  - Docs moves (every removed file was added on this branch, so it drops out of the diff):
    - **D1 (-1):** `reviews/code-logic-review.md` and `reviews/code-style-review.md` are merged verbatim into ONE
      `reviews/code-review.md`, and both originals are removed. *Deferred* until the B3 code-logic-reviewer
      finishes appending, so nobody writes to a moved path.
    - **D2 (-1):** `implementation-plan-review.md` becomes "Appendix A: review rounds" of `implementation-plan.md`,
      copied verbatim, and the file is removed. *Applied in the working tree* and checked by substring match.
    - **D3 (-1):** `research-report.md` becomes "Appendix B: research report" of `implementation-plan.md`, copied
      verbatim, and the file is removed. *Applied in the working tree* and checked the same way.
    - **D4 (-1):** there is no `test-report.md`. The senior-tester appends a `# Test report — PR 1` section
      (including visual evidence) to `reviews/code-review.md`.
    - All four are committed together in the task-specs commit that follows the B3 commit window.
    - **APPLIED 2026-09-26:**
      - D1: `reviews/code-review.md` = Part 1 (the former logic file, including the B13 re-review rounds 1 and 2)
        + Part 2 (the former style file), both verbatim.
      - D2 and D3 are the plan appendices.
      - D4 is recorded in B17.
      - Every copy was checked by substring match.
  - **L4:** B14 leaves `provider-list-view.testing.ts` untouched if at all possible.
  - **The DI-order regression check adds NO file.**
    - B12 puts the assertion (the resolved `PluginLoaderService` has `SDK_CAPABILITY_GLOBAL_LAYER` injected after
      host bootstrap) inside a spec it ALREADY modifies for the 391-vs-388 fix.
    - For any host where B12 modifies no spec (for example, when registration alone makes `rpc-surface.spec.ts`
      pass), that host moves to B17's live check.
  - **Counts:**
    - PR 1 planned: **96** (91 code + 5 docs: `task.md`, `task-description.md`, `implementation-plan.md`,
      `batches.md`, `reviews/code-review.md`).
    - Worst case: **97**, with a B11 CLI surface file.
    - `registry.md` is never staged (L3).
    - L4 would make it 95.
  - **Any further extra file must go to the orchestrator BEFORE it is written.**
- **Update 4 (orchestrator decisions, 2026-09-26):**
  - B11 needed NO extra surface file: cli-engine `rpc-surface.spec.ts:60` already passed through B10's manifest
    entry. The B11 worst-case extra is REMOVED.
  - B14b (+1: `mcp-directory-browser.component.ts`, `capabilityWarning` display) is added to PR 1.
  - **PR 1 plan: 97** (92 code + 5 docs), which leaves 2 spare slots under the limit of 99. There are no known
    contingencies left: L3 keeps `registry.md` out.
  - The CLI `capabilityWarning` output goes to PR 2 (B21, +1).
  - The stray untracked `b14.diff.txt` in the b14 worktree root is NEVER staged. It is deleted before the B14 commit,
    after confirming nothing references it.
- **Update 5 (2026-09-26):**
  - L4 held: `provider-list-view.testing.ts` stayed untouched, so the plan was 96 after B14.
  - **B9 +3 existing spec files**, approved by the orchestrator:
    - `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-harness-preflight.spec.ts`
    - `.../ptah-cli/ptah-cli-registry-off-thread-spawn.spec.ts`
    - `.../ptah-cli/ptah-cli-registry-spawn-model.spec.ts`
  - A 4th file (`di/register.ptah-cli-registry.smoke.spec.ts`) is avoided: `ptah-cli-registry.ts` looks up the
    resolver and the sync lazily from the container.
  - **PR 1 plan: 99** (94 code + 5 docs), which is AT the limit (under 100 means 99 at most).
  - **L5 (orchestrator lever, applied in the completion step after B17 and before PR 1 opens; -1 → 98):**
    - Append `batches.md` verbatim to `implementation-plan.md` as "Appendix C: batches and execution record".
    - `git rm batches.md` in the final task-specs commit.
    - This is not the earlier proposed "L5" (the review file appended to the plan), which was superseded by D2.
  - Consequence to handle: PR 2 still needs a live `batches.md` for B15, B18-B24 and B26. At PR 2 kickoff, the
    team-leader recreates it on the stacked branch from Appendix C (the PR 2 section onward, plus the current
    states). That is +1 doc in PR 2, whose budget is about 33.
  - **ANY further extra file anywhere must go to the orchestrator BEFORE it is written.** There is no slack left
    until L5 is applied.
- **New paths for all later reviewers and the senior-tester:**
  - Append `# Code Logic Review — Batch N`, `# Code Style Review — Batch N` or `# Test report — PR 1` sections to
    `.ptah/specs/TASK_2026_560_2ae5/reviews/code-review.md`.
  - Plan context is `implementation-plan.md`, including Appendix A (review rounds) and Appendix B (research
    report).
  - Until the D1 commit lands, reviewers keep appending to the two existing review files.

- Arithmetic:
  - P9 amendment: 95 + 1 (B4 `index.ts`) + 1 (B3 Electron wrapper) + 3 (B25) - 4 (B15 → PR 2) = 96.
  - B2 update (2026-09-26): + 2 (B2 unplanned) - 1 (B10 schema inlined) - 1 (B16 fixtures in spec) = 96.
  - B8 update (2026-09-26): + 2 (B8 unplanned) = **98 before L1**.
    - **This crosses 97, so L1's trigger condition is MET.** L1 is due in the next `task-specs` commit, and it
      takes the plan to **95**.
    - **L1 APPLIED (2026-09-26), in the task-specs commit that follows `e0ba036f0`.**
      - `implementation-plan-review.md` now holds rounds 1, 2, 3 and the delta, each verbatim under its own
        heading. This was checked by a substring comparison against each committed original, with LF line
        endings.
      - `-r2`, `-r3` and `-delta` are removed with `git rm`.
      - Docs total: 11 → 8 (plus test-report.md at B17 = 9).
      - **PR 1 plan: 95.**
    - With L1 applied, the worst case with all three contingencies below is 98.
- Both absorbers are now SPENT. The remaining contingencies have no absorber:
  - R4 (shell html, +1) → 97;
  - a `.ptah/specs/registry.md` touch (+1) → 98;
  - a B11 surface-exclusion file outside `container.ts` (+1) → 99, which is the hard ceiling.
- Rule:
  - Every executor report must list unplanned files, and the team-leader re-counts this table at each commit.
  - Before accepting any unplanned file that would take the plan past 97, the team-leader returns to the
    orchestrator with options instead of committing.
  - **L1 (APPLIED 2026-09-26): merge the plan-review history files (-3; orchestrator decision).**
    - When to apply: only when an extra file would push PR 1 past 97, or at the latest in the Mode 3 completion
      step, before PR 1 is opened.
    - What to do:
      - Merge `implementation-plan-review-r2.md`, `implementation-plan-review-r3.md` and
        `implementation-plan-review-delta.md` into `implementation-plan-review.md`. There is one heading per round
        (round 1, round 2, round 3, delta), and the content of each round is copied verbatim.
      - `git rm` the other three in the same `task-specs` commit.
      - These files were added on this branch, so the deleted ones drop out of the PR diff, and no code changes.
    - Confirm the saving with `git diff --stat c4bdc87dd | tail -1` after applying.
    - With L1 applied, the plan is 95 and the worst case with every contingency is 98. (Before B8 added 2 files,
      that worst case was 96.)
  - After L1, the only known lever left is `provider-list-view.testing.ts` in B14, if the helper needs no change
    (-1).
  - The B9 chip change can NOT be deferred: the chip hard-codes the connector copy for every notice, so the new
    notice would render the wrong text.
  - Anything beyond that is a scope decision for the orchestrator or the user.

PR 2 (counted separately against its own stacked base):

| After batch | Code files | PR 2 total (with docs) |
| --- | --- | --- |
| 18 | 2 | 2 |
| 19 | 3 | 5 |
| 20 | 4 | 9 |
| 21 | 2 | 11 |
| 22 | 6 | 17 |
| 23 | 4 | 21 |
| 15 (moved from PR 1) | 5 | 26 |
| 26 (new, P9 G5/G6) | ~3 | ~29 |
| 24 | 0 | ~29 + ~4 docs (batches.md, test-report.md, code-logic-review.md, code-style-review.md) = **~33** |

## Parallelism map

At most 3 batches run at once. "Worktree" means a separate `git worktree` off the current branch head, with
`node_modules` as a junction to the main checkout. The team-leader verifies and commits each batch on the
feature branch in wave order; a parallel batch's worktree is rebased or cherry-picked onto the branch before
its commit.

| Wave | PR | Batches (projects) | Separate worktrees |
| --- | --- | --- | --- |
| W1 | 1 | B1 (shared, marketplace) | n/a |
| W2 | 1 | B4 (harness-sync) ∥ B5 (agent-sdk) ∥ B6 (cli-agent-runtime) | Chosen layout: **B5 runs in the feature worktree** (TASK_WT). **B4 → `.claude-worktrees/feat-task-2026-560-b4`** (branch `feat/task-2026-560-b4-facet-inspect`). **B6 → `.claude-worktrees/feat-task-2026-560-b6`** (branch `feat/task-2026-560-b6-toggle-store`). The two new worktrees branch from the feature-branch HEAD and have a `node_modules` junction. This isolates B6's cli-agent-runtime typecheck from B4 and B5's in-flight edits. The team-leader commits each accepted batch on its own branch, cherry-picks it onto `feat/task-2026-560-mcp-skill-toggles`, and then removes the worktree and branch. |
| W3 | 1 | B7 (cli-agent-runtime) ∥ B8 (agent-sdk) ∥ B2 (shared) | RECOMMENDED for B7 vs B8 (cli-agent-runtime imports agent-sdk) and for B2 (shared is read by all) |
| W4 | 1 | B3 (harness-sync, ptah-electron) ∥ B10 (rpc-handlers) ∥ B13 (marketplace) | The projects are disjoint, and B7 is still running in `feat-task-2026-560-b7`. **Chosen layout (2026-09-26):** **B3 runs in the feature worktree** (TASK_WT). **B10 → `.claude-worktrees/feat-task-2026-560-b10`** (branch `feat/task-2026-560-b10-capability-rpc`), which keeps rpc-handlers' typecheck clear of B3's in-flight harness-sync edits. **B13 → `.claude-worktrees/feat-task-2026-560-b13`** (branch `feat/task-2026-560-b13-toggle-ui`), which keeps TASK_WT single-writer. Both new worktrees branch from the task-specs commit that records B8, and the orchestrator creates their `node_modules` junctions in PowerShell. Readiness: all three can start now. B3 needs B1 and B5 (done); B10 needs B2 (done) and builds against the shared `ICapabilityResolver` through `SDK_CAPABILITY_RESOLVER`, so B7 is NOT a compile dependency; B13 needs B2 (done). The visual-reviewer's BEFORE screenshots at `c4bdc87dd` are due before B13 is committed. |
| W5 | 1 | B9 (cli-agent-runtime, chat) ∥ B14 (marketplace) ∥ B25 (vscode-lm-tools) | Not required (disjoint projects). B15 left this wave (moved to PR 2), so no same-project pair remains in PR 1. |
| W6 | 1 | B11 (rpc-handlers, cli-engine) ∥ B12 (ptah-electron, ptah-extension-vscode) | Not required (disjoint projects); RECOMMENDED because B12 typechecks against rpc-handlers |
| W7 | 1 | B16 (webview-e2e-harness) | n/a |
| W8 | 1 | B17 (live verification, all PR 1 projects) | n/a; open PR 1 after B17 |
| P1 | 2 | B18 (harness-sync) ∥ B19 (cli-agent-runtime) ∥ B20 (agent-sdk) | Not required; RECOMMENDED for B19 (reads harness-sync) |
| P2 | 2 | B21 (ptah-cli) ∥ B22 (cli-agent-runtime) ∥ B15 (marketplace, webview-e2e-harness) | Not required |
| P3 | 2 | B23 (cli-agent-runtime, shared) ∥ B26 (rpc-handlers) | Not required |
| P4 | 2 | B24 (live verification) | n/a |

Same-project pairs that must never share a worktree while both are in flight: B3/B4 and B3/B12 (ptah-electron;
different waves), B5/B8, B6/B7/B9, B10/B11, B13/B14, B19/B22/B23. No same-wave same-project pair remains.

Critical path (PR 1): B1 → B5 → B7 → B10 → B11/B12 → B16 → B17. The UI path (B2 → B13 → B14) and the P9 path
(B3, B25) run alongside it.

## Visual evidence plan (Mode 3 requirement)

Existing surfaces gain controls, and no new surface is added, so no prototype is required. Mode 3 therefore
needs before and after screenshots, in dark and light themes, of:

- the Installed servers page and the server detail;
- the Installed skills page and the skill detail;
- the chat MCP chip.

- **Before**: a visual-reviewer captures these from the base commit `c4bdc87dd` BEFORE Batch 13 is committed
  (this is scheduled as the W4 entry step).
- **After**: captured in Batch 17.
- Screenshots are stored outside the repository, and a "Visual evidence" section of `test-report.md` records
  their paths. They are not committed (R3 and the budget rules).

Parity: not applicable. No surface is replaced, consolidated, rebuilt or redesigned; controls are added to
existing pages.

Write-path trace (Mode 3): the writes go to `~/.ptah/capabilities/**` (Batch 6) and `PluginConfigState`
(`saveWorkspacePluginConfig`, Batches 5 and 7). Their readers are the resolver (Batch 7), the plugin loader
(Batch 5), the harness source resolver (Batch 3) and the Ptah CLI `plugin` command (AC-3.3). Batch 17 records
the trace.

---

## Batch 1: Shared contract and pure rules (PR 1) — COMPLETE (commit 4876206a7)

- Result:
  - 10 code files. The two unplanned ones are `libs/shared/src/lib/types/capability-id-codec.ts` and its
    `.spec.ts`, split out in the revise round.
  - Both reviewers accepted: code-logic APPROVE, and code-style APPROVE after revise round 1. One minor note
    remains: the codec file name is narrower than its content, because it also holds `tomlKeySegment` and the
    fingerprint. That is left as it is.
  - Check: 2 projects, and lint, typecheck and test all pass.
  - The team-leader verified on disk:
    - the SHA-256 is pure (only the spec imports `node:crypto`, to cross-check);
    - the D2 vectors appear verbatim at `capability-id-codec.spec.ts:26-30`;
    - `isCapabilityPolicyUnknownError` is at `capability-toggle.types.ts:609`;
    - the badge case is at `harness-health-badge.component.ts:265`.
- Downstream note: import `CapabilityKind`, the codec, `tomlKeySegment`, `harnessPolicyFingerprint` and
  `isHarnessPassAcknowledged` from `@ptah-extension/shared` (they live in `capability-id-codec.ts`).

- PR: 1
- Goal: land the C1 contract that TASK_2026_559 consumes: the types, the pure resolution rules, the filename
  codec, the fingerprint and the extended unions, and keep marketplace compiling after the union change.
- Nx projects: `@ptah-extension/shared`, `@ptah-extension/marketplace`
- Depends on: none
- Recommended executor: backend-developer
- Fallback executor: senior backend sub-agent (general-purpose)
- Execution mode: sequential
- Rationale: one pure-types library plus one mechanical exhaustive-switch case; the types are tightly coupled.
- Reviewers: code-logic-reviewer (rules and codec correctness), code-style-reviewer (touches a UI component)
- ACs proved: AC-1.3 (`nextWorkspaceValue`), AC-2.1 (`classifyMcpScope`), AC-2.5 (`definitionInEffect` pinned),
  AC-3.2 (`pluginConfigLayer` preserves legacy semantics), AC-4.1 (defaults and `resolveEffective`), and the
  D2 codec vectors
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/shared,@ptah-extension/marketplace --parallel=2`
- Commit: `feat(shared,marketplace,task-specs): batch 1 - add capability toggle contract`. This commit ALSO
  stages the task docs: `.ptah/specs/TASK_2026_560_2ae5/{task.md,task-description.md,research-report.md,implementation-plan.md,implementation-plan-review.md,implementation-plan-review-r2.md,implementation-plan-review-r3.md,implementation-plan-review-delta.md,batches.md}`.
- Files (8 code):
  - C `libs/shared/src/lib/types/capability-toggle.types.ts`
  - C `libs/shared/src/lib/types/capability-toggle.types.spec.ts`
  - M `libs/shared/src/index.ts`
  - M `libs/shared/src/lib/types/harness-sync.types.ts`
  - M `libs/shared/src/lib/types/rpc/rpc-misc.types.ts`
  - M `libs/shared/src/lib/types/mcp-directory.types.ts`
  - M `libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.ts`
  - M `libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.spec.ts`
  - C `libs/shared/src/lib/types/capability-id-codec.ts` (added in the revise round)
  - C `libs/shared/src/lib/types/capability-id-codec.spec.ts` (added in the revise round)

### Task 1.1: Capability contract, codec and pure rules — COMPLETE

- File: `libs/shared/src/lib/types/capability-toggle.types.ts` (+ `.spec.ts`)
- Plan reference: implementation-plan.md:78-110 (Resolution rules), :141-164 (C1), :176-186 (codec)
- Pattern to follow: `libs/shared/src/lib/types/harness-sync.types.ts` (types + pure reducer in shared)
- Quality requirements:
  - `CapabilityEntry`, `EffectiveCapabilitySet`, `ICapabilityResolver`, `ICapabilityGlobalLayer`.
  - `CAPABILITY_ENFORCEMENT`: codex, opencode, antigravity MCP rows and `ptah-cli-proxy` are `not-enforced`.
  - Pure functions: `defaultEnabled`, `resolveEffective`, `nextWorkspaceValue`, `pluginConfigLayer`,
    `classifyMcpScope`, `definitionInEffect`, `planApprovalImport`, `isMcpServerEnabled`, `tomlKeySegment`,
    `harnessPolicyFingerprint` (sorted canonical JSON → FNV-1a; no `crypto`, because shared ships to the
    browser), `isHarnessPassAcknowledged`, `encodeCapabilityId` / `decodeCapabilityId` / `canonicalFilename`.
- Validation notes:
  - D2: the literal form is `l_<pct>`, and the hashed form is `h_<sha40>` when `pct` is longer than 120.
  - The fixed vector: `"x".repeat(121)` → `mcp__h_79072a47bfaa54e6057a9ee21e0dea64b9edbfd1.json`, and id
    `h_79072a47bfaa54e6057a9ee21e0dea64b9edbfd1` → `mcp__l_h_79072a47bfaa54e6057a9ee21e0dea64b9edbfd1.json`.
  - SHA-256 in shared must not pull in Node `crypto`. Either use a pure implementation, or have the codec take an
    injected hasher that the store provides. Choose one and state it in the report.
  - R2: export `CAPABILITY_POLICY_UNKNOWN_ERROR_NAME` and `isCapabilityPolicyUnknownError(e)`.
  - The `inherit` tombstone skips the imported layer.
- Implementation details: export from `libs/shared/src/index.ts`. The spec covers every Resolution rules bullet,
  fingerprint stability under key reordering, and the acknowledgement predicate (a mismatch, `writeFailed`,
  `null` and `sources !== 'ok'` are all not acknowledged).

### Task 1.2: Extend existing shared types — COMPLETE

- Files: `harness-sync.types.ts`, `rpc/rpc-misc.types.ts`, `mcp-directory.types.ts`, `src/index.ts`
- Plan reference: implementation-plan.md:157-159
- Quality requirements:
  - Add `HarnessHealth.policyFingerprint?`.
  - Add `HarnessSourcesStatus |= 'policy-unknown'`; the shared reducer (`harness-sync.types.ts:~294`) maps it
    to `degraded`.
  - Add `PluginConfigState.enabledSkillIds?` and `InstalledMcpServer.scope?`.
- Validation notes: all additions are optional, so pre-task configs still load (AC-3.2).

### Task 1.3: Keep the marketplace health badge exhaustive — COMPLETE

- File: `libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.ts:259-267` (+ spec)
- Quality requirements: add a `'policy-unknown'` case with a note stating that the skill and plugin sync is
  paused because Ptah couldn't read the capability policy. Add a spec case.
- Validation notes: R1. No other change to the component.

### Batch 1 verification

- Every listed artifact exists and holds the required work; no `crypto` import in shared.
- The check command passes.
- code-logic-reviewer and code-style-reviewer accept.
- The D2 vectors are in the spec verbatim.

## Batch 2: Shared RPC surface and policy notice (PR 1) — COMPLETE (commit e0ba036f0)

- Result:
  - 5 code files (3 planned + 2 unplanned, both recorded below).
  - code-logic-reviewer: APPROVE 9/10. The moderate issue is the `schemas.ts:252` follow-up (recorded below). The
    minor issue is that an `explicit` flag with `scope: 'global'` is only rejected at runtime; that is a B10
    acceptance item.
  - Check: shared and vscode-core lint, typecheck and test all pass.
  - Committed as `457fe1bfa` in the b2 worktree. The drift check was clean, and the commit was cherry-picked as
    `e0ba036f0`. The b2 worktree and branch are removed.
- The team-leader verified on disk:
  - the registry entries are at `rpc.types.ts:1401-1411`, the allowlist entries at `:3631-3633`, and the re-export
    at `:41`;
  - the notice code is in both the type and `NOTICE_CODES` (`session-mcp-status.ts:72,100`), with a spec case at
    `:57`;
  - vscode-core accepts `'capabilities:'`.

- PR: 1
- Goal: add `capabilities:getState`, `capabilities:getEffective` and `capabilities:setEnabled`, and the
  `capability-policy-unverified` notice code.
- Nx projects: `@ptah-extension/shared`, `@ptah-extension/vscode-core`
- Depends on: B1
- Recommended executor: backend-developer | Fallback: general-purpose | Mode: sequential
- Reviewers: code-logic-reviewer
- ACs proved: contract for AC-1.4, AC-3.1, AC-4.6 (unverified notice) and AC-5.1/5.2 (`schemaTokens?`)
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/shared,@ptah-extension/vscode-core --parallel=2`
- Commit: `feat(shared,vscode-core): batch 2 - add capabilities rpc methods and policy notice`
- Files (5 code; +2 unplanned, recorded 2026-09-26, the second by orchestrator decision):
  - C `libs/shared/src/lib/types/rpc/rpc-capability.types.ts`
  - M `libs/shared/src/lib/types/rpc.types.ts` (re-export plus method registry entries; pattern `rpc.types.ts:11-19`)
  - M `libs/shared/src/lib/types/messages/session-mcp-status.ts` (add to `SessionMcpNoticeCode` and `NOTICE_CODES`)
  - M `libs/shared/src/lib/types/messages/session-mcp-status.spec.ts` (unplanned: the new-notice parse case)
  - M `libs/backend/vscode-core/src/messaging/rpc-handler.ts` (unplanned: adds `'capabilities:'` to
    `ALLOWED_METHOD_PREFIXES`; without it the host rejects the new methods)
- **Known transient failures on the branch after B2 lands (NOT regressions):**
  - B2 adds three methods to the RPC registry before any handler owns them. Two surface-parity specs therefore fail
    until their owning batches land:
    - RESOLVED: `libs/backend/rpc-handlers/.../rpc-allowlist.spec.ts:41-43` ("claims every registry method exactly
      once") → fixed by **B10** (`916dd9ad9`).
    - **STILL OPEN:** `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts:60` (391 vs 388) → fixed by **B11**.
      It is now the ONLY known transient failure.
    - RESOLVED: `apps/ptah-electron/src/di/rpc-surface.spec.ts:38` and the VS Code `rpc-surface.spec.ts` have
      passed since B10 landed (confirmed by the B12 check at `38b4c30f4`: electron 873 passed, vscode 101 passed).
  - Every batch check that runs `@ptah-extension/rpc-handlers` or `@ptah-extension/cli-engine` before B10 or B11
    reports these two failures and only these; any other failure there is real.
  - The B2 check itself (shared, vscode-core) does not run them.
- Follow-up (NOT in PR 1; record it in the PR 1 description):
  - `libs/shared/src/lib/types/messages/schemas.ts:252` has a Zod notice-code literal without
    `'capability-policy-unverified'`.
  - Today only a spec imports that schema, so no runtime path is affected. Align it when a runtime consumer adopts
    the schema, or in PR 2 if budget allows.

### Task 2.1: RPC types and registry — COMPLETE

- Plan reference: implementation-plan.md:156, :362-366
- Quality requirements: the request and response types carry the `scope: 'workspace' | 'global'`, `kind`, `id`,
  `enabled` and `explicit` fields that C8 needs. The response carries the updated `CapabilityEntry`. Do not edit
  `libs/shared/src/index.ts` (it is owned by B1); export through `rpc.types.ts`.

### Task 2.2: Notice code — COMPLETE

- Quality requirements: `'capability-policy-unverified'` is accepted by the parser at `session-mcp-status.ts:~133`.
  Otherwise the notice is dropped silently.

## Batch 3: Harness freeze on unknown policy (PR 1) — COMPLETE (commit 313112496)

- Result:
  - 9 code files across 3 projects (the documented exception).
  - code-logic-reviewer: APPROVE 8/10, with all 11 acceptance items PASSING.
  - Check: harness-sync passes 448/448, and every lint and typecheck task passes. The only test failures are the
    two known transients: `rpc-allowlist.spec.ts` (fixed by B10 at `916dd9ad9`, and verified passing on the branch
    right after) and Electron `rpc-surface.spec.ts:38` (391 vs 388, fixed by B12).
- **Reviewer failure mode 1 → carried to B17 (live check):**
  - When the policy is unreadable, frozen passes carry no fingerprint, so `HarnessPolicySync` never acknowledges
    and forces a preflight on every call.
  - B17 confirms that no preflight caller loops or spams (log volume and pass count over a few minutes with a
    corrupt item file) on each host.
  - B8 already skips the sync for Claude sessions when the policy is unverified, so the exposure is non-Claude
    callers only.

- PR: 1
- Goal: C3, harness-sync half. The source resolver maps the structural policy-unknown error to a frozen state,
  and the reconciler skips skill, plugin and agent planning and stamps the fingerprint.
- Nx projects: `@ptah-extension/harness-sync`, `ptah-electron`, `@ptah-extension/rpc-handlers`
  - **Documented exception to the 2-project cap (2026-09-26):** `IHarnessSourceResolver.resolve` becomes
    `HarnessSourceState | Promise<HarnessSourceState>`, and every consumer must land in the same commit.
  - The B3 executor found a third non-spec caller that the plan missed:
    `libs/backend/rpc-handlers/src/lib/harness/selection/harness-skill-selection-rpc.service.ts:86-88`.
    `getSelection()` passed `resolve()` straight into `readSkillCandidates`, so a Promise → typecheck error, and
    at runtime `sources.layout` is undefined.
  - The team-leader verified that it is the only other caller (grep over `libs` and `apps`). Its RPC wrapper
    (`harness-rpc.handlers.ts:1001-1003`) is already `async`, so it needs no edit.
- Depends on: B1 (compile). B5 at runtime: `getEffectivePluginConfig` is consumed structurally, and B5 lands in
  W2 first.
- Recommended executor: backend-developer | Fallback: general-purpose | Mode: sequential
- Reviewers: code-logic-reviewer
- ACs proved: AC-3.3 (fingerprint stamped), AC-3.4 (a frozen harness never re-adds a disabled plugin, and a
  GLOBAL OFF reaches the harness copies), D1 for skills and plugins (G1/G2), N3
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/harness-sync,ptah-electron,@ptah-extension/rpc-handlers --parallel=2`
  (If B10 has not landed yet, the one expected rpc-handlers failure is `rpc-allowlist.spec.ts:41-43`; see Batch 2.)
- Commit: `feat(harness-sync,electron,rpc-handlers): batch 3 - apply layered policy in harness sync`
- **Reviewer acceptance items (mandatory, P9 G1/G2/G2b):**
  - `resolve` calls `getEffectivePluginConfig` once per pass when the reader provides it. `overlayPluginPaths`,
    `disabledSkillIds`, `config` and `policyFingerprint` all come from that ONE result; no workspace-only sync
    call is mixed in.
  - A reader without the method keeps today's semantics, and the port union type keeps every existing
    reconciler spec unchanged (R12).
  - Spec proof:
    - a global OFF on an opt-out plugin with no workspace entry → absent from the overlay, and its skill copies
      are absent after a reconcile;
    - a global OFF skill → its copy is absent;
    - a global ON on an opt-in plugin → present;
    - a workspace entry beats a global one.
  - `isCapabilityPolicyUnknownError` → frozen (skill, plugin and agent writes and removals are zero).
  - Electron `phase-2-libraries.ts`: the new wrapper member forwards `workspaceRoot`, and it folds
    `readDormantSkillSlugs` into the effective disabled ids.
  - The VS Code (`phase-2-libraries.ts:173-178`) and CLI (`cli-engine/src/lib/container.ts:645-650`) hosts pass
    the loader instance unwrapped (verify; no edit).
- Files (9 code: 6 planned at the P9 amendment + 2 third-caller files + 1 test-only spec):
  - M `libs/backend/harness-sync/src/lib/sources/plugin-config-source-resolver.ts`
  - C `libs/backend/harness-sync/src/lib/sources/plugin-config-source-resolver.spec.ts` (P2)
  - M `libs/backend/harness-sync/src/lib/sources/harness-source.port.ts`
  - M `libs/backend/harness-sync/src/lib/reconciler/harness-reconciler.service.ts`
  - C `libs/backend/harness-sync/src/lib/reconciler/harness-reconciler.capability-policy.spec.ts`
  - M `apps/ptah-electron/src/di/phase-2-libraries.ts` (G2; added at the P9 amendment)
  - M `libs/backend/rpc-handlers/src/lib/harness/selection/harness-skill-selection-rpc.service.ts`
    (added 2026-09-26: `getSelection()` becomes async and awaits `resolve()`)
  - M `libs/backend/rpc-handlers/src/lib/harness/selection/harness-skill-selection-rpc.service.spec.ts`
    (added 2026-09-26: `await` the 5 call sites, plus a Promise-returning resolver case)
  - M `libs/backend/harness-sync/src/lib/state/agent-workspace-scope.spec.ts` (added 2026-09-26, test-only)
    - It calls `new PluginConfigSourceResolver(...).resolve(ws).layout` synchronously (`:42-71`, `:128`), which is
      TS2339 under the union return type.
    - Fix: the affected `it` callbacks become async and await `resolve`. No behaviour change: those readers are
      null or throwing, so `resolve` stays synchronous at runtime.
  - B3 total: **9 files**.
- **Expected transient failures seen in B3's check (not B3 regressions):**
  - rpc-handlers `rpc-allowlist.spec.ts:41-43` → fixed by B10;
  - **ptah-electron `apps/ptah-electron/src/di/rpc-surface.spec.ts:38` (391 vs 388)** → the Electron twin of the
    B2 registry gap, fixed by **B12** (host registration). B12 must also check
    `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts` for the same count.
- **Reviewer acceptance item (third caller):**
  - `getSelection()` awaits `resolve()` and never passes an unresolved value to `readSkillCandidates`.
  - The spec covers a resolver that returns a Promise.
  - No other file in rpc-handlers is edited.
  - rpc-handlers typechecks.

### Task 3.1: Source resolver and port — COMPLETE

- Plan reference: implementation-plan.md:252-261
- Quality requirements:
  - `HarnessPluginConfigReader` gains optional `getEffectivePluginConfig`.
  - `HarnessSourceState` gains `policyUnknown?` and `policyFingerprint?`.
  - `isCapabilityPolicyUnknownError` → `{policyUnknown: true}`. Every other read failure keeps today's unfiltered
    semantics (`plugin-config-source-resolver.ts:136-150`).
- Validation notes: R2. No import from `@ptah-extension/agent-sdk`.
- P9 G1: `HarnessPluginConfigReader.getEffectivePluginConfig?(root): Promise<{config, fingerprint,
  overlayPluginPaths}>` is a structural mirror of agent-sdk's `EffectivePluginConfig`. `resolve` awaits it when it
  is present. It returns `HarnessSourceState | Promise<HarnessSourceState>` (R12).

### Task 3.3: Electron reader wrapper forwards the effective config — COMPLETE

- File: `apps/ptah-electron/src/di/phase-2-libraries.ts:200-231`
- Quality requirements: add `getEffectivePluginConfig: async (workspaceRoot) => { const e = await
  loader.getEffectivePluginConfig(workspaceRoot); return {...e, config: {...e.config, disabledSkillIds:
  [...e.config.disabledSkillIds, ...readDormantSkillSlugs(container)]}}; }`. Keep the existing three members. Add
  a comment in the file's own style saying why dormant slugs are folded here too.

### Task 3.2: Reconciler freeze and fingerprint — COMPLETE

- Plan reference: implementation-plan.md:257-266; health assembly is at `harness-reconciler.service.ts:238-245,431-436`
- Quality requirements:
  - When `policyUnknown`, MCP intents proceed, and skill, plugin and agent writes and removals are zero.
  - Health `sources: 'policy-unknown'`.
  - `policyFingerprint` is stamped on every health.
  - Spec: a previously disabled plugin and its skill copies stay absent across a frozen pass.
  - P9 G1 spec: global OFF opt-out plugin → no copies; global OFF skill → no copy; global ON opt-in plugin →
    copies; a workspace entry beats a global one.
  - The reconciler awaits `sourceResolver.resolve(...)` at both call sites (`:200`, `:383`).

## Batch 4: Status-bearing MCP facet inspect (PR 1) — COMPLETE (commit 5f6a750e8)

- Result:
  - 6 code files: the planned 5, plus `libs/backend/harness-sync/src/index.ts`, which exports the
    `McpFacetInspection` and `McpSourceStatus` types (2 lines, added in revise round 1).
  - code-logic-reviewer: APPROVE 9/10 after revise round 2.
  - Check: harness-sync lint, typecheck and test all pass.
  - Committed as `e10baf4b4` in the b4 worktree. The drift check was clean (no change to any of the 6 files on the
    feature branch since `cac3db9e2`), and the commit was cherry-picked onto the feature branch as `5f6a750e8`.
    The b4 worktree and branch are removed.
- The team-leader verified on disk:
  - `inspect` is on the port (`mcp-facet.port.ts:152`), and JSON and Codex implement it;
  - the Codex `inspect` goes through `readStatus` (`codex-toml-mcp-facet.ts:150-151`);
  - the ENOENT → `missing` and EACCES → `error` tests are at `codex-toml-mcp-facet.spec.ts:263,301`, and the second
    test also shows the legacy `readAll` still reads as empty;
  - no quoted-key parsing (PR 2).

- PR: 1
- Goal: C4 facets. `inspect(root) → {status, error?, servers}`, and a Codex `readStatus` that separates ENOENT
  from other errors (N9).
- Nx projects: `@ptah-extension/harness-sync`
- Depends on: B1
- Recommended executor: backend-developer | Fallback: general-purpose | Mode: sequential
- Reviewers: code-logic-reviewer
- ACs proved: AC-2.1 (source status per declaration), N9 fail-closed input
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/harness-sync --parallel=2`
- Commit: `feat(harness-sync): batch 4 - add status-bearing mcp facet inspect`
- Files (5 code):
  - M `libs/backend/harness-sync/src/lib/targets/mcp/mcp-facet.port.ts`
  - M `libs/backend/harness-sync/src/lib/targets/mcp/json-mcp-facet.ts`
  - M `libs/backend/harness-sync/src/lib/targets/mcp/codex-toml-mcp-facet.ts`
  - M `libs/backend/harness-sync/src/lib/targets/mcp/opencode-mcp-facet.spec.ts`
  - M `libs/backend/harness-sync/src/lib/targets/mcp/codex-toml-mcp-facet.spec.ts`

### Task 4.1: Port and JSON facet `inspect` — COMPLETE

- Plan reference: implementation-plan.md:275-280
- Quality requirements: the result type is declared in `mcp-facet.port.ts`, which is already exported
  (`harness-sync/src/index.ts:180-181`). No `index.ts` edit is expected; if one is needed, report it as an
  unplanned file.

### Task 4.2: Codex `readStatus` — COMPLETE

- Quality requirements: a private `readStatus(root) → {status: 'ok'|'missing'|'error', text, error?}`. Legacy
  `readAll` is byte-for-byte unchanged in behaviour (`codex-toml-mcp-facet.ts:109-110,187-195`). No quoted-key
  parsing (that is PR 2, Batch 18).

### Task 4.3: Regression specs — COMPLETE

- Quality requirements: EACCES → `inspect` returns `error` and `readAll` returns empty; ENOENT → `missing`. The
  opencode spec covers JSON `inspect`.

## Batch 5: agent-sdk tokens, loader layering and HarnessPolicySync (PR 1) — COMPLETE (commit 1e7aab5bb)

- Result:
  - 7 code files, as planned.
  - code-logic-reviewer: APPROVE after revise round 1. Its Serious-1 (the global layer is unreachable from the
    sync callers) is resolved at the batch-plan level by P9: G1/G2 in B3, G3/G4 in B25, and G5/G6 in B26 (PR 2).
  - Check: agent-sdk lint, typecheck and test all pass.
- The team-leader verified on disk:
  - the four tokens are at `di/tokens.ts:189-205`;
  - `HarnessPolicySync` is registered (`di/register.ts:554`) and exported with `CapabilityPolicyUnknownError` and
    `EffectivePluginConfig` (`src/index.ts:327-332`);
  - the error's `name` is the shared constant (`plugin-loader.service.ts:95-105`);
  - both sync readers are documented "WORKSPACE LAYER ONLY" (`:1216`, `:1484`);
  - the force rule and `lastAck` are at `harness-policy-sync.ts:49-92`.

- PR: 1
- Goal: C3 loader half, the C5 tokens and C5a.
- Nx projects: `@ptah-extension/agent-sdk`
- Depends on: B1
- Recommended executor: backend-developer | Fallback: general-purpose | Mode: sequential
- Reviewers: code-logic-reviewer
- ACs proved: AC-3.2 (legacy `PluginConfigState` unchanged), AC-3.3 (a legacy CLI save changes the fingerprint →
  forced pass), AC-4.9 (next-session application), N3 (restrictive on unknown), N4
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/agent-sdk --parallel=2`
- Commit: `feat(agent-sdk): batch 5 - layer capability policy into plugin loader`
- Files (7 code):
  - M `libs/backend/agent-sdk/src/lib/di/tokens.ts`
  - M `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts`
  - C `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.capabilities.spec.ts`
  - C `libs/backend/agent-sdk/src/lib/harness/harness-policy-sync.ts`
  - C `libs/backend/agent-sdk/src/lib/harness/harness-policy-sync.spec.ts`
  - M `libs/backend/agent-sdk/src/lib/di/register.ts`
  - M `libs/backend/agent-sdk/src/index.ts`

### Task 5.1: Tokens — COMPLETE

- Plan reference: implementation-plan.md:321-322
- Quality requirements: add `SDK_CAPABILITY_RESOLVER`, `SDK_CAPABILITY_GLOBAL_LAYER`, `SDK_HARNESS_POLICY_SYNC`
  and `SDK_MCP_SCHEMA_SIZE`. Follow the existing `SDK_TOKENS` style.

### Task 5.2: PluginLoaderService effective config — COMPLETE

- Plan reference: implementation-plan.md:245-251, :259-261
- Quality requirements:
  - An optional inject of `SDK_CAPABILITY_GLOBAL_LAYER`.
  - `getEffectivePluginConfig(root)` returns config + fingerprint from ONE snapshot, and throws
    `CapabilityPolicyUnknownError` (an `SdkError` whose `name` equals the B1 constant) when unreadable.
  - `resolveCurrentPluginPaths` → `[]` on unknown; `getDisabledSkillIds` → all known skill ids on unknown.
    (P9: both stay synchronous and workspace-only, and their JSDoc says so. Session callers move to
    `getEffectivePluginConfig` in B3 and B25.)
  - `saveWorkspacePluginConfig(config, root?)` captures `storageFor(root)` once.
  - Omitted `enabledSkillIds` is preserved.
- Validation notes: define the error in `plugin-loader.service.ts`, or in a file already listed. Any new errors
  file is unplanned and must be counted.
- Spec: pre-task config unchanged; global OFF / workspace ON; a save during an A→B switch; unknown throws.

### Task 5.3: HarnessPolicySync — COMPLETE

- Plan reference: implementation-plan.md:323-328
- Quality requirements: `apply(physicalRoot, fingerprint)`. It forces when the fingerprint differs from
  `lastAck`, runs at most one extra forced pass on a mismatched or joined result, and records `lastAck` only when
  `isHarnessPassAcknowledged`.
- Spec: acknowledged; mismatch → second pass; `writeFailed` not acknowledged; `null` not acknowledged; a legacy
  CLI save → forced.
- Register the sync in `di/register.ts`, and export it and the error from `src/index.ts`.

## Batch 6: Lock-free capability toggle store and Claude approval reader (PR 1) — COMPLETE (commit d003642a9)

- Result:
  - 4 code files, as planned.
  - code-logic-reviewer: APPROVE 8/10, with all 9 D1/D2 acceptance items RESOLVED and named tests. The one
    moderate issue (a flaky 200-write test) was fixed spec-only by the senior-tester with explicit 30 000 ms
    timeouts at `capability-toggle-store.spec.ts:548,602`; two load runs gave 59/59.
  - Check: cli-agent-runtime lint, typecheck and test all pass.
  - Committed as `e9881a54e` in the b6 worktree. The drift check was clean (none of the 4 paths existed on the
    feature branch), and the commit was cherry-picked as `d003642a9`.
  - The b6 worktree is de-registered, and its junction and branch are removed. An EMPTY directory
    `.claude-worktrees/feat-task-2026-560-b6` remains, locked by a live process handle; run `rmdir` on it later.
- The team-leader verified on disk:
  - no lock, `unlink` or `rm` in the store;
  - writes go through `atomicWriteWithRetry` (`capability-toggle-store.ts:430`), and the filename is checked
    against `canonicalFilename` (`:412`);
  - zod validation;
  - the D2 pair tests are at `capability-toggle-store.spec.ts:270-273`, the tombstone test at `:199`, the `.tmp`
    re-import at `:463` and the concurrent `publishImport` at `:521`;
  - the reader runs git through `execFile` with a timeout (`claude-approval.reader.ts:84-94`).
- Carried to B7: see the B7 acceptance item on `recordWorkspaceRoot`.

- PR: 1
- Goal: C2 store (lock-free, one file per toggle, IMPORTED layer) and the C4 `ClaudeApprovalReader`.
- Nx projects: `@ptah-extension/cli-agent-runtime`
- Depends on: B1 (codec and types; harness-sync `atomicWriteWithRetry` already exists at
  `harness-sync/src/index.ts:296,301`)
- Recommended executor: backend-developer (store, reader and base specs), then senior-tester (the C2 concurrency
  and interruption tests in the same spec file), in sequence within the batch
- Fallback: general-purpose | Mode: sequential
- Rationale: the plan handoff assigns the C2 concurrency tests to senior-tester.
- Reviewers: code-logic-reviewer
- **Reviewer acceptance items (mandatory):**
  - **D1, the IMPORTED layer:**
    - `imported.json` is one file per workspace, published once by `atomicWriteWithRetry`, and its existence is the
      marker.
    - A crash that leaves only `.tmp` → re-import.
    - A corrupt `imported.json` → `error` → unverified, never absent.
    - The `inherit` tombstone skips the imported layer, so a clear written before, during or after an import stays
      cleared.
    - An imported OFF over an inherited ON stays OFF.
    - Two concurrent `publishImport` calls → one complete file, never a mix.
  - **D2, the `l_`/`h_` namespaces:**
    - The reader recomputes `canonicalFilename(kind, id)` from the content and rejects a mismatch (→ `error`).
    - The collision pair `"x".repeat(121)` (→ `mcp__h_79072a47bfaa54e6057a9ee21e0dea64b9edbfd1.json`) and id
      `h_79072a47bfaa54e6057a9ee21e0dea64b9edbfd1` (→ `mcp__l_h_79072a47….json`) map to different files.
    - Toggling or clearing one leaves the other byte-identical.
- ACs proved: AC-1.1 (persistence), AC-1.4 (EACCES or rename failure rejects; the prior file stays
  byte-identical), AC-2.3 (the global snapshot is unchanged after a workspace write), D1, D2, N7 (`wsKey` on a
  win32 alias vs case-sensitive roots)
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/cli-agent-runtime --parallel=2`
- Commit: `feat(cli-agent-runtime): batch 6 - add lock-free capability toggle store`
- Files (4 code):
  - C `libs/backend/cli-agent-runtime/src/lib/capabilities/capability-toggle-store.ts`
  - C `libs/backend/cli-agent-runtime/src/lib/capabilities/capability-toggle-store.spec.ts`
  - C `libs/backend/cli-agent-runtime/src/lib/capabilities/claude-approval.reader.ts`
  - C `libs/backend/cli-agent-runtime/src/lib/capabilities/claude-approval.reader.spec.ts`

### Task 6.1: CapabilityToggleStore — COMPLETE

- Plan reference: implementation-plan.md:166-241
- Pattern to follow: `libs/backend/harness-sync/src/lib/fs/atomic-write.ts:36-70`
- Quality requirements:
  - The layout is `~/.ptah/capabilities/{global,workspaces/<wsKey>/items,workspaces/<wsKey>/imported.json,root.json}`.
  - `wsKey = sha256(policyKey).slice(0,32)`.
  - Items are validated by zod.
  - Every read is a fresh `readdir` with no cache. Unknown names are ignored and logged; 0-byte or unparseable
    files are errors.
  - `setExplicit` writes `on`.
  - Ptah never deletes an item.
  - The class implements `ICapabilityGlobalLayer` and exposes `fingerprintEntries` (skill and plugin items only).
  - It logs through `IOutputChannel` (`PLATFORM_TOKENS.OUTPUT_CHANNEL`).
- Validation notes: no lock, and no import of harness-sync `file-lock.ts`. The tests use a real temp directory:
  200 interleaved writes from two instances on different items → all present.

### Task 6.2: ClaudeApprovalReader — COMPLETE

- Plan reference: implementation-plan.md:101-110, :283-284
- Quality requirements:
  - It reads `~/.claude.json` `projects[<physicalRoot>]` with the existing key-folding rule.
  - It reads `.claude/settings.local.json` only when git reports the file ignored AND untracked.
  - git runs with argument arrays and a 2 s timeout, and an expected non-zero exit is distinguished from a git
    failure.
  - It never throws, and returns `{status, approvals}`.
- Spec: the tracked, non-git and git-timeout cases.

## Batch 7: Capability resolver, single inventory and DI (PR 1) — COMPLETE (commit 8bf335662; cherry-picked from `b0332ffcc`, drift check clean, b7 worktree and branch removed)

- Result so far:
  - 7 code files: 6 planned + 1 unplanned `libs/backend/cli-agent-runtime/src/lib/capabilities/capability-policy-model.ts`.
  - code-logic-reviewer: APPROVE, high confidence. Items (a)-(f) pass, and the DI-order fail-open was traced SAFE
    on VS Code, Electron and CLI (lazy closures only).
  - Check: cli-agent-runtime lint, typecheck and test all pass.
- The team-leader verified on disk:
  - resolution inputs come only from `getEffectivePluginConfig` (`capability-resolver.service.ts:439,605`);
  - the approved write-base deviation is at `:605-614`, with no `await` between the two reads;
  - `recordWorkspaceRoot` is best-effort, with try/catch and a log (`:283-297`);
  - `ensureImported` runs before a write (`:217,245`), and the root uses `realpathSync.native` (`:263`);
  - both tokens are registered (`di/register.ts:128,137`).
- Reviewer moderate #2 (catalog/policy snapshot skew in `readSnapshot`) is ACCEPTED as documented (orchestrator
  decision, 2026-09-26).
- Reviewer moderate #1 moved to B12 as an acceptance item: the DI-order regression spec.

- PR: 1
- Goal: C4 resolver and inventory, plus registration of the store, reader and resolver under the `SDK_TOKENS`.
- Nx projects: `@ptah-extension/cli-agent-runtime`
- Depends on: B4 (done, `5f6a750e8`), B5 (must be COMMITTED first), B6 (done, `d003642a9`)
- Recommended executor: backend-developer | Fallback: general-purpose | Mode: sequential
- Reviewers: code-logic-reviewer
- **Reviewer acceptance items (mandatory):**
  - (from the B6 review) `CapabilityToggleStore.recordWorkspaceRoot` (`capability-toggle-store.ts:301-315`) has no
    try/catch around its diagnostics-only `root.json` write. The resolver must call it best-effort (catch, log
    through `IOutputChannel`, continue), so a failed diagnostics write never fails `resolve`, `set` or a session.
    A spec proves that a rejecting `recordWorkspaceRoot` still yields a verified set.
  - (P9) The resolver's skill and plugin inputs come ONLY from `await getEffectivePluginConfig(physicalRoot)`.
    There are no calls to the workspace-only `resolveCurrentPluginPaths`, `getDisabledSkillIds` or
    `getWorkspacePluginConfig`. `deniedSkillNames` includes global-OFF skills and the children of global-OFF
    plugins. `CapabilityPolicyUnknownError` → `unverified`.
  - (P9 G7) Skill and plugin workspace writes use `saveWorkspacePluginConfig(…, physicalRoot)` with a
    workspace-only payload built from the stored workspace config, never from the layered `config`, so global
    items are never copied into the workspace.
  - (R7/N2) `set` awaits `ensureImported` first, and the "first `set()` in a fresh workspace" spec exists.
  - (Declared deviation, approved by the orchestrator on 2026-09-26)
    - What it does: for skill and plugin writes, `set()` reads `getWorkspacePluginConfig(physicalRoot)` as the
      WRITE-payload base. That read comes immediately after a strict `await getEffectivePluginConfig(physicalRoot)`,
      with no `await` in between.
    - Why: it is how the G7 rule "build the payload from the stored workspace config, never the layered one" is
      met.
    - The reviewer confirms three things:
      - (a) there is no `await` between the two reads;
      - (b) resolution inputs (effective state, denied sets, the fingerprint) still come ONLY from
        `getEffectivePluginConfig`;
      - (c) the strict effective read fails closed (`CapabilityPolicyUnknownError` → the write is rejected)
        before the workspace read is used.
- ACs proved:
  - AC-1.2 (A vs B), AC-1.3 (on-again writes the `inherit` tombstone; the entry shows inheriting);
  - AC-2.1 (scope and paths), AC-2.3 (user files unchanged), AC-3.1 (backend: skill and plugin workspace
    writes);
  - AC-4.1 (three `settings.local.json` fixtures with `imported.json` present);
  - N2 (first `set()` in a fresh workspace), N6, N7.
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/cli-agent-runtime --parallel=2`
- Commit: `feat(cli-agent-runtime): batch 7 - add capability resolver and inventory`
- Files (6 code):
  - C `libs/backend/cli-agent-runtime/src/lib/capabilities/capability-resolver.service.ts`
  - C `libs/backend/cli-agent-runtime/src/lib/capabilities/capability-resolver.service.spec.ts`
  - M `libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-install.service.ts`
  - M `libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-install.service.spec.ts`
  - M `libs/backend/cli-agent-runtime/src/lib/di/register.ts`
  - M `libs/backend/cli-agent-runtime/src/index.ts`

### Task 7.1: CapabilityResolverService — COMPLETE

- Plan reference: implementation-plan.md:80-110, :286-309
- Quality requirements:
  - `resolve(cwd)`: physical root via `realpathSync.native(resolveHarnessWorkspaceRoot(cwd))`. The
    `policyKey` is lower-cased on win32 only. Then single-flight `ensureImported`, then store + inventory +
    `getEffectivePluginConfig` + back-off.
  - It produces denied, approved (explicit or imported ON only) and `deniedSkillNames` (including the
    children of disabled plugins, bare and `plugin:skill`), plus `harnessFingerprint` and `status`.
  - `list(root)` shares the same inputs.
  - `set` awaits `ensureImported` first.
  - Skill and plugin workspace writes go through `saveWorkspacePluginConfig(…, physicalRoot)`.
  - An unknown id is rejected.
- Validation notes: R7 and R8. An `.mcp.json` error or an unreadable Codex config → `unverified`. A source error
  publishes nothing, and a retry imports. A server added later is OFF. Two concurrent `resolve` calls → one
  import. It logs through `IOutputChannel`.

### Task 7.2: McpInstallService.listDeclarations — COMPLETE

- Quality requirements: `listDeclarations(root) → {declarations, sourceStatus}` uses facet `inspect` (B4) and
  feeds both `listInstalled` (which dedupes including scope) and the resolver. Claude user rows use the existing
  `entry.scope`. The #16 reader switch is PR 2 (Batch 19).

### Task 7.3: DI — COMPLETE

- Quality requirements:
  - Register the store as `SDK_CAPABILITY_GLOBAL_LAYER` and the resolver as `SDK_CAPABILITY_RESOLVER`.
  - Export `CapabilityResolverService` and `CapabilityToggleStore` from `src/index.ts`.
  - Record the write-path trace notes for Mode 3.

## Batch 8: Claude SDK enforcement (PR 1) — COMPLETE (commit f68419e63)

- Result:
  - 10 code files: 8 planned + 2 unplanned (recorded below).
  - code-logic-reviewer: APPROVE after revise round 1.
  - Check: agent-sdk lint, typecheck and test all pass.
- The team-leader verified on disk:
  - the flag tier is at `sdk-query-options-builder.ts:419-486`, and the fail-closed
    `{strictMcpConfig: true, skills: []}` at `:507-510`;
  - the notice is emitted at `:605`, and the local notice-code cast is GONE (the follow-up is closed);
  - the model probe is strict with `skills: []` (`sdk-model-service.ts:842-844`);
  - the runner injects `SDK_CAPABILITY_RESOLVER` optionally (`sdk-query-runner.service.ts:202`);
  - the executor passes `policy.harnessFingerprint` to `HarnessPolicySync` (`session-query-executor.service.ts:612-619`);
  - no workspace-only sync loader call appears in any of the five source files (P9).
- **Cross-batch item (OPEN):**
  - Harness policy sync does not run in real sessions until **B7** registers `SDK_CAPABILITY_RESOLVER` (the
    injection is optional, so an unregistered resolver takes the unverified or no-op path).
  - B7's reviewer confirms the registration.
  - **B17's live check must confirm the sync runs on all three hosts (VS Code, Electron, CLI):** a skill toggle is
    followed by a harness pass stamped with the new `policyFingerprint`.

- PR: 1
- Goal: C5 builder, runner (one-shots), model probe and executor. Verified policy → flags. Unverified → strict MCP
  + `skills: []` + notice.
- Nx projects: `@ptah-extension/agent-sdk`
- Depends on: B5 (must be COMMITTED first; the resolver is mocked through `ICapabilityResolver`, and B7 is not
  needed at compile time)
- Recommended executor: backend-developer | Fallback: general-purpose | Mode: sequential
- Reviewers: code-logic-reviewer
- Unplanned files (recorded 2026-09-26; counted in the running count):
  - `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`
  - `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.output-style.spec.ts`
- Follow-up for a later batch:
  - After B2 lands, the NEXT batch that touches `sdk-query-options-builder.ts` must remove the local
    `'capability-policy-unverified' as SessionMcpNotice['code']` cast. B2 adds the literal to
    `SessionMcpNoticeCode`, so the cast becomes redundant.
  - **CLOSED in `f68419e63`:** the cast is removed (verified by grep).
  - **Owning batch: B8's revise round** (orchestrator decision, 2026-09-26; B2 is now on the branch). The B8
    reviewer checks that the cast is gone and that the literal typechecks directly.
  - (Superseded text follows.) Owning batch: TBD. The B8 reviewer names it, and the team-leader then copies this
    item into that batch's
    acceptance items.
- **Reviewer acceptance items (P9):**
  - The builder, runner, model probe and executor take skill and plugin policy ONLY from
    `EffectiveCapabilitySet` (`deniedSkillNames`, `disabledPluginIds`, `harnessFingerprint`). None of them calls the
    loader's workspace-only sync methods.
  - `HarnessPolicySync.apply` gets the set's `harnessFingerprint`.
  - Spec: a global-OFF skill (it arrives in `deniedSkillNames` from a mocked resolver) is denied through
    `skillOverrides`.
- ACs proved: AC-3.4, AC-4.2, AC-4.3 (built options, direct and proxied), AC-4.6 (ptah OFF honoured; ptah present
  by default), AC-4.7 (back-off wins), AC-4.9, and unit coverage for A1 and A2
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/agent-sdk --parallel=2`
- Commit: `feat(agent-sdk): batch 8 - enforce capability policy in claude sessions`
- Files (8 code):
  - M `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`
  - C `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.capabilities.spec.ts`
  - M `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts`
  - M `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.spec.ts`
  - M `libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.ts`
  - M `libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.spec.ts`
  - M `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts`
  - M `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.harness-preflight.spec.ts`

### Task 8.1: Builder flags and fail-closed mode — COMPLETE

- Plan reference: implementation-plan.md:329-346; existing deny plumbing is at `sdk-query-options-builder.ts:373-410`
- Quality requirements:
  - Verified: `deniedMcpServers` / `disabledMcpjsonServers` (flag tier), explicit-only `enabledMcpjsonServers`,
    `skillOverrides`. ptah is filtered only when explicitly OFF, and denied overrides are removed.
  - Unverified: `strictMcpConfig: true` with ptah only (omitted only if a readable store says OFF), `skills: []`,
    and the `capability-policy-unverified` notice.
- Spec: a repository server OFF is denied under a user `enableAll`; explicit ON is approved; proxied parity; ptah
  default and OFF; back-off; parent-off children; unverified.

### Task 8.2: Executor, runner and model probe — COMPLETE

- Quality requirements:
  - `SessionQueryExecutor` runs `HarnessPolicySync.apply` before the build. Unacknowledged is logged and not
    fatal. Unverified → no preflight.
  - One-shots use the same flags, or strict mode when unverified.
  - The model probe uses `strictMcpConfig: true`, `mcpServers: {}` and `skills: []`.

## Batch 9: Ptah CLI enforcement and chat notice (PR 1) — COMPLETE (commit eeb1d2a4d; cherry-picked from `df2417f05`)

- PR: 1
- Goal: C5 Ptah CLI ordering (resolve policy → `HarnessPolicySync.apply` → `assembleSpawnOptions`), and the chat
  chip rendering the unverified notice.
- Nx projects: `@ptah-extension/cli-agent-runtime`, `@ptah-extension/chat`
- Depends on: B2, B7, B8
- Recommended executor: backend-developer (the chip is a single template/notice change) | Fallback:
  frontend-developer for the chip | Mode: sequential
- Reviewers: code-logic-reviewer, code-style-reviewer (chat UI)
- ACs proved: AC-4.5 (Ptah CLI lane), AC-4.6 (unverified chip notice), AC-3.3
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/cli-agent-runtime,@ptah-extension/chat --parallel=2`
- Commit: `feat(cli-agent-runtime,chat): batch 9 - enforce policy for ptah cli agents`
- Files (4 code):
  - M `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.service.ts`
  - M `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts`
  - C `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-capabilities.spec.ts`
  - M `libs/frontend/chat/src/lib/components/molecules/mcp-status-chip.component.ts`

- **Amendment (2026-09-26, team-leader, before launch):**
  - B8's capability helpers (`capabilityFlagsFor`, `capabilityIsolationOptions`, `filterMcpServersByPolicy`,
    `unverifiedCapabilityPolicy`, `capabilityPolicyNotice`, all in `sdk-query-options-builder.ts:469-600`) are
    NOT on agent-sdk's public barrel.
  - B9 needs them so the Ptah CLI spawn path shares ONE definition with the Claude builder; a copy is forbidden.
  - B9 therefore also edits `libs/backend/agent-sdk/src/index.ts`: ONE direct export statement from
    `'./lib/helpers/sdk-query-options-builder'`. This follows the precedent of direct helper exports at
    `src/index.ts:221,333`; the `helpers/index.ts` barrel is NOT touched.
  - That file is already in the PR diff (B5), so there is **no budget cost**.
  - It is a documented 3-project exception: cli-agent-runtime, chat and agent-sdk.
  - The check adds `@ptah-extension/agent-sdk`.
  - Current code: `ptah-cli-registry.ts:658` runs `runHarnessPreflight(cwd)` BEFORE `assembleSpawnOptions`, and the
    policy is never resolved there.
  - The chip (`mcp-status-chip.component.ts:172-190`) renders the claude.ai connector copy for EVERY notice, so the
    new notice code needs its own branch.
- **Amendment 2 (2026-09-26, orchestrator, after the B9 logic review):**
  - Blocking fix: `SDK_MCP_SERVER_BACKOFF_SERVICE` used `useClass`, but its untokened `options?` parameter makes
    tsyringe throw "TypeInfo not known for Object". `CapabilityResolverService` depends on it, so
    `SDK_CAPABILITY_RESOLVER` could not be constructed on any host. B9 registers it with `instanceCachingFactory`
    in `libs/backend/agent-sdk/src/lib/di/register.ts` (already in the PR diff) and adds a regression test to
    `register.compaction-boundary-registry.smoke.spec.ts` (+1 file). The test fails with the old registration.
  - `PLATFORM_TOKENS.DI_CONTAINER` stays optional in `ptah-cli-registry.ts`. A required container forced 11 more
    spec edits, which broke the file budget. A comment on `lookupOptional` records why.
  - AC-4.6 for the Ptah CLI lane is deferred to PR 2 (see implementation-plan.md "Fail-closed policy",
    amendment). B9 proves AC-4.6 for the chip rendering only. The Ptah CLI lane enforces strict options and logs
    a warn.
  - Final B9 file set (10): the 4 code files above, `agent-sdk/src/index.ts`, `register.ts`, the smoke spec, and
    the 3 edited registry specs (harness-preflight, off-thread-spawn, spawn-model). New to the PR diff: 8, so
    PR 1 is 100 before L5 and **99 after L5**.
- Worktree: `feat-task-2026-560-b9` (branch `feat/task-2026-560-b9-ptah-cli-policy`, base `ae855b8dd`).
- Isolation checks:
  - B9 does not touch `@ptah-extension/chat-ui` (B14b) or `libs/frontend/marketplace` (B14); the chip lives in
    `@ptah-extension/chat`.
  - B25 is in `@ptah-extension/vscode-lm-tools` and does not touch `protocol-dispatcher.ts` (TASK_2026_559).

### Task 9.1: Registry ordering and spawn flags — COMPLETE

- Plan reference: implementation-plan.md:336-337, :346; reorders `ptah-cli-registry.ts:657-659`
- Quality requirements: the assembly carries the flags, or strict mode when unverified.
- Spec: ordering (the policy is resolved before preflight), flags present, strict when unverified.
- Pattern: `ptah-cli-registry-harness-preflight.spec.ts`.

### Task 9.2: Chat chip notice — COMPLETE

- Quality requirements: render the plan text "Only Ptah tools are loaded and skills are off: Ptah couldn't read
  <path> (<reason>). Fix the file and start a new session." Use OnPush and signals, as the component already does.

## Batch 10: Capabilities RPC handlers (PR 1) — COMPLETE (commit 916dd9ad9; cherry-picked from `964726aaa`)

- PR: 1
- Goal: C8 `CapabilityRpcHandlers` with a zod schema, the handler index and exports, and the host-profile
  manifest entry.
- Nx projects: `@ptah-extension/rpc-handlers`
- Depends on: B2, B7
- Recommended executor: backend-developer | Fallback: general-purpose | Mode: sequential
- Reviewers: code-logic-reviewer
- ACs proved: AC-1.4 (store error → RPC error), AC-3.1, AC-5.2 (no `schemaTokens` without `SDK_MCP_SCHEMA_SIZE`
  → "size unknown")
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/rpc-handlers --parallel=2` (includes `host-profile/resolve-handler-plan.spec.ts`, P4)
- Commit: `feat(rpc-handlers): batch 10 - add capabilities rpc handlers`
- **Status (2026-09-26):**
  - code-logic-reviewer: APPROVE 8/10. Boot order is safe on all three hosts. Moderate-1 (the list-check race
    falls back to generic text and never widens) is accepted as documented.
  - 5 code files (the schema is inlined; there is no `capability-rpc.schema.ts`).
  - Check: rpc-handlers passes 3301 tests (4 skipped), and `rpc-allowlist.spec.ts` now PASSES.
  - Committed on its branch as `964726aaa`. The cherry-pick comes after the B3 commit, on the orchestrator's go.
  - The team-leader verified on disk:
    - the `explicit` restrictions are at `capability-rpc.handlers.ts:103-126`;
    - the manifest owns the methods at `manifest.ts:206-208`;
    - the optional schema-size port is at `:136`.
- **Commit-order constraint (recorded 2026-09-26):**
  - `CapabilityRpcHandlers` injects `SDK_CAPABILITY_RESOLVER` as REQUIRED, so the hosts would throw at boot
    without it.
  - On the feature branch, **B7 (`b0332ffcc`, cherry-pick pending) must be committed BEFORE B10**.
- **PR 2 carry-over (for B20):** B10 defines a local port `McpSchemaSizeReader { schemaTokensFor(cwd):
  Promise<ReadonlyMap<string, number>> }` in `capability-rpc.handlers.ts`. B20's `McpSchemaSizeService` must
  implement exactly that shape, or move the port to `@ptah-extension/shared` and update B10's import.
- **Reviewer acceptance items:**
  - (Dependency note, 2026-09-26) B10 depends on B7 only at RUNTIME. It injects `SDK_CAPABILITY_RESOLVER` typed as
    the shared `ICapabilityResolver` (`resolve`, `list`, `set`, `setExplicit`), and passes the active workspace
    path as `cwd`; the resolver canonicalizes the root itself. It imports nothing from
    `@ptah-extension/cli-agent-runtime`, and its specs mock the resolver.
  - (From the B2 review, minor) The `setEnabled` zod schema rejects `explicit: true` together with
    `scope: 'global'` at the RPC boundary (only the install path may request an explicit write, and it is
    workspace-only), and a spec proves it.
  - `rpc-allowlist.spec.ts:41-43` ("claims every registry method exactly once") PASSES, because the manifest entry
    owns `capabilities:getState`, `capabilities:getEffective` and `capabilities:setEnabled` (the transient failure
    B2 introduced).
  - The zod request schemas live INSIDE `capability-rpc.handlers.ts` (budget fallback, applied 2026-09-26). No
    separate `capability-rpc.schema.ts` is created. The schemas are module-level constants at the top of the file,
    named as `agent-rpc.schema.ts` would name them, so a later extraction is mechanical.
- Files (5 code; the schema file was dropped by the budget fallback):
  - C `libs/backend/rpc-handlers/src/lib/handlers/capability-rpc.handlers.ts` (handlers plus their zod schemas)
  - C `libs/backend/rpc-handlers/src/lib/handlers/capability-rpc.handlers.spec.ts`
  - M `libs/backend/rpc-handlers/src/lib/handlers/index.ts`
  - M `libs/backend/rpc-handlers/src/index.ts`
  - M `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts` (pattern: the `HarnessRpcHandlers.METHODS` entry at `manifest.ts:197`)

### Task 10.1: Handlers — COMPLETE

- Plan reference: implementation-plan.md:360-366
- Quality requirements:
  - `getState`, `getEffective` and `setEnabled`; the root comes from `canonicalPolicyRoot`.
  - zod runs at entry, and ids are validated against the inventory.
  - `schemaTokens` is attached only when the optional `SDK_MCP_SCHEMA_SIZE` is registered.
  - A write failure → RPC error naming the item.

## Batch 11: Install writes explicit ON, CLI host wiring (PR 1) — COMPLETE (commit ae855b8dd; cherry-picked from `8e177e76a`)

- PR: 1
- Goal: `McpDirectoryRpcHandlers` install calls `setExplicit` (N6), with a `capabilityWarning` on failure, and the
  cli-engine container registers the capability handlers and services.
- Nx projects: `@ptah-extension/rpc-handlers`, `@ptah-extension/cli-engine`
- Depends on: B10
- Recommended executor: backend-developer | Fallback: general-purpose | Mode: sequential
- Reviewers: code-logic-reviewer
- ACs proved: N6 (a workspace install with a same-name Codex-global entry ends up approved), AC-3.1 (CLI host has
  the RPC)
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/rpc-handlers,@ptah-extension/cli-engine --parallel=2`
- Commit: `feat(rpc-handlers,cli-engine): batch 11 - write explicit on at install`
- **Reviewer acceptance items:**
  - `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts:60` PASSES (it currently fails at 391 vs 388). The
    three `capabilities:*` methods are either registered on the CLI surface through the `container.ts`
    registration, or explicitly excluded with a stated reason.
  - Registering is preferred, because AC-3.1 wants the CLI host to have the RPC and it needs no new file.
  - If an exclusion or surface-list file outside `container.ts` must change, it is an unplanned file: the executor
    reports it, and the team-leader re-counts the budget before commit.
  - The check already includes `@ptah-extension/cli-engine`.
- Files (3 code):
  - M `libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.ts`
  - M `libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.spec.ts`
  - M `libs/backend/cli-engine/src/lib/container.ts`

## Batch 12: Electron and VS Code host registration (PR 1) — COMPLETE (commit 38b4c30f4)

- Result:
  - 2 code files, as planned: a `registerSingleton(CapabilityRpcHandlers)` on each host, plus the Electron
    phase-4 name entry.
  - code-logic-reviewer: APPROVE 9/10. The resolver is registered in phase 2, before the phase 3 and phase 4
    handlers on both hosts, and the singleton is the same instance `registerRpcSurface` resolves.
  - Check: ptah-electron (873 passed, 3 skipped) and ptah-extension-vscode (101 passed); lint and typecheck pass.
- **DI-order assertion: NOT added.** No spec had to be touched, because both host `rpc-surface.spec.ts` files
  already pass after B10. Under the Option 1 rule:
  - VS Code and Electron → **B17 live check**;
  - CLI → the B11 reviewer's trace of `cli-engine/src/lib/container.ts`, plus the B17 live check.

- PR: 1
- Goal: register `CapabilityRpcHandlers` in both desktop hosts (NFR: both hosts surface the controls).
- Nx projects: `ptah-electron`, `ptah-extension-vscode`
- Depends on: B10
- Recommended executor: backend-developer | Fallback: general-purpose | Mode: sequential
- Reviewers: code-logic-reviewer
- ACs proved: NFR compatibility (VS Code + Electron), and AC-1.1 across app restart (a host-wired handler)
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p ptah-electron,ptah-extension-vscode --parallel=2`
- Commit: `feat(electron,vscode): batch 12 - register capabilities rpc handlers`
- Files (2 code):
  - M `apps/ptah-electron/src/di/phase-4-handlers.ts` (pattern: `:43,105,160`)
  - M `apps/ptah-extension-vscode/src/di/phase-3-handlers.ts` (pattern: `:48,82`)
- **Reviewer acceptance item (surface parity, recorded 2026-09-26):**
  - `apps/ptah-electron/src/di/rpc-surface.spec.ts:38` (it currently fails at 391 vs 388) PASSES, because B12
    registers the three `capabilities:*` methods on the Electron host, or explicitly excludes them with a reason.
  - The same holds for `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts` if it pins the count.
  - Registering is preferred. Any file beyond `phase-4-handlers.ts` and `phase-3-handlers.ts` is unplanned and
    must be counted.
- **Reviewer acceptance item (B7 reviewer moderate #1, recorded 2026-09-26): DI-order regression spec.**
  - What the spec pins: after each host's bootstrap, `PluginLoaderService` has the global capability layer
    injected (`SDK_CAPABILITY_GLOBAL_LAYER` resolved, not `undefined`). Otherwise `getEffectivePluginConfig`
    would silently ignore a global OFF.
  - Why B12: it is the host-wiring batch whose projects (`ptah-electron`, `ptah-extension-vscode`) each already
    have a container smoke spec. B11's only spec (`mcp-directory-rpc.handlers.spec.ts`) cannot hold a bootstrap
    assertion.
  - **SUPERSEDED by the Option 1 decision:** the assertion goes ONLY into a spec B12 already modifies (for the
    391-vs-388 surface fix). The two container smoke specs are NOT touched. A host with no already-modified spec
    is covered by B17's live check.
  - (Old text:) Where it goes: add the assertion to the EXISTING `apps/ptah-electron/src/di/container.smoke.spec.ts` and
    `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts`. No new file, but **+2 changed files**, because
    neither spec is in the PR yet.
  - The CLI host is covered without a file: by the B11 reviewer's trace of `cli-engine/src/lib/container.ts`
    registration order, and by B17's per-host live check.
  - **Budget: this is pending the orchestrator's lever decision** (see the running count). Without levers it
    takes PR 1 to 100.

## Batch 13: Marketplace capability store, toggle control and shell banner (PR 1) — COMPLETE (commit fb49b8621; cherry-picked from `f33e72f3e`)

- PR: 1
- Goal: C10 foundation. The store does an optimistic update and reverts on error. `CapabilityToggleComponent`
  carries the badges, the accessible name and the scope-of-write text. The shell shows the policy banner.
- Nx projects: `@ptah-extension/marketplace`
- Depends on: B2. Entry step: the visual-reviewer captures the BEFORE screenshots (dark + light) at `c4bdc87dd`
  before this batch is committed.
- Recommended executor: frontend-developer | Fallback: general-purpose | Mode: sequential
- Reviewers: code-logic-reviewer, code-style-reviewer
- ACs proved: AC-1.4 (revert + error naming the server), AC-1.5 (accessible name with name + state; keyboard
  operable), AC-2.2 ("This workspace only"), AC-2.4 (override indicator), AC-4.6 (ptah OFF warning), AC-4.8
  ("not enforced" from `CAPABILITY_ENFORCEMENT`), AC-4.9 ("applies to the next session")
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/marketplace --parallel=2`
- Commit: `feat(marketplace): batch 13 - add capability toggle store and control`
- Files (5 code; R4 allows +1 `marketplace-shell.component.html`):
  - C `libs/frontend/marketplace/src/lib/data/capability-toggles.store.ts` (pattern: `data/connector-links.store.ts`)
  - C `libs/frontend/marketplace/src/lib/data/capability-toggles.store.spec.ts`
  - C `libs/frontend/marketplace/src/lib/ui/capability-toggle.component.ts`
  - C `libs/frontend/marketplace/src/lib/ui/capability-toggle.component.spec.ts`
  - M `libs/frontend/marketplace/src/lib/shell/marketplace-shell.component.ts`

### Task 13.1: Store — COMPLETE

- Quality requirements: signals only. `setEnabled` is optimistic → reconcile with the returned entry, or revert
  and surface the error on failure. Unverified status → banner state with the paths (each bad item file named).

### Task 13.2: Toggle control — COMPLETE

- Quality requirements:
  - OnPush.
  - Badges: new workspace server, imported, parent-off, unknown, inheriting/override.
  - The ptah-OFF warning copy is AC-4.6: agent lanes, memory and browser become unavailable.
  - The accessible name includes the item name and the state.

### Task 13.3: Enforcement labels and shell banner — COMPLETE

- Validation notes: A-UI and R6. Labels are derived from `CAPABILITY_ENFORCEMENT` and never hard-coded, so the
  PR 2 flip needs no UI edit.

## Batch 14: Server pages - toggles, scope, declarations and size (PR 1) — COMPLETE (commit e303b8514; cherry-picked from `a02b31482`)

- PR: 1
- Goal: wire the toggle into the Installed servers rows and the server detail. The UI shows the scope label and
  source paths as a declaration LIST (#16-ready), the scope-of-write text, and "size unknown" (which is always the
  case in PR 1).
- Nx projects: `@ptah-extension/marketplace`
- Depends on: B13
- Recommended executor: frontend-developer | Fallback: general-purpose | Mode: sequential
- Reviewers: code-logic-reviewer, code-style-reviewer
- **Reviewer acceptance items (recorded 2026-09-26):**
  - (From the B13 review) AC-2.3 template wiring, proven by a spec once the pages consume the control: a
    `scope="workspace"` toggle calls `setEnabled` with `scope: 'workspace'` and never `'global'`, and a
    `scope="global"` toggle does the reverse.
  - L4: `provider-list-view.testing.ts` is left untouched unless the helper truly needs a change. If it does, that
    is counted, and the orchestrator is told before the file is written.
  - After B14 lands, the visual-reviewer takes the AFTER capture against the `feat-task-2026-560-before` worktree
    (keep that worktree until then).
- ACs proved: AC-1.1 (UI), AC-1.3 (inheriting shown), AC-1.5, AC-2.1, AC-2.2, AC-2.4, AC-4.6, AC-4.8, AC-5.2
  ("size unknown", and a failed server doesn't block the page)
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/marketplace --parallel=2`
- Commit: `feat(marketplace): batch 14 - add server toggles, scope and size labels`
- Files (9 code):
  - M `libs/frontend/marketplace/src/lib/pages/servers/provider-list-view.component.ts`
  - M `libs/frontend/marketplace/src/lib/pages/servers/provider-list-view.component.html`
  - M `libs/frontend/marketplace/src/lib/pages/servers/provider-list-view.component.spec.ts`
  - M `libs/frontend/marketplace/src/lib/pages/servers/provider-list-view.testing.ts`
  - M `libs/frontend/marketplace/src/lib/pages/servers/server-detail.component.ts`
  - M `libs/frontend/marketplace/src/lib/pages/servers/server-detail.component.html` (paths block at `:335-363`)
  - M `libs/frontend/marketplace/src/lib/pages/servers/server-detail.component.spec.ts`
  - M `libs/frontend/marketplace/src/lib/pages/servers/installed-servers-page.component.ts`
  - M `libs/frontend/marketplace/src/lib/pages/servers/installed-servers-page.component.spec.ts`
- Validation notes:
  - A-UI: render N declarations generically. In PR 1 there is one `~/.claude.json` declaration per name.
  - The figure renders only when `schemaTokens` is present, labelled with the estimate method.
  - The ptah CLI proxy row shows "not enforced".

## Batch 14b: Show the install capabilityWarning (PR 1) — COMPLETE (commit 2828233a3)

- PR: 1 (added 2026-09-26 by orchestrator decision, option a1 of the `capabilityWarning` lookup)
- Goal: after an MCP install, a failed workspace-ON record (B11's `McpDirectoryInstallResult.capabilityWarning`)
  is shown to the user, so a repository server is not left OFF without explanation.
- Nx projects: `@ptah-extension/chat-ui`
- Depends on: B11 (the optional shared field). It runs in the feature worktree AFTER B11 is committed there.
- Recommended executor: frontend-developer | Fallback: general-purpose | Mode: sequential
- Reviewers: code-logic-reviewer, code-style-reviewer (UI). They append to `reviews/code-review.md`.
- ACs proved: AC-1.4 spirit (no silent partial state after install), N6 visibility
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/chat-ui --parallel=2`
- Commit: `feat(chat-ui): batch 14b - show install capability warning` (the `chat-ui` scope is verified in
  `.commitlintrc.json`)
- Files (1 code):
  - M `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.ts`
- **Reviewer acceptance items:**
  - Inside the `successes.length > 0` branch (`:500-508`), when `result.data.capabilityWarning` is present, show it
    through the existing message surface (`error` signal, rendered at `:91-93`, `data-testid="mcp-error"`).
  - The failure paths (`:510-521`, the catch at `:522-524`) are unchanged.
  - A later per-target failure message still reports failures and is not masked by the warning. If both occur, the
    reviewer confirms that the user sees the failure text; the warning must not replace a failure.
  - No other file is edited, and no spec is added (option a1; there is no regression test by decision).
- Carried to PR 2: option c, where the CLI prints `capabilityWarning` in `apps/ptah-cli/src/cli/commands/mcp.ts`
  (`:244-258`), is added to **B21** (same `ptah-cli` project, +1 file there).

## Batch 16: Webview e2e for Marketplace capability controls (PR 1) — COMPLETE (commit c38a55204)

- PR: 1
- Goal: C11 scenarios in the existing harness marketplace e2e location
  (`libs/frontend/webview-e2e-harness/src/lib/scenarios/marketplace/`, next to `marketplace-servers.e2e.spec.ts`).
  The skill and plugin scenario moved to PR 2 with B15 (P9 budget).
- Nx projects: `@ptah-extension/webview-e2e-harness`
- Depends on: B13, B14
- Recommended executor: senior-tester | Fallback: frontend-developer | Mode: sequential
- Reviewers: code-logic-reviewer, code-style-reviewer
- ACs proved:
  - AC-1.1 (toggle write + reload), AC-1.4 (revert on failure), AC-2.2 (scope text);
  - AC-4.6 (ptah OFF warning), AC-4.8 (rival lanes and CLI proxy "not enforced"), AC-5.2 ("size unknown");
  - the new repository server badge, where ON sends `{scope: 'workspace', enabled: true}`, the imported badge
    and the unverified banner;
  - NFR (an e2e spec for each new PR 1 control).
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/webview-e2e-harness --parallel=2`
  plus `NX_DAEMON=false npx nx run @ptah-extension/webview-e2e-harness:e2e -- capability-toggles` (this project
  has no `test` target).
- Commit: `test(e2e,webview-e2e-harness): batch 16 - cover capability toggles`
- Files (1 code; `marketplace.fixtures.ts` was dropped by the budget fallback applied 2026-09-26):
  - C `libs/frontend/webview-e2e-harness/src/lib/scenarios/marketplace/capability-toggles.e2e.spec.ts` (P3)
- Validation notes: R6. The "not enforced" assertions derive from fixture or constant data. The spec uses
  `installRpcAutoResponder` to fail `capabilities:setEnabled` for the revert case.
- **Reviewer acceptance item (recorded 2026-09-26, from B14):** the e2e fixtures MUST answer
  `capabilities:getState`. Otherwise the new "Use in sessions" panel on the servers page and the server detail
  shows its error state, and every scenario that opens those surfaces asserts against an error panel. The
  `capabilities:getEffective` and `capabilities:setEnabled` answers are required as well.
- **Visual-spec finding (read-only check, 2026-09-26): NO baseline risk to the PR 1 file count.**
  - `marketplace-visual.e2e.spec.ts` does not compare against baselines: there is no `toHaveScreenshot` or
    `toMatchSnapshot` anywhere in the harness or in `apps/ptah-electron-e2e`, and the Playwright config has no
    snapshot directory.
  - It WRITES `shell.screenshot({path})` files to `OUT_DIR` =
    `.ptah/specs/TASK_2026_533_marketplace_redesign/screenshots/angular/` (spec `:33-36`). That folder does not
    exist in the repo, and no PNG is tracked under it.
  - A new "Use in sessions" section therefore cannot fail that spec, and it changes no committed file.
  - **Caveat:** that path is NOT git-ignored (`.gitignore:135` `!.ptah/specs/**` re-allows it). Running the full
    harness e2e leaves about 10 untracked PNGs for servers and detail (installed-servers ×3 widths and
    server-detail drawer/docked, per host), plus the shell and page shots, under TASK_2026_533's folder.
  - The rules:
    - B16 runs only `-- capability-toggles`, which does not run the visual spec.
    - The team-leader stages explicit paths only, so these PNGs never enter the PR 1 diff.
    - Anyone running the full harness deletes them afterwards.
    - Retargeting `OUT_DIR` is out of scope.
- **Reviewer acceptance item (budget fallback):**
  - The capability fixtures (the RPC responses for `capabilities:*`, and the entries for a repository server, an
    imported entry and an unverified policy) live INSIDE `capability-toggles.e2e.spec.ts`.
  - The spec reuses `baseMarketplaceFixtures`, `installHost`, `installRpcAutoResponder` and the other helpers by
    importing them from `./marketplace.fixtures`.
  - `marketplace.fixtures.ts` is NOT modified.

## Batch 25: In-session skill list and spawned-agent plugins use the layered policy (PR 1) — COMPLETE (commit e39b65b1e; cherry-picked from `dcd6abcbc`)

- PR: 1 (added at the P9 amendment; the id is out of sequence so earlier ids stay stable)
- Goal: P9 G3 and G4. The code-execution `ptah.harness.searchSkills` and the plugin paths given to spawned agents
  follow `workspace ?? global ?? default`, and fail closed when the policy is unknown.
- Nx projects: `@ptah-extension/vscode-lm-tools`
- Depends on: B1 (the `isCapabilityPolicyUnknownError` guard). B5 at runtime: the structural
  `getEffectivePluginConfig`.
- Recommended executor: backend-developer | Fallback: general-purpose | Mode: sequential
- Reviewers: code-logic-reviewer
- **Reviewer acceptance items (mandatory, P9 G3/G4):**
  - `searchSkills` awaits `getEffectivePluginConfig(root)` once and uses its `overlayPluginPaths` and
    `config.disabledSkillIds`; there is no sync `resolveCurrentPluginPaths()` or `getDisabledSkillIds()` left on
    this path.
  - Spec: a global OFF skill → not offered as invocable; a global OFF opt-out plugin → none of its skills are
    listed; unknown policy → no local plugin skills and a logged reason; the remote results are unchanged.
  - `getPluginPaths` uses the effective `config.enabledPluginIds`: a global ON opt-in plugin's path reaches the
    spawned agent, and unknown → `undefined`.
  - `protocol-dispatcher.ts` is untouched (TASK_2026_559).
- ACs proved: AC-3.4 (a disabled skill is excluded from the session's skill surface), D1 for skills and plugins
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/vscode-lm-tools --parallel=2`
- Commit: `feat(vscode-lm-tools): batch 25 - use layered policy for in-session skills`
- Files (3 code):
  - M `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts` (`:273-284` interface, `:420-440` `searchSkills`)
  - M `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.spec.ts`
  - M `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts` (`PluginLoaderLike` `:242-255`; `getPluginPaths` `:668-683`)

## Batch 17: PR 1 live verification and AC report (PR 1) — COMPLETE (report in reviews/code-review.md; contrast fix commit 941d0a917)

- PR: 1
- Goal:
  - close A1 and A2 live;
  - capture the AC-4.3 proxied first request;
  - produce the AC report, the after screenshots (dark + light, recorded in a "Visual evidence" section of
    `test-report.md`) and the write-path trace (including G7: no workspace save persists a layered config);
  - re-test P9 live: a GLOBAL OFF skill with no workspace entry is absent from the workspace `.claude/skills`
    copies and from `ptah.harness.searchSkills`, and a global OFF opt-out plugin's skills are absent from both;
  - (B3 failure mode 1) with a corrupt capability item file, confirm on each host that the repeated forced
    preflights (a frozen pass has no fingerprint, so nothing is ever acknowledged) do not loop or spam: record the
    pass count and log volume over a few minutes of normal use;
  - (B8 cross-batch item) confirm on EACH host (VS Code, Electron, CLI) that `SDK_CAPABILITY_RESOLVER` is
    registered and that a skill toggle is followed by a harness pass whose health carries the new
    `policyFingerprint`, so the harness policy sync actually runs;
  - (B7 moderate #1 / B12: the DI-order invariant, with no spec added) on VS Code, Electron AND CLI, confirm that
    the resolved `PluginLoaderService` has `SDK_CAPABILITY_GLOBAL_LAYER` injected after bootstrap. Live test: a
    GLOBAL skill OFF with no workspace entry is absent from the next session and from the harness copies. For CLI,
    also cite the B11 reviewer's `container.ts` trace.
- Nx projects (full PR 1 regression): all PR 1 projects
- Depends on: B1-B14, B16, B25
- Recommended executor: senior-tester (+ visual-reviewer for the after screenshots) | Mode: sequential
- Reviewers: code-logic-reviewer (on the report's evidence)
- ACs proved: AC-4.3 live, A1, A2, R11, and the PR 1 AC map (implementation-plan.md:456-480). The AC-3.1 UI
  moved to PR 2 (B15); PR 1 proves AC-3.1 on the backend (B7, B10).
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/shared,@ptah-extension/harness-sync,@ptah-extension/cli-agent-runtime,@ptah-extension/agent-sdk,@ptah-extension/chat,@ptah-extension/rpc-handlers,@ptah-extension/cli-engine,@ptah-extension/vscode-lm-tools,ptah-electron,ptah-extension-vscode,@ptah-extension/marketplace,@ptah-extension/webview-e2e-harness --parallel=2`,
  then `git diff --stat origin/main | tail -1` (must be under 100), then a `git diff --name-only origin/main`
  that contains no `protocol-dispatcher.ts` and no `*.generated.*`.
- **Completion-step checklist (team-leader, after B17 is accepted and before PR 1 opens):**
  - [x] **L5:** append this `batches.md`, verbatim and in its final state, to `implementation-plan.md` as
    "Appendix C: batches and execution record". `git rm batches.md` in the final task-specs commit, and confirm
    with `git diff --stat c4bdc87dd | tail -1` that the count is **98** (actual: **99**, because B9 added the backoff DI regression spec; see B9 Amendment 2).
  - [x] Stage explicit paths only. No `registry.md` (L3), and no TASK_2026_533 PNGs.
  - [x] Record, in Appendix C's closing note, that PR 2 recreates `batches.md` from it.
- Before this commit, if lever L1 (merge the plan-review history files, see the running count) has not been
  applied yet, the team-leader applies it in the Mode 3 completion step. The saving is confirmed with
  `git diff --stat c4bdc87dd | tail -1`.
- Commit: `docs(task-specs): batch 17 - record pr 1 acceptance and live checks`
- Files: none new (D4). The senior-tester appends `# Test report — PR 1` (with a "Visual evidence" subsection) to `.ptah/specs/TASK_2026_560_2ae5/reviews/code-review.md`.
- Possible flaky specs seen under load (NOT caused by this task; watch in CI and in this batch's full regression):
  - `libs/frontend/marketplace/.../connectors-page.component.spec.ts` (2 tests failed once);
  - `libs/backend/rpc-handlers/.../voice-rpc.handlers.spec.ts` ("leaves no input temp file behind", 5000 ms
    timeout once).
  - If either fails in the B17 check, re-run it alone before treating it as a regression.
- PR 1 description must state:
  - the P8 e2e path deviation;
  - the #16 single-scope disclosure;
  - that the skill and plugin Marketplace toggles (AC-3.1 UI) arrive in PR 2. Meanwhile, workspace skill and
    plugin toggles remain in the existing Plugins panel, and global skill and plugin items are only settable via
    `capabilities:setEnabled`.

---

## Batch 18: Codex quoted MCP keys (#12) (PR 2) — PENDING

- PR: 2
- Goal: C4b, quoted-header parsing in the Codex facet (corrects `codex-toml-mcp-facet.ts:423-428`).
- Nx projects: `@ptah-extension/harness-sync`
- Depends on: PR 1 merged
- Recommended executor: backend-developer | Mode: sequential | Reviewers: code-logic-reviewer
- ACs proved: AC-4.4 prerequisite; unit half of A3
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/harness-sync --parallel=2`
- Commit: `fix(harness-sync): batch 18 - parse quoted codex mcp server keys`
- Files (2): M `libs/backend/harness-sync/src/lib/targets/mcp/codex-toml-mcp-facet.ts`, M `.../codex-toml-mcp-facet.spec.ts`

## Batch 19: Claude user MCP declarations in both scopes (#16) (PR 2) — PENDING

- PR: 2
- Goal: C4c. `readClaudeUserMcpDeclarations` yields non-collapsing declarations, and `mcp-install` switches to it.
- Nx projects: `@ptah-extension/cli-agent-runtime`
- Depends on: PR 1 merged
- Recommended executor: backend-developer | Mode: sequential | Reviewers: code-logic-reviewer
- ACs proved: AC-2.1 (a name in both `~/.claude.json` maps shows both scopes and paths), AC-2.5
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/cli-agent-runtime --parallel=2`
- Commit: `feat(cli-agent-runtime): batch 19 - keep both claude user mcp scopes`
- Files (3):
  - M `libs/backend/cli-agent-runtime/src/lib/mcp-directory/claude-user-mcp.reader.ts`
  - M `libs/backend/cli-agent-runtime/src/lib/mcp-directory/claude-user-mcp.reader.spec.ts`
  - M `libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-install.service.ts`

## Batch 20: MCP schema-size measurement (PR 2) — PENDING

- PR: 2
- Goal: C7 `McpSchemaSizeService` (N5). It runs `mcpServerStatus()` and `getContextUsage({detail: 'summary'})`
  under one 3 s bound, keeps figures only for servers `connected` now, re-checks the token, and memos by
  `(token, server, configHash)`.
- Nx projects: `@ptah-extension/agent-sdk`
- Depends on: PR 1 merged
- Recommended executor: backend-developer | Mode: sequential | Reviewers: code-logic-reviewer
- ACs proved: AC-5.1, AC-5.2, AC-5.3 (fixture within 10%), AC-5.4 (the total equals the sum of enabled servers),
  and the unit halves of A4 and A5
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/agent-sdk --parallel=2`
- Commit: `feat(agent-sdk): batch 20 - measure mcp schema size per session`
- Files (4):
  - C `libs/backend/agent-sdk/src/lib/helpers/mcp-schema-size.service.ts`
  - C `libs/backend/agent-sdk/src/lib/helpers/mcp-schema-size.service.spec.ts`
  - M `libs/backend/agent-sdk/src/lib/di/register.ts`
  - M `libs/backend/agent-sdk/src/index.ts`
- Validation notes:
  - Tests: connected→failed in one session → unknown; pending→connected → figure; ended → unknown; timeout; no
    cross-session reuse.
  - Never spawn a disabled server to measure it.
  - Logs through `IOutputChannel`.
- **Reviewer acceptance items (carried from PR 1, 2026-09-26):**
  - `McpSchemaSizeService` implements B10's local port `McpSchemaSizeReader { schemaTokensFor(cwd):
    Promise<ReadonlyMap<string, number>> }` (`capability-rpc.handlers.ts`) exactly, or moves that port to
    `@ptah-extension/shared` and updates B10's import. Either way, there is one port.
  - `capabilities:setEnabled` returns an entry WITHOUT `schemaTokens`. Once sizes exist, the Marketplace store's
    reconcile (`libs/frontend/marketplace/src/lib/data/capability-toggles.store.ts`, B13) must keep the previous
    figure on the toggled row, not blank it. This is a spec-proven item.
    - It is owned by B20 if B20 touches the store; otherwise it goes to the PR 2 UI batch B15, which already edits
      marketplace. Count the file.

## Batch 21: CLI proxy collector policy filter (#14, #9) (PR 2) — PENDING

- PR: 2
- Goal: C9. The policy is checked before every cache hit, and cached inventory is filtered. Parent-OFF skills are
  filtered, and a known ptah OFF is preserved when unverified (ptah tools only otherwise).
- Nx projects: `ptah-cli`
- Depends on: PR 1 merged
- Recommended executor: backend-developer | Mode: sequential | Reviewers: code-logic-reviewer
- ACs proved: AC-4.3 (CLI proxy path), AC-4.9 (no stale cache across toggles, TTL test), fail-closed for the proxy
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p ptah-cli --parallel=2`
- Commit: `feat(cli): batch 21 - filter proxy mcp tools by capability policy`
- Files (2): M `apps/ptah-cli/src/services/proxy/workspace-mcp-collector.ts` (bypass at `:89-91`, cache at `:152-154`), M `.../workspace-mcp-collector.spec.ts`
- Added 2026-09-26 (option c from PR 1): M `apps/ptah-cli/src/cli/commands/mcp.ts` (`:244-258`), which prints `result.capabilityWarning` after a successful `mcpDirectory:install`, so the CLI user also learns that the workspace-ON record failed. B21 becomes 3 files.

## Batch 22: Codex and OpenCode lane enforcement (PR 2) — PENDING

- PR: 2
- Goal: C6 part A. The spawn path resolves the policy and runs `HarnessPolicySync.apply`; unverified → the lane is
  refused (`CapabilityPolicyUnavailableError`). The Codex lane gets `enabled=false` for denied servers with
  pre-quoted `tomlKeySegment` keys, and OpenCode's inline `mcp` gets only the enabled servers. An unacknowledged
  pass → a warning with `partial` skill/plugin labels.
- Nx projects: `@ptah-extension/cli-agent-runtime`
- Depends on: B18, B19 (same project, sequential)
- Recommended executor: backend-developer | Mode: sequential | Reviewers: code-logic-reviewer
- ACs proved: AC-4.4, AC-4.5 (OpenCode), AC-4.8 (warning naming the provider and the item); the serialised-argv
  half of A3
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/cli-agent-runtime --parallel=2`
- Commit: `feat(cli-agent-runtime): batch 22 - enforce policy in codex and opencode lanes`
- Files (6; A-PR2, re-verify at kickoff):
  - M `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-spawn-environment.service.ts`
  - M `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-spawn-environment.service.spec.ts`
  - M `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts` (`:592-643`)
  - M `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.spec.ts`
  - M `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts` (`:534,605-607`)
  - M `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.spec.ts`

## Batch 23: Antigravity lane enforcement and enforcement-table flip (PR 2) — PENDING

- PR: 2
- Goal: C6 part B.
  - Antigravity uses ownership-gated cleanup: cleanup runs only after a successful setup ownership
    (`antigravity-cli.adapter.ts:573-579,628-634,826-829`).
  - Refused when unverified.
  - The `CAPABILITY_ENFORCEMENT` codex, opencode, antigravity and `ptah-cli-proxy` rows flip to enforced.
- Nx projects: `@ptah-extension/cli-agent-runtime`, `@ptah-extension/shared`
- Depends on: B20, B21, B22 (the rows flip only after every lane and the proxy enforce)
- Recommended executor: backend-developer | Mode: sequential | Reviewers: code-logic-reviewer
- ACs proved: AC-4.5 (Antigravity), AC-4.8 (the "not enforced" labels disappear through data only, A-UI)
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/cli-agent-runtime,@ptah-extension/shared --parallel=2`
  plus the marketplace test and the harness e2e, both unchanged and still passing (this proves A-UI).
- Commit: `feat(cli-agent-runtime,shared): batch 23 - enforce antigravity lane policy`
- Files (4):
  - M `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts`
  - M `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.mcp.spec.ts`
  - M `libs/shared/src/lib/types/capability-toggle.types.ts`
  - M `libs/shared/src/lib/types/capability-toggle.types.spec.ts`

## Batch 24: PR 2 live verification (PR 2) — PENDING

- PR: 2
- Goal: close A3, A4 and A5 live; run the lane tests for AC-4.4 and AC-4.5; confirm the schema figures in the UI
  (AC-5.1 and AC-5.4); write the after screenshots for the size figure.
- Depends on: B18-B23
- Recommended executor: senior-tester | Mode: sequential | Reviewers: code-logic-reviewer
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/shared,@ptah-extension/harness-sync,@ptah-extension/cli-agent-runtime,@ptah-extension/agent-sdk,ptah-cli,@ptah-extension/marketplace --parallel=2`,
  plus the per-PR `git diff --stat` budget.
- Commit: `docs(task-specs): batch 24 - record pr 2 acceptance and live checks`
- Files: `test-report.md` (M), `batches.md` (M). These are docs only.
- Depends on (amended at P9): B15 and B26 as well. The B24 check adds `@ptah-extension/rpc-handlers` and
  `@ptah-extension/webview-e2e-harness`.

## Batch 15: Skill and plugin pages - toggles (PR 2; moved from PR 1 at the P9 amendment) — PENDING

- PR: 2. It was moved from PR 1 to keep PR 1 at 96 or below after P9 added 4 files. This is the lowest-risk
  deferral:
  - AC-3.1's backend lands in PR 1 (B7, B10);
  - workspace skill and plugin toggles already exist in the Plugins panel, so nothing regresses;
  - no enforcement moves.
  - The task completes only when PR 2 merges.
- Goal: the same toggle, scope label and scope-of-write text on the Installed skills page and the skill detail
  (skills and plugins, including parent-off), plus the skill and plugin e2e scenario.
- Nx projects: `@ptah-extension/marketplace`, `@ptah-extension/webview-e2e-harness`
- Depends on: PR 1 merged (B13's store and toggle, B16's spec file)
- Recommended executor: frontend-developer (pages), then senior-tester (the e2e scenario) | Fallback:
  general-purpose | Mode: sequential
- Reviewers: code-logic-reviewer, code-style-reviewer
- ACs proved: AC-3.1 (UI), AC-2.2, AC-1.5, AC-3.4 (UI side: a parent-off child is shown OFF), NFR e2e for the
  skill and plugin toggles
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/marketplace,@ptah-extension/webview-e2e-harness --parallel=2`
  plus `NX_DAEMON=false npx nx run @ptah-extension/webview-e2e-harness:e2e -- capability-toggles`
- Commit: `feat(marketplace,e2e): batch 15 - add skill and plugin toggles`
- Files (5 code):
  - M `libs/frontend/marketplace/src/lib/pages/skills/installed-skills-page.component.ts`
  - M `libs/frontend/marketplace/src/lib/pages/skills/installed-skills-page.component.spec.ts`
  - M `libs/frontend/marketplace/src/lib/pages/skills/skill-detail.component.ts`
  - M `libs/frontend/marketplace/src/lib/pages/skills/skill-detail.component.spec.ts`
  - M `libs/frontend/webview-e2e-harness/src/lib/scenarios/marketplace/capability-toggles.e2e.spec.ts` (skill and plugin scenario)

## Batch 26: Harness wizard and collision prediction use the layered policy (PR 2) — PENDING

- PR: 2 (P9 G5/G6; display only, so it never widens a session)
- Goal: the harness wizard's skill summary and the install-time collision prediction stop showing
  globally-disabled skills as available or active.
- Nx projects: `@ptah-extension/rpc-handlers`
- Depends on: PR 1 merged
- Recommended executor: backend-developer | Mode: sequential | Reviewers: code-logic-reviewer
- **Reviewer acceptance items:**
  - both sites await `getEffectivePluginConfig(root)` and use its overlay and disabled ids;
  - unknown → restrictive (no skill offered as available; collision owners computed from no overlay);
  - the G7 read-modify-write paths in `plugin-rpc.handlers.ts` stay workspace-only.
- ACs proved: consistency of AC-2.4/AC-3.1 across surfaces
- Check: `NX_DAEMON=false NX_PLUGIN_NO_TIMEOUTS=true npx nx run-many -t lint,typecheck,test -p @ptah-extension/rpc-handlers --parallel=2`
- Commit: `fix(rpc-handlers): batch 26 - use layered policy in harness wizard views`
- Files (about 3; the executor confirms the spec file names at kickoff):
  - M `libs/backend/rpc-handlers/src/lib/harness/workspace/harness-workspace-context.service.ts` (`:350,353`)
  - M `libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts` (`:873-874`)
  - M or C a spec covering both (existing spec preferred)

### Closing note for PR 1 (2026-09-26)

- PR 1 is complete: B1-B14, B14b, B16, B17 and B25. The file count against `c4bdc87dd` is 99.
- **PR 2 kickoff:** the team-leader recreates `batches.md` on the stacked PR 2 branch from this appendix (the PR 2
  section onward, with the current states). That is +1 doc in PR 2.
- **Carried into PR 2, beyond the planned B15, B18-B24 and B26:**
  - The Ptah CLI user-visible `capability-policy-unverified` notice, through the agent monitor (B9 amendment,
    AC-4.6 for the Ptah CLI lane).
  - `CapabilityToggleStore` ignores `--config` / `PTAH_CONFIG_PATH` (Moderate, B21): pass the host's user-data
    dir as `baseDir` in `libs/backend/cli-agent-runtime/src/lib/di/register.ts:131-133`.
  - AC-4.3 proxied first-request capture: not run in PR 1 (needs provider credentials).
- **Follow-ups outside this task:**
  - The `text-warning` on `bg-warning/10` pair fails WCAG AA in anubis-light at about 26 sites.
  - The OFF-state toggle track has low affordance in the dark theme; the "Use in sessions" panel is below the
    fold at 1280x800 with 11 servers.
  - `resolveSessionCapabilityPolicy` logs "No capability resolver is registered." also when resolution throws.
