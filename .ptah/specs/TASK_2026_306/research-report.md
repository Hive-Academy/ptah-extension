# Defect inventory — Electron dev serve, 2026-08-22

Source: `tmp/logs/log.log`, 1200 lines, a single `nx serve ptah-electron` run
that never opened a window. Every claim below is traced to either a log line or
a source location; where a conclusion rests on the **absence** of a log line,
that is stated explicitly.

Severity key: **S1** blocks the app · **S2** silently breaks a feature ·
**S3** wastes resources or degrades quality · **S4** noise.

| #   | Severity | Defect                                                                            | Owner                                                 |
| --- | -------- | --------------------------------------------------------------------------------- | ----------------------------------------------------- |
| A   | S1       | Cron cold-start catchup is awaited on the activation path, gating window creation | `cron-scheduler`, `ptah-electron`                     |
| B   | S1       | No provider quota gate — a 429 is invisible to every background consumer          | `auth-providers`, `skill-synthesis`, `memory-curator` |
| C   | S2       | Session importer parses a truncated line and discards every file                  | `agent-sdk`                                           |
| D   | S2       | One `ENOENT` aborts the entire workspace file index                               | `workspace-intelligence`                              |
| E   | S3       | `task-specs` index rebuild runs before SQLite opens                               | `task-specs`, `ptah-electron`                         |
| F   | S3       | `harness-sync` reports 13 missing files on both passes                            | `harness-sync`                                        |
| G   | S3       | SDK adapter and CLI detection initialise twice                                    | `agent-sdk`                                           |
| H   | S4       | Log noise and cosmetic warnings                                                   | various                                               |

---

## A — Boot blocker: window creation waits on background LLM work

**Severity S1.** The app is unusable; there is no window and no error.

### The chain

Every link is a bare `await`. No link is fire-and-forget.

| Step | Location                                                         | Call                                                                                   |
| ---- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1    | `apps/ptah-electron/src/main.ts:127`                             | `await wireRuntime({...})`                                                             |
| 2    | `apps/ptah-electron/src/activation/wire-runtime.ts:373`          | `await bootHeavyServices(startupWorkspaceRoot)`                                        |
| 3    | `apps/ptah-electron/src/activation/wire-runtime.ts:325`          | `await startThothCron(container, thoth, {...})`                                        |
| 4    | `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts:282`     | `await refs.cronScheduler.start({...})`                                                |
| 5    | `libs/backend/cron-scheduler/src/lib/cron-scheduler.ts:98`       | `await this.catchup.replayMissed(options, () => DEFAULT_CATCHUP_POLICY)`               |
| 6    | `libs/backend/cron-scheduler/src/lib/catchup-coordinator.ts:105` | `await this.runner.run(job, slot, {...})` — inside a `for` loop over every overdue job |

The window is created at `apps/ptah-electron/src/activation/post-window.ts:108`,
reached from `main.ts:145` — that is, **only after step 1 returns**.

### Evidence

Two log lines that should exist do not:

- `[Ptah Electron] Cron scheduler started` (`start-thoth-cron.ts:287`) — absent.
  This is emitted immediately after step 4, so step 4 never returned.
- `[Ptah Electron] Subsystems brought up` (`wire-runtime.ts:385`) — absent.
  Confirms `bootHeavyServices` never returned either.

Two that do exist bound the cost:

```
[DEBUG] [skill-synthesis] drain finished: {"tier":"frequent", ... "durationMs":94246}
[DEBUG] [cron-scheduler] run succeeded: {"jobId":"@ptah/skills-drain-frequent", ...}
```

That is 94 s for **one** of four overdue jobs, and the nightly and weekly drains
had not finished when the capture ended. Meanwhile
`[IpcBridge] Cannot send to renderer: no window available`
(`apps/ptah-electron/src/ipc/ipc-bridge.ts:123`) fires eight times — services
broadcasting into a void.

### Why this is not a quota problem

`DEFAULT_CATCHUP_POLICY` is `'last'` (`cron-scheduler.ts:56`), so the replay is
one slot per job, not a full 24-hour window — four jobs total
(`@ptah/daily-backup`, and the `frequent` / `nightly` / `weekly` skill drains,
registered at `start-thoth-cron.ts:53-78` and `:247`). The bound is small. The
cost is not, because each of those slots is LLM work whose duration is set by a
remote endpoint.

**A healthy provider with a large backlog stalls the window identically.** The
quota exhaustion turned a long stall into an unbounded one; it did not create
the ordering defect. Fix A must land regardless of B.

### Fix

