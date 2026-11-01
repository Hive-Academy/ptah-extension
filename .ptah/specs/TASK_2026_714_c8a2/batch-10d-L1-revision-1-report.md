# Batch 10d.L1 revision 1 report

## Changes

1. **Failed close cached forever:** `codex-app-server-lane.adapter.ts:296-331` removes a failed context close from `closePromises` and clears `closePromise` when `close()` returns false. The failed resume still receives `CodexLaneWriterCloseError`; the next resume retries the same context close. A successful close remains cached.
2. **Writer registered after close:** `codex-app-server-lane.adapter.ts:362-373` checks `closed` and the abort signal immediately after registry insertion, removes that entry only when it still belongs to this writer, and refuses startup.
3. **Completed lane entries:** No code change. A completed lane retains its live context and registry entry until close because that context serves `continue`.

## Specs

- `codex-app-server-lane.adapter.spec.ts:398-422` extends the failed-close case: the first resume gets the coded refusal, then the next resume retries close and opens.
- `codex-app-server-lane.adapter.spec.ts:424-452` gates the prior close to overlap two resumes. One opens, the other receives `CodexLaneWriterConflictError`, and the old context closes once.
- `codex-app-server-lane.adapter.spec.ts:454-473` checks reservation cleanup after the prior lane aborts and resume open fails; a later resume opens.
- `codex-app-server-lane.adapter.spec.ts:475-498` closes during registry insertion after identity persistence, checks that no entry remains, and resumes the thread afterward.

## Decisions

- Kept the registry lifecycle tied to live contexts so `continue` works after a completed turn. Entries for completed, never-resumed lanes stay until close by design.
- Skill invocation was unavailable in this lane: no invocable skill mechanism was listed, and workspace skill directories were absent. The matching skill could not be loaded.

## Verification

Reviewed the changed source and specs. Tests, typecheck, lint, build, Nx, verify, and `ptah_get_diagnostics` were not run per task hard rules. `rg` was unavailable (access denied), so source inspection used PowerShell.
