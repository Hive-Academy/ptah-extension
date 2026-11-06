# Code logic review — fix round

Review family: codex (implementer family: claude)

| Prior finding | Status | Evidence |
| --- | --- | --- |
| 1. Watcher latch | **FIXED** | `libs/backend/platform-core/src/file-settings-manager.ts:415-432,458-466`: a content event cannot cancel the rename timer; the timer clears the flag before reloading and rewatching. Disposal clears it at `:251-256`. `file-settings-manager.error-paths.spec.ts` covers content between rename and timer expiry, then a second rename. |
| 2. Host report precedence | **FIXED** | `libs/backend/lane-outcomes/src/lib/store/lane-outcome.store.ts:67-78` keeps a classified `failed` row unchanged. The in-memory store still receipts at `in-memory-lane-outcome.store.ts:95-107`; SQLite applies and receipts in a transaction at `sqlite-lane-outcome.store.ts:238-245`. Both store specs assert row and receipt (`in-memory-lane-outcome.store.spec.ts:353-376`, `sqlite-lane-outcome.store.spec.ts:605-631`). |
| 3. Directory deliverable | **FIXED** | `libs/backend/lane-outcomes/src/lib/deliverable-check.ts:69-74` requires the File bit. `libs/backend/platform-core/src/types/platform.types.ts:30-35` defines File=1, Directory=2, SymbolicLink=64. `deliverable-check.spec.ts:132-153` covers directory, root, and File\|SymbolicLink. |
| 4. Markdown WROTE forms | **FIXED** | `libs/backend/lane-outcomes/src/lib/wrote-lines.parser.ts:25-32,67-73` accepts one spaced list marker and both bold prefixes. The marker regex cannot consume `**WROTE:**` because its first `*` is followed by `*`, not whitespace. `wrote-lines.parser.spec.ts:84-132` covers accepted forms and false-positive cases. |
| 5. HOME fallback | **FIXED** | `scripts/dev/seed-lane-outcomes.mjs:22-32,142` falls back to `os.homedir()` and maps refusals to exit 2. `scripts/dev/check-past-outcomes-live.mjs:105-108` shares that mapping. `scripts/dev/seed-lane-outcomes.spec.ts:42-73` covers both scripts with HOME absent, unavailable homedir, and profile-path refusal. |

## New defects

1. None found in the scoped diff. The rename callback runs `processCrossProcessChange` and clears the pending flag before it (`file-settings-manager.ts:422-432`). The host report's unchanged row is still receipted by both stores.

## Logic questions

1. **Silent success:** A classified failure cannot become `delivered` through a host observation (`lane-outcome.store.ts:73-78`); a receipt means processed, not that the verdict changed.
2. **User action:** An atomic settings replacement followed by a content event still reloads and re-establishes the watcher (`file-settings-manager.ts:422-432,458-466`).
3. **Wrong-answer input:** A directory yields `exists: false`; a bold `WROTE:` line yields its path, while embedded prose and doubled list markers remain unmatched (`deliverable-check.ts:69-74`, `wrote-lines.parser.spec.ts:84-132`).
4. **Dependency failure or bad shape:** Stat errors return an error code (`deliverable-check.ts:69-77`); a missing home produces a one-line refusal with exit 2 (`seed-lane-outcomes.mjs:22-26,142`, `check-past-outcomes-live.mjs:105-108`).
5. **Unspecified case:** The pre-existing retry policy for a watcher that cannot be re-established remains at `file-settings-manager.ts:469-491`. The fix introduces no new gap there.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep a classified failure and receipt for a host report | Preserve row and receipt; reject report | The request requires both; `applyOutcomeEffect` returns the row while both stores write receipts. | Yes |

Static review covered the tracked diff, untracked script spec, surrounding receipt and watcher paths, and FileType values. I did not rerun tests or builds as instructed. The orchestrator reported verify 9/9, script specs 4/4, and profile refusal exit 2. Scoped `ptah_get_diagnostics` was unavailable after its TypeScript timeout and provides no additional result. The score is 8 rather than 9 because this is a static re-review without an independent runtime check; it is above 7 because all five paths are corrected and no new logic defect was found.

Score: 8/10

Verdict: APPROVED
