# Batch 1 report — TASK_2026_383

**Batch**: 1 — Degradation contract and reporter (components 1, 2)
**Executor**: `backend-developer`
**Worktree**: `D:/projects/ptah-extension/.claude-worktrees/task-383`, branch `task/383-degradation-audit`
**Status**: COMPLETE — NEEDS REVIEW (`code-style-reviewer`, per the review-gate table)
**Committed**: no. Working tree left dirty for the team-leader.

---

## Files

### Task 1.1 — `DegradationEvent` wire contract

| Action | Path                                                          | Lines                      | What                                                                                                                                                                                                            |
| ------ | ------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CREATE | `libs/shared/src/lib/types/rpc/rpc-degradation.types.ts`      | 1-164                      | The whole contract: two closed unions, their `*_VALUES` arrays, the payload interface, three hand-written narrowing guards.                                                                                     |
| CREATE | `libs/shared/src/lib/types/rpc/rpc-degradation.types.spec.ts` | 1-127                      | 40 guard cases.                                                                                                                                                                                                 |
| MODIFY | `libs/shared/src/index.ts`                                    | +1 at `:56`                | `export * from './lib/types/rpc/rpc-degradation.types';`, immediately after the `rpc-activity.types` line in the `types/rpc/*` block.                                                                           |
| MODIFY | `libs/shared/src/lib/types/messages/message-constants.ts`     | +10 at `:228-237`          | `DEGRADATION_EVENT: 'degradation:event'` with a doc comment, directly below `ACTIVITY_EVENT` (`:227`).                                                                                                          |
| MODIFY | `libs/shared/src/lib/types/messages/payload-map.ts`           | +1 at `:127`, +1 at `:320` | The `import type { DegradationEventPayload }` beside the activity import, **and** the `'degradation:event': DegradationEventPayload;` entry beside `'activity:event'`. Both sites, per shared CLAUDE.md rule 5. |

### Task 1.2 — `DegradationReporter`

| Action | Path                                                                | Lines                                         | What                                                                                                                    |
| ------ | ------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| CREATE | `libs/backend/vscode-core/src/logging/degradation-reporter.ts`      | 1-227                                         | `DegradationReporter`, `MAX_TRACKED_DEGRADATION_CODES = 64`, and the three exported shapes.                             |
| CREATE | `libs/backend/vscode-core/src/logging/degradation-reporter.spec.ts` | 1-236                                         | 13 cases over a hand-rolled container stub.                                                                             |
| MODIFY | `libs/backend/vscode-core/src/di/tokens.ts`                         | +7 at `:181-187`, +1 at `:268`                | `DEGRADATION_REPORTER = Symbol.for('DegradationReporter')` plus its entry in the `TOKENS` object.                       |
| MODIFY | `libs/backend/vscode-core/src/di/register-platform-agnostic.ts`     | `:12`, `:27`, +16 at `:100-115`, +1 at `:135` | Binding, imports, and the registered-services log list. **See deviation D-1** — this is the file, not `di/register.ts`. |
| MODIFY | `libs/backend/vscode-core/src/logging/index.ts`                     | +9 at `:7-15`                                 | Value exports + `export type` for the three interfaces.                                                                 |
| MODIFY | `libs/backend/vscode-core/src/index.ts`                             | +9 at `:7-15`                                 | Same, re-exported from the lib barrel.                                                                                  |

Nothing outside the "Files owned" list was touched. `rpc-handler.ts` /
`ALLOWED_METHOD_PREFIXES` was **not** modified — there is no RPC namespace here,
only a push message type.

---

## The final contract shape

`libs/shared/src/lib/types/rpc/rpc-degradation.types.ts`:

```ts
export type DegradationSource = 'boot' | 'database' | 'auth' | 'settings' | 'harness' | 'sessions' | 'indexing' | 'memory' | 'skills' | 'cron' | 'agent' | 'workspace';

export const DEGRADATION_SOURCE_VALUES = [
  /* the twelve above, in order */
] as const satisfies readonly DegradationSource[];

export type DegradationSeverity = 'expected' | 'degraded' | 'critical';

export const DEGRADATION_SEVERITY_VALUES = ['expected', 'degraded', 'critical'] as const satisfies readonly DegradationSeverity[];

export interface DegradationEventPayload {
  readonly source: DegradationSource;
  /**
   * Stable, dot-namespaced identifier for THIS site, e.g.
   * `'electron.boot.startOrJoin-failed'`. A string literal at the call site,
   * never interpolated.
   */
  readonly code: string;
  readonly severity: DegradationSeverity;
  /** One human sentence, already formatted by the emitter. */
  readonly summary: string;
  /** Epoch ms. */
  readonly timestamp: number;
  /** The varying part of the failure. Never a secret: this crosses to the renderer. */
  readonly detail?: string;
}

export function isDegradationSource(value: unknown): value is DegradationSource;
export function isDegradationSeverity(value: unknown): value is DegradationSeverity;
export function isDegradationEventPayload(value: unknown): value is DegradationEventPayload;
```

