# Code Logic Review 8o-1 / 8o-2

Score: 8/10. Verdict: APPROVED (no Blocking or Serious findings; 2 Moderate, 2 Minor).
Scope: uncommitted diff of the listed files, plus surrounding `updateCodexExecution`, `isForeignWorkspace`, `persistMetadata`. Nothing was executed, as instructed.

## B - workspaceId persistence (session-metadata-store.ts:1054-1066)

- The binding checks are unchanged and still run on `execution.workspaceId` (the normalized Codex key): `binding-change` (~1018-1028), `isForeignWorkspace(execution.workspaceId)` (1032), and the thread/workspace match (1040-1050). `codexExecution.workspaceId` stays normalized. OK.
- Row `workspaceId` is now `proposed.workspaceId` (the raw caller path from the updater, taken before normalization). This is the Claude-shaped value and feeds the SQLite `workspace_key`. OK on posix, where the key preserves case so raw and key differ only by trailing slash or separators, which SQLite normalizes. OK on win32, where the key is lower-cased.
- Repair rule: `existing.workspaceId && existing.workspaceId !== execution.workspaceId ? existing.workspaceId : proposed.workspaceId`.
  - A legacy row holding the normalized key is repaired to the caller path (spec pins this).
  - A row already holding a caller path keeps it, so a later call from a differently-cased spelling does not flip the row.
  - It never adopts a different workspace's path from `proposed`, because the binding check forces the same normalized workspace.
- Change event now carries the caller path (1078, and `incrementCodexMessageCount` at 1105 reads `current.workspaceId`). Both are consistent with the Claude emissions at 863/1796/1808. `isForeignWorkspace` normalizes with `normalizeWorkspaceId` before comparing, so a raw path is safe there (710-722, 1193).

## C - native title (codex-chat-adapter.ts:356-365)

- The first non-blank of sessionTitle, sessionName, name matches the Claude precedence. `'name' in config` guards the resume config type. The raw (untrimmed) candidate is forwarded and the store rule is unchanged. OK.

## H - usage reader (codex-account-usage.service.ts:305-316, 501-506; process.ts:32; index.ts)

- A single exported constant `CODEX_INITIALIZE_TIMEOUT_MS = 60_000` replaces the private one, and no second `60_000` exists. Other requests keep `REQUEST_TIMEOUT_MS` at 10 s through the default parameter. `timer.unref?.()` is retained.
- The diff does not show the pending-map clearing path. Cleanup behavior is unchanged from before and I did not re-read the full resolve/reject code, so the claim that every timer is cleared rests on the pre-existing code.

## Findings

1. Moderate - session-metadata-store.ts:1057-1060. The repair rule keeps ANY `existing.workspaceId` that differs from the normalized key. It does not check that the existing value normalizes to the same workspace. A corrupted or foreign row path (for example a leftover from a manual edit) would be preserved permanently, and the row would then be listed under the wrong workspace. Fix: keep the existing value only when `normalizeCodexWorkspaceKey(existing.workspaceId, process.platform) === execution.workspaceId`, otherwise use `proposed.workspaceId`. This is a one-line hardening, and no spec covers it.
2. Moderate - session-metadata-store.spec.ts:2370-2410 (new repair spec). It covers the keep-path and legacy-repair cases only. There is no case for an existing row with an unrelated path (finding 1), and no posix-platform case. The "would fail on old code" requirement is met, because the old code wrote `execution.workspaceId` and the new assertions expect `callerPath`.
3. Minor - codex-chat-adapter.ts:356-360. The adapter spec added a "name only" case. I saw only the first new case in the diff output (the diff was truncated); a case for blank-string `sessionTitle` falling through to `sessionName`/`name` would pin the `trim()` behavior if it is not already present.
4. Minor - codex-account-usage.service.spec.ts. The new fake-timer tests use `jest.useRealTimers()` in `afterEach`, which is good. The "still times out account/read at ten seconds" test depends on `holdMethod` skipping the response. That is fine, but it leaves the per-test timer to unref-based cleanup rather than an explicit assertion.

## Five logic questions (brief)

1. Silent failure: none new. The repair path only changes which string is stored.
2. User action: opening the same workspace with a different path spelling keeps the first stored spelling (intended, listing is normalized).
3. Wrong answer: finding 1 only.
4. Dependency failure: a slow `initialize` now waits up to 60 s before `service-unavailable`; the UI waits longer on a dead binary. Accepted by the plan.
5. Missing: no migration that rewrites already-persisted normalized-key rows. They repair only on the next `updateCodexExecution`.
