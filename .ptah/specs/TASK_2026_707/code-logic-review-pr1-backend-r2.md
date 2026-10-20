# Code Logic Review — TASK_2026_707 PR 1 backend, round 2

Review family: ptah-cli (Ollama Cloud); implementer families: antigravity, codex.

Scope: `libs/backend/auth-providers/src/lib/quota/**` and
`libs/shared/src/lib/types/plan-limit.types.ts`. Frontend is out of scope here.
Read-only review: no source file was edited.

## Verdict

**APPROVE WITH FIXES** — 0 blocking, 2 moderate, 2 minor new defects.

All four re-checked defects (1, 2, 4, 5) are fixed with the requested typed
reasons and tests. The two moderate findings are new, small and local: one
corrupted label string in the Antigravity CLI adapter, and one candidate loop
that can stop before the installed `.exe` fallback.

## Per-item results

### 1. Defect 1 (401/403 hidden by the other endpoint) — FIXED

- `ollama-cloud-plan-usage.reader.ts:182-184` maps 401/403 on either endpoint to
  a per-endpoint `unsupported-auth` outcome before any data check.
- `:216-233` (`combine`) keeps the surviving endpoint's windows or usage and
  attaches `statusReason`; `:247-261` (`availableReason`) returns
  `balance-auth-rejected` for balance 401/403 and `usage-auth-rejected` for
  usage 401/403.
- `:235-238` returns `unsupported-auth` when both endpoints rejected auth and no
  data exists.
- Tests, both mixed directions: balance 401/403 + usage OK stays `available`
  and says `balance-auth-rejected`
  (`ollama-cloud-plan-usage.reader.spec.ts:457-471`); usage 401/403 + balance OK
  keeps the windows and says `usage-auth-rejected`
  (`ollama-cloud-plan-usage.reader.spec.ts:478-492`); both endpoints rejected →
  `unsupported-auth` (`:434-451`).

### 2. Defect 2 (usage-only reads look like "no limits"; 429 freeze) — FIXED

- Balance failure with usable usage → `balance-unavailable`:
  `ollama-cloud-plan-usage.reader.ts:252-256` (`availableReason`), tested at
  `ollama-cloud-plan-usage.reader.spec.ts:43-80` (F33), `:460-461` (429/503) and
  `:473-476` (unreadable body).
- Per-endpoint cooldown with `Retry-After` capped: each outcome gets its own
  entry (`:149-157`), `Retry-After` seconds are parsed and capped at 10 min
  (`:273-279`, `MAX_RETRY_AFTER_MS` at `:47`). A recovered endpoint is re-fetched
  on its own schedule; tested by `429 on one endpoint only delays that endpoint`
  (`ollama-cloud-plan-usage.reader.spec.ts:523-559`).
- In-flight promise per owner: `:138-142` (`current.inflight ??= load(...)` with
  `.finally` clearing it on settle, rejection included). Concurrent reads share
  one request pair; tested at `ollama-cloud-plan-usage.reader.spec.ts:561-575`
  (three reads → two fetch calls). `load` itself cannot reject in practice
  because `fetchBody` converts every error into an outcome
  (`:163-214`, catch at `:206-213`).
- Cache keyed per owner: the `owners` map is keyed by `target.ownerRef.key`, not
  by the credential (`:77-78`, `:126-136`), with a 32-owner cap. The service
  additionally refuses a credential that does not match the owner key
  (`plan-usage.service.ts:280-285`), so no cross-account leakage path was found.
- The 60 s base cache is retained (`:44-46`, test `:577-597`).

### 3. Defect 4 (CLI failures collapse into `cli-unavailable`) — FIXED, with one new gap

- Distinct classifications at `antigravity-cli-usage.adapter.ts:190-221`:
  ENOENT → `cli-not-found` (`:200`), max-buffer overflow → `cli-parse-failed`
  (`:201-203`), caller cancellation → `cli-unavailable` (`:204`), killed /
  ETIMEDOUT / ABORT_ERR / AbortError → `cli-timeout` (`:205-212`), numeric exit
  code with a sign-in phrase → `cli-not-signed-in`, otherwise `cli-exit-error`
  (`:213-219`), non-process error → `cli-unavailable` (`:194`).
- Sign-in phrase only, and only on failed output: `SIGN_IN_HINT` at
  `antigravity-cli-usage.adapter.ts:183-184` is consulted only inside
  `classifyCliFailure`, which runs only in the catch path (`:91-96`); usage is
  parsed only from a successful run (`:97`). Tested by `never parses a failing
  run output as usage` (`antigravity-cli-usage.adapter.spec.ts:156-166`) and the
  sign-in variants at `:121-140`.
- 10 s abort: `antigravity-cli-usage.adapter.ts:21,84`, plus the `execFile`
  `timeout` at `:237`.
- Argument array without shell: `execFile` with `shell: false` and `[...args]`
  (`:227-238`); tested at `antigravity-cli-usage.adapter.spec.ts:204-216`.
- Output cap: `maxBuffer` (`:236`) and a byte-length check before parsing
  (`:114-116`); tested at `:68-75` and `:177-189`.
