# Code Logic Review — `TASK_2026_855_d4b6`

Review family: grok (implementer: codex)

| Metric | Value |
| --- | --- |
| Overall score | 4/10 |
| Assessment | REVISE |
| Blocking issues | 1 |
| Serious issues | 1 |
| Moderate issues | 0 |
| Minor issues | 1 |
| Failure modes found | 3 |

Score is 4, not 5–6, because the new root gate is on every child launch, handoff, inactive continue, activation, and rewind, and it rejects the mode Node reports for Windows directories. Linux precedence, MCP isolation, distinct-cwd refusal, and metadata round-trip match the plan, which is what keeps this above a 1–2 foundation failure. No code-style review was present. No logic-review skill is assigned in the catalogue; the role file was read. `ptah_code_search_symbols` returned an empty index, so later lookups used read and one scoped search. Coordinator verify (59/59) was not re-run. Those tests run on Linux and do not exercise the Windows mode bits.

## Five logic questions

### 1. How does this fail silently?

A slash relaunch of a legacy worktree session never reads ancestor policy. The worktree layer is empty, so parent-enabled skills stay off and the call still returns success (`chat-session.service.ts:1391`, `plugin-loader.service.ts:1104`). On the same path, a stored ancestor that is no longer an open folder but still exists as a directory is treated as an empty layer, so an ancestor disable does not apply (`plugin-loader.service.ts:1192`).

### 2. What user action produces unexpected behaviour?

On Windows, resuming any saved session, or starting a worktree child, throws `SESSION_FOLDER_UNAVAILABLE` even when the folder is open, readable, and the parent is valid (`session-folder.ts:49`). On any OS, sending a slash command as the first continue of an inactive legacy worktree session skips the recovery that a normal message performs (`chat-session.service.ts:1393` versus `chat-session.service.ts:2007`).

### 3. What input data produces a wrong answer?

Windows `fs.stat` mode `0o40666` (decimal 16822) makes `(mode & 0o111) === 0`, so a good directory is classified unavailable (`session-folder.ts:50`). A metadata record whose `pluginConfigAncestorRoots` field is absent, combined with a slash continue, yields no ancestor list (`sdk-agent-adapter.ts:1302`). A stored absolute ancestor that fails `isAuthorizedWorkspace` but still `stat`s as a directory is merged as an empty plugin config (`plugin-loader.service.ts:1197`).

### 4. What happens when a dependency fails?

`validateSessionPolicyRoot` turns every filesystem, authorization, and mode failure into one `SESSION_FOLDER_UNAVAILABLE` and drops the cause (`session-folder.ts:56`). `resolveSessionFolder` logs the candidate and not the reason (`session-folder.ts:82`). A legacy upgrade that fails after `resumeSession` has already started is reported to the caller as a failed resume while the stream is already broadcasting (`chat-session.service.ts:2098`).

### 5. What is missing that the requirements never mentioned?

Nothing material outside the approved plan. The plan already required the same validation on inactive continue and on every query reconstruction. The slash relaunch is that reconstruction and does not call it.

## Findings

### 1. Blocking — Windows directories fail the execute-bit test

- File: `libs/backend/rpc-handlers/src/lib/chat/session/session-folder.ts:49`
- Scenario: On Windows, Node reports a normal directory with permission bits `0o666` (commonly mode decimal 16822, `0o40666`). `(physicalStat.mode & 0o111) === 0` is true. `validateSessionPolicyRoot` throws `SESSION_FOLDER_UNAVAILABLE` before `fs.access`. Child launch, handoff, inactive continue, activation, and rewind all call this helper. A readable worktree and a readable main checkout are both refused. The previous check was `fileSystemProvider.exists`, which succeeded for those folders. Linux modes such as `0o755` pass, so the added specs stay green.
- Impact: Resume and worktree sessions do not start on Windows. The inheritance fix never runs there.
- Fix: Delete the `mode & 0o444` and `mode & 0o111` tests. Keep `isDirectory()` and `fs.access` with `R_OK | X_OK` (on Windows `X_OK` is existence). Add a unit case whose `stat` mode is `0o40666` and expect success.

### 2. Serious — Slash relaunch skips recovery and ancestor revalidation

