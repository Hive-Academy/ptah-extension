# Implementation Plan - TASK_2026_463_f13d

Four independent follow-ups from TASK_2026_437. All paths below are relative to the worktree
`D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers` unless absolute.
`S437` = `.ptah/specs/TASK_2026_437_0778/`.

## Inputs and constraints

- Requirements used: `context.md` (this folder); `S437/handoff.md` §5-§9; `S437/batches.md`
  Batch 10, 16, 16b; `leftovers-inventory.md` (TASK_2026_453 worktree) Table A + grouping;
  root `CLAUDE.md`; `libs/backend/agent-sdk/CLAUDE.md:87-88`.
- Corrections applied: none.
- Design handoff used: none (no UI).
- Missing decision-critical input: none. Two naming/threshold choices were settled from source,
  not asked:
  - Input name `dry-run` (hyphen, boolean) instead of the user's `dry_run`, because the one
    existing release workflow with this toggle uses `dry-run` (`.github/workflows/publish-cli.yml:49-53`,
    `:387`, `:394`). If the user wants the underscore spelling, it is a rename of one input and its
    references. Nothing else changes.
  - Background cap at `limit = 1` is `1`, not `0` (see Component 2, decision D2-c).
- Task type: `DEVOPS`. There is no `CHORE` type (`libs/shared/src/lib/types/task-spec.types.ts:22-32`).

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| The CI skip guard is `!startsWith(github.head_ref, 'chore/bump-')` in three jobs | `.github/workflows/ci.yml:46-49`, `electron-e2e.yml:42-45`, `vscode-e2e.yml:54-57` | Three identical `if:` blocks. Comments at `ci.yml:41-45`, `electron-e2e.yml:40-41`, `vscode-e2e.yml:52-53` name `chore/bump-*`. |
| Bot branch names: `chore/bump-cli-v${VERSION}`, `chore/bump-electron-v${VERSION}`, `chore/bump-extension-v${VERSION}` | `publish-cli.yml:401`, `publish-electron.yml:657`, `publish-extension.yml:226` | These are the only three `gh pr create` sites in `.github/workflows` (`publish-cli.yml:416`, `publish-electron.yml:680`, `publish-extension.yml:247`). The narrow guard uses exactly these three prefixes. |
| `cli-e2e.yml` and `webview-e2e.yml` have no bump guard | grep of `chore/bump` across `.github/workflows` | Out of scope. Left unchanged. |
| No `actionlint` in the repo or on PATH. `yaml` and `js-yaml` are in `node_modules` | `node_modules/yaml`, `node_modules/js-yaml`; `which actionlint` empty | Workflow verification is a YAML parse plus a structural assertion script run with `node`, not actionlint. |
| Gate constants: `DEFAULT_MAX_CONCURRENT = 2`, `DEFAULT_MAX_CONCURRENT_PER_LANE = 1`, `DEFAULT_QUEUE_TIMEOUT_MS = 60_000` | `libs/backend/agent-sdk/src/lib/internal-query/internal-query-concurrency-gate.ts:87`, `:103`, `:114` | The constant to raise lives in the gate file, not in `internal-query.service.ts`. |
| Background lanes: `GOVERNED_BACKGROUND_LANES = {memory-curator, skill-synthesis}`; `USER_ACTION_QUERY_LANE = 'user-action'`; `DEFAULT_INTERNAL_QUERY_LANE = 'default'` | `internal-query-concurrency-gate.ts:23`, `:33`, `:36`, `:43`, `:56-59` | The existing allow-list defines "background". `default` (wizard, harness, cron) and `user-action` (RPC clicks) are foreground. No new classification is needed. |
| One admission predicate: `active < limit && inFlightForLane(lane) < perLaneLimit` | `internal-query-concurrency-gate.ts:432-436` | The background cap is a third term in this one predicate, not a second semaphore. That keeps the "one gate, no lock ordering" property documented at `:185-192`. |
| `drain()` scans for the first admissible waiter | `internal-query-concurrency-gate.ts:468-481` | A waiter blocked by the background cap is skipped. It does not block a foreground waiter behind it. No change to drain. |
| Limits are read fresh on every `acquire` | `internal-query-concurrency-gate.ts:288-294`; `internal-query.service.ts:140-185`, `:244-279` | The derived background cap must be computed from the current `limit` on each admission check, not stored at construction. |
| The service duplicates the admission predicate for its debug log (`blockedBy: 'global' \| 'lane' \| 'governor'`) | `internal-query.service.ts:147-176` | The log must learn a `'background'` reason. Otherwise a background-capped wait is logged as `governor`. |
| Settings are read with a caller default: `getConfiguration('ptah', key, fallback)`; `FileSettingsManager.get` returns the caller default before the registered default | `internal-query.service.ts:258-266`; `libs/backend/platform-core/src/file-settings-manager.ts:83-91` | At runtime the gate uses 2 today, not 1. The `1` in `FILE_BASED_SETTINGS_DEFAULTS` is visible only where no caller default is passed: `settings:get` (`libs/backend/rpc-handlers/src/lib/handlers/settings-rpc.handlers.ts:108-121`). So FU-16c is a display/contract drift, not a runtime bug. |
| Settings table: `'internalQuery.maxConcurrent'` and `'internalQuery.queueTimeoutMs'` registered; default `1` and `60000`; comment points at the wrong file | `libs/backend/platform-core/src/file-settings-keys.ts:363-373`, `:627-632` | Change `1` to the new gate default and point the comment at `internal-query-concurrency-gate.ts`. |
| `'internalQuery.maxConcurrentPerLane'` is read by the service but registered nowhere | `internal-query.service.ts:39-40`, `:251-256`; absent from `file-settings-keys.ts` (grep) | The same silent-drop defect as TASK_2026_328 (`file-settings-keys.ts:363-371` comment). `ElectronWorkspaceProvider.getConfiguration` routes only registered keys to the file store (`libs/backend/platform-electron/src/implementations/electron-workspace-provider.ts:90-102`). The key cannot be set on Electron. It is fixed with FU-16c (same files, same defect class). |
| The settings spec hard-codes the default and says why | `libs/backend/platform-core/src/file-settings-keys.spec.ts:818-878` (value asserted at `:871-873`) | platform-core cannot import agent-sdk. The drift pin stays a hard-coded literal. Update it to 3 and add the per-lane key. |
| The stale doc says "default limit 1" | `libs/backend/agent-sdk/src/lib/errors/internal-query-queue-timeout.error.ts:5-6` | Rewrite that sentence. |
| Specs that encode the global default 2 | `internal-query-concurrency-gate.spec.ts:156-168` (fallback test acquires a, b, then expects c queued); `internal-query.service.spec.ts:416-429` ("honours a configured limit above the default" uses 3), `:461-472` ("holds a third lane at the global ceiling") | These three tests break when the default becomes 3. They must be updated, not deleted. |
| The gate spec already has a fake governor and a lane-parameterised `acquire` helper | `internal-query-concurrency-gate.spec.ts:18-38`, `:193-252` | New gate tests reuse these helpers. No new test harness. |
| Docs that state "global 2" | `libs/backend/agent-sdk/CLAUDE.md:87` ("`DEFAULT_MAX_CONCURRENT` is 2"), `:88` ("The global ceiling (2) is shared by all four lanes: when both background lanes hold a slot, a wizard or user-action call waits"); `libs/backend/memory-curator/src/lib/curator-llm/curator-job-queue.ts:38-40` ("claim both global slots") | Updated in the same change. `:88` currently documents the defect this task fixes. |
| `publish-electron.yml` dispatch has only a `bump` input; concurrency group `publish-electron`, `cancel-in-progress: false` | `.github/workflows/publish-electron.yml:46-60` | A new optional boolean input. The concurrency group must separate dry runs from real runs (see Component 3). |
| `prepare` bumps the version locally and checks the remote tag read-only. It pushes nothing | `publish-electron.yml:71-142` (comment `:140-142`) | `prepare` is safe to run in a dry run unchanged. |
| Paid signing steps: `sslcom/esigner-codesign` at `:457-474`, `:507-511`, `:544-548`, `:616-628`. Retry conditions read `steps.sign-check-1.outputs.complete != 'true'` | `publish-electron.yml:508`, `:515`, `:545` | **Critical.** If the check step is skipped, its output is empty, `'' != 'true'` is true, and the retry step RUNS and bills. Every signing step and every retry step needs its own explicit mode condition. |
| Copy-back throws when signed files are missing | `publish-electron.yml:555-578` (`:576-577`) | Must be skipped in a dry run, or the Windows leg fails. |
| NSIS repack from `win-unpacked` and post-repack verifies do not depend on a signature | `publish-electron.yml:588-604` | Kept in a dry run. They prove the Windows installer build and the packed native deps. |
| All `electron-builder` calls use `--publish never` | `publish-electron.yml:310`, `:342`, `:590` | The build job cannot publish. Only the `release` job publishes. |
| `release` job: tag push, bump branch push, `gh pr create`, `softprops/action-gh-release` | `publish-electron.yml:642-719` | Skipped as a whole in a dry run. |
| Sync Release Branch dispatches `publish-electron.yml` with `-f bump=$BUMP` only | `.github/workflows/sync-release-branch.yml:132-145` (`:142`) | A new optional input with default `false` keeps this call site correct. No edit to the sync workflow. |
| `release/electron` push has no inputs | `publish-electron.yml:43-45` | On push, `github.event.inputs.dry-run` is empty. The push path must resolve to "publish". |
| Script precedents: Node scripts with a `--check`/`--self-test` flag, bash scripts with explicit mode flags and `--dry-run`; no `.ps1` tracked | `package.json:52`, `:66-68`; `scripts/reset-ptah-dev-profile.sh:1-40`; `git ls-files '*.ps1'` empty | Load-test scripts are Node `.mjs` (cross-platform, runs from Git Bash and PowerShell) with explicit mode flags and a `--self-test`. |
| Load-test definition: clone (never the real repo), `npm ci`, ~16 worktrees under `.claude-worktrees/`, then manual B-E actions with 3 streaming tiles | `S437/handoff.md:480-490` | Setup does the clone, install and worktrees. Cleanup removes them. The B-E actions and log reading stay manual and are printed, not run. |

