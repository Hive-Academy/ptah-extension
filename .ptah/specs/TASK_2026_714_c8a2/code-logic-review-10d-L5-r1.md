# Code Logic Review - batch 10d.L5, revision 1

Score: 8/10. Verdict: APPROVED. Blocking 0, Serious 0, Moderate 3.

Scope: the full uncommitted diff (14 files) plus the "Revision 1" section of the lane report. Re-read: `agent-process-manager.service.ts` capture and clear sites, `cli-adapter.interface.ts`, `codex-app-server-lane.adapter.ts`, `codex-lane-events.ts`, `start.ts`, and the two touched specs. No tests, lint, build or diagnostics were run, per the rules.

## B1 (usage scope): closed

- Opt-in is explicit and typed. `SdkHandle.outcomeUsageIsTurnTotal?: true` is declared in `cli-adapter.interface.ts` next to `onSegment`.
- The manager captures usage only when the handle declares it: `agent-process-manager.service.ts:1260` reads `sdkHandle.outcomeUsageIsTurnTotal && segment.usage`. There is no cli-name comparison in this path. The only `cli === ...` hits in the file (`:806`, `:867`, `:3315`) are unrelated.
- Only the native Codex lane sets the flag (`codex-app-server-lane.adapter.ts:541-544`). OpenCode, Copilot, Antigravity, Cursor, Pi, Claude CLI and legacy Codex do not, so their outcome tokens and cost stay NULL, as before this batch.
- The declaration is truthful. `codex-lane-events.ts:143-160` swallows interim `usage` snapshots and emits one usage segment at terminal, so the segment is a terminal per-turn total.
- Continuation: `tracked.outcomeUsage` is cleared at `:2256` before each continued turn, so a resumed turn does not inherit the earlier total.
- The undercount-catching spec is sound. `agent-process-manager.service.spec.ts:1488-1516` emits two step-usage segments (100/20, then 200/40) on an undeclared handle (with `cli: 'codex'`) and asserts the completion context has no `usage`. If the gate were removed, the last-wins value (200/40) would appear and the test would fail. It therefore discriminates the original defect, and it deliberately uses the `codex` cli name to show the name does not matter.
- The positive spec (`:1436-1473`) declares the flag and checks the usage reaches the completion context. The adapter spec checks the flag is set (`codex-app-server-lane.adapter.spec.ts:214-218`).

## S1 (root cause): honestly documented

The report withdraws the causal claim ("does not prove the old throw was caused by early start") and notes that neither test replaces a live Electron boot. That is the correct posture.

The new smoke check (`container.smoke.spec.ts:783-825`) is sound as a sanity check but does not discriminate the move:
- It uses `buildMinimalContainer()` with a key-value state store and no SQLite connection, so it exercises the key-value store branch, not the Electron graph.
- It would very likely pass with the start in the old position as well.
- It does what it claims: the recorder and both classifier aliases resolve, `startAndRegisterLaneOutcomes` does not warn, the disposer exists and `dispose()` resolves. The `toBe` alias checks run before the start, so a throw there fails the test directly.
- The text-order assertion (`:768-780`) remains and is the only guard on position.
- It is cross-platform safe (`path.join(__dirname, ...)`, no OS-specific paths).

Residual: the live Electron log is still the only real evidence. See M1.

## S2 (other hosts): honestly documented

The report records the VS Code order (outcomes started at phase-2 `:268`, no SQLite by design) and the CLI order (SQLite at `container.ts:798`, start at `:799`). It states no same-dependency gap is evident, no edit was made, and the startup logs remain an open observation. I agree with that; this is acceptable under the Electron-first rule.

## M1/M3 (order comment, sibling warnings): closed

- `container.ts:46` carries the comment explaining why the start follows all phases.
- `start.ts` now logs `error: message` plus `stack` in all four catches (cleanup, callback registration, drain, start). `start.spec.ts` asserts message and stack for each, including a new cleanup test, so nothing serializes as `{}`.

## Remaining moderate items

- M1. Live evidence: confirm in the next Electron run that `Lane outcomes start failed` no longer appears in app.log. Until then the reason for the original warning is unknown, and the move may be a no-op.
- M2. Whether Codex "turn" usage from the core is per turn or cumulative across a resumed thread is not established by the code I read (`codex-lane-events.ts:143-146` calls it a "turn snapshot"). If it is cumulative, a resumed lane's row records the thread total, not the last turn. That would still be a valid lane figure, but the field comment ("one turn") should say which.
- M3. Cache-read tokens are still not written to the outcome row (the schema has no column), and the legacy Codex adapter now records NULL tokens even though it emits terminal usage (`codex-cli.adapter.ts:1277-1299`). Both are documented in the report. Opting legacy Codex in later would need the same flag and a spec.

## Verdict

APPROVED, confidence MEDIUM-HIGH. Top risk: the Electron startup warning's cause is unproven and only a live boot can confirm the move fixed it.
