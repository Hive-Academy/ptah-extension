# Future enhancements — TASK_2026_383

Everything this task deliberately did not do, in one place. Written by Task 12.3
(Batch 12) from the Batch 1-8 and Task 12.1 verification records in `batches.md`,
the six-lane defect list in `batch-5-report.md`, and the four lane reports in
`triage/`.

Nothing here is a blocker for TASK_2026_383. Each item states **what**, **where**,
**why it was deferred**, and the **trigger/owner** that should pick it up.

Priority bands:

- **P1** — a user-visible failure is currently invisible or a deletion can happen
  silently. Should become its own task.
- **P2** — real, bounded, and cheap once someone is already in the file.
- **P3** — hygiene, naming, tooling ergonomics.

---

## P1 — silent failures still shipping

### 1.1 The 18 defects recorded by Batch 5, and the 9 by Task 12.1

**Recorded, not fixed — by design.** Batches 5 and 12.1 were comment-only
classification passes: a defect was labelled and left byte-for-byte untouched so
that no behavioural change could hide inside a 79-file and a 61-file comment
diff. They are collected in section "Recorded defects, not fixed" below, grouped
by library, each with the suggested fix its lane wrote.

- **Why deferred**: fixing them inside the classification batch would have made
  those diffs unreviewable, and each fix is a behaviour change needing its own
  spec.
- **Trigger/owner**: one follow-up task per library group, `harness-sync` first
  (six of its sites can drive a _deletion_). Each fix needs a spec pinning the
  failure apart from the legitimate empty result.

### 1.2 Nothing routes through `DegradationReporter` yet

**Where**: all four contested libs — `libs/backend/rpc-handlers` (40 sites),
`libs/backend/vscode-core` (17), `libs/backend/agent-sdk` (33),
`apps/ptah-electron` (28). Task 12.1 assigned **zero** `reported` labels: every
marker is `optional-capability`.

The reporter (`libs/backend/vscode-core/src/logging/degradation-reporter.ts`) has
exactly three producers today — the two keytar suppressions in
`libs/backend/platform-cli/src/settings/cli-master-key-provider.ts`,
`electron.boot.startOrJoin-failed` in
`apps/ptah-electron/src/activation/wire-runtime.ts`, and
`database.backup.*` in `libs/backend/persistence-sqlite/src/lib/backup.service.ts`.

- **Why deferred**: the classification lanes were forbidden from behavioural
  change, and adding a `report(...)` call is one.
- **Trigger/owner**: the same per-library fix tasks as 1.1. A site that stays a
  legitimate optional capability but is worth counting gets a `report(...)` and
  its marker upgraded from `optional-capability` to `reported — <CODE>`.

### 1.3 Escalate N consecutive `unavailable` integrity verdicts (TASK_2026_380 follow-up #5)

**Where it belongs**: the single-row `db_integrity_check_state` table from
migration `0042`, reached through
`libs/backend/persistence-sqlite/src/lib/integrity/integrity-check-state.store.ts`.

**Where it does NOT belong**: `DegradationReporter`. The reporter's counts are
deliberately **in-memory and per-boot** — the file's own contract says so, and the
boot summary reads `snapshot().total` for one line per process. "N consecutive
verdicts" is a claim about history across restarts, which only a persisted row
can make. Putting a counter in the reporter would give an answer that resets
every launch and looks like a healthy streak.

- **Why deferred**: it needs a schema decision (a new column on the 0042 row vs a
  derived count) and a policy decision (what N is, and what "escalate" means to a
  user), neither of which is in this task's scope.
- **Trigger/owner**: whoever picks up the 380 follow-up list; `persistence-sqlite`
  owner. Migration `0042`'s table is already single-row
  (`id INTEGER PRIMARY KEY CHECK (id = 1)`), so the change is additive.

### 1.4 `electron-safe-storage-vault.ts` — the AES-GCM fallback is unreachable off Linux

**Where**: `apps/ptah-electron/src/services/platform/electron-safe-storage-vault.ts:116-119`.
`resolveMachineSeed()` calls `fs.readFileSync(candidate, 'utf8')` for
`/etc/machine-id` and `/var/lib/dbus/machine-id` **outside** the `try` that begins
at `:120`. On Windows and macOS the first iteration throws `ENOENT` and propagates
out of the method, so the fallback path the file header calls "a last resort" is
unreachable on exactly the platforms it names.

