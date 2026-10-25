# Code Logic Review — TASK_2026_712 Phase P1-C (Batches 12–15, quota-probe split, fix 0c7313438)

- Reviewer family: Anthropic
- Implementer families: OpenAI/Codex (Batches 12–15, split 1c2965b4a); Anthropic (orchestrator) for fix 0c7313438
- Review family line: independent for Codex work; fix 0c7313438 is same-family — **weaker evidence** for that part
- Scope: static read of `git diff 982007d6c..HEAD -- libs` (non-spec source read in full for changed hunks; specs not re-read). No tests, nx, tsc or lint were run.
- Score: **7/10**
- Verdict: **REVISE** (0 Blocking, 2 Serious, 6 Moderate, 3 Minor)

Deferrals D16 (named import refuses) and D17 (registry binding populated by Batch 17) were not counted as defects.
Consequence of D17 worth stating once: until Batch 17 binds records, every `readAccountForRoute` / `readPlanUsageForRoute` call returns `account-mismatch`, so the named plan-usage path is wired but cannot yet be exercised end to end.

## Acceptance check (Batches 12–15)

| Batch | Result |
| --- | --- |
| 12 transcript/history/stats roots | Met for readers. Named context selects `<config>/projects` (`jsonl-reader.service.ts:56-72`), file and dir reads are realpath-bounded (`:75-88`), cache keys carry route fingerprint, revision and epoch (`claudeResourceKey`), dispose guards cache writes (`:365`, `:394`, `:613`). Missing named root throws `ClaudeAccountResourceError('unavailable')`. Omitted context keeps the ambient algorithm by design. |
| 13 output styles / MCP / approvals | Partially met. MCP and approval readers return an explicit `unsupported` result for named contexts, with no fake HOME. Output-style root selection is correct, but see findings 1 and 2. |
| 14 model and quota probes | Met. Epoch checks, single-flight with refcount abort, bounded 3 s timeout and `query.close()` plus process abort in `finally`, foreign auth scrubbed by `NATIVE_CLAUDE_AUTH_ENV` plus `applyClaudeAccountRouteEnv` (`claude-account-route-env.ts:5-44`, covers Bedrock/Vertex/Foundry/OAuth token/API key selectors), unknown installation returns `[]` instead of an API fallback (`sdk-model-service.ts:375-381`). |
| 15 owner-correct plan cache | Met with caveats (findings 5, 6). Owner key is email+organization only, never the directory (`provider-owner.resolver.ts` `claudeAccountOwnerKey`). Failed proof returns `sourceInvalid`, which bypasses cache and stale promotion (`plan-usage.service.ts:378`). Identity is re-proved after the usage read (`claude-plan-usage.reader.ts` before/after). `flightKey` isolates named flights by route, epoch, run and session. |

## Findings

### 1. Output-style display path claims the ambient root for a named account — Serious
- File: `libs/backend/output-styles/src/lib/output-style-discovery.service.ts:135-141` (`toDisplayPath`), used at `:246`; `output-style-file.writer.ts:189` and `:463`
- Scenario: a named account's user-tier style is read from or written to `<config>/output-styles`, but `relativePath` / `displayPath` is always `~/.claude/output-styles/<file>`. The UI shows the ambient location for a file that lives in the account directory. Any consumer that resolves that display path against home, such as open-in-editor, reads or edits the ambient file. This is the "named must never silently read or write ambient" rule failing at the presentation layer.
- Fix: give `toDisplayPath` the context. For named, return an opaque account-relative label (for example `account:output-styles/<file>`) and mark the row `openable: false` unless open resolves through the same context. Add a spec asserting that no named path begins with `~/.claude`.

### 2. Named output-styles directory is not symlink-bound, unlike the transcript root — Serious
- File: `output-style-discovery.service.ts:98-108`, `:191-193`, `:216-245`; `output-style-file.writer.ts:381-390`
- Scenario: `<config>/output-styles` is a symlink (dotfile setups, or a manually linked account dir) to `~/.claude/output-styles`. Discovery reads and the writer saves/deletes ambient files while the activation code believes it is in the account. Batch 12 solved this with `realpath` plus a bound check; Batch 13 only joins strings and has no `lstat` or `realpath` handling (no match for either in `libs/backend/output-styles/src/lib`).
- Fix: before a named read or write, resolve the directory (through the fs port if it has `stat`/`realpath`, otherwise a small host-injected check). Require the real path to stay under the real `canonicalConfigDir`, or refuse with `OutputStyleAccountResourceError`.

### 3. Selected output style that is absent in the named account aborts session start — Moderate
- File: `output-style-session-activation.service.ts:173-175` (plus catch at `:187`)
- Scenario: the selection (`readSelectedName`) is global. A user selects an ambient user-tier style `foo`, then launches a named account that has no `foo`. Discovery returns no winner, so `resolveSessionFields` throws `OutputStyleAccountResourceError`. The "never fatal" session-start rule is replaced by a hard failure, and the user did not request the missing resource for that account. The behaviour is correct only if the Batch 17 caller catches it and degrades to "no style" plus a visible notice. Nothing in this batch makes that contract explicit.
- Fix: either return `NO_OUTPUT_STYLE` plus an `unavailable` marker field, or document and test in Batch 17 that the launcher catches this error. A per-account selection is the longer-term fix.

