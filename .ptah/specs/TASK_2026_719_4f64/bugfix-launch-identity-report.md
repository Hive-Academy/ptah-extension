# Bugfix report: named lane refused at `launch` with `identity-unproved`

Verdict: I could not prove a root cause from the source alone. I made no guessed fix.
The launch stage now logs fixed sub-stage words, so the next live run will name the
failing check. One related lease defect is proved and reported below. Lease policy is unchanged.

## 1. What the evidence rules out (proved from source)

The refusal is logged in the outer catch of `ClaudeCliAdapter.runSdk`
(`claude-cli.adapter.ts`, the catch after `named.dispose()`). That catch covers:
`getCliJsPath`, `getQueryFunction`, `named.bootstrap`, `defaults`, `resolveEffort`,
`policy`, `syncHarness`, `assembleSpawnOptions`, `buildClaudeSdkLaneOptions`, `named.launch`
and `named.enqueue`.

**The retained lease narrows the window.** `dispose()` (`claude-sdk-lane-runner.ts`,
`dispose`) chooses *release* only when `!boundaryUnproved && (!child || child.exited)`.
`bootstrap()` clears `this.child` after a proved close and sets `boundaryUnproved=false`
after a passing check. So any failure in the host steps between bootstrap and the final
launch would have **released** the lease, not retained it. That covers policy, harness sync,
assembly, the options build, and the synchronous `assertCertifiedLaunch` in the final
`checkBoundary`, which fails before `boundaryUnproved=true` is set. The DB shows `retained`,
so the failure happened while one of these was true:
- a boundary check was pending, or
- an SDK child (bootstrap or final) was alive.

**10.7 s means an explicit throw, not a deadline.** Each `wait()` has a 15 s deadline
(`deadlineMs = 15_000`), and the admission timer is 15 s too (that one logs stage `timeout`).
A single hung wait cannot fire before 15 s. So the refusal is most likely an explicit check
that rejected a child's answer, or a foreign rejection.

**A crashed child is unlikely.** A child that exits with a number sets `exited=true`, and
dispose would then release. An `accountInfo()` rejection or `next.done` caused by a child
crash would therefore release, unless the exit was signal-only (see section 4).

## 2. Ranked candidates (each ends as `identity-unproved`, no binding written, child alive)

1. **Final child `readIdentity` fails (`launch()` → `readIdentity`, `claude-sdk-lane-runner.ts`
   `readIdentity`/`personalClaudeLogin`).** The final child runs with the workspace cwd and the
   certified `settingSources`, so property-hub's user/project settings and the env keys newly
   accepted by 5f9ecd82b are active. The bootstrap child had cwd=tmpdir and
   `settingSources: []`, so bootstrap can pass while the final child reports a different
   `tokenSource`/`apiKeySource`/`apiProvider`/`subscriptionType` or account. That would show as
   `personal-login` or `identity-compare`. The time fits: bootstrap spawn + accountInfo + close,
   then the final spawn + accountInfo.
2. **Final child init tripwire (`launch()` init loop).** `claude_code_version !== certified
   version` or `apiKeySource` ∉ {`none`,`oauth`} (`INIT_PERSONAL_KEY_SOURCES`). This depends on
   the same settings/env difference as #1 (for example, a settings env that changes the
   key source). It would show as `init-version` or `init-key-source`.
3. **Foreign rejection while a child is alive.** `assertRouteCurrent` (store read error →
   `routeFailure`), `commitRunBinding` (`ProviderAccountStoreError` with *its own* code such as
   `conflict`/`busy` — `claudeLaneRefusalCode` recognises only lane/certified refusals, so the
   real store code is replaced by `identity-unproved`), or an SDK control-request error
   from `accountInfo()`. "0 run bindings" is consistent with `commitRunBinding` throwing. This
   would now show as `commit-binding` + `foreign: <ClassName>`. The main-chat path
   (`namedRefusalCode`, session-query-executor.service.ts ~595) has the same mapping.
4. **Bootstrap child identity (`bootstrap()` → `readIdentity`).** This is less likely,
   because the main chat runs an identical bootstrap (same options builder shape, cwd=tmpdir,
   `settingSources: []`, same `namedIdentity` checks) and it works. It is still possible if the
   profile differs from the one used in earlier main-chat tests.

### Lane vs main-chat differences (static)

- The bootstrap options and identity checks are equivalent. `buildClaudeLaneBootstrapOptions`
  matches `buildNamedAccountBootstrapOptions`, except that the lane sets
  `spawnClaudeCodeProcess` itself; the main path gets the same off-thread spawner via
  `useOffThreadSpawner`. `personalClaudeLogin` is equivalent to `namedIdentity`. Both wait for
  `system/init` before the first prompt, with the gate closed.
- The final options differ. The lane (`buildClaudeSdkLaneOptions`) adds
  `extraArgs: {'replay-user-messages', name}`, `includePartialMessages: true`,
  `persistSession: true`, the flag `settings` built by `buildFlagSettingsArg(..., 'accept', ...)`,
  `...assembly.capabilityIsolation`, `hooks`, and the lane MCP servers. Named child stderr is
  logged only at debug level as a fixed line, so a CLI complaint is invisible. Any of these
  that changes what the final child reports (auth source or init) points to candidates #1/#2.