Latent: only reached when `safeStorage` itself is unavailable.

- **Why deferred**: it is a plain bug, not a degradation-marker question, and the
  Task 12.1 electron lane's mandate was marker-only.
- **Trigger/owner**: `apps/ptah-electron` owner. One `try` boundary move plus a
  spec that forces `safeStorage` unavailable on a non-Linux platform.

### 1.5 Pre-existing test-suite instability under concurrency

**Where**: repo-wide, but the named sightings are
`libs/backend/rpc-handlers/.../voice-rpc.handlers.spec.ts` (timed out once under
parallel load), `skills-sh-legacy-adoption.spec.ts` (timed out under parallel
load in Task 12.1; `rpc-handlers` then passed whole in isolation, 94 suites /
2715 tests), and Nx flagging `thoth-runtime:test` flaky.

Batch 5 saw **three distinct failure shapes** across runs — a ts-transform crash,
a real-time timer race, and a 5 s timeout — including with projects running alone,
and five of six projects emitted `A worker process has failed to exit gracefully`.
A comment-only diff cannot cause any of this.

- **Why deferred**: it predates this task and reproducing it is the work, not the
  fix. Every batch here was green on a clean or isolated re-run.
- **Trigger/owner**: **this deserves its own task.** Suggested shape: find the
  handles keeping Jest workers alive (an un-`unref`'d timer or an unclosed
  better-sqlite3 handle are the two candidates the boot code already warns about),
  then decide per project whether `--runInBand` or a real teardown is the answer.

---

## P2 — bounded, cheap, needs an owner in the file

### 2.1 `IBackupService` fakes in three specs are untyped object literals

**Where**: the three Batch 8 call-site specs
(`libs/backend/persistence-sqlite/src/lib/migration-runner.spec.ts`,
`libs/backend/thoth-runtime/src/lib/start-thoth-cron.spec.ts`,
`libs/backend/cli-engine/src/lib/bootstrap/*` specs). The shape is pre-existing;
Batch 8 changed the argument, not the fake.

- **Why deferred**: a style minor filed by the Batch 8 style review; typing the
  fakes is unrelated to the `backup(kind)` signature change the batch owned.
- **Trigger/owner**: annotate each fake `satisfies IBackupService` (or a
  `Partial<IBackupService>` alias) the next time one of those specs is edited.
  The value is that a future signature change fails at compile time in the spec
  rather than at runtime.

### 2.2 `cli-engine` specs log `migrationRunner.runMigrations is not a function`

**Where**: emitted from `libs/backend/cli-engine/src/lib/testing/with-engine.ts:292` —
the test engine's migration-runner fake lacks the method. Pre-existing; not
introduced by Batch 8.

- **Why deferred**: noise, not a failure — the suites pass. Fixing it is a
  one-method addition to a fake, which is not in any batch's owned file set.
- **Trigger/owner**: `cli-engine` owner. Add `runMigrations` to the fake so the
  log line stops masking a real one.

### 2.3 `electron-browser-capabilities.ts:610` returns an `error` field the detector does not flag

**Where**: `apps/ptah-electron/src/services/electron-browser-capabilities.ts:610`
— the outer `catch` in `stopRecording` returns
`{ filePath: '', …, error: '…' }`. The audit tool does not treat a populated
object literal as a sentinel, so it produced no row.

**It is not silent** — it carries the error. Recorded only so a later pass does
not read its absence from the row set as an oversight, and so the tool's
sentinel-detection scope is a known, deliberate boundary rather than a gap
someone rediscovers.

- **Trigger/owner**: no action required today. If sentinel-object detection is
  ever added to `tools/degradation-audit`, this is the first site to check it
  against.

### 2.4 The boot summary narrates the awaited chain only

**Where**: `apps/ptah-electron/src/activation/wire-runtime.ts` —
`logBootDegradationSummary`, armed via `coordinator.armBootSummary(...)` at `:497`
and fired from the post-window `.finally()` in
`apps/ptah-electron/src/activation/boot-coordinator.ts:472`.

Two documented limits, both accepted deviations from Batch 2:

1. A report issued from a **detached continuation** —
   `boot-heavy-services.ts`'s `prefetchPricing().catch(...)` and
   `cliDetection.detectAll().then(...)` — lands after the line has printed. It is
   tallied but never narrated.
