# Code Style Review, Phase 2 — `TASK_2026_617` (Batches 5-9)

## Summary

| Metric          | Value                                        |
| --------------- | -------------------------------------------- |
| Overall score   | 7.5/10                                       |
| Verdict         | REVISE (one Major, small and well scoped)    |
| Blocking issues | 0                                            |
| Major issues    | 1                                            |
| Minor issues    | 7                                            |
| Files reviewed  | all in-scope source files, plus 6 spec files |

Scope read: `git diff 5caeff54d..b720f2f18` and `git diff 72b5677d0..HEAD` (excluding `.ptah`). The whole of
`grok-cli.adapter.ts`, `grok/grok-acp-profile.ts`, the siblings `pi-cli.adapter.ts`, `opencode-cli.adapter.ts`
and `codex-cli.adapter.ts`, and `acp/index.ts` were read. The formatting-only part of the three matrix files was
separated from the real change by running the repo's prettier (3.9.8) over the pre-batch versions and diffing.
No tests, builds or git state-changing commands were run, so the review rests on reading the code and on the
accepted pass results in `batches.md`.

Overall, this is a clean, mostly mechanical registration. Grok is wired like its siblings in every place that the
type system enforces, the ACP boundary rules are respected, and the specs are in the house style. The one real
design cost is a third hand-copied `probeModels`.

## Five style questions

### 1. What breaks in six months?

- The next model-probe fix lands in one of three copies. `grok-cli.adapter.ts:142-174` is a near-verbatim copy of
  `pi-cli.adapter.ts:235-264` (and the core of `opencode-cli.adapter.ts:382-430`). It has already diverged: Grok
  guards the synchronous `spawnCli` throw (over-long command line) with try/catch, while Pi's version throws
  inside the Promise executor and rejects. See finding 1.
- The next CLI is the eighth. Prose in `apps/ptah-cli/src/cli/commands/agent-cli.ts:34,39,80,81,225,439` says
  "six system CLIs ... a seventh adapter", which is now false; the derivation code is fine, the comments are not.
- `task-agent-discovery.service.ts:10` types its display-name table `Readonly<Record<string, string>>`, so a new
  CLI is not forced to appear there; Grok was added only because someone remembered (finding 6).

### 2. What would a new team member misread?

- `grok-acp-profile.ts:131-134` maps effort a second time with `mapEffortToGrok`, although the manager already
  passes the resolved value (`agent-process-manager.service.ts:693` `reasoningEffort: laneEffort.effort`). A reader
  will assume `options.reasoningEffort` is raw and may "fix" the resolver, or the reverse.
- `ensureTokensFresh` (`grok-cli.adapter.ts:191-203`) returns true for any parsed JSON object, including `{}` and
  `[]` (`typeof [] === 'object'`). Pi requires at least one provider entry. The doc comment ("exists and parses")
  is accurate, but the sibling convention suggests a stronger check than is implemented.
- The `PENDING_USER_REVIEW_IDS` comment references "Batch 36" / "Gate V 36" from an earlier task; Grok's copy is
  added under that banner (`cli-permission-notes.ts:20`, comment at `:66`). Acceptable, but it reads as part of
  the old task.

### 3. What does this cost to maintain that a simpler shape would not?

- The third probe copy (finding 1), about 30 lines.
- One extra cross-layer import and an export that exists only to serve it (finding 3).
- 1,300+ lines of diff in `cli-orchestration-matrix.component.ts` for a 5-line functional change (finding 4);
  every future `git blame` on that file lands on this task.

### 4. Where is this inconsistent with the rest of the repository?

- Registration is consistent: barrel export `cli-adapters/index.ts:28`, `adapters.set('grok', ...)`
  `cli-detection.service.ts:75`, `refreshCliTokens` list `:244`, `MODEL_CONFIG_KEYS`
  `agent-spawn-environment.service.ts:65`, `effortMapperFor` `lane-spawn-policy.ts:175`, and the
  `SYSTEM_CLI_TYPES` consumers (`chat-view.component.ts:98`, `tribunal-discovery.service.ts:67`,
  `tribunal-run.service.ts:436`, `cli-model-list.service.ts:76,85`, `agent-cli.ts:473`).
- The constructor `(spawner?, logger?)` differs from Pi and opencode (`spawner?`) but follows codex's logger
  precedent (`codex-cli.adapter.ts:329`), and `cli-detection.service.ts:75` passes both. Accepted deviation 3.
