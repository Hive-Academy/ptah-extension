# Evaluate Memory and Skills actions

Use this guide in the Electron desktop app. Make one observable change at a time,
then compare the UI with the read-only database and log checks below. A successful
click is evidence of a request, not proof that the background work completed.

## Before you begin

`resolvePtahDbPath` in
`libs/backend/persistence-sqlite/src/lib/db-path.ts` chooses the database.
`PTAH_DB_PATH` overrides the profile. Otherwise it uses `~/.ptah/state/ptah.sqlite`
for production, `~/.ptah/state/ptah-dev.sqlite` for development, and
`~/.ptah/state/ptah-test.sqlite` for test. Confirm which profile launched the
app before inspecting data. Set `PTAH_EVAL_DB` to that exact file and
`PTAH_EVAL_LOG` to the Electron log being inspected. The log location in the
task plan is `~/.config/Ptah/logs/Ptah Electron-<date>.log`; choose the actual
dated file. The following Python commands use SQLite's `mode=ro` URI and cannot
create a missing database:

```bash
export PTAH_EVAL_DB="$HOME/.ptah/state/ptah.sqlite" # change for the running profile or PTAH_DB_PATH
export PTAH_EVAL_LOG="$HOME/.config/Ptah/logs/Ptah Electron-<date>.log"
python3 - <<'PY'
import os, sqlite3
from pathlib import Path
db = sqlite3.connect(Path(os.environ['PTAH_EVAL_DB']).resolve().as_uri() + '?mode=ro', uri=True)
print(db.execute('SELECT name FROM sqlite_master WHERE type = ?', ('table',)).fetchall())
db.close()
PY
```

If the file does not open, check the selected profile and `PTAH_DB_PATH` rather
than creating a database for this evaluation.

## Memory curator

**Trigger and expected result.** Click **Run curator now** in Memory diagnostics
to request `memory:runNow`. Automatic curation can follow an idle or turn
threshold, a completed turn, an episode, or a session end; the trigger switches
and hourly budget in `memory-trigger-config.ts` gate these paths. The boot scan
also revisits eligible unscanned transcripts after startup. Watch the Memory
diagnostics activity and last run: a stalled pass leaves its observations for
another pass; a failed pass reports a fixed sentence. The curator provider
picker excludes `openai-codex` because its native runtime cannot serve this
background query. A pinned or inherited Codex choice can still reach the
backend refusal, which reports `provider-unsupported`.

`curatorRunMessage` in
`libs/backend/memory-curator/src/lib/curator-llm/curator-activity-log.ts`
supplies these **exact** sentences (`KEPT` expands to the same final sentence):

| Reason code                  | Sentence shown                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `provider-unsupported`       | The memory curator cannot run on OpenAI Codex. Choose another provider for Memory curator in Settings > Background model roles.       |
| `auth-required`              | The memory curator's provider is not signed in or its sign-in expired. Check it in Settings > Background model roles, then run again. |
| `curator-error`              | The curator run failed. See the logs for details.                                                                                     |
| `provider-cooling-down`      | The curator's provider is rate-limited, so this pass did not run. Observations are kept for the next pass.                            |
| `provider-unreachable`       | The curator's provider could not be reached. Observations are kept for the next pass.                                                 |
| `no-output`                  | The curator finished without returning a result. Observations are kept for the next pass.                                             |
| `concurrency-slot-timeout`   | The curator waited too long for a free model slot. Observations are kept for the next pass.                                           |
| `curator-queue-wait-timeout` | The curator pass waited too long in the queue. Observations are kept for the next pass.                                               |
| `caller-aborted`             | The curator pass was cancelled before it started. Observations are kept for the next pass.                                            |
| `network-backoff`            | The curator is pausing after recent network failures. Observations are kept for the next pass.                                        |
| `host-shutdown`              | The curator pass was cancelled because the app is shutting down. Observations are kept for the next pass.                             |