- Fail-closed parser: any malformed or duplicate line rejects the whole output
  (`:110-128`); tested at `:48-66`.
- Propagation: the reader carries the typed reason on the `service-unavailable`
  reading (`antigravity-plan-usage.reader.ts:78-79`), the service forwards
  `statusReason` into the snapshot (`plan-usage.service.ts:437`), and the reader
  tests cover ordering and reason pass-through
  (`antigravity-plan-usage.reader.spec.ts:407-434,446-457`).
- Windows `.cmd`/`.bat` question: the fallback candidate is
  `%LOCALAPPDATA%\agy\bin\agy.exe` (`antigravity-cli-usage.adapter.ts:68`) — a
  real `.exe`, which `execFile` runs fine without a shell, and the candidates
  test confirms the `.exe` path (`antigravity-cli-usage.adapter.spec.ts:219-232`).
  The remaining gap is the PATH candidate; see new defect 2 below.

### 4. Defect 5 (body cap applied only after full buffering) — FIXED

- `ollama-cloud-usage.parsers.ts:20-47` (`readJson`) reads the stream with a
  byte counter (`:25-34`) and cancels the reader on overflow (`:32`); the
  null-body fallback still enforces the cap via `Buffer.byteLength` (`:39-40`).
- Tested by `a body over the cap is cancelled mid-stream, not buffered`
  (`ollama-cloud-plan-usage.reader.spec.ts:499-521`): the stream's `cancel` runs
  and fewer than ten chunks are pulled.

### 5. `PlanLimitStatusReason` single definition — PASS

One definition in the repository
(`libs/shared/src/lib/types/plan-limit.types.ts:184-196`; a repository-wide
search found no other). It contains exactly the twelve requested values:
`no-oauth`, `no-local-server`, `cli-unavailable`, `cli-not-found`, `cli-timeout`,
`cli-not-signed-in`, `cli-exit-error`, `cli-parse-failed`,
`api-key-no-subscription-quota`, `balance-unavailable`, `balance-auth-rejected`,
`usage-auth-rejected`.

### 6. Ollama reader split — PASS