## Architecture decision

### D1 — CI guard

- Chosen approach: replace the single prefix test with three prefix tests, one per bot branch
  family (`chore/bump-cli-v`, `chore/bump-electron-v`, `chore/bump-extension-v`), in all three
  guarded jobs. Add a comment next to each of the three `BRANCH=` lines that names the three
  guard files.
- Rationale: GitHub expressions have no regex. `startsWith` on the full bot prefix is the tightest
  match available. The three prefixes are the only PR-creating branch names in the workflows.
- Rejected alternative: rename the bot branches to `chore/release-bump-*`. This touches three
  publish workflows that run only at release time, so the change cannot be proven until the next
  release of each product. The narrow guard edits only PR-time workflows. Its effect is visible
  on the next PR.
- Assumptions: none. A human branch named `chore/bump-electron-v…` (for example
  `chore/bump-electron-vite`) would still skip CI. That is an accepted residual. It is documented
  in the guard comment.
- Effect on existing code: three `if:` blocks and their comments. The `chore(release)` commit
  message check and the PR-state check are unchanged.

### D2 — Internal-query slot reservation (FU-16b-c + FU-16c)

- Chosen approach:
  - (a) `DEFAULT_MAX_CONCURRENT` 2 → 3.
  - (b) A third term in the one admission predicate. A lane in `GOVERNED_BACKGROUND_LANES` is
    admissible only while the in-flight count summed over the background lanes is less than
    `backgroundLimit(limit)`.
  - (c) `backgroundLimit(limit) = limit >= 2 ? limit - 1 : 1`, exported from the gate file as a
    pure function. The service uses it for its log.
  - (d) No new setting key. The cap is derived from `internalQuery.maxConcurrent`.
  - (e) Settings default and doc drift fixed. `internalQuery.maxConcurrentPerLane` registered.
