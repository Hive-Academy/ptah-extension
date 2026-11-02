# Code Logic Review - D9 12c-2 (session history router)

Score: 6/10. Verdict: APPROVE WITH FIXES (1 blocking, 3 moderate, 3 minor).
Scope: read router, spec, diff of tokens/register/index in full; read session-metadata-store.ts (updateCodexExecution, 1075-1135), codex-thread-identity-store.ts, codex-chat-metadata-port.ts. Nothing was run (per instruction). Spec execution is UNCONFIRMED.

## Blocking

### B1. Workspace comparison uses raw string equality; breaks every native session on Windows (and any non-canonical path)
- `session-history-router.ts:71` compares `codexThread.workspaceId !== codexExecution.workspaceId`.
- Per `session-metadata-store.ts:113-116` and `1086-1090,1126-1129`, `codexExecution.workspaceId` is the NORMALIZED key (`normalizeCodexWorkspaceKey(path, process.platform)`), while `codexThread.workspaceId` keeps the caller's path. The store itself validates with `sameCodexWorkspace` (normalize(thread) === key, store:145), and `codex-thread-identity-store.ts:50-51` does the same. Raw equality holds only when the caller path is already canonical (the spec uses `/repo` for both, so it hides this).
- Impact: for `D:\Repo` / trailing separators / `a/../b` etc., the router throws `invalidNativeIdentity` for a valid, healthy native session; Electron on Windows (the priority host) would never load native history.
- Fix: compare with `normalizeCodexWorkspaceKey(thread.workspaceId, process.platform) === execution.workspaceId`, inside try/catch mapping a throw to `invalidNativeIdentity` (it throws on relative paths). `normalizeCodexWorkspaceKey` is in codex-runtime (already a type dependency of this file; codex-thread-identity-store.ts:1 imports it as a value from `@ptah-extension/codex-runtime`). Add a spec with a non-canonical caller path (e.g. a trailing slash plus `win32`-style value, or a path needing normalization) that must route natively.

## Moderate

### M1. Requiring `codexThread` is stricter than the data the chat path guarantees
- The chat metadata writer (`codex-chat-metadata-port.ts:17-24`) calls `updateCodexExecution(sessionId, execution, undefined, title)`; `codexThread` is written by a separate step (`codex-thread-identity-store.ts` persist, ~line 88-115). A native row written by `save` before/without `persist` (persist failure, crash between the two) has `runtime: 'codex-app-server'` but no `codexThread`. The router then throws `invalidNativeIdentity` although the thread exists and `thread/read` by id could work. Safe (explicit, no Claude fallback), but the user loses history for that row. Also lane-consumer rows (`consumer: 'lane'`) are served identically; confirm that is intended (a lane thread is not a chat session; the RPC layer normally never asks for them).
- Fix: decide explicitly. Either keep strict and document it in the plan/spec (and add a test naming that case), or let the 12d-1 port derive the resume identity from `codexExecution` alone and drop the `codexThread` requirement from the router. Recommend: keep the cross-field consistency checks, make `codexThread` optional for read-only history if the port can read without a context mapping; otherwise accept strict and document.

### M2. Native port captured at first resolution (instanceCachingFactory) - late binding silently pins "unavailable"
- `register.ts:312-322`: `isRegistered(NATIVE_SESSION_HISTORY_PORT)` is evaluated once at first resolve and the result (possibly `undefined`) is cached forever. The comment in tokens.ts says to bind before first resolution, but nothing enforces it; if anything resolves the router before Electron bootstrap binds the port, every native history read fails with `nativePortUnavailable` for the whole process. It fails loudly, not silently, but is a latent order bug.
- Fix: resolve the port lazily per call (pass a getter `() => NativeSessionHistoryPort | undefined`, resolved on each call from the container), or keep as is and have 12d-1 add a bootstrap-order test (port registered before any `SESSION_HISTORY_ROUTER` resolve). Lazy getter is preferred.

### M3. Error is a plain `Error`, not mapped to a coded RPC error
- `SessionHistoryRouteError` (router:20-29) has a good fixed user-safe message and a code, but project rule says user-facing RPC failures use a code from `rpc-error-codes.types.ts` via `RpcUserError`. Nothing maps `nativePortUnavailable`/`invalidNativeIdentity` yet; in 12d-2 an unmapped throw reaches the frontend as a generic/internal error. Required for 12d-2: map both codes in the history RPC handler (add codes to the shared union), and make sure other errors from `port.readHistory` (runtime errors) are also mapped and never forwarded raw. Not blocking for this batch because there is no consumer yet, but record it as a hard 12d-2 acceptance item.

## Minor

- m1. `router:68` `session.sessionId !== sessionId` is redundant (the store is keyed by it); harmless.
- m2. `nativeHistory` (router:77-81) is a non-async method that throws synchronously; callers `await` it inside async methods so rejection still results, fine, but declare it `async` for consistency.
- m3. Spec gaps (spec file): no test for workspace-normalization case (B1), mismatched `codexExecution.sessionId`, workspace mismatch, a native port that rejects (error must propagate and not fall to legacy), `metadata.get` returning `null` (goes to legacy - intended, assert it), and the `readSessionHistory` fixture only asserts `stats: null` rather than that replay metadata is absent. The "older-page" test (spec:101-107) only re-asserts full-list equality; it does not exercise paging, which belongs to 12d-2. Rename or note.

