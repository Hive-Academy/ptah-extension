# Backend implementation — `TASK_2026_719_4f64`, batch 5

**Tasks completed**: Task 5.1 — `claude-account-status` and `claude-auth-settings-scan` (real code and tests; no stubs or TODOs).

**Files** (all created, 4 of the 6-file cap):

- CREATED D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/claude-account-status.ts — `parseClaudeAccountStatus(text, exitCode, canonicalDir, platform)`. It returns `null` (unproved), `{ loggedIn:false }`, or `{ loggedIn:true, accountClass:'P'|'O', identityReference, configDirectoryMatches }`.
- CREATED D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/claude-account-status.spec.ts
- CREATED D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/claude-auth-settings-scan.ts — the exports are:
  - `CLAUDE_POLICY_COVERAGE` (frozen; one entry, `win32@2.1.310`, sources S1-S12)
  - `claudePolicyCoverage(platform)`
  - `scanClaudeAuthPolicy(request)`
  - `claudeRemoteSignalsAbsent(canonicalDir, platform, fs)`
  - `CLAUDE_REMOTE_SETTINGS_FILES`
  - the fs, registry, request and result types
- CREATED D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/claude-auth-settings-scan.spec.ts

Not modified: `auth-providers/src/index.ts`. The plan exports nothing new from B5; B6 imports these modules from inside the same lib.

**Stack observed**:
- Pure TypeScript modules. Wiring is not applicable: B5 adds no DI, no token and no registration (batches.md "DI guard: none").
- From `@ptah-extension/agent-sdk` (verified in `libs/backend/agent-sdk/src/index.ts:467-468`), B5 imports `claudeSettingsOverride`, `CLAUDE_PERSONAL_SUBSCRIPTIONS` and `claudeIdentityReference`.
- From `@ptah-extension/auth-providers-tokens` (`provider-account-admission.port.ts:95`), B5 imports `ClaudeCertifiedLaunchPolicy`. auth-providers already imports both libs (`claude-account-command.ts`, `provider-account-actions.service.ts`).
- Spec style follows `provider-account-route.spec.ts`.
- Catch sites follow `tools/degradation-audit/check-degradation.ts`: three `// degradation-audit: reported - …` markers. Each one sits on a catch that turns an error into a refusal, never into a silent pass.

**Verification**:
- `ptah_get_diagnostics` on the 4 changed files: Errors 0, Warnings 0, coverage `clean`.
- Specs were **not run**. Rule 12 says the team-leader runs `npm run verify -- -t lint,test,typecheck -p @ptah-extension/auth-providers` (N = 1).
- No real `claude` or `reg.exe` in any spec: the specs use a fake `fs` (records every call), a fake `queryRegistry` (`jest.fn`), and an injected platform and coverage.
- No `process.cwd()`. No `jest.spyOn` on module namespaces.

## Task 5.1 evidence (acceptance mapping)

**Parser (`claude-account-status.spec.ts`)**
- **Class P:**
  - `max` and `pro` with a non-null `orgId` give P.
  - `max` with `orgId:null`/`orgName:null` gives P.
  - `apiKeySource:'none'` gives P.
  - A status without the optional metadata gives P.
- **Class O:**
  - Subscription: `team`, `enterprise`, `null`, missing, `'Max'` and `'claude_max'`.
  - `max` plus a policy or key-source field: `forcedLoginMethod` (even `'claudeai'`, per rev4), `allowedProviders`, `apiKeySource:'apiKeyHelper'`, `apiKeySource:'ANTHROPIC_API_KEY'`.
  - `max` plus the unknown key `orgRole`.
  - Provider and auth method: `apiProvider` `bedrock`/`vertex`, `authMethod:'console'`.
  - Malformed values: `orgId`, `orgName` and `analyticsDisabled`, plus an empty email.
- **D14 note 2:** a class O result always carries `accountClass`, even with no email (`identityReference:null`) and even when the config directory differs. The certifier can therefore return `unsupported-source` before any identity comparison.
- **Unproved (`null`):**
  - non-JSON output, a JSON array, JSON `null`;
  - each required key missing; a mistyped required key;
  - exit code disagreeing with `loggedIn`, including a `null` exit;
  - signed-out with an `authMethod` other than `none`.
- **Signed-out (2.1.310 observed shape):** exit 1 gives `{ loggedIn:false }`; `apiKeySource` is ignored there.
- **Identity:**
  - pinned against `claudeIdentityReference(email, orgName)` from agent-sdk, as Batch 3's note asks (not against the quota resolver);
  - 64-hex check;
  - `orgName:null` maps to an empty organization;
  - `orgId` does not affect the result.
