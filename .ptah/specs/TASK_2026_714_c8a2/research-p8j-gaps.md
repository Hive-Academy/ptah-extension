# Root cause: p8j gaps A and D14a (read-only analysis, no code changed)

Paths are relative to W (the worktree). A = `libs/backend/agent-sdk/src/lib/codex-app-server/` (adapter, sink, classifier), H = `libs/backend/rpc-handlers/src/lib/chat/`, R = `libs/backend/codex-runtime/src/lib/`. Method: read the code and simulate the classifier on the exact live strings. I read the live rollout `rollout-...01a1883e...jsonl` (read only). Nothing was run.

## Gap A: Manual-mode reads still show cards

### Verdict: exactly one gate rejects, the lexical classifier (`A/codex-read-only-command.ts:141-142`)

The `permissionLevel` gate, the details gate and the real-path gate would all have passed.

**Gate 1, `permissionLevel() === 'ask'` (`A/codex-chat-approval-sink.ts:120`): passes.**
- The sink reads `getSession()?.settings.permissionLevel` (`A/codex-chat-adapter.ts:474`). That value is seeded from `profile.permissionLevel` (`:388`).
- The profile comes from `H/codex-host/codex-chat-host-ports.ts:393`: `permissionLevel: config.permissionLevel ?? 'ask'`.
- `chat:start` only sets `config.permissionLevel` for agent-started children (`H/session/chat-session.service.ts:1081`, "chat:start keeps the global default"). `chat:resume` never sets it (config block ~1866-1890).
- The Codex path never reads `autopilot.*` when building the profile. So every Codex chat is `'ask'`, whatever the chip shows. The live app-run1 `chat:start` params carry no level.
- The log line `{"enabled":false,"permissionLevel":"yolo"}` is only the toggle request echo. `config-rpc.handlers.ts:341` computes `effectiveLevel = enabled ? permissionLevel : 'ask'`. Manual is `ask`, and the stale `yolo` string is irrelevant.
- Candidate (a) in the report is therefore refuted. In practice the gate cannot fail for a Codex chat today (see D14a).

**Gate 2, details gate (`:120-124`): passes, with one unverified field.**
- `details` is the raw frame params (`R/codex-approval-bridge.ts:286`), so `kind` is undefined.
- `networkApprovalContext` and `proposedNetworkPolicyAmendments` are nullable in the 0.165 schema. A plain read does not set them.
- `environmentId` is also nullable (`protocol/codex-app-server-protocol.schema.json`, CommandExecutionRequestApprovalParams). I could not confirm that Codex leaves it null in the live run, because nothing logs `details`. It is the only second possible rejecter, and the app log cannot tell.
- `proposedExecpolicyAmendment` and `reason` are not gated.

**Gate 3, cwd handling (`:111-118`, `:127`): passes.**
- The rollout `turn_context.cwd` is a plain `C:\Users\abdal\...\ws`. The `file:///` form (3 rollout entries) is converted by `fileURLToPath` at `:113`. Candidate (c) is handled.
- `threadCwd` is `prepared.profile.cwd` (`A/codex-chat-adapter.ts:283`, normalized).
- `pathWithin(cwd, threadCwd)` with equal paths gives `relative === ''`, which is accepted (`A/codex-read-only-command.ts:88-94`).

**Gate 4, `unwrap()` (`:18-47`): passes.**
- The command is `"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -Command '<body>'`.
- The executable is quoted, so the first-token regex at `:26` matches it. `shellPath` is true.
- `trustedPath` needs `SystemRoot` or `windir`. The sink defaults it from `process.env` (`:93`). Electron on Windows has `SystemRoot=C:\WINDOWS`, which matches `^[a-z]:[\\/][^\\/]+$`, and the joined path matches case-insensitively.
- The `-Command '...'` regex (`:41`) matches and the body has no inner `'`. The classifier spec accepts `Get-Content -LiteralPath README.md` in the same wrapper (`codex-read-only-command.spec.ts:15`, `codex-chat-approval-sink.spec.ts:109`).

