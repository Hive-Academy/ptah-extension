# Backend correction report — TASK_2026_698_4146

## Completed

- **N2:** Owner release now emits a newer settled cache snapshot even when no provisional estimate or cache-dirty signal is pending. The release path checks both the settled snapshot and whether the last emitted payload carried cache, while retaining the existing revision and result-publication guards. Added specs for clearing a pending idle deadline and for an unchanged cache release.
- **N1:** Removed the one-shot cache and idle projection miss logs and the estimate wrapper. Owner setters are called directly; the stale-owner spec now checks that no misleading debug log is written.
- **N3a:** The first cache request of a turn is determined by `cacheRequestKey`. Added a synthetic-first-frame regression spec with a long gap before the real request.

## Verification

- Scoped `ptah_get_diagnostics`: 0 errors, 0 warnings.
- Three requested Jest specs: 3 suites passed, 77 tests passed.
- `npx nx typecheck @ptah-extension/agent-sdk --parallel=1`: passed.
- `npx nx lint @ptah-extension/agent-sdk --parallel=1`: passed with 0 errors and 77 warnings.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Apply the extra cache revision check only during owner release. | Set `cacheDirty` on release; add a release-specific condition to `emitAuthoritative` (chosen). | The review identifies release as the missing signal; result and dispose already have their own settlement paths. The revision guards prevent duplicate publication. | Yes. |

No git operations were run. The six scoped source/spec files and this report are the only files written.
