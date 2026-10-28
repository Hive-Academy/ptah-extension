# Backend implementation: `TASK_2026_719_4f64`, batch 6

**Tasks completed**: Task 6.1, `ClaudeLoginConsole` and `ClaudeRouteCertifier`. Both are unregistered, with no token and no registration. B8 registers them.

**Files** (4 created, within the 6-file cap; nothing else touched):

- CREATED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/claude-route-certifier.ts`. It contains the `ClaudeCliProbe` interface, `ClaudeAuthContext`, `ClaudeRouteCertifierFs` (with `stat`) and `ClaudeRouteCertifier`. The class has `authContext`, `checkCoverage`, `certify` (steps 1-8 with 6b) and `checkLaunch`.
- CREATED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/claude-route-certifier.spec.ts`. Covers regression rows 904, 905, 908, 909 and 918 (the B6 part).
- CREATED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/claude-login-console.ts`. Contains `ClaudeLoginConsole` (`launch`, `fallbackScript`) and the quoting helpers `quotePowerShell` and `quotePosix`.
- CREATED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/claude-login-console.spec.ts`. Covers regression row 903.
- CREATED this report.

`auth-providers/src/index.ts` is not modified. The plan exports nothing from B6, and B8 imports these files from inside the same lib.

**Stack observed**:
- These are plain classes, like B5's pure modules and `ClaudeAccountCommand(detector, spawner)` in `claude-account-command.ts`. There is no tsyringe here, because B8 registers them with a factory.
- Imports go through barrels only:
  - `@ptah-extension/agent-sdk`: `buildCertifiedClaudeEnv`, `certifiedEnvDigest`, `CLAUDE_CERTIFIED_ENV_KEYS`, `claudeIdentityReference` (barrel lines 455-468).
  - `@ptah-extension/auth-providers-tokens`: the B1 launch types.
  - `@ptah-extension/platform-core`: `IProcessSpawner`, `SpawnedProcessHandle`.
  - `@ptah-extension/shared`: `ProviderAccountResultCode`.
- In-lib imports are B5's `claude-account-status.ts` and `claude-auth-settings-scan.ts`, plus `provider-account-route.ts` (`revalidateProviderAccountRoute`).

## Task 6.1 evidence

### Certifier (`claude-route-certifier.spec.ts`)

The spec uses a fake probe and a map-backed fake `fs` that implements `readFile`, `lstat`, `readdir` **and `stat`** (D14 note 1). The platform is injected. Route directories are real `mkdtemp` directories under `os.tmpdir()`, so step 8 (`revalidateProviderAccountRoute`, a real fs check) is exercised. They are removed in `afterAll`.

| Acceptance item | Test |
| --- | --- |
| Order: coverage, scan, executable, env, status, class, S9 re-check, revalidate | "runs coverage, scan, executable, env, status, signal re-check, then revalidates". An event log shows fs, registry and S9 events before `executable`, then `executable` before `status`, and exactly the three S9 `lstat`s after `status`. "revalidates the route after the status child" deletes the directory inside the status fake and gets `route-changed` |
| darwin/linux: `certifyExecutable`, `status`, `logout` and `queryRegistry` are never called, and there is no fs call | `it.each(['darwin','linux'])` asserts that the event log is empty |
| win32 `2.1.311`: the scan ran and `status` was never called | "refuses an uncovered win32 version after the scan…" |
| Below 2.1.301 gives `unsupported-store` | "refuses a build below 2.1.301" |
| Unresolved managed source with a status that would succeed. `status` is never invoked | Four cases: drop-in `apiKeyHelper`, `HKLM ClaudeCode` present, each S9 file present (`it.each` over 3), ancestor `.git` with `.claude/settings.local.json` |
| Class O gives `unsupported-source` before the identity comparison (D14 note 2) | `it.each` over `team`, `enterprise`, missing `subscriptionType`, `allowedProviders`, `apiKeySource:'apiKeyHelper'`, `apiProvider:'bedrock'`. Each fixture also has a **different email and config directory**, so class O provably wins over `identity-mismatch`. Each returns `terminated:true` and no launch. The fake probe uses the real B5 parser |
| Class P with S9 absent gives `launch.accountClass === 'personal'` | "class P with every S9 signal absent…" and the order test |
| `identity-mismatch` only for class P | Separate class-P cases for a different identity and for a different config directory |
| S9 flips after the status child: refused | "refuses when a remote signal appears after the status child closes" |
| `checkLaunch` | Unchanged sources give `ok` with no `status`, `certifyExecutable` or `logout` call and a `stat` call. An added drop-in `apiKeyHelper` refuses. An added remote signal refuses. A changed mtime gives `identity-unproved` with `certifyExecutable` still called only once. A changed size or a stat `EACCES` gives `identity-unproved`. A known version `2.1.311` gives an empty event log (no fs or registry call). A `reg.exe` timeout gives `terminated:false`. A foreign coverage id refuses |
| Three profiles | Three distinct dirs; A and B have distinct `CLAUDE_CONFIG_DIR` and `envDigest`. Class O C refuses. The JSON snapshots of A and B are unchanged, and both still pass `checkLaunch` |
| `terminated` propagation | `reg.exe` timeout during certify gives `terminated:false` with no Claude child. An unobserved status close gives `terminated:false`. An executable probe refusal passes its code and flag through. An aborted signal gives `cancelled` with no child |
| `authContext` / `checkCoverage` | `cwd === canonicalDir` and no status or logout child. `checkCoverage` is `ok` at first and refuses once an S9 file appears, without re-probing the executable. linux refuses with no call |