**Gate 5, `tokenize()` (`:51-86`): passes.** The `forbidden` character class (`:12`) does not contain `-`, a digit or `.`. Tokens: `Get-Content`, `-LiteralPath`, `README.md`, `-TotalCount`, `40`.

**Gate 6, `validStage()` PowerShell branch (`A/codex-read-only-command.ts:140-143`): REJECTS all three live commands.**
```
const values = args[0]?.toLowerCase() === '-literalpath' ? args.slice(1) : args;
if (values.length > 1 || (name !== 'get-childitem' && values.length !== 1)) return undefined;
```
| Command | `values` after `-LiteralPath` | Result |
| --- | --- | --- |
| `Get-Content -LiteralPath README.md -TotalCount 40` | `[README.md, -TotalCount, 40]` (3) | `values.length > 1`, rejected |
| `Get-Content -LiteralPath package.json -TotalCount 3` | 3 values | rejected |
| `Get-ChildItem -LiteralPath . -Name` | `[., -Name]` (2) | `values.length > 1`, rejected |

- Even if the length check passed, `:148` also rejects any value that `startsWith('-')`, so `-TotalCount` or `-Name` would still fail.
- The grammar has no switch or named-parameter support for the PowerShell cmdlets. The only accepted shapes are `Cmd [-LiteralPath] <one path>` and `Select-String -Pattern x -Path y`.
- `-TotalCount`, `-Name`, `-Raw`, `-Tail`, `-Recurse` and `-Force` appear nowhere in the allowlist or in the spec's accept list. `-Raw` appears only inside a rejected compound at `codex-read-only-command.spec.ts:70`.

