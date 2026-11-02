# Code Style Review — `TASK_2026_856_d668` (Phase 1)

## Summary

| Metric          | Value          |
| --------------- | -------------- |
| Overall score   | 7/10           |
| Assessment      | NEEDS_REVISION |
| Blocking issues | 0              |
| Serious issues  | 2              |
| Minor issues    | 5              |
| Files reviewed  | 14 (public API surface; specs and consumers skimmed) |

Scope: the Phase 1 public API named in the brief, read in full. Not re-read in full: the consumer component diffs and the spec files. No static-analysis or verification run (read-only review). Imports, `any` and `as unknown as` were grepped in the reviewed files only; none found there.

## Five style questions

1. What breaks in six months? `WallClockService` keeps `Record<WallClockCadence, ...>` maps (wall-clock.service.ts:27-42) and a hard-coded `CADENCES` array (:17). A third cadence needs edits in five places and the record initialisers fail to compile until all are touched. That is loud, so acceptable. The real risk is the token-validity rule: it now lives in at least five places (see Serious 1), so a rule change (for example, whether `NaN`, `Infinity` or negatives are valid) will be applied to some and not others.
2. What would a new team member misread? `contextFillPercent` returns `null` for bad input, but its caller `contextFillStats` coerces it with `?? 0` (live-context-stats.ts:40) and `trustedContextWindow(...) ?? 0` (:33). The `0` sentinel for "unknown" is exactly what the new null-returning API was meant to remove. Also `acquire()` (wall-clock.service.ts:59) is public and returns a release function, while `injectWallClock` is the documented entry point. Nothing says that direct `acquire()` use is discouraged.
3. Maintenance cost? Small and mostly well-contained. The wall-clock service replaces two ad-hoc clocks (`CacheCountdownClockService`, `transcript-live-clock.ts`, 101 lines removed), which is a real net reduction. The cost is the extra shared helpers that partly overlap existing ones.
4. Inconsistent with the repo? `backgroundRevision$` (tab-workspace-partition.service.ts:124) follows the local `$`-suffix signal convention, but the re-export on `TabManagerService` is named `backgroundTabsRevision` with no suffix (tab-manager.service.ts:245), while its siblings are `activeWorkspacePath$` and `removedWorkspace$` (:912, :919). Two names for one signal.
5. What would I do differently? Put one `isNonNegativeFiniteNumber` helper in `shared/utils` and reuse it in the token, CLI and live-stats code. Make `contextFillStats` carry `null` through rather than `0`, or document why `0` must stay for the persisted payload shape. Name the tab-manager re-export to match its source and its siblings.

## Blocking issues

None. No boundary tag change, deep relative import, `eslint-disable`, `any` or double cast was found in the reviewed files. Cross-lib consumers import through `@ptah-extension/*` barrels. `ENHANCED_PROMPTS_RUN_CEILING_MS` is exported through the lib index (agent-generation/src/index.ts:101) and consumed by rpc-handlers via the alias (enhanced-prompts-rpc.handlers.ts:22).

## Serious issues

### 1. Token-validity predicate duplicated across the new helpers and existing ones

- File: libs/shared/src/lib/utils/token-usage.utils.ts:4-6; libs/shared/src/lib/utils/cli-usage.utils.ts:31 and :40-43; libs/shared/src/lib/utils/context-fill.utils.ts:15-17, :44-48
- Problem: the same "finite and non-negative number" rule is open-coded at least four times in the new files, and further copies already exist at libs/shared/src/lib/types/messages/session-stats-live.ts:58, libs/shared/src/lib/utils/turn-sources.utils.ts:53 and libs/shared/src/mcp-apps-contracts/ptah-ui-agents-source.ts:502. The rules have already drifted: `contextFillTokens` accepts negatives and silently counts invalid values as 0 (context-fill.utils.ts:15-17), `sessionTokenTotal` accepts negatives (token-usage.utils.ts:29-30), `messageTokenTotal` rejects them (:20), and `cliUsageTokenTotal` rejects them. So three "token total" helpers disagree on what a valid count is.
- Tradeoff: a shared `isValidTokenCount`-style guard costs one tiny export. It makes the one rule that matters for a metrics-correctness task live in one place. The current `isValidTokenCount` is also non-exported and typed `(value: number)`, so it cannot be reused for `unknown` inputs.
- Recommendation: add one exported guard (for example `isNonNegativeFiniteNumber(value: unknown): value is number`) in a shared util. Use it in all new helpers. Decide deliberately, and document in one place, whether `sessionTokenTotal` and `contextFillTokens` should reject negatives.

