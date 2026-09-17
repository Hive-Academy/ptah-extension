# Code Style Review — `TASK_2026_437_0778` Batch 22 (AC-11 tile-open perf e2e)

## Summary

| Metric          | Value    |
| --------------- | -------- |
| Overall score   | 7/10     |
| Assessment      | APPROVED |
| Blocking issues | 0        |
| Serious issues  | 1        |
| Minor issues    | 3        |
| Files reviewed  | 2        |

## Five style questions

### 1. What breaks when requirements change in six months?

If a second env-gated Playwright perf spec is added next to this one, the `.perf.spec.ts` suffix

- `PTAH_PERF_SPECS` combination introduced here (`tile-open-longtask-budget.perf.spec.ts:83`,
  `:341`) becomes the pattern a future author copies — but the two existing precedents in this same
  project, `src/specs/perf/startup-tti.spec.ts` and `src/specs/git/perf-m1-diff-redisplay.spec.ts`,
  use neither a `.perf.` suffix nor a shared gating env var. A reader who greps for `perf` specs in
  this project six months from now finds three different naming/location/gating shapes for the same
  kind of spec, and has no single place that says which one is current.

### 2. What would a new team member misread here?

They would read the block comment at `tile-open-longtask-budget.perf.spec.ts:1-46` (and the
mirrored explanation in `test-report-b22.md`, "Gating" section) and reasonably conclude the
`.perf.spec.ts` suffix is this project's established Playwright-perf convention, because the
comment cites the Jest-side convention as justification but never mentions that `src/specs/perf/`
already exists in this same project with two specs that don't use the suffix. Nothing in the new
file or in `apps/ptah-electron-e2e/CLAUDE.md` points a reader at `src/specs/perf/` at all — the new
spec was filed under `src/specs/chat/` instead, next to non-perf chat specs
(`compaction-duplicate-session.spec.ts`, `streaming-message-handlers.spec.ts`,
`empty-assistant-envelope.spec.ts`).

### 3. What does this cost to maintain?

Low. The fixture builder (`buildLargeSessionEvents`, lines 105-190) is self-contained and doesn't
touch shared production code; the fixture-shape duplication against `largeFixture` in
`message-finalization.session-history.spec.ts` is deliberate and documented (header comment,
`tile-open-longtask-budget.perf.spec.ts:34-40`) because the two need different output shapes (flat
RPC-resume array vs. `HistoryFixture`/`StreamingState`) — importing across the Playwright/Jest
project boundary isn't available here anyway, so this isn't an avoidable duplication. The main
ongoing cost is the one named above: a third naming/location convention for the same spec category
inside one project.

### 4. Where is this inconsistent with the rest of the repository?

- File location/naming: `apps/ptah-electron-e2e/src/specs/perf/startup-tti.spec.ts` and
  `apps/ptah-electron-e2e/src/specs/git/perf-m1-diff-redisplay.spec.ts` are this project's own
  precedent for a Playwright perf spec — plain `.spec.ts`, either in a dedicated `perf/` folder or
  prefixed `perf-` and colocated with its feature. The new file does neither: it's suffixed
  `.perf.spec.ts` (a convention borrowed wholesale from Jest-side specs in `agent-sdk`,
  `platform-electron`, `skill-synthesis-ui`, none of which are Playwright) and lives in `chat/`
  alongside non-perf specs. Mechanically harmless — `playwright.config.ts:20` `testMatch:
['**/*.spec.ts']` picks up any `*.spec.ts` regardless of subfolder or infix — but it is a third
  shape for the same kind of spec in one project, see Q1/Q2.
- Gating: `PTAH_PERF_SPECS` (line 83) is a good match for the Jest-side convention (`agent-sdk`,
  `platform-electron`, `skill-synthesis-ui` all gate `.perf.spec.ts` files behind it) and is a
  better choice than reusing the one existing Playwright gate,
  `PTAH_E2E_SKILL_TELEMETRY` (`thoth/skill-telemetry.spec.ts:39`), which is a single-purpose flag
  for that spec, not a generic "perf spec" gate. This part of the file is the right call and is
  called out correctly in `test-report-b22.md`'s "Gating" section.

