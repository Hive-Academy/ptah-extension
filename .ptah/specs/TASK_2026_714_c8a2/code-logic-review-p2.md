# Code Logic Review, Phase P2 (`@ptah-extension/codex-runtime`), TASK_2026_714_c8a2

Review family: Claude reviewer, Codex implementer.

| Metric | Value |
| --- | --- |
| Score | 6/10 |
| Verdict | REVISE |
| Blocking | 0 |
| Serious | 5 |
| Moderate | 9 |
| Minor | 4 |

Scope: all files in the request, read in full (types and specs skimmed; validator read at the server-request, notification and envelope sections). Checks run: the five specs for runtime, bridge, process, usage client and registration (112/112 pass). No codex binary run. Real wire order from spike-run-6i/6j used for the trace.

Score rationale: the safety invariants hold. No accept path exists on abort, timeout, disposal or crash. There is one response per server request, a duplicate id fails the session, and there is one terminal per turn. Decline is written before the steer follow-up. Production routing is closed. The score is held at 6 by five defects on likely paths: resume practically unusable, over-aggressive kills, auto-edit privilege, Windows usage, and event loss.

## Trace (6i/6j order)
thread/start -> turn/start -> thread/started, status, turn/started (sets activeTurn, state running) -> item/started(command) -> requestApproval -> process.dispatchApproval (cap 128, 300 s timer) -> runtime.onRequest (state/turn guard) -> bridge.handle (threadId/turnId/identity guard, policy, sink, 240 s timer) -> response written in a microtask -> setImmediate steer (runs strictly after the decline write) -> serverRequest/resolved (ignored) -> tokenUsage -> turn/completed -> translator terminal -> runtime idle. 6i interrupt path: abort turnController -> pending elicitation answered `cancel` -> turn/interrupt. This is correct for the observed order. Defects below are off the observed path.

## Findings

### Serious

1. **Profile fingerprint covers per-turn and mutable inputs, so resume rejects almost any real restart.**
   `codex-execution-profile.ts:219-255` hashes the whole profile, including `model`, `effort`, `enhancedPrompt`, `attachments` (including base64 image data) and prompt text. `codex-runtime.ts:71-83` requires `resume.profileFingerprint === profile.profileFingerprint`. `updateNextTurn` changes model and effort at runtime (`:573`), but the persisted fingerprint stays that of the original profile. After a restart the caller rebuilds a profile with the current model, effort and attachments and gets "resume identity mismatch". Fix: fingerprint thread-invariant inputs only (home, provider, account, workspace, cwd, permission, approval and sandbox policy, system, developer and instruction sources, MCP set). Pass model, effort and attachments per turn.

2. **Any JSON-RPC error response, and any steer race, tears down the whole context with a generic error.**
   `codex-app-server-process.ts:281` collapses an error response to `Codex request rejected`. `codex-runtime.ts:486`, `:513` and `:598` call `onFailure()` (close and kill) on every rejection. Examples: the decline-then-steer follow-up when the turn finished a tick earlier (`expectedTurnId` mismatch), `turn/start` rejected for a bad model or usage limit, and a compaction rejection. A thread that is still healthy and resumable is killed, and the user gets "Codex turn start failed" with no reason code. Fix: keep a typed, coded, non-secret RPC failure (rejected vs transport) and close the context only for transport or protocol failures. A rejected steer should report an error and leave the context alive.

3. **`auto-edit` auto-accepts every fileChange approval, including `grantRoot`.**
   `codex-permission-policy.ts:21` returns `accept` for any `fileChange` at auto-edit. The validated params carry `grantRoot` (`codex-protocol-validator.ts:651`). An accept of a request that carries a root outside `cwd`/`writableRoots` widens the write sandbox with no user prompt. The bridge only refuses to use `grantRoot` for rule reuse (`codex-approval-bridge.ts:271-293`). Fix: in auto-edit, auto-accept only when `grantRoot` is null or inside `profile.cwd`/`writableRoots`. Otherwise present the request.