Message type: `MESSAGE_TYPES.DEGRADATION_EVENT === 'degradation:event'`, mapped
in `MessagePayloadMap` to `DegradationEventPayload`.

### Decisions a reviewer should check, and why

- **`severity` is `'expected' | 'degraded' | 'critical'`, not a log level.** The
  plan asked for a `DegradationSeverity` union without fixing its members. Log
  levels were rejected because the reporter must not decide severity and the
  boot summary picks `info`/`warn` from the _count_, not from this field — two
  unions with the same member names would invite exactly that confusion.
  `'critical'` is the level Batch 7 needs for "no worker factory, so no backup
  was taken": nothing failed yet, and that is why it must be loud now.
- **`code` carries the site identity; `source` is only the grouping key.** So
  Batch 2's `'electron.boot.startOrJoin-failed'` needs no union widening.
- **The guard rejects an empty `code` but admits an empty `summary`** — the
  deliberate asymmetry with `isActivityEventPayload`, which admits an empty
  summary and has no code at all. A count keyed on `''` is the meaningless
  bucket this contract exists to prevent; an empty summary is merely
  uninformative and a reader falls back to the code. Both are documented in the
  guard's doc comment and pinned by a named spec case each.
- **Hand-written narrowing guard, no Zod.** Follows the `isActivityEventPayload`
  precedent, as instructed. `libs/shared` still imports no `@ptah-extension/*`
  lib — the new file's only imports are its own local ones (it has none).

### Reporter surface

`libs/backend/vscode-core/src/logging/degradation-reporter.ts`:

```ts
export const MAX_TRACKED_DEGRADATION_CODES = 64;

export interface DegradationReport {
  readonly source: DegradationSource;
  readonly code: string;
  readonly severity: DegradationSeverity;
  readonly summary: string;
  readonly detail?: string;
}

export interface DegradationCount {
  readonly code: string;
  readonly source: DegradationSource;
  readonly severity: DegradationSeverity;
  readonly count: number;
  readonly summary: string;
}

export interface DegradationSnapshot {
  readonly total: number;
  readonly entries: readonly DegradationCount[]; // count desc, then code asc
  readonly droppedReports: number;
  readonly broadcastFailures: number;
}

export class DegradationReporter {
  constructor(container: DependencyContainer);
  report(report: DegradationReport): void;
  snapshot(): DegradationSnapshot;
}
```

How each stated rule is met:

- **Never throws.** `report()` calls `tally()` then `broadcast()`. `tally()` is
  pure map arithmetic — no resolution, no I/O, nothing that can throw — so
  "counts even when the broadcast is impossible" holds by construction rather
  than by a catch block. `broadcast()` is entirely inside one swallowing try,
  copied from `activity-emitter.ts:62-94`.
- **No webview manager → still counts.** `container.isRegistered(TOKENS.WEBVIEW_MANAGER)`
  is checked **lazily, per report**, and an unregistered manager returns before
  the tally is affected. Spec: "counts with no webview manager registered".
- **Broadcast rejects → still counts.** `void …broadcastMessage(...).catch(...)`;
  the rejection increments `broadcastFailures` only. Spec: "counts when the
  broadcast rejects".
- **Bounded map.** 64 distinct codes. Past the cap a new code increments
  `droppedReports`; repeats of an already-tracked code still count. One
  `logger.error` fires, latched by `capReported`, so at most one per process.
- **No logging on the hot path.** The cap notice is the only log statement in
  the file, and a spec asserts the logger is untouched by an ordinary report.
- **Never decides severity.** The reporter copies `report.severity` onto the
  payload and the tally and never derives or upgrades it.