- Rationale: the user chose "raise to 3 and cap background at limit − 1"
  (`S437/batches.md:1155`, option 1). Background is already defined by the allow-list the
  governor uses (`:56-59`), so the classification does not change. A derived cap cannot drift
  from the global limit, and a user who raises `maxConcurrent` raises both. Putting the term in
  `admissible()` keeps one queue and one predicate, and `drain()` already skips inadmissible
  waiters.
- What counts as background: `memory-curator` and `skill-synthesis` (the lane string is trimmed
  and lower-cased first, `internal-query.service.ts:50-53`). Foreground: `default` (setup wizard,
  harness LLM runner, cron), `user-action` (the seven RPC paths listed at `S437/batches.md`
  Batch 16b design), and any unknown lane (fail open, the same rule as the governor, `:46-55`).
- Why `limit = 1` gives background `1` (D2-c): a cap of `0` would stop memory curation and skill
  synthesis for good. Their waiters would time out after `maxDeferMs + queueTimeoutMs` with no
  user-visible cause. A user who sets `maxConcurrent: 1` has explicitly chosen the TASK_2026_323
  serial behaviour. It is documented at the constant and pinned by a test.
- Rejected alternatives:
  - Cap background without raising the global limit: it regresses TASK_2026_352 (the two
    background pipelines serialised into each other, `internal-query-concurrency-gate.ts:76-81`).
    The user rejected it.
  - Let `user-action` overshoot the global limit by one: it needs a per-lane exception inside
    the global term. That breaks the "one predicate over one queue" property. The user rejected it.
  - A new setting `internalQuery.maxBackgroundConcurrent`: it adds a key that can be set above
    `maxConcurrent` and reopen the starvation. It needs a cross-key validation that the store does
    not support (`settings-rpc.schema.ts:41-45` deliberately leaves `value` untyped).
- Residual (accepted, documented): the one reserved slot is shared by `default` and
  `user-action`. When both background lanes are busy and a wizard or harness call holds the
  third slot, a click still waits for one of those three to finish. The per-lane slots were
  already shared this way before Batch 16b. This is the option the user chose, and it removes the
  case where background alone blocks a click.
- Effect on existing code: the gate predicate, one constant, the service debug log, the settings
  defaults table and its spec, four comments/docs, three existing tests. No caller changes. No
  lane changes. No new DI.

### D3 — `publish-electron.yml` dry run

- Chosen approach: a boolean `dry-run` input (default `false`). `prepare` resolves one positive
  job output `release_mode` with the value `publish` or `dry-run`. Every paid or outward-facing
  step and the whole `release` job run only when `release_mode == 'publish'`. The workflow-level
  concurrency group includes the mode.
- Rationale: a positive token fails closed. If the output is missing or misspelled, the
  outward-facing steps do not run. A negative test (`dry_run != 'true'`) fails open, and in this
  file failing open means a signed public release. The input shape copies
  `publish-cli.yml:49-53`.
- Rejected alternatives:
  - Step-level `github.event.inputs.dry-run != 'true'` on each step (the `publish-cli.yml:387`
    pattern): it fails open and repeats the raw event expression in about ten places.
  - Sign with a test/sandbox eSigner environment: no sandbox credential exists in the repo
    secrets referenced (`:462-465`, `environment_name: PROD`). That is a new external dependency.
  - Drop write permissions for dry runs: `permissions` cannot be conditional on inputs. A
    job-level downgrade of `build` would also change the real release path, which this task
    cannot prove before a real release.
- Assumptions: A3-1 — `github.event.inputs.dry-run` is the string `'true'` for a checked boolean
  dispatch input. Precedent `publish-cli.yml:387` relies on the same thing. Check: the first dry
  run's `prepare` step summary prints `release_mode=dry-run`.
- Effect on existing code: the push path and the Sync Release Branch dispatch resolve to
  `publish`. Every existing step runs exactly as today on that path.

### D4 — Load-test scripts

- Chosen approach: two Node ES-module scripts plus one shared path-guard module under
  `scripts/perf/`. No npm script entry.
- Rationale: Node runs the same on the user's Git Bash and PowerShell. `fs.rm` handles the long
  `node_modules` paths that trip shell `rm` on Windows. A shared guard module lets setup and
  cleanup agree on what a load-test clone is.
- Rejected alternatives: `.ps1` (no precedent in the repo, and not usable from the Bash tool);
  bash (`rm -rf` over 179k files on NTFS is the slow path the load test itself exercises);
  scripts outside the repo (the user asked to add them to the repo).
- Effect on existing code: none. New files only.

## Component specifications

### 1. CI bump-branch guard (A3)

- Purpose: skip CI only for PRs opened by the three release workflows.
- Responsibilities:
  - In `ci.yml:48`, `electron-e2e.yml:44` and `vscode-e2e.yml:56`, replace
    `!startsWith(github.head_ref, 'chore/bump-') &&` with three terms:
    `!startsWith(github.head_ref, 'chore/bump-cli-v') &&`
    `!startsWith(github.head_ref, 'chore/bump-electron-v') &&`
    `!startsWith(github.head_ref, 'chore/bump-extension-v') &&`
  - Rewrite the three guard comments (`ci.yml:41-45`, `electron-e2e.yml:40-41`,
    `vscode-e2e.yml:52-53`). Name the three bot prefixes and their source lines. Say that a human
    `chore/bump-<dep>` branch runs CI (PR #512 merged with no main CI because the old guard
    matched it). Name the accepted residual (`chore/bump-electron-v…`).
  - Add a one-line comment above each `BRANCH=` line (`publish-cli.yml:401`,
    `publish-electron.yml:657`, `publish-extension.yml:226`): "renaming this branch requires the
    same edit in the bump guards of ci.yml, electron-e2e.yml and vscode-e2e.yml". This is a
    comment-only edit to those three files.