4. **Windows usage client likely always returns `service-unavailable`.**
   `codex-account-usage-client.ts:44` lowercases the home key on win32 and passes that key to `createProcess` (`:243`). `di/registration.ts:62` requires `profile.normalizedHome === home` exactly. The profile builder returns a case-preserving realpath (`codex-execution-profile.ts:169`). Any home with an upper-case letter throws inside `performRead`, which is swallowed to `unavailable()` (`:280-290`). Electron win32 is the priority host. The spec helper lowercases the home (`codex-account-usage-client.spec.ts:17`), which hides this. Fix: compare with the same canonicalization the process uses (`codex-app-server-process.ts:168-173`). Add a mixed-case win32 test.

5. **`events()` registers its subscriber lazily and keeps no replay buffer.**
   `codex-runtime.ts:295-299` is an `async *` generator, so the subscriber is added on the first `next()`, not at call time. A consumer that calls `events(sig)`, then `startTurn()`, then iterates loses early deltas and possibly the terminal. It then waits forever, because `closed` is the only other exit. The contract (`codex-runtime.types.ts:241`) says nothing. Fix: register synchronously in a non-generator wrapper, or buffer per turn until the first subscriber. Document the ordering.

### Moderate

6. **A server request arriving while not `running` kills the process instead of being answered.**
   `codex-runtime.ts:195-196` throws when state is `interrupting` or `idle`. `dispatchApproval` turns that into `fail('Codex server request failed')` (`codex-app-server-process.ts:306`). An approval racing `turn/interrupt` ends the session as `codexContextClosed` rather than `interrupted`. Return a `cancel` or `decline` response for the request instead.

7. **Unknown or unsupported server request methods fail the session.**
   `codex-app-server-process.ts:264-268` and `codex-protocol-validator.ts:1029` throw on `item/tool/call`, `account/chatgptAuthTokens/refresh` and similar. Reply with JSON-RPC method-not-found (-32601) and continue. This is fail-closed but kills a long session on a single unmodelled request.

8. **No watchdog for `interrupting` or compaction.**
   After `turn/interrupt` is acked, state stays `interrupting` until `turn/completed` (`codex-runtime.ts:536-545`). If the server never sends a terminal, the context is blocked: no `startTurn`, no `steer`, no timeout. `compact()` awaits `completed` with no timeout (`:596`) inside `serialize`, which blocks every later operation, including `interrupt`. Add a bounded wait that ends in close and a failed terminal.

9. **`close()` can hang forever.**
   `codex-app-server-process.ts:377-394` sends SIGKILL once and then waits for `close` with no ceiling. A grandchild holding stdio, or a kill that is a no-op, means `process.close()` never resolves. Then `RuntimeContext.close()`, `CodexRuntime.open()` failure cleanup (`codex-runtime.ts:115-117`) and `CodexRuntime.close()` never resolve either. Add a hard deadline that logs, marks failed and resolves. On Windows consider tree kill.

10. **Usage uses `tokenUsage.last`, which may be one model request.**
    `codex-event-translator.ts:107-122` treats `last` as turn usage. The evidence (decisions.md rows 119-120) shows turns with two model requests (about 24.5k). In codex, `last` is the most recent request, so multi-request turns would be under-reported. This needs confirming against a 2-request run. If true, accumulate `last` per `turnId`, or diff `total` against the turn baseline.

11. **Slow subscriber kills the whole context.**
    `codex-runtime.ts:319-323`: a subscriber queue of 1024 events (a few long text-delta streams) clears that queue, drops the triggering event, closes the context for all subscribers, and `return`s before delivering to the other subscribers. Coalesce deltas or drop only the slow subscriber.

12. **Registration lifecycle (open item b).**
    `di/registration.ts:38-41, 57-75` builds `CodexRuntime`, `CodexAccountUsageClient` and `CodexParityGate` eagerly with `useValue`. Constructors have no side effects, so eager construction is harmless. However: (i) `CodexRuntime` and `CodexAccountUsageClient` expose `close()`, not `dispose()`, so tsyringe `container.dispose()` will not close them. A host that forgets leaks children and watchers. (ii) A second `registerCodexRuntime` call silently replaces the runtime and orphans live contexts. (iii) The gate is advisory: `CODEX_RUNTIME_TOKENS.Runtime` can be resolved and used without consulting it. Production routing is closed only by convention in P3. Recommend adding `dispose()` aliases (or a `useFactory` with an owner hook), a duplicate-registration guard, and a P3 test that no route resolves the Runtime without `isEnabled`.

