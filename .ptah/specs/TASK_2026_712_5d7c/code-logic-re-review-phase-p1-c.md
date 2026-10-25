# Code Logic Re-review — TASK_2026_712 Phase P1-C fixes (uncommitted, 10 files)

- Reviewer family: Anthropic
- Implementer families: not stated in the brief; fixes reviewed from `git diff -- libs` only (non-spec source; specs not re-read)
- Review family line: independent of the original findings' author (me, first pass) only in the sense of a second look at the same reviewer's findings; no tests or tooling were run
- Verdict: **APPROVED** (no Blocking or Serious items remain; one PARTIAL and four non-blocking new items are listed for follow-up)
- Disposition honoured: findings 5 and 8 deferred, minors 9–11 recorded only — not re-flagged.

## Status table

| # | Finding | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Named output-style display path claimed ambient root | RESOLVED | `output-style-discovery.service.ts` `toDisplayPath(tier, fileName, context)` returns `account:output-styles/<file>` for named user tier; both call sites pass `context` (discovery `scanTier`, writer `output-style-file.writer.ts:191` and `:506`). Named user-tier styles and invalid rows are now `openable: false` / `editable: false` with `immutableReason`, so the ambient open route cannot be reached from the label. |
| 2 | Named output-styles dir not symlink-bound | RESOLVED (directory); residual file-level gap noted as N2 | `boundOutputStyleDirectory` (`output-style-discovery.service.ts:114-150`) realpaths the config root and the directory, refuses escape via `path.relative`, refuses a dangling symlink (`lstat` after `ENOENT`), and allows a genuinely absent directory. Used before every named discovery scan (`:263`) and every writer operation (`output-style-file.writer.ts:415`); failure maps to a closed `OutputStyleAccountResourceError` or `NOT_FOUND`. |
| 3 | Missing global selection aborted named session start | RESOLVED | `output-style-session-activation.service.ts:173-178` now returns `{ ...NO_OUTPUT_STYLE, outputStyleUnavailable: true }` with a fixed-text warning instead of throwing; invalid account root still rejects (catch at `:187`), no ambient substitution. Header comment updated. |
| 4 | Raw paths and messages for named roots in logs | PARTIAL | Output-styles: all `errorMessage(error)` sites for named context now log only a sanitized code via `accountFileError` (discovery `scanTier`, writer write/delete/stat/stale/collision/root-lookup). agent-sdk: the cited sites are fixed (`jsonl-reader.service.ts:555-566` oversize warn, `:1006-1010` scan log, `:1038-1041` unreadable file use `path.basename` for named; `session-stats-reader.service.ts:348-361`, `:386-403` log only a code or error name for named). Same-class sites are still reachable in named mode: see N1. |
| 6 | `accountEpochs` FIFO eviction forgot live identities | RESOLVED | Both services now refresh recency (`delete` then `set`) and keep `max(existing, requested)` so an older epoch can no longer regress a newer one (`session-quota-probe.service.ts` `invalidateAccountRoute`; `sdk-model-service.ts:451-466`). `activeAccountReads` counts in-flight reads per identity; `trimAccountEpochs` skips active identities and re-trims in `finally` (`readNamed` outer `finally`; `getAccountModels` `finally`). Stale-epoch early returns also refresh recency. Increment-before-`try` ordering is safe: no throwing call sits between the increment and the `try`. |
| 7 | One bad symlink made the named project listing unavailable | RESOLVED | `jsonl-reader.service.ts:279-300`: per-entry `boundPath`/`stat` failures are counted in `skippedEntries` and logged as a count only; an extra `fs.readdir(projectsDir)` inside the same try keeps a genuinely unusable root unavailable (it throws into the existing named catch, which maps to `ClaudeAccountResourceError('unavailable')`). Behaviour is correct; the second `readdir` is redundant I/O (see N4). |

## New defects

### N1. Remaining named-mode logs of raw account paths — Moderate (completes finding 4)
- Files: `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:448-451` (`readProjectsDirMtime` logs `projectsDir` and `error.message`, reached by `findSessionsDirectory` on a named root), `:1069-1072` (`listAgentDirectory` logs `dir`, which is under the account directory), `:898-901` (malformed-line debug logs `filePath` plus a 100-character transcript preview; also pre-existing for ambient).
- Scenario: a named account root on a path that fails `stat`/`readdir`, or a transcript with a corrupt line, writes the account directory and part of the content to the log. The privacy rule requires fixed text or codes only.
- Fix: thread `context` into these helpers (or pass a boolean) and, for named, log the error code and `path.basename` only; drop `linePreview` for named.

### N2. File-level symlink inside the bounded named directory can redirect a write — Minor
- Files: `output-style-file.writer.ts` (`fs.writeFile(target.absolutePath, ...)` after `collides`), `output-style-discovery.service.ts:114-150`.
- Scenario: only the directory is realpath-bound. If a planted `<config>/output-styles/foo.md` is a symlink to an ambient file, a save with `overwrite: true` writes through it. Discovery is unaffected (the Electron provider reports symlinks as `SymbolicLink`, which `isMarkdownFile` excludes), and named user-tier rows are now `editable: false`, so the UI cannot reach it today; the API-level writer still can.
- Fix: before a named write or delete, `lstat` the target and refuse a symbolic link, or `realpath` it and re-check containment.

### N3. Unavailable-selection marker has no consumer contract — Minor
- File: `output-style-session-activation.service.ts:93-94` (`outputStyleUnavailable`).
- Scenario: callers that spread the returned fields into SDK/CLI options (`sdk-query-options-builder.ts`, `ptah-cli-spawn-options.service.ts`, `chat-session.service.ts`) would carry an unknown key, and none of them shows the notice the comment promises. No current caller passes a named context, so there is no live effect.
- Fix: strip the marker where fields are mapped into options, and surface it as a notice in Batch 17.

### N4. Redundant second directory read in the named listing — Minor
- File: `jsonl-reader.service.ts:288-289` (`await fs.readdir(projectsDir)` after the loop).
- Scenario: doubles directory I/O per call and leaves a TOCTOU window without strengthening anything the first `readdir` did not already prove. Replace by checking the first result, or drop it.

### Observations (not defects)
- `deletable: true` remains for named user-tier styles while `editable` is false (`output-style-discovery.service.ts:367`); consistent with the writer still honouring named deletes through the bounded directory, but worth aligning with the intended read-only stance.
- The `(epoch > route.authEpoch)` early returns now call `invalidateAccountRoute` before returning; this only refreshes recency and cannot lower an epoch, so no regression.

## Verdict

APPROVED. Findings 1, 2, 3, 6 and 7 are resolved; finding 4 is partial with the remainder tracked as N1 (Moderate, non-blocking; fold into the next agent-sdk change). N2–N4 are Minor. Confidence: MEDIUM-HIGH (static review; specs for the fixes not executed).