### 2. `contextFillStats` re-introduces the 0-sentinel the new null-returning helpers avoid

- File: libs/frontend/chat-state/src/lib/live-context-stats.ts:33, :40
- Problem: `trustedContextWindow` and `contextFillPercent` return `null` for "unknown". This caller immediately collapses both to `0`. The result then flows into `SessionStatsLiveContext`, where `0` and "unknown" are indistinguishable. `contextFillStats` is also newly exported from the `@ptah-extension/chat-state` barrel (index.ts:41), so this behaviour is now public.
- Tradeoff: if the payload type still requires `number`, the coercion is a compatibility choice. It should be stated as such. As written, the next reader cannot tell whether `0` is intended, and the new API's null contract is undermined at the one place it is consumed.
- Recommendation: either widen the payload fields to `number | null` where the payload allows it, or add a one-line comment at :33 and :40 saying `0` means "unknown" by contract, and cite the type that forces it.

## Minor issues

- libs/frontend/chat-state/src/lib/tab-manager.service.ts:245: re-export is `backgroundTabsRevision` while the source is `backgroundRevision$` and the adjacent re-exports keep the `$` (:912, :919). Align the names. The line also grows a 3430-line god file; a one-line passthrough is tolerable, but consumers could inject `TabWorkspacePartitionService` directly, which would avoid the growth.
- libs/frontend/chat-state/src/lib/tab-workspace-partition.service.ts:210, :405, :439, :465: the revision bump is repeated at four mutation sites. A private `bumpRevision()` would make the "every mutation bumps" invariant greppable. This is minor today because the sites are few and local.
- libs/frontend/core/src/lib/services/index.ts:2: the export line is a single unwrapped line, unlike the multi-line export blocks around it. Prettier should own this; run the formatter.
- libs/frontend/core/src/lib/services/wall-clock.service.ts:14-15, :99: the file has doc comments only on `injectWallClock`. `WallClockCadence`, `WALL_CLOCK_COARSE_MS` and the public `now()` / `acquire()` carry none, unlike the commented neighbours. `WALL_CLOCK_COARSE_MS` is exported but used only inside this file (and the barrel); either document why consumers need it or stop exporting it.
- libs/shared/src/lib/utils/context-fill.utils.ts:1 and libs/shared/src/lib/utils/token-usage.utils.ts:2: the new files lack the task-reference header comment that `cli-usage.utils.ts:1-7` uses. Comment density differs slightly from siblings, but the one-line JSDoc per function is adequate. Not worth blocking.

## File-by-file

### libs/frontend/core/src/lib/services/wall-clock.service.ts

Score 8/10 — 0 blocking, 0 serious, 2 minor. Uses `inject()`, `DestroyRef`, signals and `runOutsideAngular`, matching current Angular conventions. Release function is idempotent and the visibility listener is only attached while subscribed (:60-65, :74-76). It does not accumulate per-item timers: there are two intervals total. Public methods lack docs (:55, :59).

### libs/shared/src/lib/utils/token-usage.utils.ts

Score 6/10 — 0 blocking, 1 serious (duplication and drift, Serious 1), 0 minor. `messageTokenTotal` is clear. The private guard at :4 is the right idea but should be shared.

### libs/shared/src/lib/utils/context-fill.utils.ts

Score 7/10 — 0 blocking, 1 serious (shared with Serious 1), 0 minor. `trustedContextWindow` has a clear name and a precise nullable return type; the `source` condition at :34-38 is dense and would read better as two named booleans. Returning an unclamped percent is documented (:41).