**Gate 7, `acceptIfRealPathsStayInside` (`:150-171`): would pass** (existing files under the realpath'd thread folder). It was never reached.

Why nothing was logged: a classifier miss returns `undefined`, so `classified` is falsy and `:147` calls `presentRequest` with no log. Only the accept branch logs (`:136`). This is the same silent shape as the report's minor item 3.

### Minimal backend-only fix (classifier only; sink, runtime and MCP untouched)

In `A/codex-read-only-command.ts`, replace the PowerShell branch (`:140-143`) with a per-cmdlet named-parameter grammar. Matching is case-insensitive and exact; no abbreviations are accepted, because PowerShell accepts `-Tot`.
- **Get-Content:** `[-LiteralPath|-Path] <p>` (or one positional path), plus `-TotalCount|-Head|-First <int>` and `-Tail <int>`. The int must match `^\d{1,6}$` and must not start with `-`. Also the switch `-Raw`.
- **Get-ChildItem:** `[-LiteralPath|-Path] <p>` (or none or positional), plus the switches `-Name`, `-File`, `-Directory`. Optionally `-Force`.
- **Test-Path:** keep one path. `-PathType <Leaf|Container>` is optional.
- Each parameter may appear at most once. Values are consumed by position in the grammar, not by the "startsWith('-')" heuristic. Only path values go into `paths` (those are what `insideCwd` and the realpath gate see).
- **Do not allow:** `-Wait` (blocks forever), `-Stream`, `-Filter`, `-Include`, `-Exclude`, `-Credential`, `-ReadCount`, `-Delimiter`, `-Encoding`.
- **Do not allow `-Recurse` or `-Depth`** in this batch. Windows PowerShell 5.1 `-Recurse` follows junctions, and the realpath gate checks only the root path, so a junction inside the thread folder could list outside it.
- Optional follow-up, not required for these three live commands: pipe-only filters such as `Select-Object -First N`.

### Specs

- `codex-read-only-command.spec.ts` accepts, in the live wrapper:
  - `Get-Content -LiteralPath README.md -TotalCount 40` and `Get-Content -LiteralPath package.json -TotalCount 3`
  - `Get-ChildItem -LiteralPath . -Name`
  - `-Tail 5`, `-Raw`, parameter order swapped, and a positional path plus `-TotalCount`
- The same spec rejects:
  - `-TotalCount abc`, `-TotalCount -1`, `-TotalCount` with a missing value, a repeated `-LiteralPath`
  - `-Wait`, `-Stream`, `-Filter *`, `-Tot 3` (abbreviation), `-Recurse`
  - `-Path ..\x` and `-LiteralPath C:\other`
  - a switch given a value that is really a path
- `codex-chat-approval-sink.spec.ts`: one end-to-end case with the real `-TotalCount` command and a real temp folder. It should expect `'accept'` and the log line with names only, plus a hit and a miss for the new reason log below.

### Risk

- **Security:** low to moderate. The bounded named grammar only adds reads. Residual risks are `Get-Content` of a large file (unbounded output, not an escape) and `-Force` revealing hidden files that are still inside the thread folder.
- **Regression:** the classifier is deny-by-default. The existing reject cases must stay green. The security-review sequence from 8p-1 should re-run on the diff, because D20 requires a security-focused review.
- **Open question:** `environmentId` (see gate 2) may also be non-null in 0.165. If so, the sink will still show a card after the classifier fix. The names-only reason log below settles this on the first live read.

### Minor item: the sink logs nothing on a non-accept

Add one `this.logger.debug` (or `info` during the dev gate) at each fall-through to `presentRequest` in `A/codex-chat-approval-sink.ts:107-147`:
- `{ code: 'codex-read-only-not-accepted', reason }`.
- `reason` is a fixed enum: `level-not-ask`, `not-command`, `details-gate` (one of the three gate fields), `cwd-uri-invalid`, `not-classified`, `path-not-inside`.
- Do not log the command, paths, cwd or tokens (not even the first token: an unparseable command's first token is arbitrary text).
- Optionally log which `details` keys are non-null (`environmentId`, `networkApprovalContext`, `proposedNetworkPolicyAmendments`) as booleans, which settles the environmentId question.
- Spec: assert the call carries the code and reason, and that the serialized args contain no command text.

## Gap D14a

### 1. Resume never refuses (mode shown does not match the effective policy)

Root cause: the Codex host never feeds the saved Autopilot level into the profile.
- **Profile:** `H/codex-host/codex-chat-host-ports.ts:393`, `permissionLevel: config.permissionLevel ?? 'ask'`.
- **Resume config:** the `AgentSessionResumeConfig` in `H/session/chat-session.service.ts` (~1866-1890) carries no `permissionLevel`. `params` has none either, and `classifyCodexChatOptions` lists `permissionLevel` as supported but it is never populated on resume.
- **Only autopilot readers on the Codex path:**
  - `H/codex-host/codex-session-settings-record.ts:104-118`. It serves the chip and the live controls, not the profile. It is used only for the `settings()` fallback when no record exists.
  - `H/session/chat-session.service.ts:1254-1260`. It is a stop-intent check.
- **Effect:** the profile always has `permissionLevel: 'ask'`. `buildCodexExecutionProfile` then gives `untrusted` plus `workspace-write` (`R/codex-execution-profile.ts:147,257,260`). This matches the rollout's `turn_context` for every turn.
- **Fingerprint:** it covers only `{permissionLevel, sandboxPolicy, approvalPolicy}` (`R/codex-execution-profile.ts:284-292`). Stored and current are both the `ask` triple, so the compare at `R/codex-runtime.ts:51` is equal and `CodexResumeProfileChangedError` is never thrown.
- **Wire:** `thread/resume` and `turn/start` send `profile.approvalPolicy` and `profile.sandboxPolicy` (`R/codex-context.ts:208-210,481-490`), still `untrusted` / `workspace-write`.
- **Result:** the chip (from `config:autopilot-get`, the saved default) shows Full Auto while the Codex policy is `ask`. D14a's refusal is unreachable through the UI.
- **Side effect:** the sink's `'ask'` gate is always true for Codex chats, including those where the user chose Full Auto.

### 2. Live change on an open thread throws and the UI is silent

Chain of calls:
1. `config:autopilot-toggle` (`config-rpc.handlers.ts:323`) calls `runtimeControls.setPermission`.
2. `native-session-controls.ts` `change()` calls `deps.adapter.setSessionPermissionLevel(id, level)` before it saves.
3. That is `A/codex-chat-adapter.ts:726-736`, which calls `context.updateNextTurn({ permissionLevel })` inside `safe('permission')`.
4. `R/codex-context.ts:756-761` throws `'Codex permission transition requires verified reconfiguration'` whenever the requested level differs from the frozen `this.profile.permissionLevel`.
5. `safe` (`A/codex-chat-adapter.ts:806-813`) maps this to `CodexChatAdapterError('runtime-failed')`, which is the logged text.
6. `change()` has not saved yet, so the setting is not persisted. This explains "chip stays Manual".
7. The handler rethrows (`config-rpc.handlers.ts:389-399`). The renderer shows nothing; that is frontend and out of scope for a backend-only fix.

The refusal is by design. The code comment says "requires verified reconfiguration", and the model and effort paths work (`:763-769`).

### What the App Server supports

The pinned schema (`R/protocol/codex-app-server-protocol.schema.json`, `TurnStartParams`) has `approvalPolicy` described as "Override the approval policy for this turn and subsequent turns." and `sandboxPolicy` as "Override the sandbox policy for this turn and subsequent turns." The repo's own research reached the same conclusion for 0.155.1 (`research-report.md:24`).

`R/codex-context.ts:481-490` already sends both fields on every `turn/start`, taken from the frozen profile. So the live change is supported. The runtime just never changes the values it sends.

`thread/resume` also takes `approvalPolicy` and `sandbox` (D23).

### Minimal backend-only fix (two independent parts)

**Part 1: make the profile honor the saved level.** This makes the refusal reachable.
- In `H/codex-host/codex-chat-host-ports.ts:393`, replace `?? 'ask'` with a resolver for the saved effective level.
- The resolver reads `autopilot.enabled` and `autopilot.permissionLevel` by workspace scope, the same rule as `codex-session-settings-record.ts:104-118`. Extract it as one shared helper rather than a third copy.
- The resolver gives `enabled ? level : 'ask'`.
- Behavior after this part, per D14a/D24(1), which the user already chose:
  - An existing `ask` thread resumed in Auto-edit, Plan or Full Auto is refused with `CodexResumeProfileChangedError` and the typed "Start a new chat" message.
  - A new chat started in Full Auto now actually runs `on-request` + `workspace-write`.
- **Consequence to tell the user:** every mode switch makes old Codex threads unresumable (dev-gated runtime only). If that is not what they want, the alternative (resume under the current policy) was rejected in D24(1). That is not mine to change.

**Part 2: live change applies on the next turn.** This is the Claude-parity path, for a thread that is open. It stays consistent with D24 because no resume is involved.
- In `R/codex-context.ts:744-771` (`updateNextTurn`), remove the throw. Keep the zod validation. Store the new `permissionLevel` in `this.settings`.
- Extract from `R/codex-execution-profile.ts` the pure mapping `levelToPolicy(chat, level, cwd)` that currently lives inline (`:257-277`): `approvalPolicy` plus `sandboxPolicy`. Call it from `updateNextTurn`, and keep it the single source for `buildCodexExecutionProfile`.
- `start()` (`:481-490`) reads `approvalPolicy` and `sandboxPolicy` from the current settings instead of the frozen profile.
- The bridge's `permissionLevel` (`:249`) reads `this.settings.permissionLevel`. Otherwise the local routing (`codexPermissionPolicy`, yolo accept-all) lags the wire policy.
- The adapter already updates `session.settings` after a successful update (`:735`), which keeps the sink's `'ask'` gate in step.
- The resume fingerprint: the stored identity (`R/codex-context.ts:~237`) holds the open-time fingerprint. Once the policy changes, the saved level also changes, so the next resume would compute a different fingerprint and refuse. Re-persist the identity with the new fingerprint when a live level change succeeds (reuse `options.store.persist` or add an update to it). Without that, Part 2 followed by a restart always refuses, and the Part 1 refusal covers a different case (change while closed).
- A live change is persisted by `native-session-controls.ts` after `apply` succeeds, so the "save failed, rollback" path (`change()`) already calls `apply(old)`. With Part 2, that rollback also has to restore the old policy.

### Specs to change or add

- **`R/codex-runtime.spec.ts`** (and `codex-permission-policy.spec.ts` if the mapping is extracted):
  - `updateNextTurn({permissionLevel})` changes the next `turn/start` frame to the new `approvalPolicy` and `sandboxPolicy` (all four levels).
  - The bridge uses the new level.
  - A rejected `plan` or `yolo` transition no longer throws.
  - The fingerprint is re-persisted.
- **`A/codex-chat-adapter.spec.ts` and `A/codex-chat-turn-lifecycle.spec.ts`:** `setSessionPermissionLevel` with a different level resolves, and the sink sees the new level.
- **`H/codex-host/codex-chat-native-contract.spec.ts`:** the controls path (`setPermission`, save, rollback) with a different level on an open thread.
- **New or extended `H/codex-host/codex-chat-host-ports.spec.ts`:** the profile uses the saved level when `config.permissionLevel` is absent.
  - Manual gives `ask`.
  - Enabled `auto-edit`, `plan` and `yolo` give those levels.
  - An explicit `config.permissionLevel` wins.
- **`H/session/chat-session.service.spec.ts`:** a resume with a changed saved level maps to `CODEX_RUNTIME_FAILED` with `CODEX_RESUME_PROFILE_CHANGED_MESSAGE`. This is the p8j D14a scenario, which was unreachable.

### Risk

- **Part 1:** changes the effective policy for every new Codex chat. This is the intended D14 behavior (Full Auto means `on-request`) and it matches what the user's chip shows. It also means existing `ask` threads refuse once a mode is saved.
- **Part 2:** touches the approval-routing hot path.
  - A stale bridge level could auto-accept under the wrong mode. That is a security-relevant race if a turn is active, so the update must wait for an idle turn. Reuse `this.serialize`, and reject or defer while a turn is running; see also `this.turnRevision` at `:490`.
  - The sandbox is `workspace-write` for every chat level except `plan`. Moving to `read-only` for `plan` and back must resend both fields.
  - An independent security review is warranted before commit.
- **Frontend:** untouched. The existing "no error is shown on failure" gap becomes moot once the failure does not occur.

## Minor item: reloaded transcript sometimes drops a reply

Classification: the D9 family (known gap D, P12 native history), not a new root cause.
- D9 and D7 moved P12 (native history and sessions) to the follow-up PR (`decisions.md:222-224`).
- `live-test-p8h.md` GAP-D and `live-test-p8i.md` already record "the history reader does not read native sessions". There the body was empty or "No events found" (`chat:resume`).
- p8j adds a partial instance: some replies are present and one is missing. That looks like the same reader (Ptah-side persistence rather than the rollout) being incomplete.
- I did not trace the reload path, so the exact missing-reply mechanism is not verified. If the user wants it confirmed before P12, the smallest check is to diff the rollout's agent messages for run 8 against what `chat:resume` returned.

## Unknowns

- **`environmentId` and other non-null fields.** No log shows the request `details`. The reason-code log answers it on the next live read.
- **Whether the Codex-side `commandActions` classification for PowerShell would offer a native read hint.** Not investigated (D20 says there is no native per-thread allow in 0.165).
- **The stale `sr-only` announcement (p8j item 5) is frontend and was not investigated.**