## Answers to the focus points

- Identity detection: `codexExecution.runtime === 'codex-app-server'` is the field the Electron chat path persists (`codex-chat-metadata-port.ts:17-24`, and `codex-thread-identity-store.ts` for the thread mapping). Verified. Claude rows have no `codexExecution` so they cannot be misrouted; a missing row goes to the Claude reader (correct for Claude, and an unsaved native row would fail there loudly, not silently return Claude data). A native row never falls back to Claude (confirmed in code and spec). Defect is only B1.
- Result shape: native returns `{ events, stats: null }` typed as `Awaited<ReturnType<readSessionHistory>>`; replay metadata is optional so identical type. OK. Note stats null means no token usage for native sessions; consistent with the projector.
- Port-absent failure: typed, fixed text, no path/native text. OK.
- Paging: router returns the full event list from both methods; paging remains in `ChatHistoryReadService` (12d-2). Reading the entire thread on each older-page request is O(thread) per page (re-spawns a read process each time, per the report's own description); acceptable now, note for 12d-1 to consider a short-lived snapshot cache.
- DI: Singleton-equivalent via `instanceCachingFactory`; registered in `registerSdkServices`, so all hosts get the router; it depends only on `SDK_SESSION_METADATA_STORE` and `SDK_SESSION_HISTORY_READER`, which every host already registers, and the native port is optional, so VS Code/CLI containers do not break and no native chat is forced. See M2 for ordering.
- Guards: no edit needed now in `apps/*/src/di/expected-resolvable.ts`, `container.smoke.spec.ts`, `surface-composition.spec.ts` (the new tokens are not in any list, and nothing there asserts a full SDK_TOKENS enumeration that I found; confirm when verify runs). In 12d-1: add `SDK_TOKENS.NATIVE_SESSION_HISTORY_PORT` to `ELECTRON_CODEX_BOUND_TOKENS` (apps/ptah-electron/src/di/expected-resolvable.ts:122-129), update the literal list and `toHaveLength(6)` to 7 in `apps/ptah-electron/src/di/surface-composition.spec.ts:~405-420` (the regex requires `container.register(SDK_TOKENS.X, { useValue: ...`, so the binding must use `useValue`, which conflicts with a lazy factory - bind a `useValue` object whose `readHistory` creates the scope lazily). Add `SESSION_HISTORY_ROUTER` to the always-resolvable lists of all three hosts in 12d-2 when a consumer is added. VS Code `surface-composition.spec.ts:111` regex scans for Codex-only tokens in VS Code sources: do not mention `NATIVE_SESSION_HISTORY_PORT` there, or add it to that regex if it is meant to be forbidden.
- Test runtime: spec imports `reflect-metadata` first; the router imports only erased type imports plus the projector, so no tsyringe side-effect load issue. Spec shapes use real `SessionMetadata` and `CodexSessionHistory` types. I found no runtime failure by reading, but did not run it.

## 12d-1 binding contract (report) - judgement
Mostly sound: bind before first router resolve, one method `readHistory(session)`, rebuild profile and identity from the saved row, scope created and disposed in `finally`, reject inconsistent identity, never return empty history, no binding on other hosts. Additions required: (1) bind with `useValue` to satisfy the guard regex and the length-6 assertion above; (2) address M2 (lazy resolution) so order cannot matter; (3) the port must throw a user-safe typed error (not forward App Server text or paths) and 12d-2 maps it to an RPC code (M3); (4) the port must verify the saved `normalizedHome` still matches the current profile and fail otherwise, not silently read another home; (5) concurrency: two simultaneous history reads for one thread should not each hold a runtime child indefinitely (timeout and cancellation on read are unspecified in the contract).

## Five logic questions (brief)
1. Silent failure: none found; all native failure paths throw. Risk is the false-positive `invalidNativeIdentity` (B1).
2. Unexpected user action: opening a Windows native session with a non-canonical stored path fails (B1).
3. Wrong answer: none for data; stats null shows zero usage by design.
4. Dependency fails: port rejection propagates unmapped (M3); no timeout in router.
5. Missing: lazy port resolution (M2), coded RPC mapping (M3), tests for B1.

---

# Re-review (after fixes lane)

Score: 7/10. Verdict: APPROVE WITH FIXES (1 blocking for test runtime on Windows, 0 moderate logic, 3 minor). Nothing was run; static reading only.

## Prior findings

- B1 (workspace compare): FIXED in logic. `session-history-router.ts` now normalizes `codexThread.workspaceId` with `normalizeCodexWorkspaceKey(..., process.platform)` and compares to `codexExecution.workspaceId`; a throw maps to `invalidNativeIdentity` (try/catch is not empty: it rethrows a typed error, so no `degradation-audit` is needed). Matches `sameCodexWorkspace` in the store.
- M1: IMPLEMENTED per coordinator decision. With no `codexThread`, the router passes the row (with `codexExecution.sessionId`) to the port; `codexExecution.sessionId !== sessionId` gives a typed error. Residual: the mapping consumer (`lane` vs `chat`) cannot be checked without `codexThread`; harmless for history, but 12d-1 should read by `codexExecution.sessionId` only.
- M2: FIXED. `getNative` is a per-call getter; `register.ts:312-323` calls `isRegistered(token, true)` and `resolve` per read, so late binding works. `c` is the registering container, as before. No DI regression: the router's two hard deps are unchanged, the port stays optional. Note the 12d-1 `useValue` binding is compatible.
- M3: deferred to 12d-2, recorded in plan-d9-history.md:31 (per report). Still a hard acceptance item.
- Minors: redundant row-id check removed; `nativeHistory` now async; spec gaps mostly closed (late port, rejecting port, mismatched id, invalid path, missing row, real paging).

## Projector change (codex-history-projector.ts:191-195)

Reviewed. The root user message id is now `sha256(JSON.stringify([thread.id, turn.id, item.id]))` in base64url (43 chars). `HISTORY_CURSOR_PATTERN` is `/^h1:([A-Za-z0-9_-]{1,512})$/` (history-page.utils.ts:12), so the old JSON id (brackets, quotes, commas) could never be a valid cursor: the 12c-1 id was a real defect and the change is correct and necessary.
- Stability: deterministic from the same inputs, so identical across full re-reads (the router re-fetches the snapshot per page). It does not change per call. Collision-free in practice; includes thread id, so child threads differ.
- 12c-1 compatibility: only user ids changed; `:start`/`:text:N`/`:complete` event ids derive from it. Nothing consumes native history yet (12d not landed), and no persisted cursor exists, so no migration issue.
- Live-path parity: live translator events skip `userMessage` items (projector spec line 89 filters them), so there is no live counterpart for a user message id; assistant/tool ids (JSON form) are intentionally unchanged and are never cursor anchors (`isRootUserTurnStart` requires role user and no `parentToolUseId`). The parity spec at lines 89-108 uses only assistant ids and remains valid.
- Gap (minor): the projector spec does not assert the new user id format or its stability. Add: each `role: 'user'` `message_start.messageId` matches `/^[A-Za-z0-9_-]{1,512}$/` and equals the value from a second projection. The router paging spec covers it indirectly.
- Import `node:crypto` in a backend lib is consistent with codex-chat-adapter.ts:8.

## Blocking (spec runtime on Windows)

### B2. Spec fixtures use `/repo`, which `normalizeCodexWorkspaceKey` rejects on win32
- `session-history-router.spec.ts:18-33`: `workspacePath = '/repo'`, used as `codexThread.workspaceId`. On win32, `normalizeCodexWorkspaceKey('/repo', 'win32')` throws (`codex-home-path.ts:30-37`: `/^[\/](?![\/])/` matches the drive-less rooted path). The router then returns `invalidNativeIdentity`, so every native-route test with `codexThread` present (tail/paging, projected history, late port, rejecting port, replay) fails on the developer's Windows machine, and the non-canonical test's other fixtures are inconsistent. Also `nativeExecution.workspaceId: '/repo'` is not a real normalized key on win32 (should be `d:/repo`).
- Fix: `const workspacePath = process.platform === 'win32' ? 'D:\repo' : '/repo'` and `workspaceId: normalizeCodexWorkspaceKey(workspacePath, process.platform)` for `codexExecution`; keep the caller path in `codexThread`/row. Keep the non-canonical test, but derive `callerPath` from the same helper. Linux CI would pass today; Windows (priority host dev) would not.

## Minor
- m1. Router spec "invalid or mismatched path" loop builds the router per iteration but asserts `native.readHistory` not called only at the end; fine.
- m2. Missing projector id-format assertion (above).
- m3. No timeout/cancellation in the router for a hung port: stays a 12d-1 requirement.

## Verdict
APPROVE WITH FIXES: fix B2 in the spec (no production change needed), add the projector id assertion, then verify. Confidence MEDIUM (no execution).

---

# Re-review 2

B2 is fixed. The spec now uses `workspacePath = 'D:\repo'` on win32, else `/repo` (spec line 20), and `nativeExecution.workspaceId` is `normalizeCodexWorkspaceKey(workspacePath, process.platform)` (line 27), so the fixture matches what the store persists on both platforms. The non-canonical test still derives its caller path and key independently (lines 147-155) and so still exercises the B1 normalization. The late-port test uses a `host.port` holder (lines 186-191): the first read still asserts `nativePortUnavailable` before the port is set, then a successful native read after, so it is not vacuous. The mismatch test (line 224) still has real failing inputs (`relative/path`, `D:\Other` or `/other`) and asserts the port is never called; nothing now passes vacuously. No production code changed. Final verdict: APPROVE (score 8/10). Open follow-ups, all outside this batch: add a projector spec assertion for the user-id format and stability; map router and port errors to coded RPC errors (12d-2); the 12d-1 port needs a timeout, cancellation and a saved-home check.