### libs/shared/src/lib/utils/cli-usage.utils.ts

Score 7/10 — 0 blocking, 0 serious, 1 minor. `cliUsageTokenTotal` has a good precise return type (`{ value; exact }`), and sits correctly beside its sibling `addCliUsage`. Its inline validity checks (:31, :40-43) repeat the guard rule.

### libs/frontend/chat-state/src/lib/live-context-stats.ts

Score 6/10 — 0 blocking, 1 serious (Serious 2), 0 minor. Good reuse of the shared helpers, which removes the previously inlined trust check.

### libs/frontend/chat-state/src/lib/tab-manager.service.ts and tab-workspace-partition.service.ts

Score 7/10 — 0 blocking, 0 serious, 2 minor. The revision signal lives in the partition service, where the background state is owned, and the tab manager adds one line only. Naming and repetition notes above.

### libs/shared RPC types (rpc-session.types.ts:387-393, rpc-setup.types.ts:534)

Score 8/10 — 0 blocking, 0 serious, 0 minor. Both additions are optional, `readonly` where siblings are, and documented with their absence semantics. Both files are existing large type files; additions are small and local.

### agent-generation `ENHANCED_PROMPTS_RUN_CEILING_MS`

Score 8/10 — 0 blocking, 0 serious, 0 minor. SCREAMING_SNAKE name with `_MS` unit suffix matches the neighbouring constants (`PROMPT_DESIGNER_TIMEOUT_MS`); exported via the barrel chain. The derivation from named constants is easy to follow.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| Cross-lib imports go through `@ptah-extension/*` barrels | PASS | enhanced-prompts-rpc.handlers.ts:22; live-context-stats.ts:1-6 |
| No `any`, `as unknown as`, or `@ts-ignore` in new API | PASS | grep of reviewed files |
| Kebab-case filenames with role suffix | PASS | `wall-clock.service.ts`, `token-usage.utils.ts`, `context-fill.utils.ts` |
| Angular `inject()`, signals, `DestroyRef` cleanup | PASS | wall-clock.service.ts:25-26, :103-113 |
| Timer and listener have a release path | PASS | wall-clock.service.ts:68-77, :90-95 |
| Public API exported through the lib barrel | PASS | services/index.ts:2; utils/index.ts:89-98; chat-state index.ts:41 |
| Signal naming uses the `$` suffix for service-exposed signals | FAIL | tab-manager.service.ts:245 vs :912, :919 |
| New code does not grow `tab-manager.service.ts` | PARTIAL | one line added at :245 |
| One shared definition of a repeated validation rule | FAIL | Serious 1 |
| Injected Logger instead of console | NOT_APPLICABLE | none of the reviewed new API logs |

## Maintenance debt

- Introduced: a fourth and fifth copy of the finite/non-negative number check; a second name for one signal; a public `acquire()` beside the intended `injectWallClock`.
- Retired: `CacheCountdownClockService`, `transcript-live-clock.ts` (about 100 lines and two separate timer owners), and an inlined context-window trust check in `live-context-stats.ts`.
- Net: favourable. Consolidation outweighs the duplication, but the validation rule should be unified before more call sites copy it.

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM
- Key concern: the token-count validity rule is re-implemented with differing semantics across the new helpers and their neighbours, and `contextFillStats` converts the new `null` "unknown" back into `0`.
- What a 10/10 version would do differently:
  - One exported finite/non-negative guard used by every token helper, with an explicit and tested decision on negatives.
  - Carry `null` through `contextFillStats`, or document the `0` contract at the lines that coerce it.
  - Match the `$` suffix on the `TabManagerService` re-export (or have consumers inject the partition service directly).
  - Add one-line docs to `WallClockCadence`, `now()` and `acquire()`, and decide whether `WALL_CLOCK_COARSE_MS` needs to be public.
  - Centralise the revision bump in one private method on the partition service.
