# Review 10b-2a — native Codex App Server lane adapter

Verdict: REVISE
Score: 7/10
Review family: ollama-cloud/Glm vs codex

## Defects

1. **Medium — the essential retry keeps non-essential prefix settings, so it cannot recover from a rejection those keys cause.**
   Location: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane-rejection.ts:31-43` (`essentialLaneSession`).
   The lane spread keeps `agentsEnabled`, `pluginsEnabled`, `appsEnabled`, `includeSkillInstructions` (and `ptahToolTimeoutSeconds`); only `autoCompactTokens` and `toolOutputTokenLimit` are dropped, plus the user-server disabling when the text names one. The App Server sends those kept fields as `agents.enabled`, `features.plugins`, `features.apps`, `skills.include_instructions` inside the `thread/start` config (`codex-context.ts:232-245`), so the retry re-sends the same keys.
   Scenario: Codex rejects `thread/start` and names one of those keys (for example an unknown `agents.enabled` after a Codex upgrade). The retry sends the identical key, the second attempt rejects, and the run ends with "Codex rejected the essential lane configuration." The legacy retry recovered, because `essentialCodexConfigEntries` (`codex-config-rejection.ts:53-60,131-141`) kept only effort, the user-server disabling, Ptah MCP, `developer_instructions`, `approval_policy` and `web_search`. The batch requires "essential lane settings only". The copied notice (`codex-app-server-lane-rejection.ts:11-12`) also claims the run "drops the lane budget and prefix keys", which the code does not do.
   Fix: in `essentialLaneSession`, also set `agentsEnabled`, `pluginsEnabled`, `appsEnabled` and `includeSkillInstructions` to `undefined` so Codex defaults apply (the profile schema marks them optional, `codex-execution-profile.ts:90-93`), and align the notice wording.

2. **Low — the user-server notice fires even when the lane disabled no user servers.**
   Location: `codex-app-server-lane-rejection.ts:47-51` and `:38-41`.
   The notice and the `disabledUserMcpServers` rewrite act on `codexRejectionNamesUserServer` alone. Legacy gated both on `userServers.names.length > 0` (`codex-cli.adapter.ts:835-837`). This is distinct from the accepted 10b-2b gap: it is a missing gate, not the missing rejected-key field, and it matters the moment 10b-2b makes the branch reachable.
   Scenario: a lane that disabled no user servers receives a rejection naming `mcp_servers.foo`. The run shows "your own MCP servers are enabled for this lane" although Ptah never disabled them.
   Fix: gate the branch on a non-empty `session.lane.disabledUserMcpServers`.

3. **Low — the turn-level retry seam cannot occur with the real runtime, so the main retry tests pin an impossible path.**
   Location: `codex-app-server-lane.adapter.ts:364-373` (turn-level retry) vs `:278-286` (open-level retry).
   The runtime constructs `CodexPreTurnConfigRejectedError` only for `thread/start` / `thread/resume` during open (`codex-runtime.ts:21-28,141-148`); the method type cannot represent `turn/start`, so `startTurn` never throws it. In production the retry runs only through the open-level path, which has one spec case; the notice, the `onLaneConfigRejected` callback, the close-before-open ordering and the second-rejection flow are asserted only through the unreachable `startTurn` mock.
   Scenario: a regression that breaks notice emission or the old-context close on the open-level path still passes the current suite.
   Fix: add one open-level case that asserts the notice, the callback and the essential profile.

## Checked

- **Effort**: valid set matches legacy `low|medium|high|xhigh`; an invalid value warns once, leaves no effort in the profile, and the run continues; an invalid option value overrides a valid lane value, as legacy; continuation turns keep the effort through the shared context settings.
- **Retry vs abort**: abort during the retry close or open leaves no second live context — the late-open guard (`codex-app-server-lane.adapter.ts:221-233`) closes a straggler and `done` settles exactly once.
- **Retry vs `starting` / `active`**: `starting` stays true through the retry, so a concurrent `continue()` is refused; `active` is untouched because the failed turn never registered.
- **`done` settling**: the recursive `start` shares one `resolve`/`reject`; the inner catch rejects and returns, and the outer catch does not settle again.
- **Identity on the retried context**: the retry re-opens with the previous identity, the threadId must match, so `getSessionId` stays stable; `persist` and `onAccountBinding` run again with identical values — correct for an idempotent host, but the host handler must tolerate a second call (legacy calls it once).
- **Old context**: closed exactly once before the retry opens (WeakMap close dedupe, spec ordering case); at most one live context; old-context events are ignored by the pump guard and the cleared `pending` buffer.
- **No sticky state**: all retry flags live in the `runSdk` closure; a later run starts with full settings.
- **Model rejection**: only a failed terminal event with an error reaches the advice; the pattern gate returns `undefined` for non-model wording; no substitution or retry; redaction and the 200-char excerpt match legacy. Noted divergence: legacy resolved `done` with 1, the lane rejects `done` and closes — deliberate and spec-pinned.
- **Timers**: `withCodexLaneStartupTimeout` clears its timer in `finally`; the startup races are sequential; the fake-timer cases assert zero pending timers.
- **Spec hygiene**: no `any`, `as unknown as`, `@ts-ignore`, `eslint-disable`, or readonly mock assignment in the four files; `setImmediate` waits are awaited; env mutation is restored in `finally`; the `Object.defineProperty` message enrichment is a typed 10b-2b seam.