2. A **workspace switch** boots through `booter.startOrJoin(active)` directly and
   never touches the coordinator, so its degradations accumulate with no second
   summary line. There is one summary per process, for the startup workspace.

- **Why deferred**: summarising a switch needs its own terminal signal, which is
  a new coordinator concept. Both limits are pinned by specs and written into the
  method's own doc comment.
- **Trigger/owner**: whoever converts one of those detached sites to
  `reporter.report(...)` must either move the report inside the awaited chain or
  accept that it is counted and never narrated.

### 2.5 `cli-engine` has no boot terminal, so there is no CLI summary line

**Where**: `libs/backend/cli-engine`. Batch 2 Task 2.1 said to emit the same
summary line from `cli-engine` **only if** a boot terminal already existed there.
It does not, and Batch 2 correctly declined to invent one.

- **Trigger/owner**: `cli-engine` owner, if and when the CLI grows a terminal boot
  transition of its own. Do not add one solely for the summary.

### 2.6 Two Batch 2 sites left without a code

**Where**: `apps/ptah-electron/src/activation/wire-runtime.ts` — the
workspace-change swallow beside the startup one, and `notifyCorruption`'s third
bare catch. Both were named out of scope in Batch 2 and left for a later triage
pass; Task 12.1's electron lane classified the file's flagged sites but the
"give it a reported code" decision is still open for these two.

- **Trigger/owner**: folds naturally into 1.2.

---

## P3 — naming, tooling and ergonomics

### 3.1 Rename the integrity worker to a neutral `db-worker` name

**Where**: `libs/backend/persistence-sqlite/src/lib/integrity/integrity-worker.ts`,
`integrity-worker-protocol.ts`, `worker-process.port.ts`
(`IIntegrityWorkerProcessFactory` / `IIntegrityWorkerProcess`),
`PERSISTENCE_TOKENS.INTEGRITY_WORKER_PROCESS_FACTORY` /
`INTEGRITY_WORKER_PATH`, and the esbuild target `build-integrity-worker` in each
host's `project.json`.

The worker now serves **two** commands, `check` and `backup` (Batch 6), so its
name describes only half its job. `DbWorkerRunner` — the run loop both services
share — already carries the neutral name; the worker and its port do not.

- **Why deferred**: the rename touches the esbuild target name in **three wiring
  places per host** (`build.dependsOn`, `build-dev.options.commands`,
  `serve:watch.options.commands` — see `apps/ptah-electron/CLAUDE.md`), plus
  `test.dependsOn` and the per-host `esm-bundle-gate.spec.ts` discovery lists.
  `batches.md`'s rebase step names build-target renames as _the_ hazard for
  keeping the conflict surface small on a branch that must rebase onto `main`
  after PR #463.
- **Trigger**: **rename when a third command lands.** Two commands are carried
  fine by a stale name; three means the name is actively lying, and the
  per-command split (`check` / `backup` / …) is due at the same moment —
  `integrity-worker-protocol.ts` is already 666 lines against the 700-line soft
  ceiling (Batch 6 deviation 1), and the split to make there is per-command, not
  a `helpers` file.
- **Owner**: `persistence-sqlite`, with the three host `project.json` files.

### 3.2 Audit tool: a marker on a `catch` the tool does not flag is silently honoured

**Where**: `tools/degradation-audit/check-degradation.ts`. The header promises "a
misplaced comment is never silent", backed by `bare-suppression` (a marker that
does not parse) and `orphaned-suppression` (a marker that attaches to nothing).
The gap is the middle case: a marker that lands on a `catch` the detector did not
flag is neither honoured against the site it _describes_ nor reported.

Found the hard way in Batch 5, when a lane pasted a marker ~160 lines from the
site it described; the reconciling sub-agent overrode it in
`skill-synthesis/.../skill-scorecard.service.ts`.

- **Trigger/owner**: tool owner. Worth doing before the next classification pass,
  because the failure is invisible to a reviewer reading a comment-only diff.

### 3.3 Audit tool: the wrapped-marker rule is undocumented

**Where**: same file. A wrapped (multi-line) marker must carry at least one word
of **reason on its own line**, or it is read as a bare suppression. This cost one
hand edit during Batch 5's 80-column rewrap of 109 markers.

