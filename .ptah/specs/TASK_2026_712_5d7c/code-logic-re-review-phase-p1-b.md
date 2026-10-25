# Code logic re-review — Phase P1-B fixes

Reviewer family: xAI
Implementer families: OpenAI (findings 1–4) and Anthropic (orchestrator CI fix)
Scope: `git diff HEAD` only (10 files, +229/−57). Prior findings in `code-logic-review-phase-p1-b.md`. Fix reports `implementation-report-p1-b-fixes-a.md` and `implementation-report-p1-b-fixes-b.md`.
Verdict: **APPROVED**
Counts: 0 blocking, 0 serious, 0 moderate, 0 new failure modes
Score: 8/10

Static only. No nx, jest, tsc, lint, build, or diagnostics. Unchanged registry spawn, stream loop, and D13 admission were not re-reviewed.

What separates 8 from 9–10: the SDK `?? process.env` chain was not re-opened in `sdk.mjs` this pass; the pin is the remedy the prior review specified, and the specs assert that first operand. What separates 8 from 5–6: each of findings 1–4 now has a closed path with `file:line` evidence, and the diff adds no new silent-success or wrong-answer path.

Accepted, not findings: the broad `CLAUDE*` / `ANTHROPIC*` / `AWS_` / `GOOGLE_` / `AZURE_` / `CLOUD_` / `BEDROCK` / `VERTEX` drop stays deferred to Batch 17 certification. D13 admission stays fail-closed (`claude-cli.adapter.ts:103-109` still throws when `accountAdmission` is set; that block is unchanged).

## Findings 1–4

| # | Prior severity | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Blocking — host credential namespace survives a named route | **RESOLVED** | `claude-account-route-env.ts:6-8` adds `CLAUDE_SECURESTORAGE_CONFIG_DIR`, `ANTHROPIC_CONFIG_DIR`, and `ANTHROPIC_PROFILE` to the scrub list. `:52-54` throws before any write when `canonicalConfigDir` is empty or whitespace. `:62-70` deletes every casing (`key.toUpperCase()` against the selector set), including the canonical uppercase key. `:74` then sets `CLAUDE_SECURESTORAGE_CONFIG_DIR` to `route.canonicalConfigDir`, so the SDK's `options.env` value is defined and `?? process.env` cannot select the host store. `claude-account-command.ts:30` puts the same three names on `CLAUDE_ACCOUNT_SELECTOR_KEYS`. `:63-65` still throws `unsupported-source` when any of those keys is populated (the old `^CLAUDE` prefix already refused a populated secure-storage key; the selector branch does not widen that). `:74-75` writes both directory keys only after that refusal. Ambient and omitted routes still return the same object (`claude-account-route-env.ts:51`). |
| 2 | Serious — one commit ends the prompt iterable | **RESOLVED** | `named-account-prompt-gate.ts:31-32` keeps separate `held` and `committed` queues. `next` (`:57-66`) shifts only `committed` and, on empty, waits; it does not call `close()`. `push` (`:85-91`) is refused only when `state === 'closed'`; a later push sets `state` back to `'held'` and does not wake readers. `commit` (`:93-101`) returns false unless `state === 'held'`, then appends `held` onto `committed` and wakes. Approved messages already in `committed` still drain while newer input sits in `held` (`:58-61` does not consult `state` except to stop on `'closed'`). `close` / `reject` / `iterator.return` (`:43-50`, `:68-70`, `:103`) clear both queues and wake. An empty `commit` leaves the reader waiting; the next `push` is not preapproved (`:93-96` plus the second `commit` required after `push` sets `'held'`). Waiter registration is inside the `Promise` executor (`:64`) before the `await` yields. `Array.shift` does not re-enter, so `commit` or `close` cannot run between the empty read and `waiters.add` on this thread. |
| 3 | Moderate — fresh runs share routing hint `claude` | **RESOLVED** | `claude-cli.adapter.ts:142` passes `routingId: \`claude:${randomUUID()}\`` once per `runSdk`. `claude-sdk-lane-options.ts:138-140` still prefers a non-blank resume session, then parent session, then that hint. `SessionId.safeParse` (`branded.types.ts:41-42`, `:109-110`) accepts only a full UUID v4. `claude:<uuid>` fails that parse the same way `claude` did, so `resolveClaudeLanePermissionOptions` (`claude-sdk-lane-options.ts:201-219`) keeps the raw string as the hint and does not invent a routable session id. Two fresh spawns no longer share one hint. A resume or parent id still wins, so the UUID does not replace an existing session route. |
| 4 | Moderate — effort dropped when the model is omitted; segment buffer capped at 5000 | **RESOLVED** | `claude-cli.adapter.ts:223-237` no longer returns before the candidate loop just because `model` is empty, and it skips `getNativeClaudeModels` in that case. `:240-248` returns `low` / `medium` / `high` / `xhigh` / `max` when there is no model; a truthy unsupported candidate still logs `Not applied — configured precedence remains in effect` (`:249-252`). `buildClaudeSdkLaneOptions` sets `effort: effort \|\| undefined` (`claude-sdk-lane-options.ts:111`) with no model guard. `claude-cli.adapter.ts:152` deletes `options.model` only, so the effort value remains. `emitSegment` (`:188-193`) pushes every pre-subscribe segment; the 5000 cap remains only on stream events (`:199`), which matches the registry split the prior review cited. `disposeCallbacks` (`:159-164`) still clears `segments`. |

