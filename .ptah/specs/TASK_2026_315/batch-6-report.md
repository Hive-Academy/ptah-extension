# Batch 6 report — TASK_2026_315 (C1, C4, C5, C7)

**Executor**: `backend-developer` | **Status**: complete, no commits created
**Outcome**: 3 code fixes (C4, C5, C7) + 1 investigation closed with no behavioural
change (C1). All six affected projects green on `test`, `lint` and `typecheck`.

---

## Summary table

| Task | Finding                                               | Outcome                                                                                                                            |
| ---- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 6.1  | C1 — `unrecognized_model` on session-title generation | **No code change warranted.** Symptom disproved by observation. Finding recorded as a code comment so it cannot be re-opened blind |
| 6.2  | C4 — repeated ENOENT for a broken skills.sh install   | **Staging guard has no hole** (evidence below). The repeated report is fixed                                                       |
| 6.3  | C5 — AgentDiscovery ENOENT bypasses the logger        | Fixed at both named sites; a real EACCES still surfaces                                                                            |
| 6.4  | C7 — sqlite-vec primary resolver fails noisily        | Fixed. Total-failure diagnostic survives intact                                                                                    |

---

## Files changed

| File                                                                                                                     | Task                             |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\auth\workspace-provider-profile-resolver.ts`             | C1 (comment only — no behaviour) |
| `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\plugin-loader.service.ts`                             | C4                               |
| `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\plugin-loader.service.spec.ts`                        | C4 (extended)                    |
| `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\autocomplete\agent-discovery.service.ts`             | C5                               |
| `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\autocomplete\command-discovery.service.ts`           | C5                               |
| `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\autocomplete\autocomplete-workspace-scoping.spec.ts` | C5 (constructor arity)           |
| `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\autocomplete\discovery-scan-logging.spec.ts`         | C5 (**new**)                     |
| `D:\projects\ptah-extension\libs\backend\thoth-runtime\src\lib\diagnostics.ts`                                           | C7                               |
| `D:\projects\ptah-extension\libs\backend\thoth-runtime\src\lib\diagnostics.spec.ts`                                      | C7 (extended)                    |

Nothing under `libs\backend\harness-sync\` was opened. Confirmed against
`git status`: the 24 modified files there belong to the concurrent session and
are untouched by this batch.

---

## Task 6.1 — C1: `unrecognized_model` on session-title generation

### The user-visible symptom, as an OBSERVATION

**There is no user-visible symptom. Session titles are not broken.** This is
stderr noise from an internal Claude Code CLI feature that Ptah neither invokes
nor consumes. Stated as observation, with the source for each claim:

1. **Ptah never displays a CLI-generated title on any live path.** The session
   name rendered by `session:list` is `SessionMetadata.name`
   (`libs\backend\rpc-handlers\src\lib\handlers\session-rpc.handlers.ts:327`).
   That field is written at SDK `init` from
   `config?.name || 'Session <date>'` (`sdk-agent-adapter.ts:633`, persisted at
   `:800`) — i.e. **before** a title could exist. The frontend default is
   `'New Chat'` (`tab-manager.service.ts:656`). `SessionMetadata` has no
   `title` and no `summary` field at all
   (`session-metadata-store.ts:37-83`).
2. **Ptah actively discards the CLI's title artifact.**
   `session-importer.service.ts:197-221` (`isTitleOnlySidecar`) detects the
   CLI's `{"type":"ai-title",…}` records and skips those files (`:568-577`);
   `:146-189` prunes metadata already pointing at them. The `title` field inside
   an `ai-title` record is never read into `name`.
3. **The one place a CLI title IS read contributed nothing in the captured
   run.** `session-importer.service.ts:311-321` reads
   `entry.customTitle || entry.summary` from the CLI's `sessions-index.json`,
   falling back to the first user prompt truncated to 50 chars. The log reports
   `fromIndex: 0` at `log.log:669`, `:886` and `:1116` — that branch produced
   zero entries. The names that were actually imported are first-prompt
   derivations: `log.log:1080` → `"name":"what is your output style"`.
4. **The complaint is advisory, not fatal.** At `log.log:922` the CLI subprocess
   emits it mid-MCP-handshake and proceeds to `tools/list` on the **very next
   line** (`:923`). No abort, no error. Repo-wide grep for `unrecognized_model`
   returns **zero source hits** — only `.ptah/specs/**` markdown. It reaches
   Ptah solely through the string-sniffing stderr sink at
   `sdk-query-runner.service.ts:363-371`, and because the payload carries
   neither `[ERROR]` nor `[WARN]` it logs at INFO — matching the log exactly.
5. **The same model id worked.** `haiku → deepseek-v4-flash:0731-cloud` served
   Ptah's own internal queries in the same session without complaint
   (`log.log:614-624`, `:907-916`, both returning a live conversation handle in
   ~670 ms), and again at `:803`. `query_source` appears exactly twice in the
   whole 1177-line log, both `generate_session_title`.
6. Both complaints rode a **headless one-shot query with `persistSession: false`**
   (`sdk-query-runner.service.ts:342`, same options object as the `:363` stderr
   sink) — a session that is never listed in the UI at all.

### Decision: no code change

Not merely "unnecessary" — the obvious fix is **actively harmful**. Setting
`ANTHROPIC_DEFAULT_HAIKU_MODEL` to an id the CLI recognises means setting it to
an Anthropic id, for a user with no Anthropic credentials whose configured
endpoint is `ollama-cloud`. That would silence a harmless line about a feature
Ptah does not use, by breaking the memory-curator and skill-synthesis queries
that work today. It would also ship an invented id, which the derivation rule
in `libs\backend\auth-providers\CLAUDE.md` ("Tier derivation") forbids by
construction: every returned string must be `===` an id on the provider's own
catalogue.

`ModelResolver`'s tier substitution was not touched, per the constraint.

### One correction to the finding as originally written

**Ptah sets no `ANTHROPIC_SMALL_FAST_MODEL` anywhere.** Repo-wide grep returns
exactly one hit, a doc comment at
`libs\shared\src\lib\providers\entries\requesty-provider-entry.ts:10`. The
`AuthEnv` type has no such member. The entire tier env surface is the three
writes at `workspace-provider-profile-resolver.ts:397-399`
(`ANTHROPIC_DEFAULT_{SONNET,OPUS,HAIKU}_MODEL`). The brief's "small-fast tier
env" framing should be read as `ANTHROPIC_DEFAULT_HAIKU_MODEL`.

### What was written

A ~30-line block appended to the `applyProviderTiers` docblock recording the
measurement, the decision, and **why the obvious fix is wrong** — so the next
person who greps `unrecognized_model` lands on the answer instead of
re-investigating. No executable line changed; `auth-providers` tests pass
unchanged.

### Could not determine

Whether the two curator one-shot queries returned _usable_ content — no
success-side log line exists at any layer, and `[memory-curator] curator LLM
query failed` (`sdk-internal-query.curator-llm.ts:309`) appears nowhere in the
log, so the run is silent either way. This does not affect the decision: it is
the same silence with or without a title.

---

## Task 6.2 — C4: repeated ENOENT for a broken skills.sh install

### The staging guard: investigated, no hole found

**Evidence — the actual on-disk residue** (`Get-ChildItem -Recurse -Force`):

```
C:\Users\abdal\.ptah\plugins\ptah-skillssh-oso95-scroll-world\skills                          d----- 8/18/2026 6:06:12 PM
C:\Users\abdal\.ptah\plugins\ptah-skillssh-oso95-scroll-world\skills\scroll-world             d----- 8/20/2026 9:55:03 PM
C:\Users\abdal\.ptah\plugins\ptah-skillssh-oso95-scroll-world\skills\scroll-world\references  d----- 8/20/2026 9:55:03 PM
```

Two facts do the work here:

1. **Zero files anywhere in the tree.** Not just a missing `SKILL.md` — the
   `references/` subdirectory is empty too. This is a directory _skeleton_.
2. **No `.ptah-skillssh.json`.** Every successful write path writes that record
   unconditionally: `SkillsShSourceRootService.install` at
   `skills-sh-source-root.service.ts:153` (after the move loop), and
   `mergeMetadata` in `skills-sh-legacy-adoption.ts:213-240`. A root produced by
   a _completed_ install always has one. This root has none.

Both write paths verify a readable `SKILL.md` before moving anything:

- `install()` — `listSkillSlugs(stagedSkillsDir)` at `:133`, which `fs.access`-es
  `SKILL.md` per candidate (`:356-375`), then the refusal at `:134-140`. Only
  verified slugs reach the `movePath` loop at `:146-150`.
- `adoptLegacySkillsShInstalls` — `isSkillDir()` at `:196-205`, same
  `fs.access` on `SKILL.md`, checked at `:115` before the copy.

So no _successful_ run of either path can produce this tree, and the guard at
`:133-140` is not what let it through. **The guard has no hole and I did not
edit it.**

What the residue is consistent with is a **partial `fs.rm` / `fs.cp`**, not a
staging failure: files deleted, directories left behind — the classic Windows
shape where the file unlinks succeed and the `rmdir` fails on a held handle
(indexer, AV, Explorer). Both `uninstall()` (`:195-202`) and `install()`'s
`rm`-then-`move` loop (`:148-149`) are non-atomic and would propagate such a
throw to the RPC caller, leaving exactly this. The identical `8/20 9:55:03 PM`
mtime on both surviving directories is consistent with their contents being
removed in one operation.

I did **not** harden that path. It is a teardown-atomicity question, one machine
deep, and "resolving the user's own broken install" is explicitly out of scope.
Recording it here rather than editing defensively, per the instruction. If it is
wanted, it is a separate task with its own decision (retry-on-EBUSY vs.
move-aside-then-delete).

### The fix that was made: report once, not once per call

`PluginLoaderService.discoverSkillsForPlugins` now reports an unreadable
`SKILL.md` at most once per path per errno.

- New field `reportedUnreadableSkills: Map<string, string>` (path → errno).
- New private `reportUnreadableSkill(skillMdPath, error)` — returns early when
  the same path already reported the same errno.
- The success branch does `this.reportedUnreadableSkills.delete(skillMdPath)`.

Three properties, all pinned by tests:

- **Reported once.** Three `discoverSkillsForPlugins` calls over the broken root
  produce one debug line, not three (log 793/844/1012 becomes log 793 only).
- **A root that becomes readable is still picked up.** Only the _log_ is
  memoised; the scan itself is uncached and re-runs every call. The test writes
  a `SKILL.md` mid-test and asserts the slug appears on the very next call.
- **A path that breaks again is reported again**, and a path whose failure
  _mode_ changes (ENOENT → EACCES) re-reports rather than hiding behind the
  first entry.

Level stays `debug` deliberately: a half-written skill folder is a condition the
method must survive (per the existing comment at the read site) and the user
cannot act on the line either way. The defect was repetition, not severity.

---

## Task 6.3 — C5: AgentDiscovery ENOENT bypasses the logger

### What now logs, and at what level

**`agent-discovery.service.ts` — `scanAgentDirectory`**

| Condition                                            | Before                              | After                                                                                                      |
| ---------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Directory absent (`ENOENT`/`ENOTDIR`)                | raw `console.debug`, **every call** | `logger.debug('[AgentDiscovery] No agent directory here', {dir, code, error})`, **once per dir per errno** |
| Directory present, unreadable (`EACCES`, `EPERM`, …) | raw `console.debug`, every call     | `logger.warn('[AgentDiscovery] Agent directory unreadable', …)`                                            |
| Unknown / no errno                                   | raw `console.debug`                 | `logger.warn` (an unclassifiable failure surfaces rather than hides)                                       |

`Logger` is now injected via `@inject(TOKENS.LOGGER)` as the third constructor
parameter. Memo key is `` `${dir}::${errno}` `` and it is cleared for a
directory the instant that directory scans successfully.

**`command-discovery.service.ts` — `scanWorkspaceSkills` outer catch**

Same shape, plus one genuine defect found in the block being edited: an
**absent** `.claude/skills` was raising `sentryService.captureException`. That
spent the error budget on the ordinary state of any workspace the reconciler
has never run in, once per `autocomplete:commands`. Now:

| Condition     | Before                                             | After                                                                                        |
| ------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `ENOENT`      | `console.debug` + **Sentry exception**, every call | `logger.debug('[CommandDiscovery] No skills directory here', …)` once per dir; **no Sentry** |
| Anything else | `console.debug` + Sentry, every call               | `logger.warn('[CommandDiscovery] Skills directory unreadable', …)` + Sentry, as before       |

`Logger` injected as the fourth constructor parameter (after the existing
`SentryService`). The pre-existing `isEnoent()` helper at `:118` is reused
rather than duplicated.

### Proof the genuinely-bad cases still surface

New spec `discovery-scan-logging.spec.ts`, 7 tests:

- `routes a missing directory through the logger, never console` — spies on
  `console.debug` and asserts it is **not** called.
- `reports an absent directory ONCE across repeated calls` — 3 calls × 2
  directories → exactly 2 debug lines, not 6; zero warns.
- **`surfaces an unreadable directory at warn, not swallowed with the miss`** —
  project dir throws `EACCES`, user dir throws `ENOENT`; asserts exactly one
  **warn** carrying `{code: 'EACCES'}` and exactly one **debug**. This is the
  criterion "do not swallow a real permission problem", pinned directly.
- `re-reports a directory that regresses after reading successfully` — ENOENT →
  readable → ENOENT gives 2, 2, 4 lines.
- `re-reports the same directory when its failure MODE changes` — ENOENT then
  EACCES produces the warns.
- `does not raise a Sentry exception for a skills directory that is simply
absent` — asserts `captureException` **not** called, one debug line for two
  calls.
- **`still warns AND reports to Sentry when the directory is unreadable`** —
  EACCES asserts one warn **and** `captureException` called once.

### Deliberately not touched

`command-discovery.service.ts` retains `console.error` at `:340` / `:484` and
`console.debug` at `:460` / `:545` / `:566`, and `agent-discovery.service.ts`
retains `console.error` at `:274` / `:347` and `console.warn` at `:322` / `:328`.
None of these is a per-call emission on a normal machine and none appears in the
captured log; C5 names two sites and I fixed those two. A lib-wide `console`
sweep is a legitimate follow-up but is scope creep here.

One pre-existing lint warning is in a file I touched and is **not** mine:
`'IFileWatcher' is defined but never used` at `agent-discovery.service.ts:14`.
Verified unused at `HEAD` via `git show HEAD:… | Select-String IFileWatcher`.
Left alone.

---

## Task 6.4 — C7: sqlite-vec primary resolver fails noisily on every boot

### The emitter is not where the spec pointed

The task named
`persistence-sqlite\src\lib\sqlite-connection.service.ts:733-749`. That block is
**already correct** and was not changed: it is a `logger.warn` reached only after
the `for (const strategy of strategies)` loop at `:695-731` exhausts every
strategy, i.e. only on total failure. Its success sibling at `:716-721` already
logs a compact `logger.info` with `attemptedFallbacks: errorChain.length` — that
is `log.log:560`, and it is fine.

The nineteen-line block at `log.log:568-586` comes from
**`libs\backend\thoth-runtime\src\lib\diagnostics.ts:107`**:
`console.log('[persistence-sqlite] sqlite-vec diagnostic', summary)` where
`summary` included `chain: diagnostic.errorChain` on **both** branches. With
`ok: true` and a one-entry chain, the success path printed the primary
resolver's rejection message naming two paths that do not exist under
`nx serve`. That is the actual noise and that is what was fixed.

### What now logs, and at what level

| Condition             | Before                                                                                              | After                                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Loaded (any strategy) | `console.log` with `chain`, `error`, `electronVersion`, `processArch`, `processPlatform` — 19 lines | `console.debug` with `{ok, reason, attemptedPath, packageName, fsExists, attempts}` — one line, **no `chain`, no `error`** |
| Failed every strategy | `console.warn` with the full summary                                                                | **unchanged** — `console.warn` with `chain`, `error` and all three host facts                                              |

`attempts` is deliberately retained on the success path. Quietening the fallback
_count_ as well would hide a host that has silently stopped resolving via its
primary path; the count is the cheap signal, the per-strategy messages are the
expensive one. The full chain is still on the `VecLoadDiagnostic` object and
still reaches the renderer via `serializeVecDiagnosticForBridge` (untouched), so
nothing is lost — only unasked-for. `libs\backend\cli-engine\src\lib\bootstrap\thoth-runtime.ts:592`
already built its summary without `chain`; this is the Electron/VS Code side
catching up, and the code comment cites it.

`sqlite-connection.service.ts` was **not** modified — its
`attemptedFallbacks` reporting is preserved by not touching it.

### Proof the genuinely-bad case still surfaces

Two new tests in `diagnostics.spec.ts`, plus a corrected existing one:

- **`a successful load after a fallback logs at debug and drops the chain`** —
  drives the exact log:568-586 shape (`ok: true` + a `primary-resolver`
  errorChain entry naming absent paths). Asserts `console.warn` **not** called,
  `console.debug` called once, payload has **no** `chain` and **no** `error`,
  and `attempts === 1`.
- **`a load that failed every strategy still prints the full chain`** — asserts
  the message is `'[persistence-sqlite] sqlite-vec diagnostic (offline)'` and the
  payload still carries `chain`, `error`, `electronVersion`, `processArch` and
  `processPlatform`. This is the "must survive intact" criterion, pinned.
- `emits at most once per process` — retargeted from the `console.log` spy to
  `console.debug`; the once-per-process latch is unchanged.
- The Sentry tests are unaffected: the breadcrumb still fires only on `!ok`, and
  `survives an unresolvable Sentry service` still passes (it uses
  `toHaveBeenCalledWith`, and warn is now called twice on that path — once for
  the offline diagnostic, once for the Sentry failure).

---

## Commands run, with results

The `npx nx test projA projB` trap was avoided throughout — every multi-project
invocation uses `run-many -t … -p …`.

| #   | Command                                                                                                                                                                                | Result                                                                                                                                                                                                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `npx nx run-many -t test -p workspace-intelligence agent-sdk thoth-runtime auth-providers rpc-handlers persistence-sqlite --skip-nx-cache`                                             | **exit 1** — 5/6 green (agent-sdk 35 suites / 631 tests; workspace-intelligence 37 / 903; thoth-runtime 3 / 39). `rpc-handlers` reported failed — see #2                                                                                                                                              |
| 2   | `npx nx run @ptah-extension/rpc-handlers:test --skip-nx-cache`                                                                                                                         | **87 suites passed, 2440 passed / 31 skipped, 0 failed.** The #1 failure was the flaky `A worker process has failed to exit gracefully and has been force exited` teardown leak, not a test failure. Re-run **exit code 0**. Pre-existing and unrelated: this batch changed no file in `rpc-handlers` |
| 3   | `npx nx run-many -t lint typecheck -p <6 projects> --skip-nx-cache`                                                                                                                    | **0 errors**, warnings only. Two warnings were mine (`USER_AGENTS` and `os` unused in the new spec) and were fixed; the rest are pre-existing (`max-lines`, `no-non-null-assertion`, the `IFileWatcher` import noted above)                                                                           |
| 4   | C4 revert probe — delete the `reportedUnreadableSkills.get(...) === code` early return, then `npx nx run @ptah-extension/agent-sdk:test --skip-nx-cache -t "broken-root log volume"`   | **1 failed, 2 passed.** Restored → all 3 pass. The test latches                                                                                                                                                                                                                                       |
| 5   | C5 revert probe — delete the `reportedScanFailures.has(key)` early return, then `npx nx run @ptah-extension/workspace-intelligence:test --skip-nx-cache -t "directory-scan reporting"` | **1 failed, 4 passed.** Restored → all 5 pass. The test latches                                                                                                                                                                                                                                       |
| 6   | C7 revert probe — re-add `chain` to the success payload, then `npx nx run @ptah-extension/thoth-runtime:test --skip-nx-cache -t "emitVecLoadDiagnostic"`                               | **1 failed, 5 passed.** Restored → all 6 pass. The test latches                                                                                                                                                                                                                                       |
| 7   | `npx nx run-many -t test lint typecheck -p workspace-intelligence agent-sdk thoth-runtime auth-providers rpc-handlers persistence-sqlite --skip-nx-cache`                              | **`Successfully ran targets test, lint, typecheck for 6 projects`** — exit 0                                                                                                                                                                                                                          |
| 8   | `Get-ChildItem -Recurse -Force C:\Users\abdal\.ptah\plugins\ptah-skillssh-oso95-scroll-world`                                                                                          | 3 directories, **0 files** — the C4 evidence above                                                                                                                                                                                                                                                    |
| 9   | Per-root survey of `~/.ptah/plugins/ptah-skillssh-*`                                                                                                                                   | Exactly one root exists; `HasMetadata = False`; its single slug `scroll-world` has `SKILL.md = False`. No healthy comparator on this machine                                                                                                                                                          |
| 10  | `git show HEAD:libs/backend/workspace-intelligence/src/autocomplete/agent-discovery.service.ts \| Select-String IFileWatcher`                                                          | Present at HEAD → the unused-import warning is pre-existing                                                                                                                                                                                                                                           |
| 11  | `git status --porcelain`                                                                                                                                                               | Confirms the 9 files above are mine and that all 24 `harness-sync` modifications belong to the concurrent session                                                                                                                                                                                     |

`thoth-runtime` was added to the verification set: it is where C7's defect
actually lives, and it was not in the batch's stated project list because the
spec pointed at `persistence-sqlite`.

---

## Constraints observed

- Windows absolute paths for every Read/Write.
- `catch (error: unknown)` with `instanceof Error` narrowing at every new catch
  site (`agent-discovery.service.ts` `scanAgentDirectory`,
  `command-discovery.service.ts` `scanWorkspaceSkills`,
  `plugin-loader.service.ts` `reportUnreadableSkill`).
- No backend lib gained a `platform-{vscode,electron,cli}` import. The two new
  DI injections are `TOKENS.LOGGER` from `vscode-core`, which
  `workspace-intelligence` already depends on and whose registration is asserted
  at `di\register.ts:67`.
- No stubs, no `// TODO`, no placeholder returns.
- **No git commits created.**
- No file under `libs\backend\harness-sync\` opened.
- Out-of-scope list respected: `resolveRoot`, the global namespaces
  (`skillSynthesis:listCandidates`, `cron:list`, `gateway:*`), harness-sync's
  refusal rule, and the user's own broken install are all untouched.

## Notes for Batch 7

1. **C1 needs no replay assertion.** There is no behavioural change to verify.
   The Batch 7 log-replay check should expect the
   `[claude-code:unrecognized_model]` line to **still be present** — it is CLI
   stderr and suppressing it was rejected with reasons.
2. **The C4 root cause is open but out of scope.** The half-tree is a
   partial-delete residue, not a staging bug. If teardown atomicity in
   `SkillsShSourceRootService.uninstall` / `install` is wanted, raise it as its
   own task.
3. `rpc-handlers:test` intermittently exits non-zero on a worker force-exit with
   0 failed suites. Worth a re-run before treating it as a failure.
