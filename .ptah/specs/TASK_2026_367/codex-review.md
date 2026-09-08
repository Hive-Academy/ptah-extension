# TASK_2026_367 — Independent review gate (Codex + adjudication)

Reviewed at HEAD `2977dfa41` on branch `fix/empty-assistant-bubbles`. All 13
commits claimed in `batches.md` are ancestors of HEAD, and the B11 mojibake
sweep landed (verified: `git merge-base --is-ancestor` for each of
`1d5933d9e 0c7347068 4906edf04 298b59d27 a1179ad75 ec431d4cc f2bdd4a25
f17440800 ecf62776b 2c5d62c1a a2071b763 651aab906 bacf829e7`).

## 1. Acceptance criteria

| # | Criterion | Verdict | Evidence |
| - | --------- | ------- | -------- |
| C1 | ptah-cli child stderr no longer blanket-`logger.error`; one shared classifier used at all 5 sites | SATISFIED | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-stderr-severity.ts:8`; call sites: `ptah-cli-registry.ts:691-696` (warn on `error`, else `debug`), `antigravity-cli.adapter.ts:556`, `copilot-sdk.adapter.ts:63`, `opencode-cli.adapter.ts`, `pi-cli.adapter.ts` — 5 non-spec importers confirmed |
| C1b | ANSI stripped BEFORE classify; `abort` word-boundary pinned | SATISFIED | `ptah-cli-registry.ts:691` `classifyCliStderr(stripAnsiCodes(data).trim())`; regex `\b(...|abort|...)\b` at `cli-stderr-severity.ts:4-5`; `cli-stderr-severity.spec.ts:43` pins `'abortive attempt' -> 'info'` |
| C2 | Spawn log prints the tier actually resolved | SATISFIED | `ptah-cli-registry.ts:618` resolves `tier`, `:831` logs `with model ${model} (tier: ${tier})` — the `effectiveTiers?.sonnet` recomputation is gone from the spawn log |
| C3 | `connectOAuth` failure carries a typed reason to the webview + API-key hint + debounced probe | **PARTIAL — see Blocker 1** | Type: `libs/shared/src/lib/types/mcp-directory.types.ts:599`; classifier: `mcp-directory-rpc.handlers.ts:1311-1315`; UI copy: `oauth-surface.component.ts:65`, consumed at `:688` and `:881`; specs at `mcp-directory-rpc.handlers.spec.ts:281,308` and `oauth-surface.component.spec.ts:355,429`. Probe present (`probeOAuthDiscovery`). **But a transport failure is reported as `no-oauth-discovery`.** |
| C4 | Curator does chunked map/reduce windows, not one 32 KB head+tail clip | SATISFIED | `memory-curator.service.ts:483-488` `windowForModel` → `CuratorWindowRunner.planWindows`; `:538-556` `extractAcrossWindows`; `curator-llm/transcript-windows.ts:243-336` (`compressToolNoise`, `CURATOR_MAX_WINDOWS`); `clamp-transcript.ts:48` is now the last-resort guard at `CAP * MAX_WINDOWS` |
| C5a | `endSession` returns a distinguishable `already-ended`; frontend dedupe scoped to a TURN and cleared on failure | SATISFIED | `session-control.service.ts:37` `EndSessionOutcome`, `:126` returns `'already-ended'`; `conversation.service.ts:52,193-195,224,237,255` — turn key from sessionId + streaming message id + last user message id, cleared on throw (`:237`) and on `success:false` (`:255`); four regressions in `conversation.service.spec.ts` (commit `ecf62776b`) |
| C5b | Logger serialises Error args (name/message/stack) | SATISFIED | `libs/backend/vscode-core/src/logging/logger.ts:20-24`, `:157-167`, `:249`, `:315-317` |
| C5c | `content_block_start` before `message_start` synthesises a start; a REAL start reconciles instead of opening a second envelope | SATISFIED | `stream-event.transformer.ts:141-156` guard, `:219-252` `reconcileSynthesizedStart` (keeps the synthesized id, does NOT call `clearToolCallIdsForContext` or `clearActiveSkillToolUseIds`), `:242` clears the flag; specs `stream-event.synthesized-start.spec.ts:275,510,569,687` |
| C6a | Preflight ensure() coalesced per root; external pass credits the throttle; budget unchanged; promise stored before cleanup can run | SATISFIED | `harness-preflight.service.ts:102-104,118,154-159,162,166-173`; `harness-preflight.coalesce.spec.ts:206,221,248,276,288,310,345-363` — including the `DEFAULT_PREFLIGHT_TIMEOUT_MS` assertion proving the budget was not raised |
| C6b | PulseMCP source fully removed | SATISFIED | Zero production references across `libs/backend`, `libs/frontend`, `libs/shared`, `apps/*`. Only residue is a negative-path string `source: 'pulsemcp' as never` at `mcp-directory-rpc.handlers.spec.ts:421`. Aggregate search asserted on `['official','smithery']` (`harness-namespace.builder.spec.ts:1072-1078`) |
| C7a | Spawns go off the main thread through `IProcessSpawner`; tree-kill awaits `whenSpawned`; adapters read `close` | SATISFIED | Port `libs/backend/platform-core/src/interfaces/process-spawner.interface.ts:79-82`; impl `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.ts` (`spawnProcess` specs at `off-thread-process-spawner.spec.ts:410,427,472,495`); `cli-adapter.utils.ts:159-166,197-218,261,325`; `whenSpawned`-gated kill at `antigravity-cli.adapter.ts:500-504`, `copilot-sdk.adapter.ts:287-291`, `opencode-cli.adapter.ts:466`; `close` (not `exit`) at `copilot-sdk.adapter.ts:403` |
| C7b | `taskId` arriving before registration is buffered, consumed on register, TTL-swept | SATISFIED | `subagent-state-store.ts:79,151,265-280,355-361,378`; `subagent-registry.service.ts:421` (`markPendingTaskId` on miss, now `logger.debug` with `buffered: true`) and `:106` (`consumePendingTaskId` in `register`); `subagent-state-store.pending-task-id.spec.ts:34,97,102` pins the TTL sweep |
| C7c | Mojibake repaired in the in-scope files | **PARTIAL — see Finding A** | The em-dash / right-arrow families are gone: only `config-rpc.handlers.ts`, `phase-2-libraries.ts` (deliberately excluded, on the 362 branch) and `console-text.ts` (the repair table) still carry them. Two OTHER corruption families survive untouched. |
| GLOBAL | Every behaviour pinned by a test that would fail on revert | SATISFIED | Each row above names a spec that asserts the new behaviour (values, not call counts). Full run below. |

### Test run (this machine, this HEAD)

`npx nx run-many -t test -p agent-sdk cli-agent-runtime harness-sync
memory-curator vscode-core rpc-handlers marketplace chat --skip-nx-cache`

- `chat` 990 passed / 64 suites; `cli-agent-runtime`, `harness-sync`,
  `memory-curator`, `rpc-handlers` green.
- Three projects failed on the first pass under heavy load (6 concurrent Codex
  agents on the box). All three were re-run and are **not real failures**:
  - `agent-sdk` — 1439 passed, 0 failed on re-run.
  - `marketplace` — 239/239 passed with `--runInBand`. The two first-pass
    failures (`oauth-surface … disconnects a server`, `connectors-surface …
    gives up after five minutes`) were 119 s / 151 s suite timeouts.
  - `vscode-core` — the only named failure was
    `src/diagnostics/cpu-profile-capture.spec.ts` exceeding its 5000 ms Jest
    timeout while capturing a real V8 profile; unrelated to this task.

No `TODO`, `FIXME`, `not implemented` or empty `catch {}` was found in the
production files of the 13 commits (independently confirmed by Codex, whose
grep over the same path set exited 1 with no matches).

## 2. Codex raw verdict

The Codex agent (`0bc8a4a7-0fcb-42cb-91da-49f80a103e8b`, CLI session
`01a07db1-238a-70b0-a68e-9eb511cacb8f`) read the task folder and worked through
every criterion against the source, but never emitted its final
`VERDICT:` line before this gate closed. Its own mid-run summary was:

> "I've found two release-blocking discrepancies so far: manual compaction now
> deliberately restores a one-window 32,768-character head/tail clamp, and the
> mojibake sweep missed an in-scope production banner. I'm finishing the
> line-level evidence and checking whether OAuth transport failures are being
> mislabeled as 'API key required'."

Treat that as **VERDICT: NEEDS_WORK (partial, unsigned)**.

## 3. Adjudication

**Confirmed and carried forward**

- *Mojibake residual.* Confirmed independently — see Finding A. Codex is right
  that a production banner is still corrupt; it is wrong that this is
  release-blocking (the banner only prints when SQLite fails to open).
- *OAuth transport mislabelling.* Codex flagged this as a suspicion it had not
  finished checking. I checked it and it holds — see Blocker 1. This is the
  one finding that should stop the move to `done`.

**Dropped**

- *"Manual compaction restores a 32,768-char one-window clamp."* Real code,
  wrong attribution. `MANUAL_COMPACTION_MAX_WINDOWS = 1`
  (`memory-curator.service.ts:76`, applied at `:240-241` only when
  `data.trigger === 'manual'`) is TASK_2026_374's deliberate later narrowing of
  the hand-typed `/compact` path, documented at length in
  `libs/backend/memory-curator/CLAUDE.md` and pinned by
  `memory-curator.service.spec.ts:1286-1414`. `clampWindowBudget`
  (`curator-window-runner.ts:97`) lets a caller only LOWER the ceiling.
  Automatic threshold compaction keeps the full `CURATOR_MAX_WINDOWS = 8`
  budget, which is exactly what 367 C4 promised. Not a 367 regression, not a
  blocker for this task.

## 4. Blockers

### Blocker 1 — a network failure is reported to the user as "this server needs an API key" (C3)

- `libs/backend/cli-agent-runtime/src/lib/mcp-directory/oauth/mcp-oauth-metadata.ts:260`
- `libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.ts:1311`
- `libs/frontend/marketplace/src/lib/oauth-surface.component.ts:65`

Every discovery route swallows its own transport error and returns "not found":
`readProtectedResourceMetadata` catches and returns `undefined` (`:127-129`),
`discoverPrmUrlFromChallenge` the same (`:166-168`), and
`discoverAuthServerMetadata`'s candidate loop catches per candidate (`:260`,
comment `/* try next candidate */`) and, when the loop ends, throws
`OAuthDiscoveryError` (`:267`). `classifyOAuthFailure` then maps that error to
`'no-oauth-discovery'` and the UI renders the fixed sentence at
`oauth-surface.component.ts:65`.

Failure scenario: the user is on a captive-portal Wi-Fi, a VPN is down, or
corporate TLS interception rejects the handshake. They press **Connect** on a
server that fully supports OAuth. Every `fetch` throws, the loop exhausts, and
Ptah tells them *"It probably needs an API key instead."* They then go hunting
for an API key that does not exist for a server that would have connected once
the network came back. C3's whole purpose was to replace a swallowed error with
an honest one; this replaces it with a confident wrong one. The fix is to
distinguish "reachable and published nothing" from "never reached" — carry a
third reason (e.g. `'discovery-unreachable'`) rather than folding both into
`no-oauth-discovery`, and add a spec where `fetchImpl` rejects.

## 5. Findings (non-blocking)

### Finding A — the mojibake sweep left two corruption families untouched (C7c)

- `libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:144-154`
- `libs/frontend/chat/src/lib/services/chat-store/conversation.service.spec.ts:283`

B11's ten-pair map covers em dash, en dash, quotes, ellipsis, bullet, right
arrow and minus. It does not cover **box-drawing characters** or **`⇒`**, so:

- The persistence-offline console banner is still double-encoded on every
  frame character (`'â•”â•â•…'`, `'â•‘'`, `'â•š'`) — B11 repaired the em dash
  *inside line 145* and left the box around it corrupt, which is why the file
  did not show up in the post-sweep dry run. This banner prints when
  better-sqlite3 fails to load, i.e. exactly when a user is reading it.
- `conversation.service.spec.ts:283` still reads `// No active session â‡’ no
  RPC at all.`

The batch report's "post-repair dry-run: TOTAL 0 / FILES 0" is honest about the
map it ran and misleading about the file set — the dry run cannot report a
family it does not know. Worth folding into the existing
`future-enhancements.md` mojibake item rather than reopening a batch.

### Finding B — `pendingTeammateNames` still has no TTL sweep

`libs/backend/vscode-core/src/services/subagent-registry/subagent-state-store.ts:355`
sweeps `pendingTaskIds` but not the older `pendingTeammateNames` map. Already
recorded in `future-enhancements.md`; noted here only to confirm it is real.

## 6. Final verdict

**NEEDS_WORK** — one blocker.

Twelve of the thirteen acceptance criteria are fully satisfied with real tests
that assert real behaviour, and the review chain inside the task (two HIGHs
found and fixed before commit) did its job. The single thing standing between
this task and `done` is Blocker 1: C3 shipped a typed failure reason that is
correct for the case it was designed for and confidently wrong for an offline
user. That is the same class of defect C3 existed to remove, in the code C3
added, so it belongs to this task rather than to a follow-up.

Finding A can be absorbed into `future-enhancements.md` without reopening a
batch.
