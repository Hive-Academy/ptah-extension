# Silent-degradation triage — `libs/backend/agent-sdk`

TASK_2026_383, Task 12.1. Worktree `task-383`, branch `task/383-degradation-audit`.
33 flagged sites, all classified. Edits are marker comments only — `git diff -U0`
over the lib contains no non-comment line.

## Split counts

| Label                          | Count |
| ------------------------------ | ----- |
| legitimate optional capability | 29    |
| reported                       | 0     |
| defect                         | 4     |
| test-only                      | 0     |
| **total**                      | 33    |

No site in this lib emits a structured degradation event today — `agent-sdk`
has no `DegradationReporter` consumer — so the `reported` bucket is empty by
construction, not by oversight.

## All 33 sites

Line numbers are the ones the inventory carried (pre-marker). The four defects
are unmarked and remain violations, which is why the audit count is 4.

| #   | Site                                                        | Label               | Reason                                                                                                         |
| --- | ----------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | `curator-llm-adapter/sdk-internal-query.curator-llm.ts:527` | optional-capability | Brace scan over LLM prose; a slice that will not parse is not the JSON object, `null` = "no JSON found".       |
| 2   | `detector/claude-cli-detector.ts:149`                       | optional-capability | WSL environment probe over `/proc/version`; `false` = "not WSL", identical to every non-Linux host.            |
| 3   | `detector/claude-cli-detector.ts:237`                       | optional-capability | Candidate-binary verification; `false` = "not a usable Claude CLI", caller moves to the next strategy.         |
| 4   | `detector/claude-cli-detector.ts:424`                       | optional-capability | npm-global detection strategy; `null` = "not installed this way", chain continues.                             |
| 5   | `detector/claude-cli-detector.ts:487`                       | optional-capability | PATH lookup strategy; `null` = "not on PATH", chain continues with WSL/common paths.                           |
| 6   | `detector/claude-cli-path-resolver.ts:117`                  | optional-capability | Shim-script unwrapping is an optimisation; `null` keeps the wrapper path the caller already holds.             |
| 7   | `helpers/code-symbol-prompt-injector.ts:77`                 | optional-capability | Symbol-index enrichment is additive prompt context; `''` omits the block, same as no hits.                     |
| 8   | `helpers/history/history-event-factory.ts:548`              | optional-capability | Transcript detail rendering; a cyclic value yields `''`, same as the null/undefined case.                      |
| 9   | `helpers/history/jsonl-reader.service.ts:203`               | optional-capability | `~/.claude/projects` absent on a machine that never ran the CLI; `null` = no transcript history.               |
| 10  | `helpers/history/jsonl-reader.service.ts:264`               | optional-capability | `mtimeMs` is only a cache validity token; `null` disables memoisation and forces the full scan.                |
| 11  | `helpers/memory-prompt-injector.ts:132`                     | optional-capability | Recalled memory is additive prompt context; `''` runs the turn without recall.                                 |
| 12  | `helpers/memory-prompt-injector.ts:207`                     | optional-capability | SessionStart subject list is additive; `''` starts the session unprimed rather than partially primed.          |
| 13  | `helpers/memory-prompt-injector.ts:267`                     | optional-capability | Corpus block already contracts to `''` for an unwired reader or absent corpus.                                 |
| 14  | `helpers/plugin-loader.service.ts:1075`                     | optional-capability | Plugin root is create-on-demand, so ENOENT is the ordinary empty case; any other errno warns first.            |
| 15  | `helpers/sdk-model-service.ts:727`                          | optional-capability | One link of the model-source chain; `[]` hands over to SDK tier slots and the exhausted chain warns.           |
| 16  | `helpers/sdk-model-service.ts:826`                          | optional-capability | `/v1/models` is an optional network catalog; `[]` equals a data-less response.                                 |
| 17  | `helpers/sdk-query-options-builder.ts:1059`                 | optional-capability | Pre-flight only moves a provider rejection earlier; skipping matches the no-cached-models path.                |
| 18  | `helpers/session-lifecycle/session-control.service.ts:103`  | optional-capability | `false` is the method's reported "interrupt did not take", same as the 3 s timeout; turn claim released.       |
| 19  | `helpers/subagent-message-dispatcher.ts:424`                | **defect**          | See D-1.                                                                                                       |
| 20  | `helpers/workflow-transcript-reader.ts:37`                  | optional-capability | Walks a speculative workflow-run tree that usually does not exist; `[]` = no entries here.                     |
| 21  | `sdk-agent-adapter.ts:608`                                  | optional-capability | Queued reset only waits for its predecessor to settle; that rejection already reached its own caller.          |
| 22  | `sdk-agent-adapter.ts:631`                                  | optional-capability | Reset waits out the in-flight init and discards its result either way.                                         |
| 23  | `sdk-transcript-reader.adapter.ts:40`                       | **defect**          | See D-2.                                                                                                       |
| 24  | `session-history-reader.service.ts:622`                     | optional-capability | Per-model pricing hydration; `null` = no pricing published, other models still hydrate.                        |
| 25  | `session-importer.service.ts:375`                           | optional-capability | Title-only classification probe; `false` keeps the file on the ordinary import path.                           |
| 26  | `session-importer.service.ts:634`                           | **defect**          | See D-3.                                                                                                       |
| 27  | `session-importer.service.ts:797`                           | optional-capability | Per-file metadata extraction; `null` skips one transcript and the import continues.                            |
| 28  | `session-importer.service.ts:843`                           | optional-capability | `~/.claude/projects` absent; `null` = nothing to import for this workspace.                                    |
| 29  | `session-metadata-store.ts:422`                             | optional-capability | Inline-output migration is a size optimisation; `false` keeps the fat reference, which still holds the output. |
| 30  | `session-metadata-store.ts:1028`                            | optional-capability | Courtesy flush on the failure path; `settleWrite` logs its own error and the original rejection is preserved.  |
| 31  | `session-metadata-store.ts:1032`                            | optional-capability | Queue ordering handle only; `next` carries the real rejection to the caller.                                   |
| 32  | `settings-export.service.ts:96`                             | **defect**          | See D-4.                                                                                                       |
| 33  | `stream-processing/sdk-stream-processor.ts:269`             | optional-capability | Optional stream subscriber; a throwing listener must not tear down the stream it watches.                      |