### 5. What would you have done differently, and why is that better rather than merely other?

Either (a) put the file in `src/specs/perf/` next to `startup-tti.spec.ts`, matching this project's
own precedent for where a Playwright perf spec lives, or (b) if `chat/` is deliberately chosen
because the spec is chat/canvas-specific (a legitimate reason — `perf-m1-diff-redisplay.spec.ts`
is filed under `git/` for the same reason), add one sentence to `apps/ptah-electron-e2e/CLAUDE.md`'s
"Specs" section recording that `.perf.spec.ts` + `PTAH_PERF_SPECS` is now this project's convention
for a budget-gated Playwright perf spec, wherever it's filed, so the next author doesn't have to
reverse-engineer it from three examples. Doing nothing leaves the ambiguity for the next perf spec
to resolve or ignore.

## Blocking issues

None.

## Serious issues

### Playwright perf-spec convention diverges from this project's own precedent without updating the doc that would carry it

- File: `apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts:1-46`
- Problem: The header comment justifies the `.perf.spec.ts` naming by pointing across the
  Playwright/Jest boundary to `off-thread-process-spawner.perf.spec.ts` and siblings, but doesn't
  acknowledge or reconcile with this project's own two existing Playwright perf specs
  (`src/specs/perf/startup-tti.spec.ts`, `src/specs/git/perf-m1-diff-redisplay.spec.ts`), which use
  plain `.spec.ts` names and no shared env-var convention. `apps/ptah-electron-e2e/CLAUDE.md`'s
  "Specs" section (one line: "auto-updater, clipboard, ... startup config, state") doesn't mention
  perf specs at all, so there is no canonical place recording which of the three shapes is current.
- Tradeoff: leaving it as-is costs nothing today (the spec runs, is correctly gated, and is
  mechanically indistinguishable from any other `*.spec.ts` to the runner), but the next Playwright
  perf spec author has three precedents to choose from with no tiebreaker, which is exactly the kind
  of drift this repo's own `CLAUDE.md` module-index pattern (one line per lib/app documenting its
  real shape) exists to prevent.
- Recommendation: add one line to `apps/ptah-electron-e2e/CLAUDE.md` naming `.perf.spec.ts` +
  `PTAH_PERF_SPECS` as the convention for a budget-gated perf spec (mirroring the Jest-side
  convention), and note where such specs are filed (feature folder vs. `perf/`). This is a doc
  change, not a rename, so it doesn't require touching `startup-tti.spec.ts` or
  `perf-m1-diff-redisplay.spec.ts` retroactively.

## Minor issues