- File: `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1391`
- Also: `libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts:327`, `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1290`, `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:1104`
- Scenario A: Metadata for a worktree session has no `pluginConfigAncestorRoots` (legacy). `workingDirectory` is the worktree and `workspaceId` is the checkout that enables skill `S`. The user sends `/orchestrate` while the session is inactive. `continueSession` resolves the folder, then skips `autoResumeIfInactive` because the prompt is a slash command. The router builds `sessionConfig` with `projectPath` only. `resolveStoredPluginConfigAncestorRoots` sees legacy state and `callerRoots === undefined`, so it returns `undefined`. The loader reads only the worktree. `storageFor` is null and `readWorkspaceLayer` returns an empty config with status ok. Skill `S` stays off. A normal message on the same record calls `restoreLineage` and passes `[workspaceId]`.
- Scenario B: The field is present and lists `/repo`, but `/repo` is no longer an open folder. The directory still exists, so the loader's `statSync` does not record a reason. `storageFor('/repo')` returns null, the ancestor is merged as an empty layer, and a skill the ancestor had turned off is on again if the global layer enables it. The session starts. The normal continue path calls `validateSessionPolicyRoot` and refuses with `SESSION_FOLDER_UNAVAILABLE` before `resumeSession` (`chat-session.service.ts:2007`).
- A deleted ancestor does fail closed inside the loader (unreadable → unverified → no skills), but the slash query still starts. The plan says an unavailable governing root refuses restore before the SDK call.
- Adapter lineage tests can pass by placing roots on `sessionConfig` themselves. `chat-continue-slash-before-resume.spec.ts` was only a fixture update. Neither asserts legacy recovery or an unauthorized ancestor on the chat slash path.
- Fix: Run `restoreLineage` (and the legacy upgrade) for an inactive slash continue before `executeSlashCommand`. Pass the validated roots on `sessionConfig`. Treat a null ancestor store after a required root was requested as policy-unknown, not as an empty config.

### 3. Minor — Resume reports failure after the session is already live

- File: `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:2098`
- Scenario: Legacy resume validates, `resumeSession` returns, and `streamEventsToWebview` starts. `upgradeLegacyPluginConfigAncestorRoots` then throws because the metadata write fails. The `catch` at `chat-session.service.ts:2119` returns `{ error }` to `chat:continue`. The webview is already streaming. The in-memory query has the recovered roots; the durable field is still absent, so the next process recovers again. The user is told the resume failed.
- Fix: Persist the upgrade before calling `resumeSession`, or if the upgrade fails after a live start, log it and still return `justResumed: true`.

## Failure modes

### Windows root gate rejects a readable directory

- Trigger: `validateSessionPolicyRoot` on a directory whose mode has no execute bits.
- Symptom: `SESSION_FOLDER_UNAVAILABLE` for a folder the user has open.
- Evidence: `session-folder.ts:49`
- Current handling: One generic refusal. `fs.access` never runs.
- Recommendation: Permission-check with `fs.access`, not the Unix mode mask.

### Slash continue uses a different policy than message continue

- Trigger: Inactive session, prompt classified as a slash command.
- Symptom: Legacy worktree keeps disabled skills, or a closed ancestor's disables disappear, and the RPC still succeeds.
- Evidence: `chat-session.service.ts:1391`, `chat-slash-command-router.service.ts:327`, `plugin-loader.service.ts:1104`
- Current handling: Stored valid roots are forwarded by the adapter. Legacy recovery and physical authorization are not.
- Recommendation: One restore helper for every path that builds a new query, including slash.

### Legacy upgrade error masquerades as a failed resume

- Trigger: Metadata write throws after the SDK stream is attached.
- Symptom: Error toast while the session is running.
- Evidence: `chat-session.service.ts:2098`
- Current handling: The exception is the continue-call result.
- Recommendation: Do not fail the RPC for a post-start durability write.

## Data flow