## Defects (not fixed, not suppressed)

### D-1 `libs/backend/agent-sdk/src/lib/helpers/subagent-message-dispatcher.ts:424`

**Masked**: any failure reading a subagent transcript — a malformed JSONL line, an
EPERM on the session directory, a `findWorkflowAgentTranscript` throw — returns
`[]`, which is byte-identical to the legitimate "this subagent has produced no
messages yet" answer. The `warn` reaches the log only; the RPC consumer and the
subagent panel see an empty transcript and render it as an idle agent.

**Suggested fix**: return a discriminated result (`{ ok: true, messages }` /
`{ ok: false, code }`) or emit a structured degradation event with a stable code
such as `SUBAGENT_TRANSCRIPT_READ_FAILED` carrying `sessionId`/`agentId`, so the
panel can distinguish "nothing yet" from "could not read". A spec should exercise
the positive path against a real temp JSONL tree — the file already supports one,
`workflow-transcript-reader.ts` documents a `homeDir` temp-tree spec.

### D-2 `libs/backend/agent-sdk/src/lib/sdk-transcript-reader.adapter.ts:40`

**Masked**: a failed `readHistoryForCuration` returns `''`, and `''` is a valid
transcript. The consumers are the memory curator and skill synthesis, which then
curate an empty conversation and report a successful run. This exact shape has
already produced a shipped defect — TASK_2026_293 curated a placeholder instead
of the conversation because the reader rejected an unresolved id — so an empty
string is a known-dangerous degradation value on this path.

**Suggested fix**: let the adapter throw, or return `null` distinctly from `''`,
so the curator can abandon the run rather than persist a curation derived from
nothing. Failing that, emit `TRANSCRIPT_READ_FAILED` with the session id and have
the curator refuse to write on a degraded read.

### D-3 `libs/backend/agent-sdk/src/lib/session-importer.service.ts:634` (now `:637`)

**Masked**: `findSessionsDirectory` has already proven the directory exists before
this call, so a `readdir`/`stat` failure here is a genuine I/O error (permissions,
a disappearing volume), not the ordinary absent-directory case. It is logged at
**`debug`** and returns `[]`, and `importFromJsonlFiles` then reports zero
imported sessions as an ordinary result. A user with an unreadable
`~/.claude/projects/<ws>` sees an empty session list and no signal anywhere.

**Suggested fix**: raise to `warn` and emit a structured event with a stable code
(`SESSION_IMPORT_SCAN_FAILED`) carrying `sessionsDir` and the errno, and let the
importer's return value distinguish "scanned, found none" from "could not scan".

### D-4 `libs/backend/agent-sdk/src/lib/settings-export.service.ts:96`

**Masked**: a secret-storage read failure — a locked keychain, a
`SecretStorage` backend that is not ready — returns `undefined`, and
`collectSettings` builds a `PtahSettingsExport` that omits the key entirely. The
class doc sanctions this for **missing** keys ("Missing keys are silently
skipped"), but a read failure is not a missing key: the export is written to disk
looking complete, `secretCount` counts the surviving secrets, and the user
discovers on restore that their license key or API key is gone.

**Suggested fix**: distinguish absence from failure — have `getSecret` return a
tri-state (`{ present }` / `{ absent }` / `{ failed, code }`), and have
`collectSettings` either fail the export or attach a `degraded: [keys]` field
plus a `SETTINGS_EXPORT_SECRET_UNREADABLE` event, so the export file itself
records that it is incomplete.

## Audit line

```
libs/backend/agent-sdk: 4 ok (baseline 33)
```

`npx nx run degradation-audit:lint`, run in the worktree. Four residual sites,
exactly the four defects above. Zero `bare-suppression` and zero
`orphaned-suppression` in this lib.
