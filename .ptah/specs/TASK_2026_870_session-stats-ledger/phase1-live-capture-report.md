# Phase 1 live capture report (component 2)

## Scope

Live capture only. This lane owns the agent-sdk port, the DI token, the public
exports, and three producer hooks: the owner accepted-result hook, the Codex
checkpoint hook, and the CLI lane completion hook. Persistence files, DI roots,
spec files and PR 2 work belong to other lanes. No JSONL backfill exists
anywhere in this work (user override). No git operations.

## What was implemented

### Port: `libs/backend/agent-sdk/src/lib/session-stats/session-usage-sink.ts`

- Zod schemas `sessionUsageContributionSchema` and
  `sessionUsageModelDeltaSchema` are the single source of truth. All types come
  from `z.infer`. Both schemas are `.strict()`.
- `parseSessionUsageContribution(raw)` does a safe parse and returns null for
  invalid input. It never throws.
- `usdToMicroUsd(value)` converts USD to integer micro-USD. It returns null for
  negative or non-finite input. Unknown cost stays null. It never becomes zero.
- `SessionUsageSink` port: `recordUsage(contribution): void`. Fire and forget.
  The port never throws. The adapter owns the bounded queue, the retry, and the
  logging.
- Constants: `SESSION_USAGE_PRODUCERS` (`sdk-owner`, `codex-checkpoint`,
  `cli-lane`), `SESSION_USAGE_COST_AUTHORITIES` (`provider-reported`,
  `model-priced`, `unpriced`), `MAX_USAGE_MODELS_PER_CONTRIBUTION` (256).
- Token counters are finite and non-negative, not integers. Cost is integer
  micro-USD. Every contribution carries deltas for one accepted event, never
  cumulative values. The `eventKey` makes each contribution idempotent.

### DI token

`SDK_TOKENS.SDK_SESSION_USAGE_SINK` in `libs/backend/agent-sdk/src/lib/di/tokens.ts`.
All three producers inject it with `{ isOptional: true }`. A session stream
works with or without a host binding.

### Producer `sdk-owner` (accepted result hook)

`session-stats-owner.service.ts` captures an accepted turn after the state
update, before any snapshot or RPC effect changes. Per-model turn deltas equal
`subtractRunBase(now)` minus `subtractRunBase(previous)`. The telescoping sums
to `acceptedTurnCost`. The `eventKey` is `${runToken}#${turn}`. A row cost is
null when either side of the delta is unreported. The total authority is
`provider-reported` when the result reported a cost, `model-priced` when the
model priced it, and `unpriced` when the cost is null.

### Producer `codex-checkpoint` (checkpoint hook)

`session-metadata-store.ts` captures per-thread accrued deltas against the
previously stored checkpoint, grouped per model. The total equals the
`nativeCheckpointCost` delta. The `eventKey` is `String(revision)`. A
same-revision price correction uses `${revision}#price#${totalCostMicroUsd ?? 0}`
so a corrected price upserts over the stale row. The capture runs only after
the checkpoint write succeeded. A failed write captures nothing. The next
checkpoint delivery recomputes the same deltas.

### Producer `cli-lane` (lane completion hook)

`agent-process-manager.service.ts` calls `recordLaneUsageOutcome` from
`lane-completion-outcome.ts` next to the existing outcome enqueue. The `eventKey`
is `${agentId}:${completedAt}`, the same identity the notifier dedupe uses. The
usage is the lane's last turn total. Only adapters that set
`outcomeUsageIsTurnTotal` reach this hook. The row cost authority is
`provider-reported` when the lane reported a cost, else `unpriced`.

### Public exports

`libs/backend/agent-sdk/src/index.ts` exports the schemas, the parse helper,
`usdToMicroUsd`, the constants, and all types.

## Cursor and ACP coverage

- The Cursor adapter reports no usage. No hook attaches there. Nothing captured.
- The ACP session update mapper ignores `usage_update`
  (`acp-session-update-mapper`). No hook attaches there. Nothing captured.
- Only the codex-app-server-lane adapter sets `outcomeUsageIsTurnTotal: true`.

An absent figure is never fabricated. `modelId` stays what the lane reported.
No display fallback is inserted.

## Contract deltas versus the first report to the parent

- Per-row `modelId` is `string | null`. Null means an unattributed row. This is
  distinct from a residual row that the adapter derives.
- Token counters are finite and non-negative, not integers. The adapter owns
  the rounding to INTEGER columns.

## Decisions

1. **Token counters are not integers in the port.** Options: integers in the
   port, or finite non-negative in the port with adapter rounding. Evidence:
   the stats owner validates SDK counts as finite non-negative. Integer
   validation in the port would reject a whole accepted turn over a fractional
   count. Reversible: yes, one schema line plus adapter rounding.
2. **Per-row `modelId` is nullable.** Options: require a model id, or allow
   null for unattributed rows. Evidence: Codex threads and CLI lanes can lack a
   model id. A required id would drop real usage. Reversible: yes.
3. **Unknown cost is null, never zero.** Options: null, or zero with an
   authority flag. Evidence: zero is a real measured cost in this ledger. Null
   keeps unknown and zero distinct. Reversible: yes.
4. **Codex price corrections reuse the revision with a price suffix.** Options:
   a new revision number, or a content-derived key. Evidence: the checkpoint
   revision does not change when a price catalog updates. The suffix key keeps
   the upsert idempotent over the stale row. Reversible: yes.