1. Child or handoff `captureLineage` reads source metadata or `pendingLineage`, checks the source execution root against the host root, and returns physical ancestor paths (`chat-session.service.ts:391`). OK on Linux when the host root is the source cwd.
2. `launchSdkSession` revalidates, then `startChatSession` → `create` persists the list on the real SDK id (`sdk-agent-adapter.ts:1670`). A second `create` keeps the stored list. OK.
3. `pendingLineage` is cleared on bind (`chat-session.service.ts` session-id callback), on launch failure (`chat-session.service.ts:1318`), and on session end (`chat-session.service.ts:574`). OK.
4. Inactive message continue, activation, and rewind call `restoreLineage` then `resumeSession`. Distinct missing cwd does not fall back to `workspaceId` (`session-folder.ts:76`). OK on Linux. Broken on Windows by finding 1.
5. Slash continue resolves the execution folder, then builds a query without `restoreLineage`. Gap, finding 2.
6. `CapabilityResolverService.readSnapshot` passes ancestor roots only into `readPluginPolicy`. MCP inventory, import, and workspace store stay on the execution context (`capability-resolver.service.ts:419`). OK.
7. `layerAncestorConfigs` copies plugin and skill ids nearest-first and leaves `disabledAgentIds` on the local object (`plugin-loader.service.ts:223`). OK.
8. Effective fingerprint v2 includes ordered ancestor plugin/skill lists and not ancestor agent ids (`capability-id-codec.ts:216`). OK.
9. Save stays on the local storage root and does not write the merged config (`plugin-loader.service.ts:1267`). OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Nearest-first plugin/skill inheritance, child override, agents local | COMPLETE | Merge and fingerprint match the plan |
| `[]` independent, absent legacy, malformed refused | COMPLETE | On the message/resume path |
| Durable transitive list on session metadata | COMPLETE | Create, preserve, upgrade |
| Every governing root physically validated before read or SDK | PARTIAL | Message/resume/child/handoff on Linux only. Windows mode check refuses good directories. Slash relaunch does not validate ancestors |
| Distinct saved cwd never falls back to the parent | COMPLETE | `resolveSessionFolder` |
| MCP trust, imports, plugin files, harness stay at the execution root | COMPLETE | Ancestor list is plugin-read only |
| Same rules for child, handoff, activation, inactive continue, rewind | PARTIAL | Slash inactive continue is a separate query and skips restore |

Implicit requirements not addressed: none beyond the slash reconstruction the plan already called an equivalent restore.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Explicit `[]` | YES | Valid independent list, fingerprint v2 | None |
| Malformed lineage | YES | Reader returns malformed; capture and restore throw | Slash adapter also throws on malformed stored data |
| Ancestor equal to execution root | YES | Capture and valid restore reject; loader dedupes | Legacy recovery dedupes instead of erroring, which matches "same folder yields []" |
| Symlink to an outside folder | YES | Both supplied and realpath must be authorized | Returned execution cwd stays the saved spelling, by batch 6 decision |
| Missing metadata on resume | YES | `restoreLineage` supplies `[]` and does not upgrade | Intentional for history-only resume |
| Live query already running | YES | Adapter returns the existing stream | Policy stays stale until the next query, as designed |
| Windows directory mode | NO | Execute-bit mask | Finding 1 |

## Decisions

- Windows `fs.stat` mode is treated as `0o666` permission bits. Evidence: Node's published Windows `stat` values (file 33206 = `0o100666`, directory 16822 = `0o40666`) have `(mode & 0o111) === 0`. Alternative: assume Node sets execute bits on directories. That alternative contradicts those values. Reversible: yes, drop the mask.
- `fileSystemProvider` left unused on `ResolveSessionFolderOptions` is not a defect. Existence is now `realpath` plus `stat` plus `access`. No caller observes the old provider result. The dropped rejection string is finding 3's observability half only; the user-facing code is still `SESSION_FOLDER_UNAVAILABLE`.
- Handoff of a registered child session is refused earlier as `child-session` (`session-handoff.service.ts:167`). Top-level handoff passes `workspaceId` and `projectPath` that `chat:start` sets equal, so the source-root equality check holds. Not filed.
- Nested spawn compares the source execution root to `scopedWorkspaceRoot()`, which is the MCP caller's declared directory. A worktree lane declares its worktree, so R → A → B matches. A mismatch refuses rather than truncating ancestry. Not filed.
- `session-fork.service.ts` still creates the new row without lineage and with `workspaceId` as cwd. That predates this diff and relocates execution onto the listing root, where the local config is the governing config. Not filed.
- Wholly missing resume metadata returning `[]` is the batch 5 choice for history-only resume. Not filed.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: `validateSessionPolicyRoot` refuses every Windows directory, so the inheritance path never runs there, and Linux tests cannot see it.
- What a robust implementation would add: mode-independent directory checks, one restore-and-validate step in front of slash relaunch, and ancestor storage misses reported as policy-unknown.