### 4. Privacy: raw filesystem paths and error messages for named roots reach logs — Moderate
- Files: `jsonl-reader.service.ts:547-551` (`filePath` in the oversize warning), `:1019-1022` (`filePath` in the unreadable agent file debug log), `session-stats-reader.service.ts:372-378` (`error.message`, which for a raw `fs.stat` EACCES/EPERM contains the absolute account path), `output-style-discovery.service.ts:239` and `:255` (`errorMessage(error)` and `fileName`)
- Scenario: for a named context these carry `<config>/projects/...` or `<config>/output-styles/...`, so the account directory leaks into logs. The directory name may encode the account label or user name, which breaks the "no directory in logs" requirement. The new `ClaudeAccountResourceError`, `SdkModelService` and probe paths do this correctly (fixed text only).
- Fix: when `context.kind === 'named'`, log only the error `code`/`name` and the basename, or omit the path.

### 5. Named plan-usage reads bypass the TTL and fan out SDK control calls on every request — Moderate
- File: `plan-usage.service.ts:193-200`
- Scenario: `target.claudeRoute?.kind !== 'named'` skips the fresh-cache fast path entirely. Every UI refresh or poll for a named owner makes `accountInfo` twice plus `/usage` (`claude-plan-usage.reader.ts`, before/after proofs) against the live session. Concurrent calls collapse through single-flight, but sequential calls do not. This risks hitting Anthropic's usage endpoint at poll frequency, and it spams the session's control channel.
- Fix: serve a cached reading whose proof is current (same owner key, route revision and epoch, and a TTL of `PLAN_USAGE_CACHE_TTL_MS`). Keep `sourceInvalid` readings uncached. If the bypass is intentional, state the cost in the code and add a minimum interval.

### 6. `accountEpochs` FIFO eviction can forget a live identity — Moderate
- Files: `session-quota-probe.service.ts:313-321` and `:386`; `sdk-model-service.ts:449-461`
- Scenario: at more than 128 identities the oldest-inserted key is deleted. `Map.set` on an existing key does not refresh its position, so an actively used identity can be evicted. Its in-flight result then fails `accountEpochs.get(identity) !== route.authEpoch` and returns `stale-epoch` or `[]`, a spurious failure. An older epoch for the same identity is also accepted again, because the newer epoch was forgotten, so a late stale caller is not rejected.
- Fix: delete then set on update (LRU), and never evict an identity that has an active probe or read.

### 7. One bad symlink makes the whole named project listing unavailable — Moderate
- File: `jsonl-reader.service.ts:271-290` (`listSessionsDirectories`, per-entry `boundPath` inside the shared try)
- Scenario: a single dangling or escaping symlink in `<config>/projects` makes `boundPath` throw, so the whole listing becomes `unavailable` and rewind/stats/history for the account fail. Failing closed is safe, but a stale link on disk can block an account indefinitely.
- Fix: skip an entry that fails the bound check, optionally counting skipped entries, and fail only when the root itself is unusable.

### 8. Duplicate probe processes across accounts are unbounded — Moderate
- File: `sdk-model-service.ts:391-417`
- Scenario: single-flight is per key. With N accounts and refreshes on each epoch bump, N Claude CLI processes start at once, each loading the SDK. There is no global cap.
- Fix: add a small semaphore (for example 2) around `probeAccountModels`.

### 9. Failed-proof owner label says "(no email)" for a failed read — Minor
- File: `provider-owner.resolver.ts` (`ownerForClaudeAccount`; named failure path in `ownerForSession`)
- A route-specific unknown owner from `stale-epoch` or `no-open-session` gets the label "Claude identity unavailable (no email)". `unknownReason` is correct (`unresolved-route`), but the label is misleading. Fix: use a neutral label.

### 10. User-tier `ClaudeSettingsWriter` is not account-aware — Minor (not in diff; wiring note)
- File: `libs/backend/output-styles/src/lib/claude-settings.writer.ts:63-64`
- Writes `~/.claude/settings.json`. Batch 17 must not call it for a named session, or an ambient file is written. Add a guard or an explicit unsupported result.

### 11. `listAgentDirectory` lists the subagents directory unbound — Minor
- File: `jsonl-reader.service.ts:947-1000` (named `sessionsDir` is bound, `subagentsDir` is joined from `parentSessionId` and not re-bound)
- A symlinked `subagents` directory outside the root yields entry names (not contents, since each file is then bound-checked and reported via `onUnreadable`). Low impact; bound the directory too.

## Fix 0c7313438 (weaker evidence: same family)

