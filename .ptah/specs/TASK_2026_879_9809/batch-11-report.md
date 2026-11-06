# Batch 11 report

Implemented the disposable SQLite seeder and the opt-in System One payload/live checker:

- `scripts/dev/seed-lane-outcomes.mjs` applies real `MIGRATIONS` through `SqliteMigrationRunner`, writes lane and subagent outcome rows, and prints a summary. It refuses profile paths and existing files without `seed_meta`.
- `scripts/dev/check-past-outcomes-live.mjs` reads through the real `LaneOutcomeReader` and `SqliteLaneOutcomeStore`, aggregates via `outcomeFiguresFrom`, builds via `buildDecisionPayload`, validates the request and optional response schemas, and prints the payload. It makes no network call without `--live`.

## Commands for orchestrator

```sh
node scripts/dev/seed-lane-outcomes.mjs --db /tmp/ptah-b11-orchestrator.sqlite --seed 7
node scripts/dev/check-past-outcomes-live.mjs --db /tmp/ptah-b11-orchestrator.sqlite --lane-ids codex,grok --task-kind implement
node scripts/dev/check-past-outcomes-live.mjs --db /tmp/ptah-b11-orchestrator.sqlite --lane-ids codex,grok --task-kind implement --live --base-url http://127.0.0.1:11435 --model d3:4b
```

Use a fresh disposable path for the first command. The live command requires the Chappie tunnel.

## Verification

- `node --check` on both scripts: passed.
- `npx eslint scripts/dev/seed-lane-outcomes.mjs scripts/dev/check-past-outcomes-live.mjs`: passed, no warnings after cleanup.
- Seeder on `/tmp/ptah-b11-smoke-6.sqlite --seed 7`: `rows=78`; table included three CLI lanes across six task kinds and four verdicts, three subagent rows, and three older rows.
- Checker without `--live`, using `--lane-ids codex,grok --task-kind implement`: passed; keys `codex/implement, grok/implement`, each `{delivered:1, failed:2}`. These counts exclude the old delivered rows and unverified rows.
- `ptah_get_diagnostics` reported no diagnostics in either requested script. It reported 470 errors in sibling source files outside this batch, primarily unresolved aliases and rootDir mismatch in the scripts project.
- `npm run verify` and Nx were not run per task instruction and sandbox socket limitation. The live call was not run; the orchestrator owns that step.
- The forbidden real `~/.ptah` path was never passed to either script. The safety check is implemented but was not smoke-run against that path, per the task's explicit prohibition.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Load the migration runner and migrations through targeted TS modules, with `jiti` alias mapping | Import the broad persistence barrel | The barrel loaded VS Code runtime dependencies in the smoke run; direct modules run under system Node | yes |
| Put migration archives beside the disposable DB and check that path too | Let runner default to `~/.ptah/backups` | Runner's `archiveSkillPipeline` default targets the real profile; smoke run exposed this | yes |
| Read outcomes through `LaneOutcomeReader` over `SqliteLaneOutcomeStore` | Mirror the reader with read-only SQL | The real store and reader load and pass the checker smoke run | yes |
| Anchor generated times to the UTC day | Use current millisecond timestamp | Same seed and flags should produce identical seeded records within the day while staying in the reader's 90-day window | yes |

## Fix round 1

- The seeder probes an existing database read-only for `seed_meta`, closes it, then opens it read-write. Profile-path and missing-marker refusals print one line and exit 2.
- Added `--profile skewed` (default) and `--profile uniform`. The skewed profile has 20 verified rows per lane/task kind, with 18/20, 10/20, and 3/20 delivery for the first three lanes. It retains unverified, subagent, and old rows.
- The checker constructs a `laneQuestion` from the shipped `phase-plan.ts`, gives all lanes score 80, and captures the payload through `runLaneRequest`. `--live --ab` sends this question with and without outcomes and prints choice, probabilities, confidence, threshold pass, and latency. The result is validated by `SystemOneResultSchema`.
- Added `scripts/dev/README.md` with local and live commands.

Exact smoke commands:

```sh
node --check scripts/dev/seed-lane-outcomes.mjs
node --check scripts/dev/check-past-outcomes-live.mjs
node scripts/dev/seed-lane-outcomes.mjs --db /tmp/ptah-b11-fix1.sqlite --seed 7
node scripts/dev/check-past-outcomes-live.mjs --db /tmp/ptah-b11-fix1.sqlite --lane-ids codex,grok,antigravity --task-kind implement
npx eslint scripts/dev/seed-lane-outcomes.mjs scripts/dev/check-past-outcomes-live.mjs
```

The non-live checker showed `codex/implement 18 delivered, 2 failed`, `grok/implement 10 delivered, 10 failed`, and `antigravity/implement 3 delivered, 17 failed`; all option scores were 80. The orchestrator can run the live comparison with:

```sh
node scripts/dev/check-past-outcomes-live.mjs --db /tmp/ptah-b11-fix1.sqlite --lane-ids codex,grok,antigravity --task-kind implement --live --ab --base-url http://127.0.0.1:11435 --model d3:4b
```

Existing unmarked SQLite refusal check:

```sh
node scripts/dev/seed-lane-outcomes.mjs --db /tmp/ptah-b11-smoke.sqlite --seed 7
```

It exited 2 and printed exactly `Existing database lacks seed_meta marker` on one line. No profile path was used. `npm run verify`, Nx, and `--live` were not run in this lane.

Final scoped lint and `node --check` passed with no output. `ptah_get_diagnostics` found no diagnostics in the two scripts; it reported 470 sibling project errors outside this batch (the same alias/rootDir issue as before).