- **Trigger/owner**: tool owner. One paragraph in the file header plus a wrapped
  example. Cheap, and it prevents a whole class of confusing CI failure.

### 3.4 Audit tool: `--update-baseline` needs a `--dir` filter

**Where**: same file — the baseline writer rewrites **every** directory entry.

With several batches sharing one worktree, a global rewrite bakes another batch's
mid-flight count into the ratchet. This is the concrete reason Batch 5's Task 5.7
re-baseline had to be deferred into Batch 6's commit, and why Task 12.1's
re-baseline had to wait for an empty worktree.

- **Trigger/owner**: tool owner, before the next multi-lane classification pass.

### 3.5 Audit tool: `parseMarkerLine` collapses "no reason" and "unrecognised form"

**Where**: `tools/degradation-audit/check-degradation.ts:360-372` — `ParsedMarker`
is `{ valid: boolean; raw: string }`, so a marker with a valid kind and no reason
reports identically to one with a malformed separator or an unknown kind. Filed as
a cosmetic minor by the Batch 3 logic review (Revision 2) and explicitly
non-blocking; detection and suppression are unaffected either way.

- **Trigger/owner**: tool owner, opportunistically. The value is a better CI
  message, nothing more.

### 3.6 Register a `degradation-audit` scope in `.commitlintrc.json`

**Where**: `.commitlintrc.json`, `scope-enum`. There is no `tools` and no `audit`
entry, so **three** commits in this task had to substitute a registered scope:
Batch 3 (`build(tools)` → `build(ci)`), Batch 5 (`chore(audit)` → `chore(ci)`) and
Task 12.1 (same substitution). `di-lint` is already a registered scope, which is
the precedent.

- **Why deferred**: it is a config change outside every batch's owned file set,
  and the substitution was accurate enough not to justify widening scope
  mid-batch.
- **Trigger/owner**: one line. Add `degradation-audit` (or a general `audit`)
  beside `di-lint`.

### 3.7 `build-artifact-gate.ts` exists in four copies

**Where**: `apps/ptah-electron/src/config/build-artifact-gate.ts`,
`apps/ptah-cli/src/test-utils/build-artifact-gate.ts`, and the equivalents under
`apps/ptah-extension-vscode` and `apps/ptah-tui`, alongside four per-host
`esm-bundle-gate.spec.ts` files that each duplicate the discovery and
conditional-require logic.

This is an **accepted cost**, recorded so it is not mistaken for drift: it is the
direct consequence of the ruling that four apps do not justify a shared lib, and
it is what buys cross-host false-red immunity (Batch 4, code-logic-review FM-1 —
a shared, all-hosts gate turned one host's unbuilt artifact into a CI failure on
hosts the PR never touched).

- **Trigger/owner**: revisit only if a **fifth** host appears, or if the four
  copies start to diverge in behaviour rather than just in their target lists.

### 3.8 `DegradationReporter` cap notice latches before the log attempt

**Where**: `libs/backend/vscode-core/src/logging/degradation-reporter.ts` —
`reportCapOnce` latches before it attempts the `logger.error`, so a logger
registered _after_ the cap was hit never receives the notice. Working as
documented ("at most once per process"); filed as a comment-precision minor by the
Batch 1 logic review.

- **Trigger/owner**: no action expected. Recorded so a future reader does not
  read it as a bug.

---

## Closed measurement

### A-2 — `PRAGMA optimize` cost — MEASURED, no action needed

`PRAGMA optimize` runs at `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts:407`
(and the CLI twin in `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts`).
It stays on the host by necessity — it writes, so it cannot move into the
read-only worker — and unlike `incremental_vacuum(100)` it is **unbounded**.
Batch 9 Task 9.2 timed it in isolation on a ~1 GB copy of the real database.

**Result: it is not a boot cost.** Measured 2026-09-07 with `better-sqlite3`
under `ELECTRON_RUN_AS_NODE=1` (plain `node` cannot load the module — it is
rebuilt for the Electron ABI):

| Measurement                                   | Result |
| --------------------------------------------- | -----: |
| `journal_mode = WAL`                          |   2 ms |
| `PRAGMA optimize`, fresh connection           |   0 ms |
| Touch all 57 user tables (`select * limit 5`) |  36 ms |
| `PRAGMA optimize`, after that load            |   0 ms |
| `analysis_limit=400` then `optimize`          |   0 ms |