- Verified contracts and entry points: see evidence rows 1-3.
- Dependencies: none.
- Integration points: GitHub Actions `pull_request` events. `github.head_ref` is set on
  `pull_request` and empty on `workflow_dispatch`. `startsWith('', …)` is false, so manual
  dispatches of `electron-e2e`/`vscode-e2e` still run. That is unchanged.
- Failure behaviour: a prefix typo makes bot bump PRs run CI again. The cost is runner minutes
  only, and it shows on the first bot PR. A prefix that is too broad re-creates the PR #512 skip.
  The structural check below catches both.
- Quality requirements: bot bump PRs must still show `main`, `electron-e2e`, `vscode-e2e` as
  SKIPPED. A PR from `chore/bump-better-sqlite3-13` must evaluate all three guards to run.
- Verification seam (no local runner can evaluate `if:` expressions):
  1. YAML parse of the three files:
     `node -e "const Y=require('yaml'),fs=require('fs');for(const f of ['ci','electron-e2e','vscode-e2e'])Y.parse(fs.readFileSync('.github/workflows/'+f+'.yml','utf8'))"`.
  2. Structural assertion (not committed): for each of the three files, read the guarded job's
     `if` string. Assert that it contains the three exact `startsWith` terms, and that it does not
     contain `'chore/bump-')`. Assert that the three `BRANCH=` values in the publish workflows
     start with those three prefixes. Then check the expression by hand against four
     `head_ref` values: `chore/bump-cli-v1.2.3` (skip), `chore/bump-electron-v0.9.1` (skip),
     `chore/bump-extension-v2.0.0` (skip), `chore/bump-better-sqlite3-13` (run).
  3. After merge (user-observed): the next human PR shows the three jobs running. The next bot
     bump PR shows them SKIPPED.
- Files: MODIFY `.github/workflows/ci.yml`, `.github/workflows/electron-e2e.yml`,
  `.github/workflows/vscode-e2e.yml`; MODIFY (comment only) `.github/workflows/publish-cli.yml`,
  `.github/workflows/publish-extension.yml`. `publish-electron.yml` gets its comment in
  Component 3 because that component owns the file.

### 2. Internal-query slot reservation and default alignment (FU-16b-c, FU-16c)

- Purpose: background pipelines can never hold every internal-query slot, and the declared
  defaults match the gate.
- Responsibilities:
  1. `internal-query-concurrency-gate.ts`:
     - `DEFAULT_MAX_CONCURRENT = 3`. Rewrite the doc block at `:61-86`. Keep the TASK_2026_323
       and TASK_2026_352 history. Say why three: two background families plus one slot that
       background may never take (FU-16b-c, the 60 s user-action queue timeout behind a 90-120 s
       background call).
     - New exported pure function `backgroundLimit(limit: number): number`, returning
       `limit >= 2 ? limit - 1 : 1`. Its doc names the `limit = 1` choice (D2-c).
     - New read-only getter `inFlightInBackground: number`: the sum of `activeByLane` over
       `GOVERNED_BACKGROUND_LANES`. No new counter. The map is already maintained by `take` and
       `makeRelease` (`:438-457`), and summing two entries cannot drift.
     - `admissible(lane)` (`:432-436`) gains the term
       `(!GOVERNED_BACKGROUND_LANES.has(lane) || this.inFlightInBackground < backgroundLimit(this.limit))`.
       The term is independent of the governor. It applies with or without one, because it is a
       slot policy, not a deferral.
     - Update the class doc (`:176-224`) "One gate, two ceilings" → three terms. Add one paragraph
       "Background never takes the last slot" that names the shared-foreground-slot residual.
     - Update the `GOVERNED_BACKGROUND_LANES` doc (`:45-55`). The set now also drives the slot
       cap, so a new background lane that is not listed escapes both the governor and the cap.
  2. `internal-query.service.ts` `acquireSlot` (`:140-185`): compute
     `backgroundInFlight = this.gate.inFlightInBackground` and
     `backgroundCapped = GOVERNED_BACKGROUND_LANES.has(lane) && backgroundInFlight >= backgroundLimit(limit)`.
     Include both in the wait condition and the log fields. `blockedBy` order:
     `'global'` → `'lane'` → `'background'` → `'governor'`. No other service change. Limits stay
     read fresh per call through `readLimit` (`:258-279`), which already validates finite
     numbers ≥ 1. Zod is not used here and is not added. These values are not an external
     boundary: `settings:set` is the boundary, and it validates only the key
     (`settings-rpc.schema.ts:41-52`) by design.
  3. `libs/backend/platform-core/src/file-settings-keys.ts`:
     - `'internalQuery.maxConcurrent': 3` (`:631`).
     - Register `'internalQuery.maxConcurrentPerLane'` in `FILE_BASED_SETTINGS_KEYS` next to
       `:372-373`, with default `1` next to `:631-632`.
     - Fix the defaults comment (`:627-630`) to point at
       `agent-sdk/src/lib/internal-query/internal-query-concurrency-gate.ts`
       (`DEFAULT_MAX_CONCURRENT`, `DEFAULT_MAX_CONCURRENT_PER_LANE`, `DEFAULT_QUEUE_TIMEOUT_MS`).
     - Extend the keys comment (`:363-371`) to say the per-lane key was missing (TASK_2026_463).
  4. `libs/backend/agent-sdk/src/lib/errors/internal-query-queue-timeout.error.ts:5-6`: replace
     "serializes … (default limit 1 …)" with a sentence that does not restate a number. It says
     the gate bounds concurrent one-shot subprocesses host-wide (`ptah.internalQuery.maxConcurrent`,
     see `DEFAULT_MAX_CONCURRENT`). A number in a second file is the drift FU-16c was.
  5. Docs:
     - `libs/backend/agent-sdk/CLAUDE.md:87`: "is 2" → "is 3", with a background cap of
       `limit − 1`. Keep the predicate text in step with the code.
     - `:88`: replace the "global ceiling (2) … a wizard or user-action call waits" sentence with
       the new rule and the shared-foreground-slot residual.
     - `libs/backend/memory-curator/src/lib/curator-llm/curator-job-queue.ts:38-40`: "claim both
       global slots" → "claim both background slots".