- `apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts:341-360`: the
  per-entry `console.log` inside the loop (one line per long task, up to ~35 lines per the test
  report's run 3) is verbose for CI log output on every gated run; the summary line above it
  (`wall=…longTasks=…max=…total=…`) already carries the numbers the budgets check. Not a blocker
  since the spec only runs under `PTAH_PERF_SPECS=1`, not in default CI.
- `apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts:75-79`: the two
  budget constants are named and commented well (`MAX_SINGLE_LONG_TASK_MS`,
  `MAX_TOTAL_BLOCKED_MS`), but `TARGET_EVENTS_PER_SESSION = 2_000` (line 81) sits between them
  without the same "AC-11:" comment prefix the budget constants get — a reader skimming just the
  comments could miss that 2,000 is also an AC-11-sourced number, not an arbitrary fixture size.
- `apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts:56-64`: `makeRand`
  re-implements the same LCG shape as `largeFixture`'s inline `rand` in
  `message-finalization.session-history.spec.ts:257-260`, with different constants and a
  different seed source (string hash vs. fixed `0x437`). Both are documented as deliberately
  independent (this file's header, "Fixture" section), so this is a note, not a finding requiring
  action.

## File-by-file

### tile-open-longtask-budget.perf.spec.ts

Score 7/10 — 0 blocking, 1 serious, 2 minor. Correct against AC-11 as written, reuses the right
harness primitives (`ui.mockRpc`, `ui.pushEvent`, `ui.goto('canvas')`), documents every
non-obvious choice (why 3 sessions, why `canvas` not `chat`, why the metadata-changed push) with
citations to the exact production code paths it relies on. Its one real cost is introducing a third
naming/gating shape for a Playwright perf spec in a project that already had two, without updating
the doc that would have made the choice discoverable.

### test-report-b22.md

Score 8/10 — 0 blocking, 0 serious, 1 minor. Honest and unflattering where it needed to be (AC-11
is reported as NOT met, the budget was not loosened, run 2's intermediate numbers are flagged as
lost rather than silently omitted). The "Gating" section's claim that `PTAH_E2E_SKILL_TELEMETRY` is
"the only prior env-gated-skip pattern in this project's e2e suite" checks out against
`git-watcher.spec.ts:61`, whose `test.skip(true, …)` is unconditional, not env-gated. Minor: the
report doesn't flag the `startup-tti.spec.ts` / `perf-m1-diff-redisplay.spec.ts` naming precedent
that the code-style review above treats as the batch's one real style gap — a report reviewing
"how the measurement works" is a reasonable place to have raised it alongside the Jest-convention
justification it does give.

## Pattern compliance

| Repository rule or nearby convention                                                    | Status                     | Evidence                                                                                                                                   |
| --------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `testMatch: ['**/*.spec.ts']` picks up any spec regardless of name/folder               | PASS                       | `playwright.config.ts:20`; new file is `*.spec.ts`                                                                                         |
| New launch/mock helpers added to `src/support/`, not inlined                            | PASS                       | Spec uses `ui.mockRpc`/`ui.pushEvent`/`ui.goto` from fixtures only; no inline `_electron.launch`                                           |
| Env-gated skip pattern (existing e2e precedent: `PTAH_E2E_SKILL_TELEMETRY`)             | PASS (new var, same shape) | `tile-open-longtask-budget.perf.spec.ts:83` vs. `thoth/skill-telemetry.spec.ts:39`                                                         |
| Project's own Playwright perf-spec naming precedent (`perf/` folder or `perf-*` prefix) | FAIL                       | `src/specs/perf/startup-tti.spec.ts`, `src/specs/git/perf-m1-diff-redisplay.spec.ts` vs. new `chat/tile-open-longtask-budget.perf.spec.ts` |
| `catch (error: unknown)` / type safety at boundaries                                    | NOT_APPLICABLE             | No error handling in this spec; all values are typed inline (`GeneratedEvent`, `LongTaskEntry`)                                            |
| File-size soft ceiling (~700 lines)                                                     | PASS                       | New spec is 378 lines                                                                                                                      |
| No `@ts-ignore` without `@ts-expect-error` + reason                                     | PASS                       | None present                                                                                                                               |

## Maintenance debt

- Introduced: one Playwright e2e spec proving/disproving AC-11 end-to-end, gated and reusable; one
  more naming/gating shape for "Playwright perf spec" in a project that already had two.
- Retired: nothing.
- Net: positive for AC-11 coverage; slightly negative for spec-naming consistency inside
  `ptah-electron-e2e`, fixable with a one-line doc addition rather than a rewrite.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: the new `.perf.spec.ts` + `PTAH_PERF_SPECS` shape is a good pattern in isolation but
  is the third distinct convention for a Playwright perf spec in this one project, and nothing
  records which is now canonical.
- What a 10/10 version would do differently: add the one-line convention note to
  `apps/ptah-electron-e2e/CLAUDE.md` described in the Serious issue above, and either file the spec
  under `src/specs/perf/` or state in the header comment why `chat/` was chosen instead (the way
  `perf-m1-diff-redisplay.spec.ts` implicitly justifies `git/` by being git-diff-specific).
