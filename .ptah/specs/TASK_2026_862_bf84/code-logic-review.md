# Code logic review

Implementer families: codex, Glm
Review family: kimi
Verdict: APPROVE (round 2; round 1 was REVISE)
Round 2 reviewer: Claude subagent (different family; lanes at limit)
Score: 5/10

| Result | Count |
| --- | ---: |
| Blocking findings | 0 |
| Serious findings | 3 |
| Moderate findings | 1 |
| Failure modes found | 4 |

## Scope and evidence

The review covered the 88 paths in `review-files-other-authored.txt`. It traced executable selection, process startup, runtime fallback, Electron and CLI lane composition, model discovery, authentication home propagation, pricing, and the UI status surfaces. It also examined the related selector, process, runtime, lane, pricing, authentication, and UI specifications.

The binding behavior comes from `implementation-plan.md:50-56`. It requires a fresh selection for each open, one bundled retry before a turn receipt, and feature-local handling for optional methods.

The normal selection path is present. `select-codex-executable.ts:48-113` enforces the 0.165.0 floor and prefers a supported installed executable. The process passes the selected home and verifies the returned home. The lane catalog and pricing surfaces preserve dynamic models and token counts. These working paths do not remove the findings below.

The score is in the 5-6 band because three required failure paths have Serious defects. It is not in the 7-8 band because chat fallback and concurrent opens are not sound. It is above the 3-4 band because the main selector, protocol, model, authentication, and pricing paths are present. No Blocking data loss, corruption, credential exposure, or success-looking false result was found.

## Findings

1. **Serious — Chat does not retry the first `turn/start` on the bundled executable.**

   **Evidence:** `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:507-544`; `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-lifecycle.spec.ts:973-992`.

   **Failure scenario:** The installed executable supports initialization, catalog discovery, and thread open, but returns `-32601` for the first `turn/start`. No turn receipt exists. The chat stream emits an update-or-remove instruction, closes the session, and tells the user to restart Ptah. It never opens the already-probed bundled executable. The specification explicitly tests this terminal behavior instead of the required fallback.

   **Required fix:** At the chat first-turn boundary, close the pre-receipt installed context, activate the bundled selection once, reopen with the same profile and home, and retry `turn/start` once. Return a terminal error if the bundled method also fails. Do not retry after a receipt or an uncertain turn side effect. Add separate tests for the successful bundled retry, bundled failure, and no replay after a receipt.

2. **Serious — One mutable selection snapshot races across concurrent opens.**

   **Evidence:** `libs/backend/codex-runtime/src/lib/select-codex-executable.ts:121-138`; `libs/backend/codex-runtime/src/lib/codex-runtime.ts:275-277`; `apps/ptah-electron/src/di/codex-lane-composition.ts:182-205`; `libs/backend/cli-engine/src/lib/codex-lane-runtime-composition.ts:192-215`.

   **Failure scenario:** Lane A and lane B both resolve the same installed executable. Lane A enters `CodexRuntime.open()`, whose fresh `selectForOpen()` clears the shared current selection while it probes. Lane B then enters the host `open()` guard. `current()` is undefined, so lane B fails with `Codex executable does not match the selected executable`, although its path is valid. A fallback can also read `current()` from another open and activate the wrong selection. History and account-usage reads call the same mutating selection port, so they can participate in the race.

   **Required fix:** Bind the selected executable and its one-shot fallback budget to an immutable per-open handle. Pass that handle through binary resolution, runtime open, and first-turn fallback. Do not use shared `current()` state to validate a caller's path or identify its failed executable. Keep any status-only current value generation-guarded. Add deferred-probe tests for two lane opens and for a lane open concurrent with a history or account-usage read.

3. **Serious — An unsupported optional method closes the whole runtime context.**

   **Evidence:** `libs/backend/codex-runtime/src/lib/codex-context.ts:889-892`, `libs/backend/codex-runtime/src/lib/codex-context.ts:927-938`, `libs/backend/codex-runtime/src/lib/codex-context.ts:1068-1071`, and `libs/backend/codex-runtime/src/lib/codex-context.ts:1083-1085`.

   **Failure scenario:** Codex returns `-32601` for `turn/steer`, `turn/interrupt`, or `thread/compact/start`. The process boundary raises `CodexUnsupportedMethodError`, not `CodexRequestRejectedError`. These catch blocks therefore call `onFailure()`, which closes the context. A missing optional capability can fail an active turn and make basic chat unavailable. This contradicts `implementation-plan.md:52-54`.

   **Required fix:** Handle `CodexUnsupportedMethodError` as an operation-local unavailable result before the generic transport-failure path. Retain the context. Restore interrupt state and clear its watchdog when appropriate. Preserve context closure for genuine transport and protocol failures. Add one test for each optional method that proves a following basic operation still works.