- Not drift, but worth recording: `agent-models.store.ts:45` and `:58` list only codex, copilot, cursor and
  opencode. antigravity and pi are also absent, so that store is a partial list by design and Grok's omission is
  consistent. No change required (see loose ends).

### 5. What would you have done differently?

Extract one `probeCliStdout(binary, args, { spawner, timeoutMs, logger? })` into `cli-adapter.utils.ts` (it already
owns `spawnCli`, `probeCliVersion`, `resolveCliPath`) and have Pi, opencode's single-shot path and Grok call it.
Grok's adapter then shrinks by about 35 lines and the sync-throw guard reaches all three. Everything else I would
keep as written.

## Blocking issues

None. No new `as any`, `@ts-ignore` or `@ts-expect-error` in source or specs (grep over the grok files and the
diff). The `as unknown as` casts at `grok-cli.adapter.spec.ts:359,361` are mock-construction casts, which is the
spec convention. No env or argv reaches a log (`grok-cli.adapter.ts:151` logs `command` and `error.message`
only; `acp-session-handle.ts` logs `errorText`). The ESM-only SDK is imported only as `import type { McpServer }`
(`grok-acp-profile.ts:25`); runtime access stays in `acp/acp-sdk-loader.ts`.

## Major issues

### 1. Third hand-copied `probeModels`, already diverged (grok-cli.adapter.ts:142-174)