## Five logic questions (diff only)

1. Silent success: a named `applyClaudeAccountRouteEnv` result now carries the named directory on `CLAUDE_SECURESTORAGE_CONFIG_DIR` (`claude-account-route-env.ts:74`). A follow-up `push` no longer looks accepted while the iterator has already ended; `push` returns true and the message stays in `held` until another `commit` (`named-account-prompt-gate.ts:85-101`).
2. User action: a second turn on the same iterable waits (`named-account-prompt-gate.ts:57-64`). Two fresh adapter spawns get different permission hints (`claude-cli.adapter.ts:142`).
3. Wrong answer: `reasoningEffort: 'high'` with no model is returned as `'high'` (`claude-cli.adapter.ts:240-248`) and kept on options (`claude-sdk-lane-options.ts:111`, `claude-cli.adapter.ts:152`). A late subscriber receives every buffered segment (`claude-cli.adapter.ts:178-179`, `:191-193`).
4. Dependency failure: `getNativeClaudeModels` is not called when the model string is empty, so a catalog throw cannot drop an explicit effort (`claude-cli.adapter.ts:228-232`). When the model is set, a throw still falls into the existing catch and returns `undefined` (`:254-258`). Abort, `close`, `reject`, and `iterator.return` still drop both queues (`named-account-prompt-gate.ts:43-50`). Certification of a populated secure-storage key still throws (`claude-account-command.ts:63-65`) instead of launching.
5. Unspecified: Batch 17 still owns the broad prefix drop and wiring this gate into the live query. Neither is introduced or closed by this diff. The unbounded segment buffer is the registry parity the prior finding required, not a new cap miss.

## Orchestrator CI fix

`buildClaudeLaneEnv` now lives in `claude-sdk-lane-options.ts:21-26`. The body is the same call as the deleted function: `applyClaudeAccountRouteEnv(buildSafeEnv(authEnv), accountRoute)`. The second parameter is still `Parameters<typeof applyClaudeAccountRouteEnv>[1]`, and `ClaudeSdkLaneOptionsInput.accountRoute` (`:31`) is still that function's second parameter. The only caller is `:147`. A workspace search for `buildClaudeLaneEnv` finds no remaining import from `ptah-cli-spawn-options.service.ts`.

`claude-sdk-lane-options.ts:14` imports `PtahSpawnAssembly` as `import type`. Type-only imports are erased, so loading the lane options module does not load `ptah-cli-spawn-options.service.ts`. That service still value-imports `AGENT_GENERATION_TOKENS` from `@ptah-extension/agent-generation` (`ptah-cli-spawn-options.service.ts:47`), which is the edge that pulled in `workspace-intelligence` `wasm-bundle-dir.ts`.

No other value-import path from the registry or the Claude lane modules reaches that edge:

- `ptah-cli-registry.ts:1-2` value-imports the lane options and the lane runner. Its spawn-options import is type-only (`:63`).
- `claude-sdk-lane-runner.ts` does not import the spawn-options service. Its value imports are the stream loop and the plan-limit helper.
- A search of `claude/`, `ptah-cli-registry.ts`, `ptah-cli-stream-loop.service.ts`, `ptah-cli-lane-plan-limits.ts`, `ptah-cli-prompt-mailbox.ts`, and `ptah-cli-registry.utils.ts` finds no `agent-generation` import and no value import of the spawn-options service.

`buildSafeEnv` and `applyClaudeAccountRouteEnv` are additional names from `@ptah-extension/agent-sdk`, which this file already value-imported (`buildFlagSettingsArg` and the other symbols at `:3-11`). That does not add the agent-generation edge.

Specs that construct `PtahCliSpawnOptions` themselves still value-import the service (for example `ptah-cli-registry-capabilities.spec.ts` and `ptah-cli-registry-auto-compact-argv.spec.ts`). Those loads are direct, not via the registry or `claude-sdk-lane-options.ts`. They are outside the shard failure this move fixes.

## New defects

None.

## Decisions

- Broad env-prefix removal stays deferred to Batch 17. Evidence: orchestrator instruction and fix report A decision 5. The named route still seals the secure-storage key the prior review showed the SDK reads. Reversible by a later certification change.
- D13 remains a throw with no lease. Evidence: `claude-cli.adapter.ts:103-109` is outside the fix hunks and still throws. Not re-scored.
- Per-spawn `randomUUID` rather than `claude:${agentId}`. Evidence: the adapter already passes `agentId` separately (`claude-cli.adapter.ts:141`); the permission fallback is only used when resume and parent are absent (`claude-sdk-lane-options.ts:138-140`). A missing agent id still gets a unique hint. Reversible local string.