- Tests (behaviour, no percentage):
  - `internal-query-concurrency-gate.spec.ts`:
    - Update `:156-168` "falls back to the defaults for a nonsensical limit". Acquire lanes a, b,
      c (all admitted), expect a 4th queued, and expect `inFlight` to equal
      `DEFAULT_MAX_CONCURRENT`. Lanes a/b/c are not background, so the cap does not interfere.
    - New `describe('background slot cap (FU-16b-c)')`:
      1. At limit 3 / perLane 1, `memory-curator` and `skill-synthesis` are admitted and
         `user-action` is admitted immediately (`inFlight` 3). This is the FU-16b-c regression.
      2. At limit 3 / perLane 2, two `memory-curator` calls are admitted. A third background call
         (either lane) queues, and a `user-action` call behind it is admitted (drain skips the
         capped head).
      3. A capped background waiter is not admitted when a foreground slot frees. It is admitted
         when a background slot frees.
      4. At limit 1, a background call is admitted into the only slot, and a `default` call
         queues. This pins D2-c.
      5. `backgroundLimit`: 1→1, 2→1, 3→2, 5→4.
      6. With a governor that is not clear, a background waiter held by the governor does not
         count toward `inFlightInBackground`. Only admitted holders count, so a governor hold
         cannot consume the cap.
  - `internal-query.service.spec.ts`:
    - `:416-429`: "honours a configured limit above the default" becomes `makeGatedHarness(4, 4)`,
      4 admitted, 5th queued (default lane, so no cap).
    - `:461-472`: "holds a fourth lane at the global ceiling". `memory-curator`,
      `skill-synthesis` and `default` are admitted, and `user-action` queues. `started()` equals
      `DEFAULT_MAX_CONCURRENT`.
    - New: "admits a user-action query while both background lanes hold slots at the defaults"
      (no overrides, `started()` 3).
    - New: "logs blockedBy background when the background cap binds" with
      `makeGatedHarness(3, 2)` and two `memory-curator` calls. Assert the debug log call's
      `blockedBy: 'background'` for a third background call.
  - `file-settings-keys.spec.ts:818-878`: expect `internalQuery.maxConcurrent` → `3`. Register,
    route and default checks for `internalQuery.maxConcurrentPerLane` → `1`. Update the
    `describe` doc to name TASK_2026_463.
- Verified contracts and entry points: see the evidence rows for the gate, service, settings and
  specs.
- Dependencies: agent-sdk → vscode-core (existing edge, `internal-query-concurrency-gate.ts:9-12`).
  platform-core stays import-free. memory-curator gets a comment only.
- Integration points: every `InternalQueryService.execute` caller. No signature changes:
  `agent-generation` services, `sdk-internal-query.curator-llm.ts:417`, skill-synthesis
  `LaneRunnerService`, `cron-scheduler/src/lib/job-runner.ts`, rpc-handlers user-action paths.
- Failure behaviour: unchanged error types. A capped background waiter follows the existing
  queue-timeout and deferral rules: a timeout counts only while the governor admits it
  (`:213-217`), then rejects with `InternalQueryQueueTimeoutError`, and callers already map that.
  The debug log names `blockedBy: 'background'`.
- Quality requirements:
  - At default settings, a `user-action` or `default` call is never queued only because both
    background lanes hold slots.
  - At most 3 concurrent one-shot subprocesses by default, up from 2. The spawn happens off the
    main thread (`:66-74`, TASK_2026_341).
  - No new timers, listeners or maps.
- Verification seam: the gate (pure, fake timers) is the smallest seam; the service spec is the
  integration seam. Commands are listed in the team-leader handoff.
- Files:
  - MODIFY `libs/backend/agent-sdk/src/lib/internal-query/internal-query-concurrency-gate.ts`
  - MODIFY `libs/backend/agent-sdk/src/lib/internal-query/internal-query-concurrency-gate.spec.ts`
  - MODIFY `libs/backend/agent-sdk/src/lib/internal-query/internal-query.service.ts`
  - MODIFY `libs/backend/agent-sdk/src/lib/internal-query/internal-query.service.spec.ts`
  - MODIFY `libs/backend/agent-sdk/src/lib/errors/internal-query-queue-timeout.error.ts`
  - MODIFY `libs/backend/agent-sdk/CLAUDE.md`
  - MODIFY `libs/backend/platform-core/src/file-settings-keys.ts`
  - MODIFY `libs/backend/platform-core/src/file-settings-keys.spec.ts`
  - MODIFY `libs/backend/memory-curator/src/lib/curator-llm/curator-job-queue.ts` (comment only)
  - Check before editing: if `libs/backend/agent-sdk/src/lib/internal-query/index.ts` re-exports
    gate constants by name, add `backgroundLimit` there only if a consumer outside the folder needs
    it. None is planned, so the default is no barrel change.

### 3. `publish-electron.yml` dry-run mode (A1 / D10 prerequisite)

- Purpose: prove the three-OS build, package and packed-native verification without any cost or
  outward-facing effect.
