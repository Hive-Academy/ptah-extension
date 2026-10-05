# Backend implementation — `TASK_2026_596_0a19`, batch 2

**Tasks completed**: 2.1 (`instants.ts`), 2.2 (`evidence-precedence.ts` + plan-limits barrel + utils barrel), 2.3 (`addCliUsage` fold)

## Files

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\plan-limits\instants.ts`: `normaliseInstant`, `parseRetryAfterDeadline`, `resolveClockTimeReset`, `resolveRelativeReset`, `windowKindFromDuration` (+ `PlanWindowDescriptor` type)
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\plan-limits\instants.spec.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\plan-limits\evidence-precedence.ts`: `supersedes(next, prev, lastResetAt?)`, `PlanLimitEvidenceStamp`, the constants `NEAR_LIMIT_PERCENT = 90`, `FRESHNESS_MS = 900_000` and `LIMIT_LOOKUP_DEADLINE_MS = 3_000`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\plan-limits\evidence-precedence.spec.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\plan-limits\index.ts`: plan-limits barrel with explicit named exports (17 lines)
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\cli-usage.utils.ts`: `addCliUsage(total, usage)` and `CliUsageTotals`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\cli-usage.utils.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\shared\src\lib\utils\index.ts`: adds named exports for `cli-usage.utils` and `plan-limits` (58 lines, within the 150-line limit). `libs/shared/src/index.ts` already re-exports `./lib/utils` (line 57), so the root barrel needed no change.

I did not edit `stats-bar.utils.ts`, `batches.md` or any settings file, and I ran no git commands.

## Stack observed

- Nx library `@ptah-extension/shared`, with these targets: typecheck (`tsc --noEmit -p tsconfig.lib.json`), jest test (`ts-jest`, node env) and eslint (`libs/shared/project.json`). TS target and lib are ES2022 (`tsconfig.base.json:11-13`), so `matchAll` and regex lookbehind are available.
- Barrel rules are explicit named exports with a maximum of 150 lines (`CONVENTIONS.md` §3). The new barrels follow them.
- Pure util precedent: `libs/shared/src/lib/utils/pricing.utils.ts`. The code is zod-free and uses relative type imports from `../../types/plan-limit.types` (Batch 1) and `../types/agent-process.types`.

## Per-task evidence

### Task 2.1: `instants.ts`

- `normaliseInstant(value: unknown)`: a number or numeric string below `1e11` is read as seconds; at or above it, as milliseconds. An ISO-8601 string (it must start with `YYYY-MM-DD`) is parsed, and a zone-less date-time is read as UTC (a `Z` is appended) rather than in the host zone. A valid `Date` is accepted. It returns `undefined` for non-positive, non-finite or unparseable input and for unsupported types.
- `parseRetryAfterDeadline(header, now)`: accepts delta-seconds (digits only) relative to `now`, or an HTTP-date in IMF-fixdate, RFC 850 (`…GMT`) or asctime form (read as GMT). The result is **unclamped**, and a past date is returned as stated. It returns `undefined` for an absent, blank, negative, fractional or zone-less date header, or when `now` is not finite.
- `resolveClockTimeReset(text, observedAt, timeZone?)`: finds the first clock time in the text (`17:05`, `5:05 PM`, `2am`, `12 a.m.`, `09:00:30`). A bare number with neither minutes nor AM/PM is skipped, so in "5-hour … resets 2am" the 2am is used. It returns the next occurrence strictly after `observedAt` in the IANA zone; with no zone given it uses the host zone. Zone offsets come from `Intl.DateTimeFormat.formatToParts` with a two-pass DST correction. An unknown zone (Intl `RangeError`, caught) or a hour/minute out of range gives `undefined`.
- `resolveRelativeReset(text, observedAt)`: parses compact `[Nd][Nh][Nm][N(.N)s]` in that order, ignoring whitespace. `ms`, a missing unit or parts out of order give `undefined`.
- `windowKindFromDuration(durationMins, position)`: 300 maps to `five_hour` ("5-hour session"), 10080 to `weekly` ("Weekly"), and 43200 or 44640 to `monthly` ("Monthly"). Any other duration, or none, maps to `other`, with key `other:window-N` and label "Window N" taken from the 1-based position (plan `:733`, Req 2.3). An invalid position falls back to "Window".

### Task 2.2: `evidence-precedence.ts` and the barrels

- `supersedes(next, prev, lastResetAt?)` applies to one allowance. Rules, in order:
  1. `estimated` never supersedes non-estimated evidence observed at or after `lastResetAt`. When `lastResetAt` is unknown, the real evidence is kept.
  2. Stale, non-exhausted data never clears a `stream-event`/`error-derived` exhaustion that is at least as new.
  3. Otherwise the newer `observedAt` wins. When the instants are equal, only fresh evidence replaces stale.
- Edge handling: when nothing is held, any evidence with a finite instant is taken. Evidence with a non-finite instant never supersedes.
- Staleness is passed in by the caller (`stale?: boolean`), so the function needs no clock.

### Task 2.3: `addCliUsage`

- Semantics match `stats-bar.utils.ts:38-62`:
  - token fields are summed only when reported, so they stay absent rather than 0;
  - model, cost and duration take the latest reported value;
  - a report with no defined field returns `total` unchanged (same reference);
  - the result stays `null` until any usage is seen;
  - the input is never mutated.
- Oracle: all `extractCliAgentStats` cases from `stats-bar.utils.spec.ts` (3 cases) and the 5 pure cases from `stats-accumulation.spec.ts` are ported, via `reduce(addCliUsage, null)`.
- New cases:
  - fold-before-cap equivalence at every cut point 1-5 over a mixed list (including a `text` segment without usage and an empty `{}` usage);
  - order sensitivity is limited to the latest-wins fields;
  - the running total is not mutated and the unchanged-reference behaviour holds.

## Fixtures covered

| Fixture | Spec | Case |
| --- | --- | --- |
| F1 | instants.spec.ts | seconds, ms, `Z` ISO and `+02:00` ISO all equal `NOW` |
| F5 | instants.spec.ts | `00:10` at 23:50 UTC rolls to the next day; the same in Europe/Berlin (zone-local midnight); plus a DST-change case (25 Oct 2026, CEST→CET) |
| F6 | instants.spec.ts | `144h24m50s` → `NOW + 144h + 24m + 50s` |
| F7 | instants.spec.ts | `"120"` → `NOW + 120 s`; `"0"` → `NOW` |
| F8 | instants.spec.ts | IMF-fixdate, RFC 850 and asctime → `2026-10-21T07:28Z` |
| F9 | instants.spec.ts | absent, null, empty, blank, prose, negative, fractional, zone-less date and malformed date headers, plus a NaN `now`, all give `undefined` |
| F10 | instants.spec.ts | `"604800"` → exactly `NOW + 7 d`; an HTTP-date 7 d out is also unclamped |
| F12 | instants.spec.ts | 300/10080/43200/44640 kinds; `null`/`undefined` → "Window 1"/"Window 2"; an undeclared 60 min → positional |
| F21 | evidence-precedence.spec.ts | one `describe` per rule (newer non-stale wins; estimated vs post-reset real; stale API vs newer live exhaustion), each with positive and contrasting cases |

## Verification

- `npx prettier --write` on all new and modified files.
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared --parallel=2` →
  `Successfully ran targets typecheck, test, lint for project @ptah-extension/shared`. The Nx Cloud 401 notice is unrelated: the organisation plan is disabled, and the run was local.