`providerAccountErrorCode` (`provider-account-route.ts:11-13`) returns `String(code)` for any object with a `code` property, else `''`.
- `EEXIST` to `conflict`: unchanged for `Error` instances (`provider-account-route.ts:72-75`). Plain objects with `code: 'EEXIST'` now also map (intended).
- The `provider-account.service.ts:77-81` directory loop rethrows anything that is not `EEXIST`, same as before.
- `SQLITE_BUSY`/`LOCKED` to `busy` (`provider-account.service.ts:149`) and `SQLITE_BUSY`/`LOCKED` then `SQLITE_CONSTRAINT` to `conflict` (`provider-account.store.ts:63-66`), with `unavailable-storage` as the fallback: all preserved. The only widening is non-`Error` objects with those codes, which now map instead of falling to `unavailable-storage`.
- No remaining `instanceof Error && 'code'` pattern in `libs/backend/auth-providers/src/lib/accounts`.
- Error messages are never copied (only the code is read). Mapping is unchanged.

## Five logic questions (short)
1. Silent failure: finding 1 (wrong path shown), finding 6 (spurious stale result), finding 7 (listing aborts). Resource misses otherwise surface as closed errors.
2. User action: select an ambient output style, then launch a named account (finding 3).
3. Wrong answer from data: symlinked output-styles dir (finding 2); owner email is case-sensitive, so `A@x.com` and `a@x.com` become two owners (pre-existing behaviour, not changed here).
4. Dependency failure: probe timeout, missing CLI installation and rejected `supportedModels` all return `[]` and clean up the process and listeners. Usage `service-unavailable` can serve same-owner stale data after successful dual identity proof (by design).
5. Missing: a TTL or backoff for named reads (finding 5), a cap on concurrent probes (finding 8), and a caller contract for `unsupported` / `unavailable` results until Batches 16–17.

## Edge cases

| Case | Handled | Concern |
| --- | --- | --- |
| Named root missing | YES | explicit `unavailable` |
| Symlink escaping projects root | YES (files, dirs) | NO for output-styles (finding 2); one bad link aborts listing (finding 7) |
| Late result after epoch advance | YES | eviction edge (finding 6) |
| Shutdown during in-flight read | YES | reader, stats and plan service abort and clear caches |
| Dual accounts, same workspace | YES | cache key carries fingerprint, revision, epoch |
| Same identity, two config dirs | YES | owner key excludes directory |
| Unknown or failed proof | YES | run-specific key, no cache, no promotion |
| Imported MCP and approvals for named | YES | explicit `unsupported`, no ambient read |

## Public API style

- `SessionQuotaProbe` (`session-quota-probe.service.ts:~100-120`): `readAccountForRoute` and `readPlanUsageForRoute` are required, but `invalidateAccountRoute?` is optional. Make them consistent. The reader's `!probe.readAccountForRoute || !probe.readPlanUsageForRoute` guard (`claude-plan-usage.reader.ts:175-176`) is dead code against the declared type; remove it or make the methods optional so the type tells the truth. `readPlanUsageForRoute(sessionId: string | undefined, ...)` puts the optional argument first, which differs from the legacy `readPlanUsage(sessionId?)`; consider `readPlanUsageForRoute(route, sessionId?)`.
- `readNamed` uses `value as T` and `query as object & QuotaReadableQuery` casts (`session-quota-probe.service.ts:~377, ~397`). Type `callBounded` generically to remove both.
- `sdk-model-service.ts:497` uses an untyped `require('os').homedir()` in an ESM-style import file. Import `homedir` from `'os'` at the top.
- `PlanOwnerTarget.claudeRoute?: ClaudeAccountRoute` admits the ambient kind, but all consumers special-case only `'named'`. Narrow to `ClaudeAccountNamedRoute`, or document ambient as equivalent to undefined. `PlanUsageReading` gains an internal `sourceInvalid` flag through an intersection on a public alias; consider a separate internal type so it can never leak into snapshots (`assemble` currently copies fields one by one, so it does not leak).
- Resource-context parameter: a trailing positional `context?: ClaudeAccountResolvedResourceContext` on about twelve methods forces `undefined` placeholders (`readJsonlMessages(filePath, undefined, context)` at `jsonl-reader.service.ts:1005`). Prefer folding it into the existing options objects. `readClaudeUserMcpServers` now returns `ClaudeUserMcpEntry[] | ClaudeUserMcpUnsupportedResult` through overloads; fine for the type narrowing, but the `'unsupported'` result carries both `status` and `code` with the same value (redundant).
- Imports use `@ptah-extension/*` aliases; no `any` or `as unknown as` in non-spec changed lines.

## Decisions

- Did not flag D16/D17 deferrals (no import linkage, registry binding empty): stated in the brief, reversible.
- Treated omitted `context` = ambient as an intentional contract of Batch 12–13 (plan 204-206), not a fallback defect. The risk is moved to Batch 17 callers: every named session path must pass a context; recommend a lint or spec asserting that no ambient reader is called with a named session id.
- Rated findings 1 and 2 Serious rather than Moderate because the acceptance text says "selected writes/readback use same root" and "no ambient file written for named context".

## Verdict

REVISE: fix findings 1 and 2 and decide findings 3 and 5 before Batch 16/17 build on these APIs. The rest can ride with the next batch touching the same files. Confidence: MEDIUM-HIGH (static; specs not executed).