- Responsibilities:
  1. Inputs (`:46-57`): add
     `dry-run: { description: 'Build, package and verify on all three OSes; no signing, tag, bump PR or release', required: false, type: boolean, default: false }`.
  2. Concurrency (`:58-60`): `group: publish-electron-${{ github.event.inputs.dry-run == 'true' && 'dry-run' || 'publish' }}`,
     with `cancel-in-progress: false` unchanged. Reason: GitHub keeps one pending run per group
     and cancels the older pending run. A dry run and a real release must not cancel each other.
  3. `prepare` job:
     - New first step `Resolve release mode` (id `mode`). It writes
       `release_mode=dry-run` when `github.event_name == 'workflow_dispatch'` and
       `github.event.inputs.dry-run == 'true'`, and `release_mode=publish` otherwise.
       Pass the values through `env:`, not `${{ }}` inside `run:`. It echoes the mode to
       `$GITHUB_STEP_SUMMARY`. It fails (`exit 1`) if `github.event_name == 'push'` and the mode
       is not `publish`.
     - New job output `release_mode: ${{ steps.mode.outputs.release_mode }}`.
     - Bump, tag check and abort steps are unchanged. They push nothing (`:140-142`). The tag check
       still runs, so a dry run also proves the next tag is free.
  4. `build` job. Add `needs.prepare.outputs.release_mode == 'publish'` to the `if:` of exactly
     these steps and no others:
     - `Sign main app executable with SSL.com eSigner` (`:457`), whose `if` today is
       `runner.os == 'Windows'`
     - `Check batch-sign output (attempt 1)` (`:476`)
     - `Batch-sign retry (attempt 2)` (`:507`)
     - `Check batch-sign output (attempt 2)` (`:513`)
     - `Batch-sign retry (attempt 3)` (`:544`)
     - `Copy signed binaries back into win-unpacked` (`:555`)
     - `Sign Windows installer with SSL.com eSigner` (`:616`)

     The retry steps need the term explicitly, even though their check step is skipped. See the
     critical evidence row: an empty `complete` output would otherwise run them.
  5. `build` job, kept in a dry run (listed so reviewers can confirm nothing else is skipped):
     - version patch, install, rollup/dmg-license installs, python, `npm rebuild better-sqlite3`,
       `nx test persistence-sqlite`, `manifest:check`, `nx build ptah-electron`, `validate-deps`,
       `copy-renderer`, Electron-ABI rebuild, WASM re-copy, manifest prune
     - macOS/Linux package and both verifies
     - Windows `--dir` package, both pre-sign verifies, `Stage main app executable for signing`
       (no network, no cost; it still proves the `MAX_SIGN_BATCH` selection guard)
     - NSIS repack from the unsigned `win-unpacked`, both post-repack verifies, `Find Windows
       installer`
     - `Upload artifacts`. Add `retention-days: ${{ needs.prepare.outputs.release_mode == 'publish' && 30 || 5 }}`.
       Artifacts are private to the run and are not a publication.
  6. `release` job (`:642`): add
     `if: needs.prepare.outputs.release_mode == 'publish'`. As a second lock, add a first step
     `Refuse unless publishing` that exits 1 when `RELEASE_MODE` (env from the same output) is not
     `publish`. The tag, bump PR and GitHub Release steps are otherwise unchanged.
  7. Header comment (`:5-14`): add a "Dry run" paragraph. It says what runs, what is skipped, that
     the cost is zero eSigner signatures and about 3 runner legs of minutes, and that artifacts are
     unsigned and must never be distributed. Also add the Component 1 cross-reference comment
     above `BRANCH=` at `:657`.
- Verified contracts and entry points: see the `publish-electron.yml` and
  `sync-release-branch.yml` evidence rows.
- Dependencies: none new. No new actions and no new secrets.
- Integration points: `sync-release-branch.yml:142` (no `dry-run` passed, so the mode is
  `publish`); the `push: release/electron` trigger (mode is `publish`).
- Failure behaviour:
  - A missing or garbled `release_mode` skips signing and the release job. A real release then
    finishes with no Release and no tag, which is visible and harmless, and can be re-run.
  - The push-path self-check fails `prepare` loudly if the mode resolution is ever broken for a
    push.
  - In a dry run, the Windows leg succeeds with an unsigned installer.
- Quality requirements (security/cost):
  - In a dry run, zero `sslcom/esigner-codesign` executions, zero `git push`, zero `gh pr create`,
    zero `action-gh-release`.
  - On the publish path, the same set of steps as today, in the same order.