- **`DegradationSnapshot.broadcastFailures`** exists so the swallowing catches
  have an honest non-empty body without a log line, and so Batch 2's summary can
  say "and 2 pushes never reached the renderer". This is the one field beyond
  what component 2 specified; it costs nothing and removes the empty-catch that
  Batch 3's `no-empty: allowEmptyCatch: false` would otherwise flag.

---

## Test names added

`libs/shared/src/lib/types/rpc/rpc-degradation.types.spec.ts` (40 assertions):

- `isDegradationSource` — accepts each of the twelve; rejects `'Database'`,
  `'db'`, `'telemetry'`, `''`, `null`, `undefined`, `3`; lists every union member
  exactly once.
- `isDegradationSeverity` — accepts each of the three; "is exactly the three
  documented levels"; rejects `'warn'`, `'error'`, `'info'`, `''`, `null`, `1`.
- `isDegradationEventPayload` — accepts a minimal valid payload; accepts an
  optional detail; "accepts an empty summary, because a reader falls back to the
  code"; **"rejects an empty code, because a count keyed on it means nothing"**;
  rejects twelve malformed shapes (unknown/missing source, missing/non-string
  code, missing severity, a log-level severity, missing/non-string summary, NaN /
  Infinity / string timestamp, non-string detail); rejects five non-objects;
  "rejects a null-prototype object rather than throwing on it"; "is the
  payload-map shape for degradation:event" (compile-time proof the map entry
  landed, plus `MESSAGE_TYPES.DEGRADATION_EVENT`).

`libs/backend/vscode-core/src/logging/degradation-reporter.spec.ts` (13 cases):