- `npx jest -c libs/shared/jest.config.ts plan-limits cli-usage --coverage=false --maxWorkers=2` →
  `Test Suites: 3 passed, 3 total; Tests: 89 passed, 89 total`. This confirms the new specs actually run.
- `grep -rn "Date.now" libs/shared/src/lib/utils/plan-limits` → no matches.
- Every created source file has a `.spec.ts` beside it. The `plan-limits/index.ts` barrel is covered by typecheck.

## Risks and edge cases handled

- **Seconds vs ms vs ISO (F1)**: one `1e11` threshold, shared by numbers and numeric strings. Zone-less ISO is read as UTC so results do not depend on the host zone.
- **Seven-day Retry-After stays 7 d (F10)**: there is no clamp anywhere in the parser. `parseRetryAfterDeadline` returns a plain deadline with no window kind, and `windowKindFromDuration` requires a declared duration, so a cooldown cannot be classified as a weekly reset. The existing clamping store (`provider-quota.store.ts`) is untouched.
- **Clock time across midnight and relative `144h24m50s` (F5, F6)**: handled with a strict "after observation" rule, zone-local day arithmetic and DST correction.
- **Never throws**: all entry points guard their types and finiteness. The only throwing dependency (`Intl` with an unknown zone) is caught and returns `undefined`.
- **Injected clock**: every function takes `now`/`observedAt`. There is no `Date.now()` in `plan-limits/`, and staleness for `supersedes` comes from the caller.
- **Unknown never 0 (Decision 8)**: `addCliUsage` leaves fields no report carried absent, and returns `null` until usage is seen.
- **R5 (shared hotspot `stats-bar.utils.ts`)**: not edited. Delegating to `addCliUsage` is Batch 20's job.
- **Zod-free shared**: no zod import. The code uses the Batch 1 types `PlanLimitSource`, `PlanWindowKind` and `PlanWindowKey`.

## Plan deviations

- `windowKindFromDuration` takes a second `position` argument and returns `{kind, key, label}` rather than only a kind. This is the plan's "labelled by position" (`:535`, `:733`, F12), which needs the position.
- The constants live in `evidence-precedence.ts`, because Task 2.2 names them there and lists no separate constants file. They are re-exported through the plan-limits barrel.
- `supersedes` takes `lastResetAt` as optional. When it is unknown, real evidence is protected from estimates (the conservative reading of Decision 4).

## Out-of-scope observations

- Rule 2 (stale vs newer live exhaustion) gives the same result as plain recency ordering under the current tie-break. It is kept as an explicit guard so the rule holds independently of the tie-break, and it is pinned by its own F21 fixtures. Batch 3/8 callers must stamp stale data with its original `observedAt` (not the time it was re-served) for the rule to mean what Decision 4 intends.
