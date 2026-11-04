# Code Logic Review — `TASK_2026_875_af9e`

## Verdict

- Recommendation: APPROVED
- Score: 8/10
- Confidence: HIGH
- Top risk: the markdown cost suite is ~2–2.5× slower (30–47 s locally; 16-level list `timeGrowth` ~8.7 s under load 13). That is still under the pre-existing 120 s per-test timeout, and the bound is a ratio, not an absolute ms ceiling.

Score band: 7–8 is sound. This is an 8 rather than a 9 because `timeGrowth` takes independent mins of each size (not paired same-moment ratios), the 250 ms size-cap sibling outside this describe is untouched, and e2e was not re-run here. It is not a 7: none of the three races can still fire the way CI recorded them, and the new markdown bounds still fail the injected super-linear cases in `fix-markdown-reducer.md`.

## Review family

- Reviewer: grok
- Implementers: codex (agent-pack-download spec), claude (markdown reducer spec); orchestrator applied the marketplace e2e locator edit

Skill load: this lane has no host skill-loading tool. No assigned skill. `ptah_code_search_symbols` returned an empty index (`symbolCount: 0`); structure came from `ptah_ast_analyze`, then native Read/Grep. Tests and builds were not run (results are in the fix-*.md files, per the assignment).

## Findings

None. Scope, checks, and residual uncertainty are under Failure modes.

## Criteria check

1. **Pass.** Each fix removes the recorded cause (arrival-order slot, different-moment wall-clock bound, unscoped locator in a two-node remount window). No new Jest timeouts, retries, or `sleep`. The markdown 120 s per-test timeout and the e2e 10 s `toBeVisible` timeout are pre-existing.
2. **Pass.** `firstHeld` cannot be `b`: `b.installFiles` is not started until after `await gate.firstHeld` (`agent-pack-download.service.spec.ts:841,877,941`). Instance `a` cannot consume a second dest slot while held: `installOne` issues one `readLocal` before the write lock (`agent-pack-download.service.ts:338–355`); `replaceIfBaseline`'s second dest read (`:551`) runs only after `release[0]`, and the tests wait for `allHeld` before any release. Names still match: both dest reads are held before either commit.
3. **Pass.** Offered-char growth over `blockTokens` + `Tokenizer.blockquote` + `Tokenizer.list` is restored in `finally` (`markdown.reducer.spec.ts:888–891`) and file-level `afterEach` restores all mocks (`:172–174`). Time ratio uses equal-duration interleaved samples; a 0 `smallMs` becomes Infinity (fails), not a vacuous pass. Guarded families still assert `lexCalls === 0` before `expectValidResult` (`:1039–1046`). No absolute ms assertion remains in this describe. Injected restart/backtracking in `fix-markdown-reducer.md` failed at 7.9× / 7–10× against bounds 1.5 and 4.
4. **Pass.** Not-found and later title are scoped to `docked-inspector-body` (`marketplace-servers.e2e.spec.ts:401–417`; testid at `docked-inspector.component.ts:67`). `native-drawer-body` is rendered only while `isOpen` (`native-drawer.component.ts:66–115`) and is kept during leave by `animate.leave="ptah-motion-leave"` on the host (`provider-list-view.component.html:143–145`). After `toHaveCount(0)`, the only later detail locator is the scoped title. Leave duration is `--ptah-motion-out: 180ms` (`apps/ptah-extension-webview/src/styles.css:43`).
5. **Pass.** `git diff main --name-status` is exactly the three spec files under `libs/`. No production code in the diff.

## Summary

| Metric              | Value     |
| ------------------- | --------- |
| Overall score       | 8/10      |
| Assessment          | APPROVED  |
| Blocking issues     | 0         |
| Serious issues      | 0         |
| Moderate issues     | 0         |
| Failure modes found | 0         |

## Five logic questions

### 1. How does this fail silently?

No remaining silent pass of the three CI failures:

- Agent-pack: if `b` still reached dest first, `await firstHeld` would not have started `b` yet (`agent-pack-download.service.spec.ts:841`). A hang would still fail the test, not pass it.
- Markdown: a quadratic restart still moves offered-char growth to ~8× (`fix-markdown-reducer.md` 7.88). A regex that the hooks cannot see still moves time growth to 7–10×, above `MAX_TIME_GROWTH = 4` (`markdown.reducer.spec.ts:860,948`). `largeMs === 0` would make growth 0, but `MIN_SAMPLE_MS` forces repeats on sub-10 ms samples (`:912–918`), and a 0 `smallMs` yields Infinity.
- E2E: Playwright strict mode on `server-detail-not-found` is limited to descendants of `docked-inspector-body` (`marketplace-servers.e2e.spec.ts:401–404`).

### 2. What user action produces unexpected behaviour?

None in production (test-only). For tests: starting installer `b` before `a` would still hang, but no test does that. Opening a marketplace detail at compact tier is out of this spec's wide-tier assertion (`:368–372`).

### 3. What input data produces a wrong answer?

Markdown: a guarded family at 1/8 cap that dropped below `MAX_QUOTE_RESTART_COST` would fail `offered > 0` equality (`:942`) rather than pass. Calibration notes the worst guarded family trips the guard at ~4 KiB; `atSize(262_144 / 8)` is 32 KiB (`:1050`). Crafted guarded lines use `k = 8125`, still above `MAX_CONTAINER_PREFIX = 64`.

### 4. What happens when a dependency fails?

- `fs/promises.readFile` of dest is paused after it settles, including ENOENT (`agent-pack-download.service.spec.ts:157–168`), so absent-file A2 cases still hold.
- marked spies wrap the real methods; `offeredChars` restores them in `finally` even when `reduceMarkdown` throws (`markdown.reducer.spec.ts:888–891`).
- E2E `native-drawer-body` `toHaveCount(0)` uses Playwright's default expect timeout (5 s) against a 180 ms leave. A stuck leave would fail the test, not skip the drawer node.

### 5. What is missing that the requirements never mentioned?

- `markdown.reducer.spec.ts:372–377` still has `toBeLessThan(250)` on the O(1) over-cap path, outside the rewritten describe. Same pattern, not seen to fail; out of this task's describe.
- Worktree `node_modules` symlink (D8) is untracked environment state.
- Webview e2e was not executed locally (D3a).

## Failure modes

No remaining failure mode that reproduces the three CI reports.

Scope examined: full current contents of the three spec files; `installFiles` / `installOne` / `commitItem` / `readLocal` / `replaceIfBaseline` in `agent-pack-download.service.ts`; `reduceMarkdown` guards and size cap in `markdown.reducer.ts`; docked inspector testid, native drawer `@if (isOpen())`, provider-list-view docked-vs-drawer branch, marketplace-layout width-0 seed; `git diff main -- libs/`; task `evidence.md`, `decisions.md`, `fix-*.md`.

Residual uncertainty:

- `timeGrowth` (`markdown.reducer.spec.ts:908–926`) stores `min(largeMs)` and `min(smallMs)` independently, so the ratio is not a single paired sample. Linear shapes measured 0.6–1.6× against a bound of 4 under load 9–14, which is the margin against that noise.
- E2E correctness after the locator change is inferred from DOM contracts plus the CI stack trace; this worktree did not run Playwright.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

None that change pass/fail of the three specs. Out of describe, not scored: `markdown.reducer.spec.ts:372–377` absolute 250 ms bound.

## Data flow

### Agent-pack A2 (`holdReads` + two instances)

1. `holdReads` installs `mockReadGate.hold` that pushes resume callbacks in dest-read arrival order and resolves `firstHeld` at slot 1, `allHeld` at `count` (`agent-pack-download.service.spec.ts:814–822`). OK.
2. Test starts only instance `a`. `installFiles` chains per instance (`agent-pack-download.service.ts:290–307`); `installOne` `await readLocal(dest)` (`:338`) then may take `destinationWriteLock` (`:354`). OK.
3. Mock holds that dest read after the real `readFile` settles (`agent-pack-download.service.spec.ts:167`). `firstHeld` fires. `a` cannot reach `replaceIfBaseline`'s second dest read (`agent-pack-download.service.ts:551`) until `release[0]`. OK — `firstHeld` is `a`; `a` cannot steal slot 1.
4. Test starts `b`, waits `allHeld`, then releases slot 0, awaits `a`, releases slot 1 (or both, for two-replace). OK — both paused after initial dest read, matching the test names at `:825`, `:863`, `:923`.