- `ollama-cloud-plan-usage.reader.ts` is 279 lines and
  `ollama-cloud-usage.parsers.ts` is 220 lines; both are under 300. (The
  fix-report figures 279/220 match the files; the PowerShell line count in this
  review's first pass excluded blank lines.)
- No behaviour was lost in the split: the allowance rule (positive
  `allowance_usd` only, `ollama-cloud-usage.parsers.ts:138-140`), the
  remaining-percent inversion (`:176-181`), purchased balance never becoming a
  percentage (`:139-140`), per-model top-10 detail (`:204-207`), malformed model
  groups never discarding the request total (`:89-99`), and the range labels
  (`:104-108`, `:217`) are all present with the same semantics.

### 7. Regressions — PASS

- Grok API-key reason: the service marks the credential account branch with
  `api-key-no-subscription-quota` (`plan-usage.service.ts:299-304`); the reader
  emits it for `XAI_API_KEY` (`grok-account-plan-usage.reader.ts:69`) and for an
  `api_key` credential without a key (`:118-120` via `apiKeyNoPlan`,
  `:37-41`). The local usage merge is intact: `mergeLocalUsage` spreads the
  account reading, so `statusReason` survives when local usage is attached
  (`plan-usage.service.ts:455-467`). Tests: `plan-usage.service.spec.ts:449-470`
  (reason kept with and without local usage) and
  `grok-account-plan-usage.reader.spec.ts:115-137`.
- Claude, Codex and OpenCode readers: `git status` and `git diff` show no change
  to `claude-plan-usage.reader.ts`, `codex-plan-usage.reader.ts` or the
  OpenCode readers, and the branch has zero commits beyond `main`, so the whole
  PR is the inspected working-tree diff. Unchanged.

## New defects

1. **Moderate — corrupted separator in the Antigravity CLI window label.**
   `antigravity-cli-usage.adapter.ts:167` builds the label with the literal
   mojibake sequence `Ãƒâ€šÃ‚Â·` instead of the middle dot `·`. A byte scan of the
   file confirms it: the file contains `U+00C3 U+0192 U+00E2 U+20AC U+0161
   U+201A U+00C2 U+00B7` — the double-encoded form of `U+00B7` — while
   `antigravity-plan-usage.reader.ts:350` uses a clean `U+00B7`. Every CLI-derived
   window label renders corrupted characters in the dashboard. No test asserts
   the label, so nothing catches it. **Fix:** replace the sequence with a single
   `·` (U+00B7) in the template string.

2. **Moderate — a non-ENOENT spawn error stops the candidate loop before the
   installed `.exe` fallback.** `antigravity-cli-usage.adapter.ts:94-95`
   continues to the next candidate only for `cli-not-found`; every other reason
   returns at once. On Windows, the first candidate is bare `agy` resolved
   through PATH; if PATH resolves it to a `.cmd`/`.bat` shim, `execFile` with
   `shell: false` fails (Node rejects batch files without a shell since the
   CVE-2024-27980 fix). That error has a string errno code, so
   `classifyCliFailure` maps it to `cli-unavailable`
   (`antigravity-cli-usage.adapter.ts:213-220`) and the loop returns — the
   working `%LOCALAPPDATA%\agy\bin\agy.exe` candidate that `exists()` confirmed
   (`:68-70`) is never tried. The same holds for EACCES/EPERM on POSIX.
   **Fix:** treat spawn-phase errors (EINVAL, EACCES, EPERM) like ENOENT —
   continue to the next candidate, or classify them `cli-not-found`. Keep
   `shell: false`; a shell would reintroduce command injection risk.

3. **Minor — `no-oauth` and `no-local-server` are never emitted.** A search of
   `libs/backend` finds no producer of either reason. The type docstring says
   they are "reported only when the CLI fallback did not run"
   (`plan-limit.types.ts:176-177`), but the reader runs the CLI after every
   failed local probe and reports no reason on the two paths where the CLI is
   skipped (caller aborted, account changed — `antigravity-plan-usage.reader.ts:74-79`).
   Two union members are dead and the docstring promises a contract no code
   implements. **Fix:** emit them where the CLI fallback is skipped, or correct
   the docstring; either is small.

4. **Minor (observation) — FIFO owner eviction can evict the most active owner
   first.** `ollama-cloud-plan-usage.reader.ts:131-135` evicts the
   earliest-inserted owner beyond 32; a re-read of an existing key does not
   refresh its Map position. With more than 32 owners, an active owner can be
   evicted while stale ones persist. No correctness impact: entries stay keyed
   per owner, and an evicted owner's in-flight promise still settles for its
   callers. Optional fix: delete-then-set on each read.

**Routed to code-style-reviewer (not scored here):** comment text in
`ollama-cloud-plan-usage.reader.ts` (five sequences) and
`plan-limit.types.ts` (sixteen) contains the same mojibake (`â€”` for an
em-dash). Comments only; no user-visible output. The adapter label above is the
only mojibake in a code string in this scope.

## Five logic questions

1. **Silent failure:** a 401/403 or 5xx on one Ollama endpoint is now visible
   through `statusReason` on an `available` reading, in both mixed directions.
   The one intentionally silent case is balance 404 with usage OK, which yields
   `available` with no reason — the endpoint is gone, not the balance
   (`ollama-cloud-plan-usage.reader.ts:185-187`, `:252-256`).
2. **Unexpected user action:** a refresh during a balance 429 now re-fetches
   balance after its own 60 s while usage keeps its own backoff
   (`ollama-cloud-plan-usage.reader.spec.ts:523-559`). The remaining wrong-verdict
   case is a `.cmd`/`.bat` `agy` shim on PATH (new defect 2).
3. **Wrong answer from input:** malformed Ollama bodies fail closed to
   `service-unavailable` per endpoint; malformed CLI output fails closed to
   `cli-parse-failed`; the only wrong-output case found is the mojibake label
   (new defect 1).
4. **Dependency failure:** fetch errors, timeouts and oversized bodies become
   per-endpoint outcomes that preserve the other endpoint's data; `Retry-After`
   is capped at 10 minutes; CLI process failures are classified from errno,
   kill state and exit code without parsing failure output as usage.
5. **Missing requirement:** `no-oauth`/`no-local-server` have no producer
   (new defect 3). Frontend consumption of the new reasons is reviewed
   separately and is out of this scope.

## Verification

- One serial Jest run over the five changed/new backend suites
  (`--coverage=false --maxWorkers=1`): 4 suites passed, 134 tests passed, 1 test
  failed — `plan-usage.service.spec.ts:472` (`resolves the stored OpenCode Go
  credential for its reader`) exceeded the 5 s timeout in the combined run.
  An isolated re-run of that suite passed 40/40 in 8.4 s. The diff cannot reach
  that test (the service change touches only the grok credential branch at
  `plan-usage.service.ts:299-304` and the additive `statusReason` spread at
  `:437`), so this reads as a load flake on a memory-constrained machine, not a
  code defect. It is reported for transparency; the combined run should not be
  used as evidence that the suite is red.
- Static evidence: full reads of both Ollama files, the CLI adapter, both
  antigravity readers, the grok reader, the service merge/snapshot paths and
  the shared type; `git status`/`git diff` for the regression scope; a
  repository-wide search for the reason-type definition and the two unused
  reasons; a byte-level scan of non-ASCII characters in every changed backend
  file.
- Remaining uncertainty: the `.cmd`-shim scenario (new defect 2) is inferred
  from Node's documented execFile behavior, not reproduced on this machine;
  the Ollama mixed-status cases were exercised through unit-level fetch mocks,
  not against the live API.

## Decisions

- **Flake handling:** the timed-out OpenCode Go test is reported as an
  environment flake because the isolated re-run passes and the diff cannot
  reach its code path. The alternative — calling the suite red — would misstate
  the change. Reversible by re-running the combined set.
- **Mojibake split:** only the label string is scored here because only it
  reaches the user; the comment-level mojibake is routed to the style reviewer
  to avoid duplicating that review's scope. Evidence: byte scans above.

Review family: ptah-cli (Ollama Cloud); implementer families: antigravity, codex.