The resume path already has the correct shape — `catchup-coordinator.ts:62`:

```ts
void this.replayMissed(getOptions(), getPolicy).catch((err) => {
  this.logger.error('[cron-scheduler] catchup on resume failed', { err: (err as Error).message });
});
```

Cold start should match it. At `cron-scheduler.ts:98`:

```ts
void this.catchup
  .replayMissed(options, () => DEFAULT_CATCHUP_POLICY)
  .catch((err) => {
    this.logger.error('[cron-scheduler] cold-start catchup failed', {
      err: (err as Error).message,
    });
  });
```

This makes cold start consistent with resume rather than inventing a new policy.
Note the existing `try/catch` around line 98 becomes dead once the await is
dropped — the rejection handler moves onto the promise.

**Consider as a follow-up, not part of this fix:** `bootHeavyServices` is awaited
in full at `wire-runtime.ts:373`, and everything else in it is local I/O
(SQLite open, plugin loader, user-layer mirror, harness reconcile, git watcher).
Removing the cron await takes the unbounded work off the boot path. Whether the
remaining local I/O should also move behind the window is a separate judgement
with its own risk.

---

## B — No provider quota gate

**Severity S1.** Background work loops against a dead endpoint indefinitely,
spends the developer's remaining quota, persists output from a provider that
never answered, and tells the user nothing.

### What is already correct

`libs/backend/auth-providers/src/lib/translation/translation-proxy-base.ts:545-568`
handles the 429 properly: it reads `retry-after`, logs, and returns a clean
`rate_limit_error` to the caller with the header forwarded. **The proxy is not
the defect.** Every OAuth-proxy provider passes through this one method, which
makes it the correct place to _record_ quota state.

### What is missing

Nothing consumes the signal. Three facts compose into the failure:

1. **The 429 never reaches the lane.** The Claude CLI runs as a subprocess and
   absorbs the 429, retrying internally. `LaneRunnerService`'s only failure
   signal is its own timer (`lane-runner.service.ts:431-434`), so it returns
   `{ kind: 'timeout' }` at `:489` and `:502`.
2. **There is no quota failure kind.** `SkillLaneFailureKind`
   (`lane.types.ts:116-120`) has exactly four members —
   `auth-unresolvable`, `structured-output-unsupported`, `tool-use-unsupported`,
   `timeout`. An exhausted subscription is therefore recorded as a timeout,
   which is a transport fault, and gets the transport backoff
   (`2^attempt × 60s`, `lane-runner.service.ts:118-121`) rather than the
   provider's own cooldown.
3. **Every row re-pays the discovery cost.** With no shared state, each queued
   row burns a full `timeoutMs` to rediscover the same dead endpoint.

Log evidence of the resulting waste:

```
[WARN] [skill-synthesis] synthesizer: lane failed: {"kind":"timeout","reason":"Lane synthesis: timed out"}
[WARN] [skill-synthesis] synthesizer: lane unavailable/failed or parse failed; using template fallback
[INFO] [skill-synthesis] SKILL.md materialized: {"slug":"i-would-like-you-to-spawn-all-of-our-installed-cli-agents-an", ...}
[INFO] [skill-synthesis] candidate registered: {"candidateId":"01M0N1GSJQX5NT4N2APHJ072N1", ...}
```

94 s spent, no model output, and a template-derived candidate persisted to
`~/.ptah/skills/_candidates/` and registered in the DB as if it were real work.

### Amplification factors

- **15 sessions were enqueued at boot** (`source: "boot"`), each firing an
  internal query.
- **Each internal query costs two upstream requests.** The second is the Claude
  CLI generating a session title for a headless one-shot query nobody reads:
  `[claude-code:unrecognized_model] {"model":"gpt-5.6-luna","query_source":"generate_session_title"}`.
- **The model is rejected by the CLI anyway.** `gpt-5.6-luna` comes from the
  user's own tier mapping (`SdkModelService` resolves `haiku` to it), and the
  CLI reports it as unrecognised on every call.

### No `retry-after` header is actually sent

The proxy reads `retry-after` at `:546` and appends `Retry after N seconds.` to
the warning when present. Every rate-limit line in the log is bare:

```
[WARN] [CodexProxy] [cod_mt4j9yx6_1] Rate limited by Codex Responses API
```

So the ChatGPT backend sends no `retry-after` on this path, and any cooldown
must have a default. Honour the header when present; do not depend on it.

### Proposed gate

Gate **before dispatch**, not by classifying the failure afterward — post-hoc
classification cannot work while the subprocess swallows the 429.