- `report` — counts and broadcasts a well-formed payload (asserted **through**
  `isDegradationEventPayload`, so the emitted shape is checked against the
  contract's own guard rather than against a duplicate expectation); omits
  `detail` entirely when the call site gave none; **counts with no webview
  manager registered, and does not throw**; **counts when the broadcast rejects,
  and does not reject**; counts when resolving the webview manager throws; does
  not log on the reporting path; resolves the webview manager per report, not
  once at construction.
- `snapshot` — returns per-code counts, highest first then code order; is empty
  on a boot with no degradations.
- code cap — stops tracking new codes past the cap and counts the drops; still
  counts repeats of an already-tracked code past the cap; logs the cap exactly
  once, at error; does not throw when the cap is hit with no logger registered.

---

## Verification

All three commands run from `D:/projects/ptah-extension/.claude-worktrees/task-383`.

### `npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/vscode-core`

Header read back: **`Running target test for 2 projects`** — the count asked
for. Tail:

```
 NX   Running target test for 2 projects:

- @ptah-extension/shared
- @ptah-extension/vscode-core

> nx run @ptah-extension/shared:test
Test Suites: 56 passed, 56 total
Tests:       1400 passed, 1400 total
Time:        35.124 s

> nx run @ptah-extension/vscode-core:test
Test Suites: 31 passed, 31 total
Tests:       503 passed, 503 total
Time:        52.489 s

 NX   Successfully ran target test for 2 projects
```

Confirmation the new suites are inside those totals, not silently skipped:
`find libs/shared/src -name '*.spec.ts' | wc -l` → **56**, and
`find libs/backend/vscode-core/src -name '*.spec.ts' | wc -l` → **31**. Both
match the "Test Suites" figures exactly, so all 56 / 31 files ran and the two new
ones are among them.

### `npx nx run-many -t lint -p @ptah-extension/shared @ptah-extension/vscode-core`

```
 vscode-core:  ✖ 11 problems (0 errors, 11 warnings)
 shared:       ✖ 2 problems (0 errors, 2 warnings)

 NX   Successfully ran target lint for 2 projects
```

**Zero errors.** All 13 warnings are pre-existing and in files this batch did not
touch: `webview-manager.ts` (4), `logger.ts` (1), `git-info.service.ts` (2),
`ptah-connectors.catalog.ts` (1), `rpc.types.ts` (1) and their `max-lines`
companions. No warning is attributable to a Batch 1 file.

### `npx nx affected -t typecheck`

```
 NX   Running target typecheck for 71 projects failed

Failed tasks:
- api-identity, api-membership, api-notifications, api-community,
  api-marketing, api-licensing, api-learning, api-forum, api-admin,
  api-member-hub, api-billing, ptah-license-server, ptah-landing-page-e2e
```

**These 13 failures are environmental and pre-existing, not caused by this
batch.** Every error is of the form
`Property 'notification' does not exist on type 'PrismaService'` — the generated
Prisma client is gitignored and has not been generated in this worktree
(`ls libs/api/core/src/lib/generated` → _No such file or directory_). Batch 1
touched no file under `libs/api/**` or `libs/web/**`, and `libs/api` cannot
import `libs/shared` production code at all (only the `@ptah-extension/shared/testing`
secondary entry point, which is unchanged).

Scoped re-run over every platform-side project that actually consumes the changed
code:

```
npx nx run-many -t typecheck -p @ptah-extension/shared @ptah-extension/vscode-core \
  @ptah-extension/thoth-runtime @ptah-extension/rpc-handlers \
  ptah-electron ptah-cli ptah-extension-vscode ptah-extension-webview

 NX   Successfully ran target typecheck for 8 projects
```

All three hosts (`ptah-electron`, `ptah-cli`, `ptah-extension-vscode`) and the
webview compile clean against the new contract and the new registration.

---

## Acceptance criteria

| Criterion                                              | Result                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The guard rejects malformed payloads without throwing  | Met — 17 rejection cases + an explicit non-throwing assertion on a null-prototype object.                                                                                                                                                                                 |
| The reporter counts with no webview manager registered | Met — named spec case; `total` is 1, `broadcastFailures` stays 0.                                                                                                                                                                                                         |
| The reporter counts with a rejecting broadcast         | Met — named spec case; `total` is 1, `broadcastFailures` is 1.                                                                                                                                                                                                            |
| `snapshot()` returns per-code counts                   | Met — sorted count-desc / code-asc, with `total`, `droppedReports` and `broadcastFailures`.                                                                                                                                                                               |
| Codes are string literals                              | Met by contract and pinned two ways: the guard rejects an empty code, and the 64-code cap turns an interpolated code into a bounded, loudly-logged failure instead of an unbounded map. Repo-wide enforcement of literal-ness at every call site is Batch 3's audit tool. |

---

## Deviations from `batches.md`

**D-1. The reporter is bound in `di/register-platform-agnostic.ts`, not in
`di/register.ts`.** `batches.md:145` lists `di/register.ts` under files owned.
`register.ts` is the **VS Code-only** entry (`import * as vscode from 'vscode'`
at `:22`) and it delegates to `registerVsCodeCorePlatformAgnostic(container, logger)`
at `:70`. Binding there would have made the reporter invisible to the Electron
and CLI hosts — which are precisely the batches that consume it (Batch 2's boot
summary is Electron, Batch 2's keytar site is `platform-cli`, Batch 7's backup is
runtime-agnostic). The reporter has zero `vscode` surface, so the
platform-agnostic file is the correct single home. `register.ts` is left
unmodified; the binding still reaches VS Code through its existing `:70` call, so
all three hosts get exactly one binding. No file outside the batch's ownership
was touched by this choice.

**D-2. `DegradationSnapshot` carries `broadcastFailures`, which component 2 did
not specify.** Rationale in the reporter section above: it gives the two
swallowing catch blocks an honest non-empty body without putting a log line on
the reporting path, and it is information Batch 2's summary line can use. It is
additive and costs one integer.

Nothing else diverged. No file outside the batch's "Files owned" list was
created or modified.

---

## Notes for the batches that follow

- **Batch 2** injects `TOKENS.DEGRADATION_REPORTER` and calls
  `reporter.snapshot()` at `boot-coordinator.ts:370`. `snapshot().total === 0`
  is the `info`-line condition; `entries` is already sorted for "the top codes
  and counts". The keytar site at `cli-master-key-provider.ts:139` is the
  archetype for `severity: 'expected'` with `source: 'settings'`.
- **Batch 7** wants `severity: 'critical'` with `source: 'database'` for the
  no-worker-factory case. That is the level's stated purpose.
- Widening `DegradationSource` is an ordinary append — add the literal to the
  union **and** to `DEGRADATION_SOURCE_VALUES` together, or the guard silently
  drops the new source. The `satisfies` clause catches a value that is not in
  the union, but not a union member missing from the array.
- The `?? tools/degradation-audit/`, `M .github/workflows/ci.yml` and
  `M eslint.config.mjs` entries in `git status` belong to **Batch 3**, running in
  parallel in the same worktree. They are not Batch 1's, and Batch 1 touched
  none of them.