### Markdown cost describe

1. `offeredChars` spies three marked re-entry points, reduces once, sums `src.length`, restores (`markdown.reducer.spec.ts:874–892`). OK for quote-restart re-entry; blind to in-regex backtracking by design (D6).
2. `expectLinearCost` requires the same reducer (and notes when unchanged), same “did we lex?” bit, then offered growth `< 1.5` when lexed, then `timeGrowth < 4` (`:934–948`). OK.
3. Size-cap test spies `blockTokens` and asserts it was not called (`:980–990`); path is `input.length > MAX_OUTLINE_CHARS` (`markdown.reducer.ts:91–93`). OK. No timing.
4. Families capture `lexCalls` before `expectValidResult` (`markdown.reducer.spec.ts:1039–1042`) so the oracle cannot inflate the skip-lexer assertion. OK.

### Marketplace workspace-switch e2e

1. After switch, shell remounts; `MarketplaceLayout` width starts at 0 (`marketplace-layout.ts:60–85`) → compact → drawer branch (`provider-list-view.component.html:129–156`).
2. ResizeObserver reports wide → docked inspector; drawer host keeps `native-drawer-body` for `ptah-motion-leave` (~180 ms). Two `server-detail-not-found` nodes, matching CI.
3. Test waits for docked not-found, then `native-drawer-body` count 0, then scopes `server-detail-title` to the same `dockedBody` locator (`marketplace-servers.e2e.spec.ts:401–417`). OK. No later unscoped detail testid in that test.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Remove real cause; no raised timeouts/retries/sleeps | COMPLETE | Pre-existing 120 s / 10 s timeouts kept |
| A2 tests independent of which instance reads dest first; both paused after read | COMPLETE | Ordering via `firstHeld`, then `allHeld` |
| Markdown bound catches super-linear at 256 KiB cap; machine-speed independent | COMPLETE | Counter + same-shape time ratio; size-cap is spy-only |
| E2E scoped locators; drawer wait; no later two-node window | COMPLETE | Title after reopen is scoped |
| Only test files under `libs/` | COMPLETE | Three specs |

Implicit requirements not addressed: sibling 250 ms bound at `markdown.reducer.spec.ts:372`; product drawer flash on remount (D4, out of scope).

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| `b` dest read arrives first | YES | `b` not started until `firstHeld` | None |
| `a` second dest read (replace re-check) | YES | After `release[0]`; `allHeld` already consumed both slots | None |
| Two-replace slot order | YES | Both released before await; outcomes sorted (`:952–960`) | None |
| Guarded markdown, 0 offered chars | YES | Skip counter; still time-bound; `lexCalls === 0` | None |
| Time sample ~0 ms | YES | `repeats` from `MIN_SAMPLE_MS`; 0 `smallMs` → Infinity | First-sample glitch could inflate `repeats` (residual) |
| Size cap O(1) jitter | YES | No timing on that test (D7) | Sibling 250 ms test remains |
| Drawer + docked both mounted | YES | Scoped docked locator + count 0 | Default 5 s wait vs 180 ms leave |
| Title after reopen | YES | `dockedBody.locator('server-detail-title')` | Wide tier already asserted |

## Decisions

- **Treat `firstHeld` as start-order identity, not mock-side caller IDs.** Options: (1) start `a`, await `firstHeld`, start `b` (implemented); (2) tag each `readFile` caller. Evidence: `installOne` has a single dest read before the lock, so start order is slot order. Reversible: spec-only.
- **Do not fail the markdown suite for independent-min ratio math.** Options: (1) accept `min(large)/min(small)` with bound 4 and measured 1.55 worst linear; (2) require paired per-round ratios. Evidence: injected regressions were 7–10×; five local verify runs passed. Reversible: spec-only.
- **Do not block on e2e being un-run locally.** Options: (1) approve from DOM contracts + CI stack (D3a); (2) REVISE until Playwright is run. Evidence: user rule is CI-only for e2e; locators match the two nodes in the CI error. Reversible: a CI webview-e2e run.

## Verdict (role)

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: markdown suite wall time on a loaded CI runner, still under 120 s per test
- What a robust implementation would add: pair `timeGrowth` per round; drop or spy-only the sibling 250 ms test at `:372`; keep the e2e locators as written