4. **Moderate — The lane adapter uses stale executable identity after an internal runtime fallback.**

   **Evidence:** `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts:324-330` and `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts:487-504`; `apps/ptah-electron/src/di/codex-lane-composition.ts:182-187`; `libs/backend/cli-engine/src/lib/codex-lane-runtime-composition.ts:192-197`.

   **Failure scenario:** Runtime open switches from the installed executable to the bundle after `model/list` or thread open fails. The adapter's local `binary` still says `installed`. If the bundled first `turn/start` then returns `-32601`, the adapter attempts another `openFallback()`. The host sees a bundled current selection and throws `Codex installed executable is not active`. This masks the actual bundled required-method failure and attempts to spend the fallback budget twice.

   **Required fix:** Track the active executable for each opened context and use the error's `source` plus the per-open fallback budget. Never call `openFallback()` for an error from the bundled executable. Return the safe bundled-method error from `CodexUnsupportedMethodError`. Add an integrated test where installed `model/list` fails and bundled `turn/start` also fails.

## Five logic questions

### 1. How does this fail silently?

No success-looking false result was found in the examined paths. Dynamic discovery failure returns an explicit empty catalog rather than fabricated models (`libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.ts:376-417`). Missing pricing returns a null cost with `rate-missing`, while token usage remains independent. The defects found produce visible errors or close a context.

### 2. What user action produces unexpected behavior?

Starting chat with an installed Codex that lacks `turn/start` causes a restart instruction instead of the required bundled retry (finding 1). Starting two lanes concurrently can cause a false executable mismatch (finding 2). Steering, interrupting, or compacting against a server without that optional method closes the whole context (finding 3).

### 3. What input data produces a wrong answer?

Malformed versions are rejected and malformed model entries are skipped by the reviewed parser. No incorrect version or price calculation was found. A double protocol failure produces the wrong error: installed catalog failure followed by bundled `turn/start` failure becomes `Codex installed executable is not active` (finding 4).

### 4. What happens when a dependency fails, times out, or returns an unexpected shape?

Unknown notifications are ignored with bounded diagnostics (`libs/backend/codex-runtime/src/lib/codex-app-server-process.spec.ts:191-238`). Required open-method failures can activate the bundle in `CodexRuntime.open()`. Chat first-turn fallback is missing, optional `-32601` responses close the context, and concurrent probes invalidate shared open state (findings 1-3). Catalog discovery failures produce an empty catalog.

### 5. What is missing that the requirements never mentioned?

The tests do not exercise concurrent opens with deferred probes. They also do not cover the sequence where runtime open consumes the fallback and bundled `turn/start` then fails. These cases are necessary to prove that the per-open cache and one-shot budget remain correct outside a single sequential lane.

## Acceptance criteria check

1. **Partially met.** Installed-first selection, the 0.165.0 floor, native executable checks, shell-free probes, and source/version/reason reporting are present. The CLI matrix renders the selected source and bundled reason at `libs/frontend/chat/src/lib/settings/ptah-ai/cli-matrix-rows.ts:389-410`. Concurrent opens are unsafe under finding 2.
2. **Met in the reviewed references.** The pin, parity-gate, admission, protocol-manifest, and development-route modules are deleted. Searches found no remaining production references to those symbols. The remaining `PTAH_CODEX_RUNTIME_DEV` text occurs only in an inert composition specification fixture. `codex-runtime` has no Electron, `agent-sdk`, or `cli-agent-runtime` import.
3. **Not met.** Unknown notifications, additive fields, and malformed model entries have tolerant handling. Required chat `turn/start` fallback is absent, and optional missing methods close the context (findings 1 and 3).
4. **Met by code evidence.** The provider entry has no `staticModels`. Dynamic app-server and account discovery return future identifiers without a static allowlist. Explicit lane models pass through, omitted models stay omitted, and failed discovery returns an empty catalog. Exact pricing returns null for an unknown rate; the UI uses `Not priced` only for `rate-missing` and preserves token counts (`libs/frontend/chat-ui/src/lib/molecules/session/session-stats-view.spec.ts:103-125`).
5. **Met by code evidence.** Installed and bundled processes receive `CODEX_HOME=profile.normalizedHome`, and the initialize-response home is verified. The same `CodexHomeAuthService` home entries serve either executable. No real credentials or live Codex turns were used.
6. **Met.** `.github/dependabot.yml:1-21` defines weekly grouped npm updates for the Codex CLI and SDK across the four dependency manifests. The plan requires human review of dependency and patch changes.
7. **Met as authored coverage, not as executed verification.** Selector tests cover versions, old or unreadable installs, bundled fallback, one-shot use, and a Windows shim. Process tests cover tolerant notifications and `-32601`. Pricing and UI tests cover unknown rates and `Not priced`. Findings 1-4 require additional regression tests.

