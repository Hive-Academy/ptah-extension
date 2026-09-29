# Batch 3 report — TASK_2026_555 / TASK_2026_551 — Cursor key redaction (S1b)

**Tasks completed**: Task 3.1 — `redactSecrets` + `summarizeCliSdkError(…, secrets)`; Cursor adapter redacts every error path.

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\sdk-error-summary.ts`
  - Added `redactSecrets(text, secrets)`: literal-value replacement (string split, no regex) with the fixed marker `[REDACTED]`; blank secrets are skipped. Added an optional third parameter `secrets: readonly string[] = []` to `summarizeCliSdkError`; redaction runs on the raw text **before** the headline is cut, so the marker survives the 500-character cap.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\cursor-cli.adapter.ts`
  - `runSdk` gains `secretRedactions` in scope; the turn that resolves the key sets it. The `runTurn` catch redacts the log `detail` and passes the secrets to `summarizeCliSdkError`, so the streamed summary carries the marker. The `interrupt()` catch redacts the log detail and rethrows a redacted error. `detect()`/`listModels()` catch paths are unchanged (they log nothing; pinned by specs).
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\sdk-error-summary.spec.ts`
  - New cases: `redactSecrets` (literal replacement, multiple secrets, blank-secret tolerance, regex-metacharacter safety); third-parameter redaction (headline kept, cap survival, usage-limit wording preserved); a two-argument Codex call is pinned unchanged. All existing cases untouched.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\cursor-cli.adapter.spec.ts`
  - New describe "Cursor API key redaction (551)" with the three acceptance specs plus one pin: (1) `runTurn` rejection carrying the key — no logger arg, output chunk or segment contains the key; (2) `run.cancel()` rejection — the log and the rethrown error carry the marker, not the key; (3) `detect` resolver failure carrying the key — no logger call contains it; (4) `listModels` failure carrying the key — no logger call contains it. All existing cases untouched.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\.ptah\specs\TASK_2026_551\fix-report.md`
  - Key → store → reader trace (`agent:setConfig` `agent-rpc.handlers.ts:319-338` → provider secret `cursor` → `hasProviderKey` read-back `:1050-1055` → `resolveCursorApiKey` `cursor-cli.adapter.ts:187-202`, env first) and the redaction evidence. Sections for the Batch 5/8 UI half are placeholders for those batches to fill.

## Stack observed

Node/TypeScript Jest unit lib (`libs/backend/cli-agent-runtime`, Nx project `@ptah-extension/cli-agent-runtime`). Error handling: fixed user-facing summaries with `console`-style `Logger` injection; validation n/a (no new boundary input — `secrets` is an internal literal list).

## Verification

Command (Batch 3 verify, batches.md):

```
npx nx run-many -t typecheck,test,lint -p @ptah-extension/cli-agent-runtime
```

Result:

- **typecheck: PASS**
- **lint: PASS**
- **test: FAIL (1 of 68 suites) — 1242 passed, 1 failed, 1 skipped**
  - The only failure is `src/lib/capabilities/claude-approval.reader.spec.ts:345` — "trusts an untracked, ignored file", a jest `Exceeded timeout of 5000 ms` on a **real-git integration** test (`createGitRunner`, which carries its own 2 s per-call timeout, `claude-approval.reader.spec.ts:326-331`).
  - **It is unrelated to Batch 3.** Evidence: the spec imports only node builtins and its own module (no import from `cli-adapters`); `git status` shows the only uncommitted `cli-agent-runtime` changes are this batch's four `cli-adapters` files (no `capabilities/` change by any concurrent batch); it fails identically in isolation (`20 passed, 1 failed`) and with the shell sandbox disabled, so it is machine git latency, not a code regression. The batch's own tests — all 551 specs above plus the pre-existing adapter/summary cases — passed inside the same run.
  - No fix was attempted: the file is outside Batch 3's ownership (report, not touch).

## Risks handled

- **Interrupt needs the key outside the turn**: `secretRedactions` lives in the `runSdk` scope and is set by the turn that resolved the key, so `interrupt()` redacts with the same value. `interrupt` only acts when a run is in flight, so the key is always captured by then.
- **Stack leakage on rethrow**: the original `throw error` would carry the leaked text in the error's stack (the stack embeds the original message). The rethrow is now always a fresh `Error` with the redacted message. Deliberate deviation from the current code's `error instanceof Error ? error : new Error(detail)` shape; the consumer contract is message-based and the existing spec (`rejects.toThrow('run already gone')`) passes unchanged.
- **Codex untouched**: the third parameter defaults to `[]`; `codex-cli.adapter.ts:773` keeps its two-argument call and a spec pins that behaviour.
- **Redaction strength**: literal splitting, not a regex, so a `key_…`-shaped secret or one containing regex metacharacters is replaced exactly (spec covers `a.b*c+`).
- **Order of operations**: redaction runs on the raw text before `boundedHeadline` and before usage-limit detection; the marker survives the cap and the usage-limit wording is unaffected (both pinned).

## Plan deviations

- One, described above: the `interrupt()` rethrow is always a fresh `Error` (redacted message, fresh stack) instead of rethrowing the original object. Everything else follows implementation-plan.md:230-269 and the batch text.

## Not done (by design)

- `cursorApiKeyStored` / `cursorApiKeyEnvSet` and the UI read-back half of 551: Batch 5 (fields) and Batch 8 (UI), per the plan. The fix report marks the placeholders.
- The `claude-approval.reader.spec.ts` timeout failure: out of Batch 3 ownership; needs a team-leader decision (bump the per-test timeout for the real-git describe, or mark it slow/CI-only).

## Out-of-scope observations

- `CLAUDE_APPROVAL_GIT_TIMEOUT_MS` is 2 s per git call while the jest per-test timeout is 5 s; on a machine where one git invocation takes ~1.5-2 s, `reader.read()` cannot finish inside 5 s. CI-fast machines hide this; this worktree machine does not.
- Batch 1 (platform-core) and Batch 5 (rpc-handlers) have uncommitted edits in this shared worktree; they are file-disjoint from Batch 3.