- File: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/grok-cli.adapter.ts:142-174`, against
  `pi-cli.adapter.ts:235-264` and `opencode-cli.adapter.ts:382-430`.
- Problem: the spawn, setEncoding, collect-stdout, 8 s kill timer, close/error resolve shape is now present three
  times. The repo's own rule is "similar code stays separate until a third real use proves the shared shape";
  this is that third use. Grok's copy adds a guard (`try { spawnCli } catch` for `CliCommandLineTooLongError`)
  that Pi's lacks, so the copies behave differently on the same failure.
- Fix: add `probeCliStdout` to `cli-adapter.utils.ts` (Never-throws contract; returns `string | undefined`;
  includes the sync-throw guard and an optional `onStartError` callback or `logger`). Replace `probeModels` in
  Pi and Grok (opencode's multi-status variant can stay, or reuse it). Keep each adapter's specs; they already
  mock `spawnCli` through the utils module (`grok-cli.adapter.spec.ts:24-33`), so the mock seam is unchanged. If
  the refactor of Pi is judged out of scope for this branch, at minimum record it in
  `future-enhancements.md` and say so in the PR body.

## Minor issues

2. Stale "six" / "seventh" prose in `apps/ptah-cli/src/cli/commands/agent-cli.ts:34,39,80-81,225,439`. Fix:
   reword to "every system CLI" / "the next adapter", or count-free phrasing, matching the neutral wording already
   used in the models-list comment at `:462-465`.
3. `grok-acp-profile.ts:30,131-134` imports `mapEffortToGrok` from `../../lane-spawn-policy`, the only adapter that
   imports the policy module; `lane-spawn-policy.ts:225` had to be exported for it. The manager has already mapped
   the effort (`agent-process-manager.service.ts:693`), and Pi forwards `options.reasoningEffort` raw
   (`pi-cli.adapter.ts:375-377`). Fix: push `options.reasoningEffort` as-is (the runner already applies it only
   when Grok advertises the option), make `mapEffortToGrok` private again, and keep the `lane-spawn-policy.spec`
   coverage through `resolveLaneEffort`. If defence in depth is wanted, follow Codex's allowlist check instead
   (`codex-cli.adapter.ts:486-491`), which does not couple the adapter to the policy module.
4. Formatting churn in functional commits. `cli-orchestration-matrix.component.ts` (about 1,360 changed lines),
   `cli-matrix-rows.ts`, `cli-permission-notes.ts(+spec)`, `connection-usage.spec.ts`, `agent-cli.ts` (union
   reflow at `:100-101,679-682`), `task-agent-discovery.service.ts:50-70` and `settings.fixtures.ts:249-252`
   were reflowed by the commit hook. After normalising with prettier 3.9.8, the real change in the matrix
   component is 10 lines. The formatter owns the style, so this is not a style fault; the cost is reviewability
   and blame. Fix for future batches: land a "format only" commit first. History is already committed, so for
   this branch just note it in the PR description so reviewers use `git diff -w` or the normalised view.
5. `grok-cli.adapter.ts:191-203` `ensureTokensFresh` accepts `{}` and arrays as valid credentials. Fix: require
   a non-array object with at least one key, as Pi does (`pi-cli.adapter.ts:276-283`), or document why an empty
   file counts as signed in. Detection-only, so low impact (runtime semantics belong to code-logic-reviewer).
6. `task-agent-discovery.service.ts:10` `CLI_DISPLAY_NAMES: Readonly<Record<string, string>>` is not exhaustive,
   unlike `CLI_LABELS: Record<CliType, string>` in `chat-view.component.ts:90`. Fix: type it
   `Readonly<Record<CliType, string>>` so the next adapter fails typecheck. Pre-existing, but this batch edited
   the table.
7. `router.ts:735,773` hand-list the CLI ids in help text (now with `grok`). `agent-cli.ts` derives from
   `SYSTEM_CLI_TYPES`; deriving the help string from `CLI_AGENT_SELECTORS` would remove a third place to update.
   Preference only, and the existing code already uses literal strings.
8. `agent-process-manager.service.spec.ts:2624` `it.each(['antigravity','opencode','pi'])` omits grok. This is
   the known loose end. The test goes through `setupVscodeConfig({ preferredAgentOrder })`, so it depends on the
   mocked detection reporting the CLI as installed. Fix: derive the list from `SYSTEM_CLI_TYPES` minus the three
   CLIs already handled (codex, copilot, cursor) so the next adapter is covered automatically, and add `grok` to
   the mock's installed set if it is not already included. If the mock cannot report it cheaply, leave a one-line
   comment saying Grok's preferred-order path is covered by `cli-detection.service.spec.ts`.

## Loose ends

- `agent-process-manager.service.spec.ts:2624`: see finding 8. Minor, safe to fix now.
- `libs/frontend/skill-synthesis-ui/src/lib/components/clones/agent-models.store.ts:45,58`: not a gap.
  `AgentModelProvider` there is a deliberate subset (codex, copilot, cursor, opencode; antigravity and pi are also
  absent), and the Agents tab has no Grok editor. Leave as is; record nothing.
- `libs/frontend/ui/src/lib/native/provider-mark/provider-marks.data.ts`: Grok has no entry, so it uses the
  documented fallback glyph (`provider-marks.data.ts:102` comment says the table names the fallback). Acceptable;
  a Grok mark is optional polish for the QA screenshots.
- `libs/frontend/webview-e2e-harness/.../settings-live-shape.fixtures.ts`: sets `antigravityModel` only for live
  data and does not need `grokModel`. `settings.fixtures.ts:177` has it. No action.

## File-by-file

### cli-adapters/grok-cli.adapter.ts

Score 7.5/10 — 0 B, 1 Ma, 1 Mi. Barrel import of `./acp`, `import type` for all types, `readonly` constants, the
parser is exported, pure and tested. The `private static getAuthPath` mirrors Pi and Codex. Findings 1 and 5.

### cli-adapters/grok/grok-acp-profile.ts

Score 8.5/10 — 0 B, 0 Ma, 1 Mi. Pure data plus a small `describeGrokError`; error codes are named constants;
argv is a frozen constant (`--no-leader` present, `--always-approve` absent, matches the header comment);
`import type` for the SDK. The only issue is the policy import (finding 3). The `Record<string, unknown>` cast in
`extractExitCode` is a safe narrowing after the object check.

### cli-adapters/acp/{acp-permission-policy,acp-session-update-mapper,acp-session-handle}.ts

Score 8/10. Bracket access (`option['kind']`) is a mechanical response to `noPropertyAccessFromIndexSignature` in
the consumers that now typecheck these files (accepted deviation 1). It is consistent across all 24 sites. The
`onUnexpectedTurnError` function-to-const change (`acp-session-handle.ts:698-705`) puts the declaration before
its use and is consistent with the rest of the file. No findings.

### cli-detection.service.ts / lane-spawn-policy.ts / agent-spawn-environment.service.ts / cli-adapters/index.ts

Score 8.5/10. Registration is identical to the siblings. `lane-spawn-policy.ts:219-239` is well documented, but
the export is only needed for finding 3.

### Shared types, settings keys, RPC handlers, core providers state (Batches 5-7)

Score 9/10. One-line additions in every place `antigravityModel` appears (grep: the same 12 files carry
`grokModel`), `?:` optional on the wire type like its siblings, `SCOPED_SETTING_KEYS` entry
`appScopable: false, supportedTargets: ['global']` matching neighbours, a defaulted file key, and specs in the
existing describe style (`agent-rpc.handlers.set-config.spec.ts:183-205`, `providers-commit.service.spec.ts:743`).
No findings.

### Frontend (matrix rows, permission notes, matrix component, labels, tribunal, tasks-ui)

Score 8/10. Functional change is small and uses the existing tables (`FIXED_NOTES`, `CLI_ROWS`, install-hint map).
`FIXED_NOTES` is `Record<Exclude<CliType,'copilot'>, ...>`, so exhaustiveness is enforced. No Angular
structure changed: no new component, no change to standalone/OnPush/signals usage. Findings 4 and 6.

### ptah-cli (agent-cli.ts, router.ts)

Score 7.5/10. Behaviour is correct and derived from `SYSTEM_CLI_TYPES`; stale prose and help strings (findings 2
and 7); incidental union reflow (finding 4).

### Specs (grok adapter, profile, policy, detection, set-config, commit)

Score 8.5/10. The adapter spec mocks only `spawnCli`, `resolveCliPath`, `probeCliVersion`, `fs/promises` and the
`createAcpSessionHandle` transport seam, which matches how neighbouring adapter specs mock the utils module, and it
tests `runSdk` end to end through the fake peer. The `grok-p3-*` payload rows pin the real wording. Gap: finding 8.

## Pattern compliance

| Repository rule or nearby convention                                    | Status         | Evidence                                                               |
| ----------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------- |
| Adapter registered like siblings (barrel, detection map, token refresh) | PASS           | `index.ts:28`, `cli-detection.service.ts:75,244`                       |
| Barrel imports only; no deep import into `acp/*` from the adapter       | PASS           | `grok-cli.adapter.ts:44` (`./acp`), profile `:29-35`                   |
| `import type` for type-only imports                                     | PASS           | `grok-cli.adapter.ts:23-35`, `grok-acp-profile.ts:25-35`               |
| ESM-only SDK reached only via `acp-sdk-loader.ts`                       | PASS           | `grok-acp-profile.ts:25` is a type import; no other SDK import         |
| No new vscode-core runtime import in agnostic libs                      | PASS           | `import type { Logger }` only, as in `codex-cli.adapter.ts:21`         |
| Exhaustive Record/switch over `SYSTEM_CLI_TYPES`                        | PASS (1 gap)   | `CLI_LABELS`, `CLI_ROWS`, `MODEL_CONFIG_KEYS`; gap: finding 6          |
| No `as any`, `@ts-ignore`, `@ts-expect-error`                           | PASS           | grep over diff and grok files                                          |
| Logging via injected Logger; no env/argv in logs                        | PASS           | `grok-cli.adapter.ts:151`; argv `['agent','--no-leader','stdio']` only |
| `--no-leader` always, `--always-approve` never by default               | PASS           | `grok-acp-profile.ts:42,110-112`                                       |
| Reuse existing helpers instead of re-implementing                       | FAIL           | finding 1 (`probeModels`)                                              |
| Adapter does not depend on orchestration policy module                  | FAIL (minor)   | finding 3                                                              |
| Angular: standalone, OnPush, signals for frontend changes               | NOT_APPLICABLE | no component structure changed                                         |
| Comments and docs stay true after the change                            | FAIL (minor)   | finding 2                                                              |
| Spec style matches neighbouring specs                                   | PASS           | `grok-cli.adapter.spec.ts`, `lane-spawn-policy.spec.ts` additions      |

## Maintenance debt

- Introduced: a third probe copy (about 35 lines), one policy export used by one adapter, and a one-way
  backward import from the adapter folder to the policy file.
- Retired: nothing removed. The `function` to `const` move in `acp-session-handle.ts` is neutral.
- Net: slightly up. All of it is small and removable by findings 1 and 3.

## Verdict

- Recommendation: REVISE (a short fix round; no re-architecture)
- Confidence: HIGH on structure and registration, MEDIUM on spec behaviour (not executed here)
- Key concern: `grok-cli.adapter.ts:142-174` is the third copy of the CLI stdout probe and has already drifted
  from Pi's copy.
- What a 10/10 version would do differently:
  - Add `probeCliStdout` to `cli-adapter.utils.ts` and use it from Grok and Pi (and opencode's single-shot path).
  - Forward the already-resolved `options.reasoningEffort` from the profile and keep `mapEffortToGrok` private.
  - Update the "six/seventh" comments in `agent-cli.ts` and type `CLI_DISPLAY_NAMES` as `Record<CliType, string>`.
  - Derive the `it.each` in `agent-process-manager.service.spec.ts:2624` from `SYSTEM_CLI_TYPES`.
  - Keep reformatting in its own commit so the functional diff in the matrix component is ten lines, not 1,360.
  - Require a non-empty credential object in `ensureTokensFresh`, as Pi does.