### Console (`claude-login-console.spec.ts`)

| Acceptance item | Test |
| --- | --- |
| The first statement changes directory and aborts on failure | PowerShell: the script starts with `& { $ErrorActionPreference = 'Stop'; Set-Location -LiteralPath '<cwd>'`. posix: it starts with `( cd -- '<cwd>' && exec env -i`. A reference parser recovers the cwd in both |
| A different workspace with `apiKeyHelper` is never named, and the scanned cwd equals the script cwd | The real certifier `authContext` runs over a fake fs that holds the workspace `settings.json`. The workspace file is never read and is never in the script, and the script cwd's `.claude/settings.json` is among the reads |
| Inherited `ANTHROPIC_API_KEY`, `CLAUDE_CODE_USE_BEDROCK`, `AWS_PROFILE` and `NO_PROXY=corp`: no value, names by reference only, no selector | For both dialects: no value (`sk-ant-…`, `corp`, `C:\Windows`) and no selector name. posix: every allowlist name and its lower-case variant appears only as `${N+"N=$N"}`, plus the `no_proxy`/`NO_PROXY` rule; `PROGRAMFILES(X86)` (not a shell name) is skipped. PowerShell: `$allow = @(<exactly CLAUDE_CERTIFIED_ENV_KEYS>)` |
| Paths with spaces, `'`, `$`, backtick, `;` and typographic quotes round-trip | `it.each` over both dialects. The reference parsers recover cwd, `CLAUDE_CONFIG_DIR`, the command and each prefix argument |
| `userConsole` is never set on non-win32, and the result is `unavailable` | `it.each(['darwin','linux'])`: zero spawn requests |
| win32 launch | The request equals `{ command: <SystemRoot>\System32\conhost.exe, args: [command, ...prefixArgs, 'auth','login','--claudeai'], env: context.env, cwd: context.cwd, userConsole: true }`. `whenSpawned → null`, a thrown spawn, a missing `SYSTEMROOT` or an aborted signal each give `unavailable`. The fake spawner never starts a process |

## Verification

- `ptah_get_diagnostics` with `files` set to the 4 changed files: **Errors 0, Warnings 0, coverage clean**. One round of jest generic typing errors was fixed: the lib resolves the two-argument `jest.fn<R, Args>` form.
- Spec run: I ran the two new specs once under the verify lock (one heavy command, not a wide suite):
  `node scripts/verify.mjs --exec --task b6-two-specs -- npx jest -c libs/backend/auth-providers/jest.config.ts --maxWorkers=2 <the two spec paths>`.
  - The first run failed before any test ran: "tsyringe requires a reflect polyfill". The `@ptah-extension/agent-sdk` barrel loads tsyringe.
  - I added `import 'reflect-metadata';` as the first line of both specs, as `provider-account.store.spec.ts` and the other sibling specs do.
  - Rerun result: **Test Suites: 2 passed, 2 total; Tests: 54 passed, 54 total**, lock exit code 0.
- `npm run verify` was not run (rule 12). The team-leader's command is `npm run verify -- -t lint,test,typecheck -p @ptah-extension/auth-providers` (N = 1). Lint has not been run.