The seam already exists and is documented as the right shape.
`ILaneAuthResolver.resolve()`
(`libs/backend/skill-synthesis/src/lib/lanes/lane-auth-resolver.port.ts:36-51`)
is specified to throw when "a configured provider is unusable", matched by
`name` via `PROVIDER_AUTH_ERROR_NAME` at `:59` rather than `instanceof`
(because the error class lives a lib away). `LaneResolverService` converts that
throw into a stall carrying `retryAfterMs`, and `lane.types.ts:134-143` records
why it must stall rather than fall back. Quota exhaustion is the same category.

1. `TranslationProxyBase` records `{ providerId, until }` on a 429 and clears it
   on the next success. One chokepoint, all OAuth-proxy providers.
2. `ProviderAuthResolver.resolve()` throws `ProviderQuotaError` carrying
   `retryAfterMs` while the provider is cooling down — matched by `name`, same
   pattern as `ProviderAuthError`.
3. Add `'quota-exhausted'` to `SkillLaneFailureKind` so the queue reason is
   honest and the backoff comes from the cooldown rather than from the timeout
   ladder.

No provider-id literal enters `skill-synthesis` — the resolver is keyed by the
id the lane already resolved, which is what the lane contract permits.

### Three things to settle during implementation

- **Default cooldown.** No `retry-after` arrives. A 15-minute default is a
  reasonable starting point; the value should be settable.
- **The memory curator bypasses the gate as written.** It falls back to the
  active provider on auth failure
  (`sdk-internal-query.curator-llm.ts:84-91`) — a deliberate divergence from
  lanes, documented as such. That fallback would walk straight past a quota
  stall, so the curator needs the check applied directly rather than inherited.
- **The user is never told.** The gate stops the loop but leaves background
  learning silently disabled. It needs to reach the UI once a window exists —
  and note that during this run there was no window to tell.

---

## C — Session importer discards every file

**Severity S2.** Silent: the feature reports success with a count of zero.

`libs/backend/agent-sdk/src/lib/session-importer.service.ts:477-485` opens the
file, reads a fixed 8192-byte prefix, splits on `\n`, and then `JSON.parse`s
**every** resulting line at `:492`:

```ts
const { bytesRead } = await fd.read(buffer, 0, 8192, 0);
const content = buffer.toString('utf-8', 0, bytesRead);
const lines = content.split('\n').filter((line) => line.trim());
for (const line of lines) {
  const msg = JSON.parse(line);   // <- throws on the truncated tail
```

The last line of an arbitrary 8 KB prefix is almost always cut mid-token. The
throw propagates to the method-level `catch` at `:530`, which logs at debug and
returns `null`, so the whole file is dropped.

Observed: 11 of 11 files failed, every one with an offset inside the prefix and
every one on `line 1` — the signature of a truncated single-line record, not of
corrupt data:

```
[DEBUG] [SessionImporter] Failed to extract metadata: {"filePath":"...\\922dbed2-....jsonl","error":"Unterminated string in JSON at position 7914 (line 1 column 7915)"}
[DEBUG] [SessionImporter] Failed to extract metadata: {"filePath":"...\\85c72dab-....jsonl","error":"Unterminated string in JSON at position 399 (line 1 column 400)"}
[INFO]  [SessionImporter] Import complete: {"imported":0,"fromIndex":0}
```

Fix: drop the trailing partial line before the loop (or wrap the per-line parse
and `continue`). Note the secondary consequence — modern CLI JSONL first records
routinely exceed 8 KB, so `session_id` may not be found in the prefix at all;
the filename fallback at `:516` covers that and should be kept.

---

## D — One `ENOENT` aborts the whole workspace index

**Severity S2.** Caught as non-fatal, so the app continues with no file index.

```
[ERROR] [WorkspaceFileIndex] Failed to start FileSystemError: Failed to stat:
        D:/projects/property-hub/.claude/skills/scroll-world/references/index-template.html
    at FileSystemService.stat
    at async WorkspaceIndexerService.indexWorkspaceStream
    at async WorkspaceFileIndexService.build
    at async WorkspaceFileIndexService.doStart
Caused by: Error: ENOENT: no such file or directory, stat '...' { errno: -4058, code: 'ENOENT', syscall: 'stat' }
[Ptah Electron] WorkspaceFileIndex.start failed (non-fatal): ...
```

A single unstatable entry — a broken link, or a file deleted between the
directory read and the stat — terminates `indexWorkspaceStream` for the entire
workspace. Per-entry `ENOENT` should be skipped and counted, not propagated.

---

## E — `task-specs` index rebuild runs before SQLite opens

