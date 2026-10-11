# Batch 4b executor report

## Task 4b.1 — Generic core schema and suite-kind registry

Status: implemented; targeted TypeScript diagnostics: 0 errors, 0 warnings.

Quality requirements and evidence:

1. Claim provenance is implemented in `scorecard.types.ts:6-21`: source is the required four-value enum, ref is non-empty, and prompt refs retain the `ptah-core-prompt.ts:<line>` validation.
2. Generic `kind`/`details`, registry-backed validation, unknown-kind reporting, and duplicate rejection are in `scorecard.types.ts:42-76` and `suite-kinds.ts:8-48`. `retrieval` is registered as an import side effect in `scorecard.types.ts:3` and `retrieval-suite-kind.ts:4-71`; its fields include tool, questions, all required retrieval metrics, and failures. The isolated test registry and built-in availability are proved in `suite-kinds.spec.ts:7-22`.
3. Ground truth and optional arm are at `scorecard.types.ts:23-29,46`; rater count is positive/integer and frozenAt uses Zod datetime validation.
4. Baselines/deltas, unique baseline IDs, and delta-to-baseline validation are at `scorecard.types.ts:48-55,77-96`; no native special field remains.
5. Cost, nullable latency, nullable error rate, and token breakdown are at `scorecard.types.ts:30-40`. The no-samples rendering regression is `scorecard-writers.spec.ts:106-120`.
6. Top-level artifacts with lowercase 64-hex SHA-256 are at `scorecard.types.ts:146-155`.
7. `run.guardMode` is at `scorecard.types.ts:118`; guard partial/unprobed rules are at `scorecard.types.ts:168-188`; host-exit kinds are at `scorecard.types.ts:129-134`.
8. Types derive from `z.infer` at `scorecard.types.ts:190-191`; legacy hand-written scorecard interfaces are absent.
9. Verdict/NA semantics remain in `scorecard.types.ts:100-110,196-207`, with regression coverage at `scorecard-writers.spec.ts:150-167`.

`run.guardMode` deliberately includes `'not-applied'`: Electron attach mode applies no guard, so this additive value accurately records that mode.

## Task 4b.2 — Validating JSON/Markdown writers

Status: implemented; writers validate every JSON read/write and Markdown rendering path through `scorecardSchema` (`scorecard-writers.ts:7-43`). The Markdown header renders guard mode, partial/unprobed PID/name list, and host-exit kind (`scorecard-writers.ts:45-57`). Each suite dispatches to its kind renderer or the generic table (`scorecard-writers.ts:58-112`); retrieval supplies its renderer (`retrieval-suite-kind.ts:28-71`). Lifecycle and eager-selection tables remain rendered at `scorecard-writers.ts:72-89`.

Required spec cases are covered as follows:

- Two-baseline retrieval round trip: `scorecard-writers.spec.ts:35-97,106-120`.
- Unknown kind, unknown delta baseline, invalid prompt ref, unprobed/partial, and partial/hash rejections: `scorecard-writers.spec.ts:122-148`.
- Duplicate registration and built-in registration: `suite-kinds.spec.ts:7-22`.
- NA reason: `scorecard-writers.spec.ts:150-160`.
- Null latency renders `na`, never zero: `scorecard-writers.spec.ts:106-120`.
- Kind without a renderer uses generic table: `scorecard-writers.spec.ts:168-180`.
- Crash-on-shutdown is rendered at run level and does not alter suite error rate: `scorecard-writers.spec.ts:150-167`.

## Files created or modified

- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\scorecard.types.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\suite-kinds.ts` (created)
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\retrieval-suite-kind.ts` (created)
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\scorecard-writers.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\scorecard-writers.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\suite-kinds.spec.ts` (created)
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\.ptah\specs\TASK_2026_619_af7f\batch-4b-executor-report.md` (this report)

## Verification tails

`npx prettier --write <six scorecard paths>; npx prettier --check <six scorecard paths>`:

```text
Checking formatting...
All matched files use Prettier code style!
```

Forbidden-field/type grep:

```text
grep: no forbidden legacy fields or duplicate scorecard interfaces found
```

`npx nx run-many -t typecheck,lint,test -p mcp-bench` was started and its captured tail was:

```text
NX   Running targets typecheck, lint, test for project mcp-bench:
- mcp-bench
```

It did not produce a completion result within the available command response. A single completion check of the narrower `npx nx run mcp-bench:test --runInBand` also did not complete within 30 seconds (only the Nx Jest deprecation notice was emitted). Therefore no NX target is claimed as passing. The required targeted compiler diagnostics subsequently completed cleanly (0 errors, 0 warnings).

## Anything not done

The requested full NX verification could not be confirmed as passed because the runner did not complete in the available single-check window. No source change outside the permitted scorecard files was needed.

## Revision 1

1. Registry-scoped schemas are now supported. `createScorecardSchema(registry)` is defined at `tools/mcp-bench/src/scorecard/scorecard.types.ts:116`, creates the suite schema with that registry (`:47-115`), and the default `scorecardSchema` uses `defaultSuiteKindRegistry` (`:207`). `readScorecard` and `writeScorecardJson` accept an optional registry with that default at `scorecard-writers.ts:10-27`; Markdown rendering accepts it too (`:33-57`).
2. The registry factory is now `createSuiteKindRegistry()` (`suite-kinds.ts:52-82`). `SuiteView<D>` and generic renderer registration are defined once at `suite-kinds.ts:3-50`; the suite schema is declared as `z.ZodType<SuiteView<unknown>>` (`scorecard.types.ts:45-47`). The retrieval renderer uses the inferred typed details directly, with no cast (`retrieval-suite-kind.ts:28-54`).
3. The mutable exported registered-kinds array was removed. `getRegisteredSuiteKinds()` delegates to the registry and returns its copied list (`suite-kinds.ts:79,99-100`). The copy immutability regression is `suite-kinds.spec.ts:21-25`.
4. Custom-kind isolation and typed rendering are covered in `scorecard-writers.spec.ts:177-195`: the custom kind validates through its isolated registry, is rejected by the default schema, and its typed renderer output is present in Markdown.

Revision 1 verification tails:

```text
Checking formatting...
All matched files use Prettier code style!

√  nx run mcp-bench:typecheck
√  nx run mcp-bench:lint
√  nx run mcp-bench:test

NX   Successfully ran targets typecheck, lint, test for project mcp-bench

Run duration:      1m 15s
```

5. Cost provenance is required by `costSchema` at `scorecard.types.ts:34-45` as `live | cassette | none`. It is displayed by the generic table at `scorecard-writers.ts:127` and the retrieval renderer at `retrieval-suite-kind.ts:43`, with rendering coverage at `scorecard-writers.spec.ts:123,190`.
6. Optional `suite.projectionSha256` is validated as lowercase 64-hex at `scorecard.types.ts:56-59`. `computeProjectionSha256` lives at the cycle-free registry boundary in `suite-kinds.ts:106-155`, using SHA-256 over recursively key-sorted compact JSON and rejecting non-finite numbers, undefined values, and cycles. The stable-order/different-value regression is `suite-kinds.spec.ts:27-47`.

Additional verification tail:

```text
Checking formatting...
All matched files use Prettier code style!

√  nx run mcp-bench:typecheck
√  nx run mcp-bench:lint
√  nx run mcp-bench:test

NX   Successfully ran targets typecheck, lint, test for project mcp-bench
Run duration:      1m 20s
```
