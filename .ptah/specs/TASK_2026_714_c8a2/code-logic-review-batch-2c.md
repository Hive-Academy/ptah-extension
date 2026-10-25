# Code Logic Review - TASK_2026_714_c8a2 Batch 2c

Review family: Claude reviewer, Codex implementer.
Scope: commit a7967772e (codex-cli.adapter.ts, its spec, one-line prefer-const fix in agent-process-manager.service.spec.ts).
Check run: codex-cli.adapter.spec.ts, 93/93 passed.

Score: 8/10. Verdict: APPROVED (no blocking or serious findings; 3 moderate/minor notes).

## Trace

- Credential reads: `getAuthPath()` (codex-cli.adapter.ts:429-432) is the only auth.json path in the adapter; used by `resolveAccessToken` (:488) and `ensureTokensFresh` (:512). No other `.codex`/`auth.json` read exists in cli-agent-runtime non-spec code (grep). Other `.codex` hits are doc comments, `codexHomeDir()` (rollout usage reader, harness-sync) and `readCodexUserMcpServerNames`.
- Execution: `runSdk` builds `env = {...process.env, FORCE_COLOR, NO_COLOR}` (:562-565) and passes it as the SDK `env` (:643). `CODEX_HOME` therefore reaches the spawned codex exactly as read by `getAuthPath()` (both read process.env at call time; there is no per-spawn override field, as the batch note states).
- No-fallback: `ensureTokensFresh` catch returns false (:521-525); only one read is attempted, so an unreadable selected home never falls back to the default home. `resolveAccessToken` lets the error propagate. Good.
- Write path: nothing in the adapter writes auth/config to a home; process.env is not mutated (spec asserts this). OK.
- No CODEX_HOME set: `HOME || USERPROFILE || homedir()` + `.codex` is byte-identical to the previous behaviour. Unchanged for those users.

## Findings

1. Moderate - codex-cli.adapter.ts:430. On Windows the "same home as execution" claim is not fully true when HOME and USERPROFILE differ. Codex resolves its default home from the OS profile (USERPROFILE / known folder), not HOME; the adapter prefers HOME (set by Git Bash/MSYS, may be a POSIX-style or different path). Pre-existing precedence, not introduced here, but this batch's stated goal is exact parity and the default (no CODEX_HOME) branch still can read a different file than codex uses. Suggest: on win32 prefer USERPROFILE (or homedir()), and share one resolver with harness-sync `codexHomeDir()`.
2. Minor - codex-cli.adapter.ts:431 vs libs/backend/harness-sync/src/lib/targets/mcp/codex-home.ts:51-53. Two resolvers now disagree: adapter treats whitespace-only CODEX_HOME as set (`||`) and honours HOME; `codexHomeDir()` trims and uses only `os.homedir()`. The rollout usage reader and MCP-server reader can therefore point at a different home than the credential read. Recommend one shared helper (fits the later 3a/P4 home work).
3. Minor - codex-cli.adapter.ts:431. A relative CODEX_HOME is resolved against the host cwd for the credential read but against the lane `workingDirectory` by the spawned codex. Edge case; consider `path.resolve` against the spawn cwd or documenting absolute-only.
4. Minor - codex-cli.adapter.ts:522 comment still says `~/.codex/auth.json`; stale after this change.
5. Minor (spec) - codex-cli.adapter.spec.ts credential-home block: env isolation (`jest.replaceProperty` plus `restoreAllMocks`, readFile mock reset to real) is sound and the fs/promises mock spreads the actual module, so other specs in the file are unaffected. The "same home as execution" test is close to tautological (env passthrough), and there is no Windows-precedence case (HOME vs USERPROFILE with CODEX_HOME unset on win32 semantics). The spec/formatting churn in unrelated tests (lines such as the thread-id and lane-policy tests) is formatting only, not behaviour.

Out-of-scope fix: the prefer-const change in agent-process-manager.service.spec.ts:608-610 is an explicit `= undefined` initialiser, behaviour-neutral, and matches the recorded scope exception.

## Five questions (short)

1. Silent failure: unreadable CODEX_HOME returns false (documented, tested), no default fallback.
2. Unexpected user action: CODEX_HOME changed mid-session is honoured per call (tested).
3. Wrong answer: HOME != USERPROFILE on Windows, whitespace/relative CODEX_HOME (findings 1-3).
4. Dependency failure: readFile reject handled; malformed JSON handled in ensureTokensFresh, propagates in resolveAccessToken (unchanged).
5. Missing: shared home resolver across adapter, rollout reader and MCP reader.