5. **The checkpoint hook captures only after a successful flush.** Options:
   capture before the write, or after. Evidence: capture before the write would
   record deltas that the store never accepted. Reversible: yes.
6. **Every producer wraps the sink call in a synchronous try/catch.** Options:
   trust the adapter contract alone, or add a backstop. Evidence: the port
   contract says the adapter never throws, but a defect in an adapter must not
   break an agent stream. Reversible: yes.
7. **Lane `parentSessionId` goes through `SessionId.safeParse`.** Evidence:
   the field holds a frontend tab id until the SDK uuid resolves. The branded
   `SessionId` type returns the id or null directly. Reversible: yes.

## Integration notes for the persistence and DI-root lanes

1. **The bridge registration is missing and it blocks all live capture.** The
   persistence lane registers `SqliteSessionUsageSink` under
   `PLATFORM_TOKENS.SESSION_USAGE_SINK`
   (`persistence-sqlite/src/lib/session-store/register-session-store.ts:53`).
   Nothing registers `SDK_TOKENS.SDK_SESSION_USAGE_SINK`. A search over `apps/`
   found no match. The producers resolve undefined and capture stays silent.
   Fix at the composition root: after `registerSessionStoreServices`, register
   the same instance under `SDK_TOKENS.SDK_SESSION_USAGE_SINK`. Do this before
   the stats owner and the metadata store singletons resolve, because the
   optional constructor injection happens once at singleton creation.
   Structural compatibility is confirmed. The platform-core interface
   (`platform-core/src/interfaces/session-usage-sink.interface.ts`) is
   field-for-field identical to the agent-sdk port type. Its
   `Promise<void> | void` return satisfies the `void` port signature. Its
   `recordUsage` is synchronous void and never rejects
   (`sqlite-session-usage-sink.ts:59`), so no unhandled rejection can reach a
   producer.
2. **Counter rounding belongs in the adapter.** The adapter validates counters
   with `z.number().int()`
   (`persistence-sqlite/src/lib/session-store/sqlite-session-usage-sink.ts:13`).
   Producers may send finite non-integer counts. The adapter would reject such
   a contribution with a warn log and drop it. Round with `Math.round` before
   the INTEGER columns instead of rejecting.
3. **Adapter duties from the plan.** Stamp `source='live'`. Derive a residual
   row only when a known total exceeds the per-row sum. `model_id` NULL means
   unattributed. Upsert identity is `(session_id, producer, event_key,
   model_id)`.
4. **No JSONL backfill.** The user excluded it permanently. PR 2 owns the
   finalizer and the frontend cleanup.

## Verification

Command: `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/cli-agent-runtime`
(scoped Nx affected lint, test, typecheck).

- typecheck: PASS for both projects.
- `@ptah-extension/cli-agent-runtime`: lint PASS, test PASS (974 tests).
- `@ptah-extension/agent-sdk`: test — 5281 passed, 2 failed. lint — FAIL.

The remaining failures are not from this task:

- The 2 test failures are `fs.symlinkSync` EPERM errors in
  `plugin-loader.service.capabilities.spec.ts` and
  `plugin-loader.service.session-notice.spec.ts`. Windows denies symlink
  creation without admin rights or developer mode. Both spec files are outside
  this task and reference no session-stats code.
- The 1 lint error is `prefer-const` at
  `codex-app-server/codex-chat-turn-stream.ts:142`. The file is identical to
  `main` (`git diff main` is empty for it). It is outside this lane's assigned
  files, so this lane did not edit it.
- The 101 lint warnings are pre-existing (max-lines and non-null assertion
  rules on unchanged files).

### Environment repair made by this lane

The first verify run failed 75 suites at import time. Jest could not resolve
`marked`, because this worktree lacked the `node_modules` junction that every
sibling worktree has. This lane created the junction
`node_modules -> D:\projects\ptah-extension\node_modules`. The second run then
reached the results above. The junction is git-ignored and reversible.

## Files written

- `D:\projects\ptah-extension\.claude-worktrees\session-stats-ledger\libs\backend\agent-sdk\src\lib\session-stats\session-usage-sink.ts` (created)
- `D:\projects\ptah-extension\.claude-worktrees\session-stats-ledger\libs\backend\agent-sdk\src\lib\di\tokens.ts` (modified)
- `D:\projects\ptah-extension\.claude-worktrees\session-stats-ledger\libs\backend\agent-sdk\src\lib\session-stats\session-stats-owner.service.ts` (modified)
- `D:\projects\ptah-extension\.claude-worktrees\session-stats-ledger\libs\backend\agent-sdk\src\lib\session-metadata-store.ts` (modified)
- `D:\projects\ptah-extension\.claude-worktrees\session-stats-ledger\libs\backend\agent-sdk\src\index.ts` (modified)
- `D:\projects\ptah-extension\.claude-worktrees\session-stats-ledger\libs\backend\cli-agent-runtime\src\lib\cli-agents\lane-completion-outcome.ts` (modified)
- `D:\projects\ptah-extension\.claude-worktrees\session-stats-ledger\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.ts` (modified)
- `D:\projects\ptah-extension\.claude-worktrees\session-stats-ledger\.ptah\specs\TASK_2026_870_session-stats-ledger\phase1-live-capture-report.md` (this report)

## Not done

- No spec files. The Tests workstream owns them.
- No persistence, platform-core or DI-root edits. Other lanes own them. The
  bridge registration in note 1 is the one open integration step.
- No git operations, per the lane instruction.