- I could not statically verify the property-hub settings content (forbidden to open).

## 3. Diagnostics added

`[ClaudeCliAdapter] Named lane refused` at stage `launch` now carries only fixed words:

- `hostStep`: `executable | bootstrap | assembly | launch | enqueue | runner`.
- `phase`: `admission | bootstrap | final | turn`.
- `step`: `boundary | open | route-current | account-info | personal-login | identity-absent |
  identity-compare | stored-identity | close | init-wait | init-version | init-key-source |
  resume | commit-binding | binding-check | attach | save-metadata | persist-reference |
  on-binding | gate`.
- `interrupt`, only when a wait was cut short: `deadline | abort | epoch`.
- `personalLogin`, only for step `personal-login`: booleans `tokenSource`, `apiKeySource`,
  `apiProvider`, and `subscription` ∈ `personal | organization (team/enterprise) | absent | other`.
- `foreign`, only for a non-refusal error: the `error.name` if it is identifier-shaped
  (`/^[A-Za-z][A-Za-z0-9_]{0,63}$/`), otherwise `other`; `non-error` for a thrown non-Error.
  The message is never read.

The diagnostic is read *before* `dispose()`, so the teardown abort does not overwrite the
step. No email, organization, token, path or CLI text is logged.

## 4. Lease note (report only, policy unchanged)

- **Proved defect (lease, not identity):** `dispose()` decides release vs retain in a
  microtask right after calling `this.child?.close()`, without awaiting `child.terminated`.
  Any refusal with a live child therefore always **retains**, even when the child exits
  cleanly a moment later. The main-chat `dispose` (session-query-executor.service.ts ~885-900)
  races `this.termination` against a timeout before deciding. This explains the
  `retained` lease. Fixing it changes lease policy, so I left it for the orchestrator.
- `exited` is set only for a numeric exit code (`open()` and `invokeNamedQuery`). A child that
  ends only with a signal (for example a Windows kill reported as signal-only) is never
  proved closed.
- **Effect on the next run:** a retained (unresolved) lease on the profile is held. The next
  named run on that profile is expected to be refused `busy`/`release-held` at admission until
  the store reclaims the lease. Reclaim happens through the store's unresolved-lease handling
  (expiry/sweep of `retainUnresolvedReservation` entries in `provider-account.store.ts`). I did
  not re-read the exact expiry constant within the tool budget, so the orchestrator should
  confirm its value.

## 5. Tests

`claude-sdk-lane-runner.spec.ts` (named lane identity proof):
- Each of the six personal-login trip cases asserts
  `launchDiagnostic = {phase:'bootstrap', step:'personal-login', personalLogin:{…failed check…}}`
  and that the serialised diagnostic contains no account values.
- Identity mismatch → `step:'identity-compare'`. No email → `step:'identity-absent'`.
- `accountInfo` rejecting with a custom error class → `step:'account-info'`,
  `claudeLaneForeignErrorClass` → the class name, code still `identity-unproved`.
- A hung `accountInfo` with a 5 ms deadline → `interrupt:'deadline'`.
- `claudeLaneForeignErrorClass`: `undefined` for a refusal, `non-error`, `other` for a
  non-identifier name, `TypeError`.

`claude-cli.adapter.spec.ts`: the bootstrap boundary refusal log now expects
`{stage:'launch', code, hostStep:'bootstrap', phase:'bootstrap', step:'boundary'}`.

## 6. Verification

- `node D:/projects/ptah-extension/scripts/verify.mjs -t lint,test,typecheck -p @ptah-extension/cli-agent-runtime`
  → `NX 3 tasks: 3 succeeded` (cache 0/3 hit), lock released with exit code 0.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` → printed
  `degradation-audit: TOTAL 277 unsuppressed site(s)` with no failure line. The exit code I
  captured was the pipe's `tail`, not the audit's, so the orchestrator should re-run it
  unpiped to confirm exit 0. No new catch blocks were added.
- No other projects were changed. The auth-providers and agent-sdk sources were read only.

## Files changed (4)

- MODIFIED `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts`: sub-stage
  tracking, `launchDiagnostic`, `ClaudePersonalLoginCheck`, `claudeLaneForeignErrorClass`.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts`:
  `hostStep` and the detailed launch refusal log.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.spec.ts`.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.spec.ts`.

## Decisions

- **No root-cause fix.** Options: guess a fix to the final options (for example dropping
  `settings`/`extraArgs`), or ship diagnostics only. The evidence does not single out one
  check, and the brief forbids guessing. Reversible: yes.
- **The lease defect is reported, not fixed.** The dispose decision not awaiting
  termination is lease policy, which the brief reserves. Reversible: yes.
- **The foreign error class is logged with an identifier-shape filter.** This keeps an
  attacker- or SDK-controlled `name` from carrying text into logs. Reversible: yes.
- **Store error codes were not unwrapped in `claudeLaneRefusalCode`.** Doing so would change
  the user-facing refusal code mapping (a behaviour change shared with main chat). The new
  `foreign` field makes the case visible instead. Reversible: yes.