The fresh-connection figure alone proves nothing, because `PRAGMA optimize`
only analyzes tables the connection already queried. The figure after the table
load is the one that counts, and it is also 0 ms. A prior session measured
100 ms cold and 27 ms warm on the same database. Both sets agree.

**A-2 is closed. No follow-up. The unbounded call stays on the host.**

---

## Recorded defects, not fixed

27 sites: **18** from Batch 5 (six uncontested libs, `batch-5-report.md`) and
**9** from Task 12.1 (four contested libs, `triage/*-report.md`). Every one was
left byte-for-byte untouched — no suppression, no fix — so each still appears as
an unsuppressed row in `degradation-audit:lint` and is held at its library's
baseline.

The dominant class is not "an error was ignored" but **"a failure was encoded as
a legitimate empty or negative value"** — `[]`, `{}`, `''`, `null`, `false`,
`undefined` — that no caller can tell apart from a true result.

### `libs/backend/harness-sync` (6) — the destructive-empty-state cluster

Highest priority of the 27: all six can drive a **deletion**, because
reconciliation reads an empty desired state as authoritative and reaps managed
artifacts.

| #   | Site                                                   | Masked failure                                                                                                                                | Suggested fix                                                                                                       |
| --- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/lib/manifest/harness-manifest.builder.ts:390`     | An unreadable skills source root becomes an authoritative **empty desired state**, so reconciliation reaps previously managed skills.         | Distinguish "read failed" from "no skills"; abort the reconcile pass rather than publishing an empty desired state. |
| 2   | `src/lib/manifest/harness-manifest.builder.ts:530`     | Same shape for the commands/agents roots.                                                                                                     | As above.                                                                                                           |
| 3   | `src/lib/sources/plugin-config-source-resolver.ts:189` | An MCP intent-store failure returns `[]`, read as "the user configured no servers"; servers they still have are removed.                      | Propagate the store failure; a reconcile with an unreadable intent store must not run.                              |
| 4   | `src/lib/targets/mcp/codex-toml-mcp-facet.ts:183`      | An unreadable Codex TOML config becomes `''`; the next mutation writes that empty content over unrelated user configuration.                  | Treat an unreadable existing config as a hard stop for the mutation, not as an empty document.                      |
| 5   | `src/lib/targets/mcp/json-mcp-facet.ts:172`            | An unreadable or malformed JSON config becomes `{}`; a subsequent write can erase unrelated user entries.                                     | As above.                                                                                                           |
| 6   | `src/lib/targets/workspace-target.ts:413`              | An agent source-read/transform failure returns `null`, omitting that agent from desired state and letting the reaper delete its managed copy. | Carry the failure into the pass result so the reaper skips, rather than deletes, an agent it could not read.        |

### `libs/backend/cli-agent-runtime` (2) — corruption reported as absence

| #   | Site                                                       | Masked failure                                                                                                                        | Suggested fix                                                                                                                     |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 7   | `src/lib/mcp-directory/oauth/mcp-oauth-token-store.ts:61`  | A corrupted stored OAuth token returns `null`, identical to "never connected", hiding credential loss behind a silent re-auth prompt. | Return a tri-state (present / absent / corrupt) so the caller can say "your saved credential is unreadable" instead of "sign in". |
| 8   | `src/lib/mcp-directory/smithery-installed-manifest.ts:181` | A corrupted per-server config returns `{}` with **no log**, so the MCP server silently runs unconfigured.                             | At minimum log at `warn`; better, refuse to start a server whose config could not be read.                                        |

### `libs/backend/agent-generation` (1)

| #   | Site                                                                          | Masked failure                                                                                                                                                                                                                                      | Suggested fix                                                                                                     |
| --- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 9   | `src/lib/services/user-layer/user-layer-mirror.service.ts:1600` (was `:1575`) | `seedLegacyAgents` swallows **every** error from `readdir(legacyRoot)` — no ENOENT check, no log, no error counter — unlike every sibling mirror method in the same file, so a real I/O failure silently skips the one-time legacy-agent migration. | Adopt the sibling shape: ENOENT is the expected absent case, anything else logs and increments the error counter. |

### `libs/backend/workspace-intelligence` (1)

| #   | Site                                 | Masked failure                                                                                                                    | Suggested fix                                                                                                        |
| --- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 10  | `src/context/context.service.ts:789` | An ignore-file parse failure silently drops the user's custom exclude patterns, so more files than intended enter the AI context. | Log the parse failure and surface it; a dropped ignore file is a privacy-adjacent change the user should hear about. |

### `libs/backend/skill-synthesis` (6)

| #   | Site                                      | Masked failure                                                                                                                                                                     | Suggested fix                                                                                 |
| --- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 11  | `src/lib/skill-curator.service.ts:778`    | A failed curator report write returns `''`, a path the caller cannot distinguish from a real one.                                                                                  | Return `null` (or throw); `''` must not be a path.                                            |
| 12  | `src/lib/skill-enhancer.service.ts:1019`  | `readBody` maps any read failure to `null`, so an unreadable clone is reported as a missing one.                                                                                   | Distinguish missing from unreadable in the return type.                                       |
| 13  | `src/lib/skill-suggestion.store.ts:219`   | `parseStringArray` turns malformed persisted JSON into `[]`, silently emptying a suggestion's membership list.                                                                     | Treat a malformed persisted value as a corrupt row: ignore the row, do not silently empty it. |
| 14  | `src/lib/skill-synthesis.service.ts:853`  | A failed supersede of an existing candidate is warned and then swallowed, so candidate persistence silently does not happen.                                                       | Fail the synthesis run rather than reporting success with nothing persisted.                  |
| 15  | `src/lib/skill-synthesis.service.ts:883`  | A failed `SKILL.md` write returns `null`; the synthesized candidate is lost.                                                                                                       | Propagate the write failure; the run's result must say it produced nothing.                   |
| 16  | `src/lib/skill-synthesis.service.ts:1109` | `isDominatedByAuthoredSkill` **fails open** to `false`, so a registry error lets an authored skill be re-synthesized — the exact thing its own doc comment says must never happen. | Fail closed: a registry error means "cannot prove it is not dominated", so skip.              |

### `libs/backend/vscode-lm-tools` (2)

| #   | Site                                                                           | Masked failure                                                                                                                       | Suggested fix                                                                       |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| 17  | `src/lib/code-execution/namespace-builders/analysis-namespace.builders.ts:364` | `getDependencies` turns a real "no workspace folder open" throw into `[]`, which the agent reads as "this file has no dependencies". | Follow the sibling `buildGraph` in the same file, which surfaces its error message. |
| 18  | `.../analysis-namespace.builders.ts:376`                                       | `getDependents` — identical defect.                                                                                                  | As above.                                                                           |

### `libs/backend/rpc-handlers` (1) — Task 12.1

| #   | Site                                         | Masked failure                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Suggested fix                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 19  | `src/lib/handlers/agent-rpc.handlers.ts:947` | `resolveDefaultPtahCliId`'s bare `catch { return undefined; }` makes a `ptahCliRegistry.listAgents()` failure — corrupt registry, settings-store failure, disk error — indistinguishable from "no enabled agent has an API key". There is **no log line at all**. The sole caller (`agent:resumeCliSession`, `:785-797`) then throws "No Ptah CLI agents configured. Add one in Agent Orchestration settings.", sending the user to a settings page where their agent already exists. | **Preferred**: delete the catch and let it propagate — `agent:resumeCliSession` already has a `try/catch` at `:436` that logs and rethrows. **Alternative**: keep the fallback but return `{ kind: 'none' } \| { kind: 'unavailable' }` so `:794` can raise "Could not read the Ptah CLI agent registry". Either way, pin the two messages apart with a spec — the throwing `listAgents()` path has no coverage today. |

### `libs/backend/agent-sdk` (4) — Task 12.1

| #   | Site                                                   | Masked failure                                                                                                                                                                                                                                                                                                                                                                                             | Suggested fix                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 20  | `src/lib/helpers/subagent-message-dispatcher.ts:424`   | Any transcript read failure — malformed JSONL, EPERM on the session directory, a `findWorkflowAgentTranscript` throw — returns `[]`, byte-identical to "this subagent has produced no messages yet". The `warn` reaches the log only; the panel renders an idle agent.                                                                                                                                     | Return a discriminated result (`{ ok: true, messages }` / `{ ok: false, code }`), or emit a degradation event such as `SUBAGENT_TRANSCRIPT_READ_FAILED` carrying `sessionId`/`agentId`. Add a positive-path spec against a real temp JSONL tree — `workflow-transcript-reader.ts` documents one. |
| 21  | `src/lib/sdk-transcript-reader.adapter.ts:40`          | A failed `readHistoryForCuration` returns `''`, and `''` is a valid transcript. The memory curator and skill synthesis then curate an empty conversation and report a successful run. This exact shape already shipped a defect (TASK_2026_293 curated a placeholder).                                                                                                                                     | Throw, or return `null` distinctly from `''`, so the curator abandons the run. Failing that, emit `TRANSCRIPT_READ_FAILED` and have the curator refuse to write on a degraded read.                                                                                                              |
| 22  | `src/lib/session-importer.service.ts:634` (now `:637`) | `findSessionsDirectory` has already proven the directory exists, so a `readdir`/`stat` failure here is a genuine I/O error — logged at **`debug`**, returning `[]`. `importFromJsonlFiles` reports zero imported sessions as an ordinary result. A user with an unreadable `~/.claude/projects/<ws>` sees an empty session list and no signal anywhere.                                                    | Raise to `warn`, emit `SESSION_IMPORT_SCAN_FAILED` with `sessionsDir` and the errno, and let the return value distinguish "scanned, found none" from "could not scan".                                                                                                                           |
| 23  | `src/lib/settings-export.service.ts:96`                | A secret-storage read failure — locked keychain, a `SecretStorage` backend not yet ready — returns `undefined`, and `collectSettings` omits the key. The class doc sanctions this for **missing** keys, but a read failure is not a missing key: the export is written looking complete, `secretCount` counts the survivors, and the user finds out at restore time that their license or API key is gone. | Make `getSecret` tri-state (`present` / `absent` / `failed`), and have `collectSettings` either fail the export or attach a `degraded: [keys]` field plus a `SETTINGS_EXPORT_SECRET_UNREADABLE` event, so the export file records that it is incomplete.                                         |

### `apps/ptah-electron` (4) — Task 12.1

| #   | Site                                                                          | Masked failure                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Suggested fix                                                                                                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 24  | `src/services/rpc/handlers/editor-rpc.handlers.ts:977`                        | `buildFileTree`'s own `catch { return []; }` wraps `await this.fs.readDirectory(dirPath)`, making both callers' error handlers structurally dead (`editor:getFileTree` `:352-365`, `editor:getDirectoryChildren` `:388-402` each log at `error` and return `{ success: false }`). A workspace root that cannot be enumerated returns `{ success: true, tree: [] }` and renders as an empty project.                                                                 | Let the top-level `readDirectory(dirPath)` rejection propagate, and keep degradation only where it is genuinely per-node — attach `.catch(() => [])` to the **recursive** `buildFileTree(fullPath, …)` call at `:957`. No new reporting surface needed; the callers already handle it. |
| 25  | `src/ipc/ipc-bridge.ts:313`                                                   | `this.handleFireAndForgetMessage(messageType, msg);` is a bare call to an `async` method inside `ipcMain.on('rpc', async …)`, so the enclosing `try`/`catch` (`:292`/`:337`) cannot see a rejection. This is the ingress path for every fire-and-forget renderer message. Latent today only because every `case` body (`:383-490`) has its own guard and the method contains no `await` — an invariant nobody enforces.                                             | `void this.handleFireAndForgetMessage(...)` with a `.catch()` logging through the same path — or, since it never awaits, drop `async` and make it synchronous, removing the failure class rather than handling it.                                                                     |
| 26  | `src/services/electron-browser-capabilities.ts:433`                           | `setTimeout(() => { this.cleanup(); }, MAX_LIFETIME_MS)` calls `cleanup()` bare. `cleanup()` (`:517-544`) awaits `recorder.stopRecording(...)` and calls `debugger.detach()`; either can throw, and everything after the failed `await` is skipped — `clearTimeout` on both timers, `detach()` and `window.destroy()` never run. A session that fails to stop recording outlives its own maximum lifetime with a live `BrowserWindow` and an attached CDP debugger. | `void this.cleanup().catch((error: unknown) => …)` at both sites, **and** move the `recorder.stopRecording` await inside `cleanup()` into its own `try` so a recorder failure cannot skip the window and timer teardown.                                                               |
| 27  | `src/services/electron-browser-capabilities.ts:513` (tool now reports `:516`) | The inactivity timer — identical shape to 26.                                                                                                                                                                                                                                                                                                                                                                                                                       | As above.                                                                                                                                                                                                                                                                              |

Neither 26 nor 27 is on the boot path; both are on the automatic teardown path
for a capability that holds an OS window.

---

## Defects in the measurement instrument (`measure-boot-rpcs.mjs`)

Found while running Batch 9 on 2026-09-07. The probe is the tool this task
depends on to answer its own gate question, so its defects cost measurement
time directly. None was fixed — Batch 9 owns no files.

### P-1 — intermittent attach failure

`electronApplication.evaluate: Execution context was destroyed` aborts the run
before the probe installs. Measured rate this session: roughly **1 attempt in
3**, with one stretch of 4 consecutive failures. Batch 9 needed seven-plus
attempts to collect three runs.

The application is not at fault. A direct `electron.exe main.mjs` launch with
identical arguments, database and environment boots correctly through
`SQLite connection opened + migrated successfully`. Two prior sessions hit the
same failure and attributed it to transient load after a cache-eviction pass.
That explanation is incomplete — the failure also occurs with no eviction
before it. It is not tied to boot speed either: a controlled check on
steady-state boots succeeded 2 of 3.

**Suggested fix**: retry `app.evaluate(INSTALL_PROBE)` a few times with a short
delay before giving up, rather than exiting on the first rejection.

### P-2 — the failure path prints no diagnosis

`measure-boot-rpcs.mjs:222-244`. On the early-failure path the script tells the
reader to "read the stdout above — it is captured before this point and names
the reason". It is not above. The `record` handler pushes every line into a
local `stdout` array (`:222-228`) and that array is never printed on this path.
The reader gets one Playwright error and nothing else, which is what made P-1
take a direct-launch reproduction to diagnose.

**Suggested fix**: print the collected `stdout` array before `process.exit(1)`.
The instruction in the message is already correct — only the implementation is
missing.

### P-3 — the report prints arrival times, not durations

`report()` (`:297-373`) prints each RPC's arrival offset and its outcome, but
never `answeredAt - sentAt`. Batch 9 exists to compare handler **durations**
against a baseline, so every duration in `batch-9-raw-measurement.md` had to be
computed by hand from `tmp/boot-probe.json`. The trace holds both timestamps,
so the data is there — only the report omits it.

**Suggested fix**: add a duration column, and sort a second table by duration
descending.

### P-4 — event-loop lag is not in the probe's own output

380 criterion 2 is a lag ceiling, and the probe cannot report against it. The
lag figures in `batch-9-raw-measurement.md` were recovered from the app's own
`[event-loop] lag` lines in `userData/logs/*.log`, reachable only because
`--keep-db` retains the userData directory. `NODE_ENV=production` suppresses
the console transport that would otherwise echo those lines to the probe's
stdout.

**Suggested fix**: have the probe read the retained log and fold the lag
samples into its report, so a criterion-2 verdict does not depend on a reader
knowing the log exists.

---

## Not carried forward

Recorded so a future reader does not spend time rediscovering that these were
considered and closed:

- **Batch 6's rotation-prefix hazard** (a `-wal`/`-shm` sidecar taking a rotation
  slot) was carried to Batch 7 and **closed there** — `discardArtifact` is
  sidecar-aware and `removeBackupArtifact` owns the suffix list.
- **R-8** (worker bare-run determinism) was answered "neither": both
  `embedder-worker.ts` and `voice-worker.ts` already throw synchronously at module
  evaluation, so no `--self-test` argument was added.
- **R-4** (CI test-before-build ordering) was resolved at the Nx graph level via
  `test.dependsOn`, not by reordering `ci.yml`, which is why the `ci.yml` reorder
  was reverted.
- **The husky `nx format:write` drift hazard** (Batch 5 and Task 12.1 both had a
  "comment-only" commit reformatted by the pre-commit hook) is already documented
  in the root `CLAUDE.md` release-branch section. Both corrections are recorded in
  `batches.md` rather than amended, per the repo's never-amend rule.