Inspect `memories.created_at`, `memory_chunks`, and `observation_queue` to see
whether new content was stored and pending observations were consumed. The
curator settings are `memory.curatorProvider` and `memory.curatorModel`; trigger
settings include `memory.triggers.maxCuratesPerHour` and
`memory.triggers.maxObservationsPerCurate`. A tool failure enters diagnostics as
`tool-failure`: `memory-trigger.service.ts` passes a bounded snippet through
`redactSecrets` in `triggers/redact-secrets.ts` before the UI event. The raw
failure stays in the backend log. Check the rendered snippet for redaction;
do not copy raw failure text into an evaluation report.

```bash
python3 - <<'PY'
import os, sqlite3
from pathlib import Path
db = sqlite3.connect(Path(os.environ['PTAH_EVAL_DB']).resolve().as_uri() + '?mode=ro', uri=True)
for sql in ('SELECT created_at FROM memories ORDER BY created_at DESC LIMIT 5',
            'SELECT COUNT(*) FROM memory_chunks',
            'SELECT COUNT(*) FROM observation_queue'):
    print(sql, db.execute(sql).fetchall())
db.close()
PY
rg -n '\[memory-curator\]|\[memory-trigger\] tool failure|curator LLM run failed|curation pass stalled' "$PTAH_EVAL_LOG"
```

The adapter's refusal log is exactly
`[memory-curator] curator provider not supported for background curation; pass skipped`.
Use `npm run verify -- -t test -p @ptah-extension/memory-curator` for the
curator behavior specs and
`npm run verify -- -t test -p @ptah-extension/agent-sdk` for the adapter specs.

## Memory search index rebuild

**Trigger and expected result.** Request the Memory search rebuild action,
which calls `memory:rebuildIndex`. On success the store's result describes the
rebuild. On failure the handler throws the fixed user error
`Could not rebuild the memory search index. See the logs for details.`; the
failure must not look like a successful empty result. The raw cause is logged
under `[memory] rebuildIndex failed`.

Inspect the `memories` and `memory_chunks` tables around a rebuild; these are
the searchable memory surface. Rebuild does not have a separate setting key in
the handler. Check the exact error and log prefix in
`libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts`.

```bash
python3 - <<'PY'
import os, sqlite3
from pathlib import Path
db = sqlite3.connect(Path(os.environ['PTAH_EVAL_DB']).resolve().as_uri() + '?mode=ro', uri=True)
for table in ('memories', 'memory_chunks'):
    print(table, db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0])
db.close()
PY
rg -n '\[memory\] rebuildIndex failed' "$PTAH_EVAL_LOG"
```

Run `npm run verify -- -t test -p @ptah-extension/rpc-handlers` for the
handler specs and `npm run verify -- -t test -p @ptah-extension/memory-curator`
for the store behavior.

## Code index

**Trigger and expected result.** **Re-index** calls `indexing:start`; the
status request is `indexing:getStatus`. The Electron boot path in
`libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts` starts a background
workspace scan and joins the indexing census. Observe the running state,
progress, and last run summary. `IndexingControlService` emits
`INDEXING_COMPLETE` when the census succeeds and `INDEXING_FAILED` when it
fails. A click may join a background run; pause or cancel detaches that click
while the background scan continues.

The `indexing_state` row is keyed by `workspace_fingerprint`. Inspect
`last_run_json`, `last_indexed_at`, `last_error`, `symbols_enabled`, and
`memory_enabled`; migration `0070_indexing_last_run.ts` adds `last_run_json`.
`code_symbols` holds symbol rows. The pipeline switches are stored in the
`indexing_state` row through `indexing:setPipelineEnabled`; there is no
additional settings key needed for this check.

```bash
python3 - <<'PY'
import os, sqlite3
from pathlib import Path
db = sqlite3.connect(Path(os.environ['PTAH_EVAL_DB']).resolve().as_uri() + '?mode=ro', uri=True)
print(db.execute('SELECT workspace_fingerprint, last_indexed_at, last_error, symbols_enabled, memory_enabled, last_run_json FROM indexing_state').fetchall())
print('code_symbols', db.execute('SELECT COUNT(*) FROM code_symbols').fetchone()[0])
db.close()
PY
rg -n '\[indexing-control\] (start|complete|indexing failed|start ignored — already running|last run could not be saved)' "$PTAH_EVAL_LOG"
```

