# Code Logic Review, Phase A (PR A: host-built turn recap) — TASK_2026_610_6a10

Score: 5/10. Verdict: REVISE.

Targeted runs (both green, so none of the defects below is caught by the existing specs):
- `libs/shared/src/lib/utils/`: 24 suites, 512 tests passed.
- `libs/frontend/chat/.../organisms/transcript/`: 10 suites, 110 tests passed.

## Defects

1. BLOCKING. A failing test command is reported as "passed".
   - `libs/frontend/chat-execution-tree/src/lib/builders/tool-node.fn.ts:219`: `status: resultEvent ? 'complete' : 'streaming'`. The tool node status is `complete` for any tool_result.
   - The `isError` flag (`libs/shared/src/lib/types/execution/stream.ts:172`) is never read by the tree builder. A grep of `chat-execution-tree/src` finds `isError` only in spec fixtures. The only consumer is the subagent path (`accumulator-core.service.ts:454`).
   - `libs/shared/src/lib/utils/turn-tests.utils.ts:21-22` maps `complete` to passed and `error` to failed.
   - Result: a Bash `npm test` with a non-zero exit (SDK `is_error: true`) becomes `complete` and the row reads "1 passed".
   - The A1 and A4 specs pass because their fixtures hand-build `status: 'error'` nodes, which production never produces for tools.
   - This violates Req 1.6, which requires a truthful outcome, and it misleads the user in the worst direction.
   - Fix: derive the outcome from `toolOutput` and the result's error flag instead of `status`.
     - Either set `node.error` or `status: 'error'` in `tool-node.fn.ts:219` when `resultEvent.isError` is true. Check that tool-call UI consumers tolerate this before changing it.
     - Or carry the flag onto the node and have `outcomeFor` read it. Prefer the single source of truth in the builder.
   - Add a spec that builds the node from a real `tool_result` event with `isError: true`, not a hand-built node.

2. MAJOR. `outcomeFor` ignores the pipeline and `||` exit-code masking.
   - `turn-tests.utils.ts:19-24` and `test-command-matcher.ts` (`splitSegments`).
   - `npm test | tee log` and `npm test || true` are classified as test commands, but the shell exit code belongs to the last segment, so the row says "passed" even when tests failed.
   - Fix: treat a command with a `|` or `||` tail after the test segment as `unknown`.

3. MAJOR. The A5 boundary spec is tautological and does not prove Req 1.5 / 5.12.
   - `libs/frontend/chat/src/lib/services/message-sender.host-data.spec.ts:33-96`.
   - `changeSetStore` is a local `Map` that is never injected into `MessageSenderService`. The sentinels could not reach `chat:continue` even if the sender were broken.
   - It guards nothing against a future dependency from the sender to `ChangeSetStore` or the tests-row data.
   - The frontend spec is a partial boundary only. Req 1.5 / 5.12 hold structurally because the sender never injects those stores.
   - Fix:
     - Provide the real `ChangeSetStore`, populated with the sentinels, in the TestBed.
     - Add a guard test that the sender and query builder have no import path to `anchorTurnTests` or `ChangeSetStore`. A dependency-cruiser or lint rule would do this.

4. MINOR. The A7 registry-baseline contract is unbounded (concern a).
   - `libs/shared/src/lib/types/rpc/host-source-registry.contract.spec.ts:11-21`.
   - It pins 574 lines of the whole RPC and message registry. Every unrelated PR that adds an RPC method or message type breaks it, and the cheap fix is to regenerate the baseline, which makes it noise.
   - Not acceptable as written.
   - Bounded alternative: assert only that no new member matches the Phase-A surface and that the Phase-A feature has not added any.
     - For example, pin the delta against the base: `expect(current.filter(n => !BASELINE.has(n))).toEqual(ALLOWED_ADDITIONS)`, with `ALLOWED_ADDITIONS` listed per task.
     - Or use a deny-pattern check for `turn|recap|tests|ptah-ui|a2ui` names.
   - Drop the "removed" assertion, or limit it to a pinned list of the sources actually touched.

5. MINOR. The A3 `role="status"` and `outcomeClass()` template call (concern d).
   - `libs/frontend/chat-ui/src/lib/molecules/turn-recap/turn-tests-row.component.ts:49-52, 73`.
   - `role="status"` is a polite live region. Historical rows that mount on reload, transcript window paging or the `@defer` swap-in can be announced, and the rows are not live results. Use a plain `<section aria-label>` with no `role="status"` for the historical rows, or apply `role="status"` only to the live one.
   - `outcomeClass(run.outcome)` is a pure method on an OnPush component and is cheap. A computed map or a `[class]` lookup would be cleaner.
   - It does not leak or break anything, so it is minor only.

6. MINOR. The blanket try/catch in `collectTurnTests` and `summarizeTurnTests` (concern c).
   - `turn-tests.utils.ts:34-52 and 56-69`.
   - Nothing in the bodies can throw: they are plain loops over typed input. The catch turns a programmer bug or a malformed node into "no tests ran", so the row silently disappears, which is a silent failure of the Req 1.4 kind.
   - Remove `summarizeTurnTests`'s try/catch. In `collectTurnTests`, keep a guard only around `classifyTestCommand`, which is already guarded, and log the error instead of swallowing it.

7. MINOR. The `incomplete` flag is over-eager.
   - `libs/frontend/chat/.../transcript/transcript-turns.ts:123-128`.
   - Any `error` or `interrupted` root marks a turn incomplete even if every test ran to completion. The label is therefore noisy, and not wrong.