13. **Missing env extension contract (open item c) and lost error codes.**
    `codex-app-server-process.ts:113-132` is a fixed allowlist with no `extraEnv`. It omits `HTTP(S)_PROXY`, `NO_PROXY`, `SSL_CERT_FILE`, `NODE_EXTRA_CA_CERTS`, `APPDATA` and `LOCALAPPDATA`, which blocks corporate-proxy users and sandboxed tools. MCP `envReferences` are rejected anyway (`codex-runtime.ts:85-94`). Add an optional, explicit `extraEnv` or `envAllow` to `CodexExecutableSource`, applied after the allowlist. The names must be validated, and values must stay out of logs and fingerprints. Separately, `CodexHomeMismatchError` (code `codexHomeMismatch`) is swallowed by the generic `Codex context could not be opened` (`codex-runtime.ts:115-118`). The caller cannot offer "re-login or wrong home".

14. **Home verification fails open if the field is absent.**
    `codex-runtime.ts:227-232` skips the check when `verifiedCodexHome` is undefined (`'in' this.process` plus `!== undefined`). `start()` always sets it today, but the check should be `verified !== profile.normalizedHome` and fail on undefined.

### Minor

15. **Open item (a) experimentalApi: harmless, but dead and misleading.** `codex-app-server-process.ts:162` always sends `true`, and the validator requires the literal (`codex-protocol-validator.ts:539`). A non-ask profile is therefore not broken. `profile.experimentalApi` (`codex-execution-profile.ts:246`) is read nowhere and is hashed into the fingerprint. Remove it, or derive it as constant true.
16. **Rule store never pruned.** `CodexPermissionRuleStore.clear` is never called. Rules live until runtime close and are keyed by thread. Clear on `markInactive` or thread end. `terminalTurns` is unbounded per context.
17. **MCP accept with an unsupported form silently becomes `decline`.** `codex-approval-bridge.ts:355-359`: the user clicked accept and the server sees decline, with no signal to the UI.
18. **`refresh: true` is ignored when it joins an in-flight non-refresh read.** `codex-account-usage-client.ts:138-166`.
19. **workspace-write turn policy does not set `excludeSlashTmp`/`excludeTmpdirEnvVar`.** `codex-runtime.ts:455-462`: `/tmp` and `$TMPDIR` stay writable beyond the declared `writableRoots`.
20. **`state` can stick at `running` with no `activeTurn`.** `codex-runtime.ts:464`: this happens only if `turn/completed` arrives before both the `turn/start` response and `turn/started`. It does not occur in the observed order.

## Five logic questions
1. Silent failure: a swallowed MCP accept (17); stale usage returned as a miss for 30 s; `unsupportedItem` errors that are not terminal. Persistence, kill and mark-inactive failures are surfaced or logged.
2. Unexpected user action: abort during an approval is correct (`cancel`), but approval-vs-interrupt races kill the session (6). A steer after the turn ends kills the context (2). Calling `events()` after `startTurn` loses events (5).
3. Wrong answer from data: a resumed thread with a changed model is rejected (1). Usage may be under-reported (10). Mixed-case Windows home gives no usage (4). `grantRoot` is auto-accepted (3).
4. Dependency failure: child crash and exit give a terminal `failed` exactly once and release the context (verified). A hung child blocks close (9). An absent terminal after interrupt blocks admission (8).
5. Missing: env extension (13), error taxonomy (2, 13), watchdogs (8), an enforced gate (12).

## Settled-decision check
- ask = granular all-true + read-only + experimentalApi: yes (`codex-execution-profile.ts:229-246`).
- Decisions limited to accept / acceptForSession / decline / cancel: yes.
- No edited input (decline then steer): yes. The decline is written before the steer.
- MCP via `mcpServer/elicitation/request`: yes.
- 0.155.1 pin: yes (`verifyCodexBinary`, plus the launch guard).
- Usage absent-not-zero: yes.
- Child env allowlist: yes (gap in 13).
- Parity gate: `enabled: false` is a literal type with no input path (OK, but advisory, see 12).

## Verdict
REVISE. Fix items 1-5 first, then 6-9 and 13. Items 10 and 12 need confirmation or an owner decision. Confidence: HIGH on 1-3, 5 and 6-9 (code-evident). MEDIUM on 4 (depends on the composer's home casing) and 10 (needs a 2-request wire sample).