- Verification seam:
  1. YAML parse with `node_modules/yaml`. The anchors `&batch_sign_with` / `*batch_sign_with`
     (`:460`, `:510`, `:547`) must still resolve.
  2. Structural assertion script (run with `node`, not committed). Parse the file.
     - For every step in `jobs.build.steps` whose `uses` starts with `sslcom/esigner-codesign`,
       or whose `name` starts with `Check batch-sign output` or `Copy signed binaries back`,
       assert that `if` contains `needs.prepare.outputs.release_mode == 'publish'`.
     - Assert `jobs.release.if` contains the same term.
     - Assert that no other `build` step contains `release_mode`, apart from the upload
       `retention-days`.
     - Assert `on.workflow_dispatch.inputs.dry-run.type == 'boolean'` and `default == false`.
     - Assert `jobs.prepare.outputs.release_mode` exists.
  3. By hand, evaluate the mode expression for three events: push (`publish`), dispatch without
     the input (`publish`), dispatch with `dry-run=true` (`dry-run`).
  4. After merge (the user's manual action, not part of this task): dispatch from `main` with
     `dry-run: true`. Expected: `prepare` summary `release_mode=dry-run`; 3 build legs green,
     including every `Verify packed native deps` step; signing steps shown as skipped; `release`
     job skipped; no new tag (`git ls-remote --tags origin 'electron-v*'` unchanged); no new PR;
     no new Release; no eSigner usage. The run id then goes into `S437/batches.md` Batch 10 as D10
     build-matrix evidence. The signed-installer path is still proven only by a real release.
- Files: MODIFY `.github/workflows/publish-electron.yml`.

### 4. Property-hub load-test scripts (A4)

- Purpose: repeatable setup and teardown of the TASK_2026_437 §9 load-test clone, which can never
  touch the real repositories.
- Responsibilities:
  1. `scripts/perf/property-hub-loadtest-paths.mjs` (shared guard, exported functions):
     - `resolveLoadtestPaths({ source, target })`. The defaults are `D:/projects/property-hub` and
       `D:/projects/property-hub-loadtest`. Both paths are resolved with `path.resolve` and
       compared case-insensitively on win32.
     - Refusal rules, each with its own message:
       1. target equals source
       2. target is inside source, or source is inside target
       3. target basename does not end with `-loadtest`
       4. target is inside the Ptah repo that holds the script (resolved from
          `import.meta.url`), or contains it
       5. target is a filesystem root
     - `MARKER = '.git/ptah-loadtest-clone.json'`. It lives inside `.git`, so it is never tracked
       or shown by `git status`. Helpers `writeMarker(target, { source, createdAt, worktrees })`
       and `readMarker(target)`. `readMarker` validates the parsed JSON shape by hand (string
       `source`, ISO `createdAt`, integer `worktrees`) and returns `null` on any mismatch.
     - `--self-test` entry: pure assertions over the refusal rules (same path, case variants,
       trailing separators, nested, wrong suffix, repo-internal, root). It prints `self-test OK`
       and exits 0, or exits 1.
  2. `scripts/perf/property-hub-loadtest-setup.mjs`:
     - Flags: `--dry-run` | `--execute` (exactly one is required; no mode prints usage and exits 2);
       `--source`, `--target`, `--worktrees N` (integer 1-40, default 16), `--skip-install`.
     - Steps (in `--dry-run`, each step is printed and not run):
       1. Guards; source must be a git work tree (`git -C source rev-parse --is-inside-work-tree`);
          target must not exist.
       2. `git clone --no-hardlinks <source> <target>`. On failure, remove the target only if this
          run created it.
       3. Write the marker immediately.
       4. `git -C target remote remove origin`, so load-test agents cannot push to the real repo.
       5. `npm ci` in the target, unless `--skip-install` (Windows spawns via `npm.cmd`).
       6. For i in 1..N: `git -C target worktree add .claude-worktrees/loadtest-NN -b loadtest/NN`.
       7. Print the manual procedure verbatim from `S437/handoff.md:482-489`: dev app from the Ptah
          worktree with `PTAH_PROFILE_ON_LAG_MS=500`, 3 streaming tiles, actions B-E, and the log
          locations `%APPDATA%\Ptah Dev\logs\Ptah Electron-<date>.log` and `ptah-hang.log`. Also
          print the warning: "do not run during a perf measurement".
     - Exit non-zero on the first failed step. The message names the step and says
       `run cleanup --execute` (the marker exists from step 3 onward).
  3. `scripts/perf/property-hub-loadtest-cleanup.mjs`:
     - Flags: `--dry-run` | `--execute`, `--target`.
     - Steps:
       1. Guards; the marker must exist and parse (refuse otherwise: "not a load-test clone").
       2. `git worktree list --porcelain`, then `git worktree remove --force` for every entry
          except the main work tree. Worktrees the load test already deleted are handled by
          `git worktree prune`.
       3. `fs.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })`.
       4. Report the elapsed time.
     - Never deletes a path without a valid marker.
- Verified contracts and entry points: `S437/handoff.md:480-490`; script precedents
  `package.json:66-68`, `scripts/reset-ptah-dev-profile.sh:1-40`.
- Dependencies: Node built-ins only (`node:child_process`, `node:fs/promises`, `node:path`,
  `node:url`). No repo imports and no `node_modules` dependency.
- Integration points: none in the product. The user runs them by hand.
- Failure behaviour: every refusal exits 1 with the rule that fired. A spawn failure exits 1 with
  the step name and the child exit code. Nothing is retried except `fs.rm`.
- Quality requirements (safety): no code path deletes or writes under the resolved source, under
  the Ptah repo, or under a target without a marker. `--execute` is never the default.
- Verification seam:
  - `node --check` on the three files.
  - `node scripts/perf/property-hub-loadtest-paths.mjs --self-test`.
  - `node scripts/perf/property-hub-loadtest-setup.mjs --dry-run` prints the plan and exits 0
    without creating the target.
  - `node scripts/perf/property-hub-loadtest-setup.mjs --dry-run --target D:/projects/property-hub`
    exits 1 (rule 1).
  - `node scripts/perf/property-hub-loadtest-cleanup.mjs --dry-run --target D:/projects/property-hub`
    exits 1 (no marker).
  - Never run `--execute` in this task.
  - `npx eslint scripts/perf` if the root config covers `scripts/**/*.mjs`. Otherwise `node --check`
    is the lint seam. Record which one applied.
- Files: CREATE `scripts/perf/property-hub-loadtest-paths.mjs`,
  `scripts/perf/property-hub-loadtest-setup.mjs`,
  `scripts/perf/property-hub-loadtest-cleanup.mjs`.

## Integration architecture

- Data flow:
  - C1 is a GitHub `pull_request` event → the job `if:` → run or skip.
  - C2 is caller → `InternalQueryService.execute` → `acquireSlot` (reads the limits fresh) →
    `gate.acquire` → `admissible` (global, lane, background cap) plus the governor term → slot →
    `runOneShot` → the slot is released when the stream ends.
  - C3 is dispatch/push → `prepare.release_mode` → `build` steps gated on it → `release` job gated
    on it.
  - C4 is the user CLI → guards → git/npm child processes on the clone only.
- State or persistence: C2 is in-memory gate state owned by the process-singleton
  `InternalQueryService`, with no new state. C4 uses the marker file inside the clone's `.git`,
  with the same lifetime as the clone.
- External boundaries:
  - C3: dispatch inputs are untrusted strings. They go through `env:` and are compared to fixed
    literals, never interpolated into shell.
  - C4: CLI args are resolved and checked by the guard module before any spawn.
  - C2: the settings values are validated by `readLimit` (existing).
- Failure and rollback:
  - C1 and C3 are revertible YAML with no persisted effect.
  - C2: reverting the commit restores 2/no cap. Users who set `maxConcurrent` keep their value.
  - C4: a failed setup leaves a marked clone that cleanup removes.
- Observability:
  - C2: the existing `one-shot query waiting for a concurrency slot` debug line, with
    `blockedBy: 'background'` and `backgroundInFlight`.
  - C3: the `prepare` step summary line with the mode, and skipped steps shown in the run UI.
  - C1: skipped jobs shown on the PR.

## Architecture-level quality requirements

- Functional:
  - A human `chore/bump-<dep>` PR runs `main`, `electron-e2e` and `vscode-e2e`.
  - Bot bump PRs skip them.
  - At defaults, background lanes hold at most 2 of 3 internal-query slots.
  - `settings:get internalQuery.maxConcurrent` returns 3.
  - `internalQuery.maxConcurrentPerLane` can be written on every host.
  - A `dry-run` dispatch produces three green build legs and no tag, PR, Release or signature.
  - Setup/cleanup refuse the real repo.
- Performance: at most one more concurrent off-thread one-shot subprocess at defaults. No
  main-thread work added.
- Security:
  - No publication or paid signing reachable from a dry run (positive mode token plus a second
    lock in `release`).
  - No shell interpolation of inputs.
  - The load-test clone has no `origin` remote.
- Maintainability:
  - One admission predicate, and `GOVERNED_BACKGROUND_LANES` stays the single definition of
    background.
  - The platform-core defaults stay hard-coded with a drift spec.
  - No new setting key for the background cap.
  - `internal-query-concurrency-gate.ts` is 486 lines today and stays under 700.
- Testability:
  - The gate spec pins the FU-16b-c regression and the `limit = 1` rule.
  - The service spec pins the log reason and the new default.
  - The settings spec pins both defaults and the per-lane key registration.
  - Workflow structure is checked by parse plus assertion. Runtime behaviour is checked by the
    first PR and the user's first dry-run dispatch.

## Team-leader handoff

- Recommended executors:
  - C1 + C3 → `devops-engineer`: workflow YAML only, and both belong to the release/CI surface.
  - C2 → `backend-developer`: agent-sdk and platform-core source plus Jest specs.
  - C4 → `devops-engineer`: tooling scripts outside the product.
  - All are suitable for codex CLI lanes. Each lane prompt must include the absolute worktree path,
    this plan's component section, and the rule "no git, no nx reset, no `--execute`".
- Complexity: MEDIUM. C2 changes admission in a concurrency gate and several pinned tests, and C3
  touches a paid, outward-facing pipeline where one missed `if:` costs money or ships a release.
  C1 and C4 are LOW.
- Dependencies and ordering:
  - None between components.
  - Constraint: C1 and C3 both add a comment to the publish workflows (C1 to `publish-cli.yml` and
    `publish-extension.yml`, C3 to `publish-electron.yml`). They are file-disjoint as assigned. Do
    not move the `publish-electron.yml` comment into C1.
  - Constraint: C2 test runs must wait until the idle-machine perf run is finished and the node
    test-process count is 0 (`S437/handoff.md` §8 rule 4).
- Parallel-safe work (max 2 lanes at once, all file-disjoint):
  - Wave 1: lane A = C2 (backend, the only lane that runs Jest); lane B = C1 + C3 (workflow YAML,
    no Jest).
  - Wave 2: lane C = C4 (scripts). It can also join wave 1 in place of lane B if the YAML lane
    needs a second review round.
  - Review gate per lane: `code-logic-reviewer` + `code-style-reviewer`. For C3, the logic
    reviewer must re-run the structural assertion independently.
- Files affected:
  - CREATE: `scripts/perf/property-hub-loadtest-paths.mjs`,
    `scripts/perf/property-hub-loadtest-setup.mjs`,
    `scripts/perf/property-hub-loadtest-cleanup.mjs`
  - MODIFY:
    - `.github/workflows/ci.yml`, `.github/workflows/electron-e2e.yml`,
      `.github/workflows/vscode-e2e.yml`, `.github/workflows/publish-cli.yml` (comment),
      `.github/workflows/publish-extension.yml` (comment), `.github/workflows/publish-electron.yml`
    - `libs/backend/agent-sdk/src/lib/internal-query/internal-query-concurrency-gate.ts`,
      `internal-query-concurrency-gate.spec.ts`, `internal-query.service.ts`,
      `internal-query.service.spec.ts`
    - `libs/backend/agent-sdk/src/lib/errors/internal-query-queue-timeout.error.ts`,
      `libs/backend/agent-sdk/CLAUDE.md`
    - `libs/backend/platform-core/src/file-settings-keys.ts`, `file-settings-keys.spec.ts`
    - `libs/backend/memory-curator/src/lib/curator-llm/curator-job-queue.ts` (comment)
  - REWRITE: none. No `project.json` edits, so no `nx reset` is needed.
- Verification points:
  - C2 (only on an idle machine):
    - `npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/platform-core --parallel=1 -- --maxWorkers=2`.
      The header must read 2 projects.
    - `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-sdk @ptah-extension/platform-core @ptah-extension/memory-curator`.
      The header must read 3 projects, with 0 lint errors.
    - `npx nx run degradation-audit:lint`: TOTAL equals the baseline measured on this branch
      before the edits (last recorded 303 at the TASK_2026_437 P4 gate). C2 adds no catch or
      fallback sites, so any change is a regression to investigate.
    - Consumers to reason about, not necessarily run: `rpc-handlers` `internal-query-lane-drift.spec.ts`
      (lane strings unchanged); `agent-generation` `agent-customization.service.spec.ts:786-799`
      (its own local concurrency, not the gate).
  - C1/C3: the YAML parse and structural assertion scripts in the component sections. Prettier
    check on the edited YAML (`npx prettier --check <files>`), because lint-staged formats
    `*.{ts,js,json,md}` only and YAML style must match by hand.
  - C4: `node --check`, `--self-test`, and the three dry-run/refusal invocations listed. Never
    `--execute`.
  - Carrier: when all lanes are committed, edit only the `status:` line of `task.md`.
  - The D10 dispatch, the load-test run and AC-10 stay with the user.