**Severity S3.** Ordering defect; the write is simply lost.

```
line  313: [WARN] [task-specs] index rebuild write failed: {"error":"Persistence is offline: SQLite connection has not been initialized yet."}
line  777: [INFO] [persistence-sqlite] openAndMigrate complete: {"finalVersion":39, ...}
```

464 log lines separate the attempt from the connection being available. Either
defer the rebuild until after `openAndMigrate`, or have it subscribe to
connection-open rather than firing during registration.

---

## F — `harness-sync` reports 13 missing files, and re-running does not help

**Severity S3.**

```
[WARN] [harness-sync] Reconcile finished with gaps: {"reason":"activation","mode":"full","sources":"ok","collisions":0,"expected":119,"found":106,"missing":13,"foreign":19,"removed":4,"writeFailed":0}
[WARN] [harness-sync] Reconcile finished with gaps: {"reason":"content-download-complete", ... "expected":119,"found":106,"missing":13,"foreign":19,"removed":0,"writeFailed":0}
```

The counts are **identical** across the pre-network and post-download passes, so
the second pass — which exists specifically to correct a cold or cached first
pass — closes nothing. `writeFailed: 0` rules out permissions. The 13 files are
expected by the manifest and are not being produced by either source.

The per-target summary disagrees with the reconciler's own numbers and is worth
checking while here:

```
[Ptah Electron] Harness reconciled (activation): sources=ok, found=14/27, foreign=19, writeFailed=0
```

`14/27` against the reconciler's `106/119` — two different denominators reported
from one pass.

---

## G — SDK adapter and CLI detection initialise twice

**Severity S3.** Duplicated work at boot; the auth half is already guarded.

```
[INFO] [SdkAgentAdapter] Initializing SDK adapter...
[INFO] [SdkAgentAdapter] Auth file changed for openai-codex while adapter unhealthy — re-initializing...
[INFO] [SdkAgentAdapter] Initializing SDK adapter...
[DEBUG] [AuthManager] configureAuthentication already in progress, awaiting existing call
[INFO] [SdkAgentAdapter] Detecting Claude CLI installation...
[INFO] [SdkAgentAdapter] Detecting Claude CLI installation...
```

`AuthManager` de-duplicates the auth call (`sdk-agent-adapter.ts:192` is the
re-entry point), but CLI detection runs twice and `[INFO] [RPC Verification] All
362 RPC methods correctly registered` is also logged twice. The trigger is a
`~/.codex/auth.json` change firing while the first init is still in flight —
the OAuth token refresh at boot writes that file, so the adapter races itself
on every cold start with an expired Codex token.

---

## H — Noise and cosmetic issues

Not defects in behaviour, listed so they are not re-investigated later.

| Item                         | Detail                                                                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DEP0040 punycode`           | Transitive dependency deprecation. Ignorable.                                                                                                                                        |
| `DEP0190` shell args         | `Passing args to a child process with shell option true` — a real spawn smell in CLI detection, but not implicated in any defect above.                                              |
| claude.ai connectors warning | `⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set` — expected; the proxy sets `ANTHROPIC_AUTH_TOKEN` deliberately (`OAuthProxyStrategy`). |
| Nx nag ×8                    | `Your AI agent configuration is outdated. Run "nx configure-ai-agents"` after every target.                                                                                          |
| Mojibake                     | `Resolved 'haiku' â†’ 'gpt-5.6-luna'` — UTF-8 written to a non-UTF-8 console. Cosmetic, but it makes log search unreliable for any line with a non-ASCII character.                  |
| `JsonlReader` spam           | `findSessionsDirectory` logs ~25 times at DEBUG, each carrying the full `dirCount` + `sampleDirs` payload for the same workspace. Uncached.                                          |
| Skill migration scan         | `SKILL.md migration complete (active root): {"migrated":0,"skipped":2374}` and `(candidates root): {"skipped":2373}` — 4747 files walked on every boot to migrate nothing.           |
| Webview bundle               | Initial total 7.53 MB, largest chunk 2.39 MB. Dev build, so not a shipping figure, but worth a look.                                                                                 |

---

## Suggested sequencing

1. **A** — one-line change, restores a usable window immediately, unblocks
   everything else including any manual verification of B.
2. **C** and **D** — self-contained, each restores a silently-dead feature.
3. **B** — needs an architecture pass: new error type, new failure kind, a
   proxy-side store, and the separate curator path. Largest blast radius.
4. **E**, **F**, **G** — independent, no ordering constraint among them.
5. **H** — opportunistic.