Run `npm run verify -- -t test -p @ptah-extension/memory-curator` for the
census and push behavior, `npm run verify -- -t test -p @ptah-extension/thoth-runtime`
for boot integration, and `npm run verify -- -t test -p @ptah-extension/rpc-handlers`
for the RPC path.

## Skills harvest

**Trigger and expected result.** **Harvest now** calls
`skillSynthesis:harvestSpecs` with a manual origin. The `Stop` hook schedules
an automatic harvest for its workspace after a 90 second debounce. The
harvester reads task folders with a valid `task.md` carrier and records
attributed skill grades. `taskVerdict` marks a cancelled task failed; a done
task needs a decisive latest work review to be succeeded or failed. A tie in
the latest review time with conflicting verdicts leaves the task unresolved.
Document reviews are filtered out and never become grades. Tasks in progress
and folders without a valid carrier do not produce a verdict.

Inspect `skill_invocation_events.task_id`, `skill_slug`, `workspace_root`,
`succeeded`, `reconciled_at`, and `verdict_source`; the guarded update of
`reconciled_at` is the task-level reconciliation marker. Inspect
`skill_task_grades.task_id`, `subject_slug`, `workspace_root`, `verdict`, and
`source_file` for review grades. `session_task_links` connects a workspace and
session to a task. Harvest is action and hook driven; the listed handler and
trigger do not define a user setting key for this action.

```bash
python3 - <<'PY'
import os, sqlite3
from pathlib import Path
db = sqlite3.connect(Path(os.environ['PTAH_EVAL_DB']).resolve().as_uri() + '?mode=ro', uri=True)
print('unreconciled by task', db.execute('SELECT task_id, COUNT(*) FROM skill_invocation_events WHERE reconciled_at IS NULL GROUP BY task_id ORDER BY COUNT(*) DESC LIMIT 20').fetchall())
print('grades by slug and workspace', db.execute('SELECT subject_slug, workspace_root, verdict, COUNT(*) FROM skill_task_grades GROUP BY subject_slug, workspace_root, verdict ORDER BY subject_slug, workspace_root LIMIT 30').fetchall())
print('task links', db.execute('SELECT workspace_root, task_id, COUNT(*) FROM session_task_links GROUP BY workspace_root, task_id ORDER BY task_id DESC LIMIT 20').fetchall())
db.close()
PY
rg -n '\[spec-harvester\] (harvest complete|grade key owned by another workspace|skipped|conflicting review verdicts)|\[skill-synthesis\] spec harvest failed' "$PTAH_EVAL_LOG"
```

Run `npm run verify -- -t test -p @ptah-extension/skill-synthesis` for
extractor, harvester, and store specs, and
`npm run verify -- -t test -p @ptah-extension/rpc-handlers` for the manual RPC.

## Benchmark and scoped tests

The `tools/mcp-bench` memory-skills suite measures offline extraction, dedup,
update, retention, read-side and scope-write behavior, plus agreement with the
skills rubric. Run its unit specs with
`npm run verify -- -t test -p mcp-bench`. The Nx
`mcp-bench:bench-memory-skills` target depends on `build-host-memory-skills`;
run build-type targets only when requested. This offline benchmark cannot prove
the live provider route, RPC wiring, UI feedback, harvest reconciliation, or
the duration of the boot census. Use the flow checks above for those claims.

## Known limits

- An agent-tool reindex through `ptah.code.reindex` is not shown as running
  unless a UI click joins it. Pause or Cancel on a joined click detaches the
  click; the background scan continues and remains visible.
- Skill invocation events without a task ID cannot be reconciled to a task.
- Two processes sharing one database can race while writing the displayed
  `indexing_state.last_run_json` summary. A row read failure can also let an
  older summary overwrite a newer one. The impact is the displayed last run
  summary, as recorded in
  `.ptah/specs/TASK_2026_878_5513/open-review-items.md`.