- **Directory:**
  - after normalizing `\`→`/`, removing trailing `/` and folding case on win32, the directories match;
  - off win32 the comparison is case-sensitive;
  - a mismatch is reported as `configDirectoryMatches:false` without changing the class.
- **Canary:** no email, org value, subscription word or path appears in serialized results, and the result keys are exactly the four closed fields.

**Scan (`claude-auth-settings-scan.spec.ts`)**
- **Coverage:**
  - the table holds only `win32@2.1.310`, versions `['2.1.310']`, and is frozen;
  - darwin and linux get `null`, and their scan refuses with zero fs or registry calls;
  - an entry/platform mismatch refuses with no I/O;
  - `knownVersion:'2.1.311'` refuses with no fs or registry call; `'2.1.310'` scans.
- **Registry:**
  - absent: mixed-case `hkey_local_machine\…` lines, a `ClaudeCodeHelper` sibling, `HKLM\`/`HKCU\` requests;
  - header and four-space value lines are ignored;
  - absent-parent: Policies exit 1, then `HKCU\SOFTWARE` lists no `Policies`;
  - present: `claudecode` under either hive refuses;
  - access-denied: exit 1 plus a parent listing that includes `Policies` refuses;
  - generic failure: exit 2 or a spawn error on the parent refuses;
  - spawn error on the first query: refuses with `terminated:false`;
  - timeout (`timedOut`, `terminated:false`): refuses as unproved, with no further query;
  - an exit-0 result whose close was not observed: refuses with `terminated:false`;
  - malformed: an unrecognized line, a line under another key, a nested path line or `overflow` refuses; a malformed parent listing also refuses;
  - the scan signal is passed to every query.
- **Files (S1/S2/S3/S5):**
  - benign files pass, with `managedFile:'scanned'`;
  - `apiKeyHelper` in any of the four files refuses;
  - `enabledPlugins` in `<cwd>/.claude/settings.json` refuses;
  - unparseable, non-object or >256 KiB content refuses;
  - `EACCES` refuses.
- **Drop-in (S6):**
  - a `.json` file with `apiKeyHelper` refuses;
  - only `.hidden.json` + `README.txt`: absent, and nothing is read;
  - a benign file is recorded as `scanned`;
  - readdir `EACCES`, a symlink entry, 33 entries, or a listed file that vanished: refuses.
- **Remote signals (S9):**
  - each of the 3 files present refuses (one fixture each);
  - `lstat` `EPERM` refuses;
  - all ENOENT gives `remoteSignals:'absent'`. The spec checks that the lstat calls happened; no case treats absence as proof.
- **Ancestor (S4):**
  - an ancestor with `.git` plus `.claude/settings.local.json` refuses;
  - `.git` only passes;
  - the home pattern (`.claude/settings.json`, no `.git`) passes;
  - `lstat .git` `EACCES` refuses;
  - 65 ancestors refuse; 64 pass.
- **Cancellation:** an already-aborted signal gives `cancelled` with no I/O.
- **Canary:** no fixture output, value line, `HKEY`, `ClaudeCode`, path or settings text appears in any serialized result.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| The parser takes a 4th required `platform` argument | (a) plan's 3 args with `process.platform`; (b) inject platform | Rule 2 "Platform is injected"; rev1 "case-insensitive on win32"; no consumer exists yet (B8 calls it) | yes |
| Parser returns `null` for unproved output and `configDirectoryMatches` instead of refusing a directory mismatch | refuse inside the parser vs. report the fact | D14 note 2: class must be returned before identity checks; `identity-mismatch` (certifier, B6) covers a class-P directory mismatch | yes |
| Class literals are `'P' \| 'O'` | `'personal'/'organization'` | plan Component 4a step 6b `accountClass === 'P'` | yes |
| A thrown `queryRegistry` (spawn error) yields `terminated:false` | true vs false | fail closed: an unobserved close means retain (Component 4 step 4) | yes |
| The scan returns `code:'cancelled'` on an aborted signal | report `unsupported-source` vs a distinct code | an abort is not a policy finding; B6 maps it | yes |
| The scan and parser take no logger | inject `Logger` vs pure functions | nothing in them needs to log; this removes the leak surface. The canary covers results and the never-throwing contract | yes |
| Added `claudeRemoteSignalsAbsent` export | inline only vs exported | Component 4a steps 2, 7 and `checkLaunch` re-read the S9 signals; the scan module owns the paths | yes |
| Drop-in: any symlink entry refuses (not only `.json` ones); a listed file that disappears refuses | narrower vs fail closed | plan S6 "an entry that is a symlink … refuse" | yes |

**Plan deviations**:
- The 4th `platform` parameter on the parser (above).
- The parser result adds `configDirectoryMatches` and allows a `null` return, beyond the plan's two-variant sketch.
- The fs contract is `{ readFile(path): Promise<string>, lstat(path), readdir(path): Promise<{ name, isFile(), isSymbolicLink() }[]> }`. B8's factory must adapt `node:fs/promises` (`readFile(p,'utf8')`, `readdir(p,{withFileTypes:true})`). B6 adds `stat` to its own certifier fs contract, per D14 note 1.

**Specs that mock or pin changed members (rule 5)**: none. B5 only creates modules, and no existing spec references these symbols. No ambient-path pin was touched.

**Risks handled**:
- **D14 note 2 (class-O precedence):** the parser yields `accountClass` for every signed-in result. The spec puts the `apiKeySource:'apiKeyHelper'` fixture and the non-`firstParty` provider fixtures (`bedrock`, `vertex`) next to the `team` and `enterprise` fixtures, all class O.
- **A-C2:** `pro`/`max` are class P with or without `orgId`.
- **DA-1:** S9 files are refusal signals only.
- **D-P:** darwin and linux refuse with no I/O.
- **Security:** results carry no raw value, path or CLI output. Registry value lines are discarded, never kept. Nothing is logged. `process.env` is not read or mutated.
- **Ambient drift:** no existing file was modified.

**Out-of-scope observations**: none.