8. MINOR. The anchors are stale across remounts and while hidden.
   - `chat-transcript.component.ts:497-509`.
   - `_frozenTurnTestsAnchors` starts as the empty map. If the transcript mounts while `workActive()` is false, for example a background tab, no row shows until it becomes active. This matches the change-set card behaviour, so it is acceptable, and the reload spec covers the active case.

9. MINOR. Late `git:turnChangeSet` push versus `session:turnEnded` (race).
   - The tests row depends only on the transcript and the streaming boundary, not the push, so there is no race for the row.
   - The card and the row are independent, and the order they appear in can differ when the push is late. This is a visual-only inconsistency.
   - No fix is needed.

10. MINOR. The eager-closure gate passes vacuously if `main.js` is not the output key.
    - `scripts/eager-closure-gate.js:41-44` (`queue = ['main.js']`).
    - If the entry is absent from `outputs`, the closure is empty and the gate passes. It follows the same convention as `electron-only-chunks.js:158-161`. Add a "main.js not found in stats" failure.

## Orchestrator concerns, verdicts

- (a) Not acceptable as written. Defect 4.
- (b) Confirmed defect. Defect 1.
- (c) Defect 6.
- (d) Defect 5.
- (e) The frontend spec is not a sufficient boundary test. Defect 3.

## Other checks

- The Electron gate does not leak into VS Code.
  - The `computed` returns `NO_TURN_TESTS_ANCHORS` when `!vscodeService.isElectron` (`chat-transcript.component.ts:507`).
  - The `chat-transcript.change-set.spec.ts:366` spec covers the "not Electron" case.
  - The `@defer` is lazy, and the A6 gate forbids `turn-recap` in the eager closure.
- A late `session:turnEnded` cannot leave the row stale: the row is derived from finalized messages and the streaming boundary, and the reload spec at `:347` passes.
- Requirements not met: Req 1.6, "outcome is accurate", by defect 1 (the row is accurate only for hand-built fixtures).

## Re-review round 1 (`git diff 36fb24ad9..6d27e3c4f`)

New verdict: APPROVED (score 8/10). No blocking or major defects remain. Two new minor items are below.

### Original defects

- 1 (failing test shown as passed): CLOSED.
  - `tool-node.fn.ts:227` now copies `resultEvent?.isError` onto the node. `node.ts:155-156` adds the field.
  - `turn-tests.utils.ts:22-30`: `isError === true` gives failed, `false` gives passed, and absent gives unknown. The conservative default is correct.
  - `builders.spec.ts` builds the node from a real `tool_result` event with `isError: true`. This is the missing regression test.
  - The fixture in `transcript-turns.spec.ts` now mirrors the builder.
- Replay path (checked specifically): CLOSED, `isError` survives a reload.
  - Backend: `agent-correlation.service.ts:280` sets `isError: block.is_error === true`. `session-replay.service.ts:370, 437` pass it into `createToolResult`, which sets it on the event (`history-event-factory.ts:240`).
  - Frontend: `session-history-replayer.service.ts:209-217` feeds `processStreamEvent`, the same accumulator and `buildToolNode` as live streaming. Live events also set it (`user-message.transformer.ts:60`, `sdk-stream-processor.ts:244`).
  - Retention keeps it: `execution-tree-retention.ts:302` spreads `...node`.
  - The synthetic Task `tool_result` at `session-replay.service.ts:~432` hard-codes `false`, but it applies to Task nodes only, not Bash.
- 2 (masked exits): CLOSED. `hasMaskedTestCommandOutcome` (`test-command-matcher.ts:~181-190`) returns true for a `|` or `||` tail, and `collectTurnTests` yields unknown, with a spec at `turn-tests.utils.spec.ts:69`.
  - Residual: a command like `npm test; true` is not treated as masked. It is minor.
- 3 (A5 spec tautological): CLOSED. The real `ChangeSetStore` is injected and seeded via the public push path, with positive controls and a negative control (`message-sender.host-data.spec.ts`).
- 4 (A7 unbounded): CLOSED. `host-source-registry.contract.spec.ts:17-39` asserts only that no new host-source-shaped names were added. The pattern is sanity-tested against `foo:bar`.
  - Residual: a deny-pattern check is a bounded guard, not an exact pin. It is acceptable.
- 5 (role=status, method call): CLOSED. `turn-tests-row.component.ts` has no `role` and a precomputed `rows()` with a `cls` map. The spec asserts there is no `[role=status]` or `[aria-live]`.
- 6 (try/catch): CLOSED. `turn-tests.utils.ts` has an `Array.isArray` guard only.
- 7, 8 (incomplete flag too eager, frozen anchors) and 9 (race): unchanged. They were judged minor or no-fix, and they stay so.
- 10 (gate vacuous pass): PARTIALLY CLOSED. CI now runs `gate:eager-closure` (`ci.yml:~196-199`). The webview build defaults to production with `statsJson` (`project.json:71, 93`), so the stats exist whenever it is affected. The `main.js` missing-entry check was not added. It is still minor.

### New defects introduced by the fixes

- N1 (minor). `libs/shared/src/lib/types/execution/schemas.ts:~58-64`: `ExecutionNodeSchema` has no `isError`, and a non-strict `z.object` strips unknown keys. A node parsed through this schema loses `isError`, so its run would show unknown. A grep finds no non-spec consumer today. Fix: add `isError: z.boolean().optional()` to the schema.
- N2 (minor). `ci.yml:~196`: the `hashFiles(...) != ''` guard skips the gate silently if the stats file is not emitted, for example after a build config change. Fix: fail when the webview project is in the affected set and the stats file is missing.
- Not a defect, but worth noting: other providers' adapters (for example the Codex and Copilot paths) that omit `isError` render unknown, which is truthful rather than wrong.
