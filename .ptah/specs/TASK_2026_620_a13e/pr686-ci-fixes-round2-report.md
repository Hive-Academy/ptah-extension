# PR #686 CI fixes — round 2 report

## 1. Deterministic funnel backlog count

Root cause: the two-day backlog scenario begins at the next UTC midnight after
the real clock. Its weekly drain tick is scheduled only when a simulated day is
a Sunday. The prior fixed expectation of `2 * 96 + 3` therefore passed only
when the window contained Sunday; the comment about an end-of-window daily
drain was incorrect.

Change:

- `tools/mcp-bench/src/memory-skills/suites/skills/funnel-port.ts:35` accepts a
  validated optional clock start, retaining real `Date.now()` as production's
  default.
- `tools/mcp-bench/src/memory-skills/suites/skills/funnel.suite.ts:280-284`
  exposes that clock as a factory test seam; production keeps the default.
- `tools/mcp-bench/src/memory-skills/suites/skills/funnel-lifecycle.spec.ts:197-225`
  pins a Friday start (Saturday/Sunday window, 195 ticks) and a Sunday start
  (Monday/Tuesday window, 194 ticks). Repeated backlog runs now receive unique
  result directories at `:65, :97`.

Result: both forced weekday windows pass in the focused lifecycle spec.

## 2. Thoth gateway push survives close/reopen

Root cause: task 620 added `refreshPaused()` to the `refresh()` `Promise.all`.
The pause reads call `memory:getTriggers` and `skillSynthesis:getSettings`.
When they were absent or slow, the otherwise successful gateway load could not
set `_hasLoadedOnce`; a reopen then fetched the mocked gateway baseline and
overwrote an eager `gateway:statusChanged` push.

Change:

- `libs/frontend/dashboard/src/lib/services/thoth-status.service.ts:272-296`
  starts `refreshPaused()` independently. The primary memory, skills, cron and
  gateway load now sets `_hasLoadedOnce` without waiting for the supplementary
  pause-badge reads. `refreshPaused()` retains its own settled-result and
  generation-safe update behavior.
- `libs/frontend/dashboard/src/lib/services/thoth-status.service.spec.ts:219-263`
  holds both pause reads unresolved, proves the primary gateway load completes
  and `_hasLoadedOnce` becomes true, then proves a two-running-adapter push is
  retained through `refreshIfNeeded()` without a second gateway fetch.

No Electron e2e was run, as required.

## 3. Liveness wording

The assertions already correctly describe current product behavior. Wording now
states that upstream curator fixes `2521773ad`, `aae3e441a`, and `a181ab1b2`
make fault cases (a), (c), and (d) pass, while (b) remains failing; it marks the
pre-fix frozen baseline as historic.

Changed comments and titles:

- `tools/mcp-bench/src/memory-skills/suites/memory/liveness.suite.ts:24-35`
- `tools/mcp-bench/src/memory-skills/suites/memory/liveness.suite.spec.ts:9-12, :310, :370`

## Review note

Production now runs `scheduleProvenance` per routed curator/skill-lane dispatch
because the provenance tap is registered as a no-op. This is harmless: it only
performs the existing provider lookup and queues a guarded no-op microtask.

## Verification

| Command | Result |
| --- | --- |
| `npx jest -c libs/frontend/dashboard/jest.config.ts libs/frontend/dashboard/src/lib/services/thoth-status.service.spec.ts --coverage=false --maxWorkers=2` | PASS — 1 suite, 26 tests |
| `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/suites/skills/funnel-lifecycle.spec.ts --coverage=false --maxWorkers=2` | PASS — 1 suite, 7 tests (both fixed weekday windows) |
| `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/suites/memory/liveness.suite.spec.ts --coverage=false --maxWorkers=2` | PASS — 1 suite, 10 tests |
| `npx nx typecheck @ptah-extension/dashboard --parallel=1` | PASS |
| `npx nx lint @ptah-extension/dashboard --parallel=1` | PASS — 0 errors, 1 existing max-lines warning in `provider-account-card.component.ts` |
| `npx nx typecheck mcp-bench --parallel=1` | PASS |
| `npx nx lint mcp-bench --parallel=1` | PASS — 0 errors, 6 baseline warnings |

Nx Cloud reported its disabled-plan notice during Nx commands; it did not affect
any target result.