## Specs that mock or pin changed members (rule 5)

- No existing member changed. All four files are new. A grep for `ClaudeRouteCertifier|ClaudeLoginConsole|ClaudeCliProbe` under `libs/` matches only the four new files.
- B5's `claude-account-status.ts` and `claude-auth-settings-scan.ts` are imported, not edited, so their specs are unaffected.
- The ambient-path pins (plan 943-953) are untouched.

## Risks and how they were handled

- **D14 note 1 (fs `stat`).** `ClaudeRouteCertifierFs extends ClaudePolicyScanFs` adds `stat(path): Promise<{ size, mtimeMs }>`. Every fake in both specs implements it. `checkLaunch` compares the fingerprint through `fs.stat`, and a stat error gives `identity-unproved`. B8 must pass `stat` from `node:fs/promises` in the factory.
- **D14 note 2 (class O precedence).** `certify` checks `accountClass !== 'P'` and returns `unsupported-source` before the stored-identity and directory checks. The spec pins this with mismatching identity and directory fixtures.
- **Unproved child close.** Each refusal carries `terminated`:
  - The scan's `reg.exe` flag is passed through.
  - The executable probe's flag is kept, and `terminated:false` on an `ok` probe also refuses.
  - An unobserved status close refuses with `terminated:false`.
- **Non-win32 console.** It returns `unavailable` before any spawn. B4's spawner `ENOTSUP` path is a second layer: `whenSpawned` null also maps to `unavailable`.
- **Security (rule 11).** Results carry codes only, and there is no logger. `process.env` is only read, by `buildCertifiedClaudeEnv` in step 4 as the plan states. The fallback script names only the context cwd, the canonical dir, the executable and the prefix args. No real `claude`, `conhost` or `reg.exe` runs in either spec.
- **Ambient drift (HIGH).** New files only.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| The probe's `status` returns `{ status: ClaudeAccountStatus \| null, terminated }`, so the probe (B8) calls the B5 parser | The certifier parses raw text instead | Plan Component 3: "returns facts plus `terminated`". The parser needs `canonicalDir`/platform, which the context carries | yes |
| `ClaudeAuthContext` is declared in the certifier file (`canonicalDir`, `cwd`, `executable`, `env`, `envDigest`, `policy`) | Reuse `ClaudeCertifiedLaunchContext` | The B1 launch type requires `accountClass:'personal'` and `identityReference`, which are unknown before status | yes |
| The run certification's status child uses the run `cwd`; auth operations use `canonicalDir` | Always `canonicalDir` | The status child must read the same sources step 2 scanned for that cwd | yes |
| `fallbackScript(context)` uses the injected constructor platform | Plan's `(launch, platform)` | The constructor already takes `platform` (rule 2), and a second platform argument could disagree with it | yes; **B8 must call it with one argument** |
| `launch` awaits `whenSpawned`: `null` or a thrown spawn gives `unavailable` | Return `started` at once | Gives the fallback a path when no window opened | yes |
| A stored `identityRef` of `null` gives `identity-unproved`; signed-out or unparseable status gives `identity-unproved` | `identity-mismatch` | Nothing is proved, rather than proved different | yes |
| A `checkLaunch` scan `cancelled` maps to `identity-unproved` | A new code | `ClaudeLaunchBoundaryOutcome` (B1) has no `cancelled` | yes |
| `certify` also accepts `cancelled` and `timeout` codes (from the scan and the probe) | Collapse them into `identity-unproved` | Matches `ProviderAccountResultCode`; B8 maps them | yes |
| PowerShell quoting also doubles U+2018-U+201B | `'` only | PowerShell treats them as single quotes | yes |

**Plan deviations**: the `fallbackScript` arity (see Decisions). The plan's constructor `fs: { readFile, lstat, readdir }` gained `stat`, per D14 note 1.

**Out-of-scope observations**: B5's `claude-account-status.spec.ts` imports `@ptah-extension/agent-sdk` without `import 'reflect-metadata';`. It will probably fail the same way ("tsyringe requires a reflect polyfill") under B5/B6's `@ptah-extension/auth-providers` test target. I did not edit it because it is not a B6 file; the team-leader should check it in the scoped verify. `claude-auth-settings-scan.spec.ts` also imports a module that loads the agent-sdk barrel through `claude-auth-settings-scan.ts`, so it may have the same problem.