## Decisions

- The explicit fallback and optional-method contracts in `implementation-plan.md:52-54` are binding review criteria.
- Finding 2 is Serious because concurrent lane opens are a supported host action and can fail without a user configuration error.
- Finding 4 is Moderate because it requires two required-method failures, but it masks the useful terminal error.
- Criterion 6 was checked against the Dependabot file named by the implementation plan. No out-of-scope source finding was raised.

## Verification limits

This was a read-only review. No tests, builds, Nx commands, npm verification, package installation, or state-changing Git commands ran. `ptah_get_diagnostics` was not available in this lane. No live Codex process, credentials, or paid turns were used. Specification source shows intended coverage, but it does not prove that the tests pass. No `code-style-review.md` existed when this review started.

## Round 2

Scope: targeted reads of the fix-round files (static review only; no tests run, per instructions).

| Finding | Resolved? | Evidence |
| --- | --- | --- |
| 1 Serious: chat first-turn bundled retry | Yes | `codex-chat-turn-stream.ts:190-203` retries `turn/start` once, only for an installed-source unsupported error with no `turnId` and `bundledRetryUsed` unset; the flag is set before the retry, so a second failure from the bundle throws. `codex-chat-adapter.ts:621-627` calls `runtime.retryFirstTurnOnBundle` with the same profile and secrets. `codex-runtime.ts:387-400` closes the old context, spends the one-shot fallback and reopens with the same resume identity and profile, so CODEX_HOME and auth are unchanged. A bundled rejection reaches the catch at `codex-chat-turn-stream.ts:526-528` and surfaces the safe method notice. The retry sits before the receipt, so a turn cannot be replayed. |
| 2 Serious: shared mutable selection races | Yes | `select-codex-executable.ts:121-157` makes each `selectForOpen` return a frozen selection object. `current()` is generation-guarded and used for status only. The fallback budget is a WeakMap keyed by the installed selection object, so overlapping probes cannot spend each other's budget. `codex-lane-composition.ts:156-160` carries the handle (`selection`) from binary resolution into `open`, `openCatalog` and `openFallback` (:164-195), and the open path binds a per-open snapshot (:190-215). The compositions no longer validate against shared `current()`. |
| 3 Serious: optional methods close the context | Yes | `codex-context.ts:889-891` (steer) and `:1073-1074` (compact) rethrow unsupported errors without `onFailure()`. `interrupt` at `:930-938` clears the watchdog, restores `running` and a fresh turn controller, and returns false. The abort-triggered path at `:905-906` skips `onFailure` for unsupported errors. Other errors still reach `onFailure`. |
| 4 Moderate: stale identity / double fallback | Yes | The runtime records the executable that actually opened each context (`codex-runtime.ts:~287-296`, `contextSelections`). The lane adapter at `codex-app-server-lane.adapter.ts:494-497` requires `error.source === 'installed'` and `fallbackUsed` unset, so a bundled error never calls `openFallback`. `binary.source` is stale after an internal fallback, but `error.source` guards that case. |

New findings: no Blocking or Serious.

- Moderate: `codex-runtime.ts:~296-300`. A non-unsupported `model/list` failure is only warned about and the open continues. This is pre-existing and deliberate: the catalog is non-essential. Unsupported `model/list` correctly triggers the fallback.
- Moderate (observation): in `codex-chat-turn-stream.ts:195-200`, if `retryFirstTurnOnBundle` rejects after `context.close()`, `session.context` points at a closed context. The outer catch then runs `deps.close(session)` because the turn failed (:526+), so the session is torn down, not reused. Acceptable.
- Checked and clean: no retry loop (budget is one per open and one per chat session via `bundledRetryUsed`); the old context is closed before the reopen, so no leaked process on the retry path; no new `any`, `as unknown as` or non-null `!` in the production diffs I grepped; no swallowed errors besides the audited ones already present.
- Residual uncertainty: behavioural specs were not executed, only static reading. The original `subscription` and `events` are explicitly aborted and returned before the retry.

Round 2 verdict: APPROVE.
