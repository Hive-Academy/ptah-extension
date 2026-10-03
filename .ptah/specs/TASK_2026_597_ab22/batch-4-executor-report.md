## Backend implementation — `TASK_2026_597`, batch 4

**Verdict**: IMPLEMENTED. Typecheck, lint and test pass for `@ptah-extension/cli-agent-runtime` and `@ptah-extension/rpc-handlers`.

**Tasks completed**: 4.1, 4.2, 4.3, 4.4. I picked up the earlier developer's uncommitted work and finished it. I did not start over.

### Files

All paths are under `D:/projects/ptah-extension/.claude-worktrees/task-597-lane-token-burn/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/`.

- MODIFIED `cli-adapter.interface.ts`:
  - Adds `CliLaneBudgets` and `CliCommandOptions.laneBudgets?`.
  - Adds `LaneModelSource` and `CliCommandOptions.modelSource?`, used by F10.
  - Adds `SdkHandle.onLaneConfigRejected?`. This is the buffered retry state that Batch 6's `prefixKeys: 'dropped (config rejected)'` will read.
- MODIFIED `cli-adapter.utils.ts`: H4.
  - `resumePreamblesDelivered: boolean` is replaced in place by `resumeDeliveredPreambles?: { toolPolicy; messaging }`.
  - Adds `fullPromptPreambles(options)`, which records what a first turn carried.
- MODIFIED `cli-adapter.utils.spec.ts`: Batch 5 specs moved to the new signature. Covers three cases:
  - both blocks carried: both omitted
  - tool policy only: messaging kept, policy omitted
  - neither carried: both kept
- MODIFIED `codex-cli.adapter.ts`: `runSdk` rewired. Net change is 254 added and 266 removed lines, so the adapter is 12 lines shorter.
  - Every turn constructs its own `Codex` client with `configOverrides`. The first turn uses the `first-turn` variant. Resume spawns and `continue()` turns use `resume` and call `resumeThread(threadId)`.
  - Thread options are only `model`, `sandboxMode`, `workingDirectory` and `skipGitRepoCheck`. The SDK `config` option and the dead `tool_search_always_defer_mcp_tools` block are gone.
  - On a config rejection, the turn is retried once with only the essential keys. The `mcp_servers={...}` user-server entry is dropped. Other behaviour on rejection:
    - a WARN log with a redacted stderr excerpt of at most 200 characters
    - an `info` segment
    - the `onLaneConfigRejected` callback fires
    - a second rejection is reported as a normal error
  - F10: when Codex rejects the model, the message names where the model came from (`modelSource`). There is no retry with another model.
  - `SUPPORTED_MODELS` is now gpt-6-sol (marked as Ptah's default), gpt-6-luna and gpt-6-astra.
  - The resume-site comment records the role characters resent per resume.
  - The H6 guard checks the whole SDK argv, built by `codexExecArgs`, not `developer_instructions` alone.
  - The H4 flags from the first turn are passed on `continue()`.
  - Reader, builder and budget warnings go to the logger once per distinct message per adapter instance (capped at 256). They never reach the output stream.
  - The binary version comes from `resolveCodexNativeBinaryInfo` and is logged.
- CREATED `codex/codex-native-binary.ts`: the resolver moved out of the adapter. `resolveCodexNativeBinaryInfo` returns `{ path, version }`. The version is read from the platform `package.json` four directories above the binary. If that fails, it uses one `probeCliVersion(path)` call, cached per path.
- CREATED `codex/codex-native-binary.spec.ts`. Covers:
  - a fixture package tree in a temp dir
  - missing `package.json`: one probe, then the cached result
  - unparsable `package.json`: probe fallback
- CREATED `codex/codex-config-rejection.ts` (+ spec) and `codex/__fixtures__/*.stderr.txt`: the AS15 matcher adjusted to four real stderr captures from codex 0.155.1, plus the excerpt and essential-keys helpers. Batch 8's runner can reuse them.
- CREATED `codex/codex-model-rejection.ts`: the F10 messages.
- CREATED `codex/codex-exec-args.ts`: rebuilds the argv the SDK passes to `codex exec` (same flags, same order), so the command-line guard measures what will actually run.
- CREATED `codex/codex-lane-budgets.ts` (+ spec): the Batch 3 review requirement.
  - The token budgets must be a safe integer >= 0 (`-0` is normalised to 0). Web search must be a boolean.
  - An invalid value falls back to the default (120000 / 2500 / true) with one warning that names the `agentOrchestration.*` key.
  - An absent value takes the default with no warning.
- MODIFIED `codex-cli.adapter.spec.ts`: the 9 failing role and MCP cases now check `configOverrides`. New cases (Task 4.4) check what the SDK test double actually receives:
  - First turn:
    - `developer_instructions`, `approval_policy` and effort arrive only as overrides
    - thread options are exactly the four keys
    - `web_search="live"` by default
  - N-A pin: `codexWebSearch=false` gives `web_search="disabled"`, with no thread-option override and budget 0 leaving the key out.
  - Resume spawn and `continue()`:
    - the resume variant includes `skills.include_instructions=false`
    - `developer_instructions` follows `CODEX_RESUME_RESENDS_ROLE`
    - preambles are dropped
  - Logging:
    - reader and builder warnings are logged once across two spawns and never reach the stream
    - Batch 3 cases (a string, a float, a negative value, a value above `MAX_SAFE_INTEGER`, a non-boolean web search) each fall back to the default, with exactly one warning per key across two spawns
  - Config rejection:
    - the retry, using the real fixture stderr, keeps exactly `web_search`, `approval_policy`, `mcp_servers.ptah.url`, `mcp_servers.ptah.tool_timeout_sec` and `developer_instructions`, plus the `--model` thread option, and drops `mcp_servers={...}`
    - the info segment, the callback and the excerpt of at most 200 characters are checked
    - a second rejection is one error, with no third attempt
  - F10 message for `ptah-default`.
  - H6: 40,000 user servers make `runSdk` throw `CliCommandLineTooLongError` before any client is constructed.
  - Version: the probe fallback is logged as `codexVersion`, and `detect()`'s `resolveCliPath` is never called.
- MODIFIED `.ptah/specs/TASK_2026_597_ab22/batches.md`: the Batch 4 header and Tasks 4.1-4.4 are marked IMPLEMENTED.

### Stack observed

- TypeScript library run with Nx; tests use `@nx/jest:jest` (`libs/backend/rpc-handlers/project.json`).
- The adapter takes plain constructor arguments; the logger is optional.
- The Codex SDK is loaded through the cached dynamic import in `codex-cli.adapter.ts`.
- Boundary validation is hand-written, following the `isNonNegativeInteger` rule the rpc-handlers code uses.

### Verification

All runs were scoped to these two projects.

| Command                                                                                                                                                       | Result                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers --parallel=2`                                            | EXIT=0, "Successfully ran targets typecheck, lint for 2 projects" |
| `npx nx run-many -t test -p @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers --parallel=1 --maxWorkers=2 --skip-nx-cache --output-style=static` | EXIT=0                                                            |

Test results from that run:

| Project           | Suites         | Tests                            |
| ----------------- | -------------- | -------------------------------- |
| cli-agent-runtime | 82/82 passed   | 1640 passed, 1 skipped, 0 failed |
| rpc-handlers      | 136/136 passed | 3932 passed, 7 skipped, 0 failed |

`chat-session-auth.spec.ts`, run directly: 4/4 passed.

### Plan deviations

1. **Interface scope (4.1).** Task 4.1 asked for `laneBudgets` only. I also added `modelSource` / `LaneModelSource` and `SdkHandle.onLaneConfigRejected`. Task 4.3 needs both: F10 needs to know the model's source, and the retry state has to be exposed for Batch 6. Both are optional and additive.
2. **Resolver location (4.2).** The plan places `resolveCodexNativeBinaryInfo` in `codex-cli.adapter.ts`. It now lives in `codex/codex-native-binary.ts`, following 4.3's rule that new logic goes in `codex/` collaborators. The adapter imports it.
3. **Files the plan did not name.**
   - `codex-exec-args.ts` exists so H6 measures the real argv.
   - `codex-model-rejection.ts` and `codex-lane-budgets.ts` keep the adapter getting shorter overall.
4. **Where budget validation happens.** It runs in the adapter's fallback (`resolveCodexLaneBudgets(options.laneBudgets)`), so values are validated whatever Batch 6 passes in. Batch 6's `resolveLaneBudgets` can pass raw settings values straight through.
5. **What "one warning per key" means.** Warnings are deduplicated by message text per adapter instance. One invalid value produces one warning for its key across all spawns. A different invalid value for the same key would log once more.
6. **Retry scope.** The fallback to essential keys lasts for the rest of the handle: later `continue()` turns also use only the essential keys. The essential list follows Task 4.3. `model_reasoning_effort` is not on it, so it is dropped on retry.

### Out-of-scope observations

None in the code. One tooling note: passing `-- --maxWorkers=2` through `run-many` also forwards the flag to `tsc` in the typecheck target, which fails with TS5023. Pass `--maxWorkers` without the `--` separator and only with `-t test`.

## Fix round 1

Source: `batch-4-code-logic-review.md`. Fixed S1 and Moderates 1-3. As instructed, Moderate 4 and both Minors are not touched. Paths below are under `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/`.

### Fixes

- **S1. F10 matcher too broad, original text lost.** Changes in `codex/codex-model-rejection.ts` and `codex-cli.adapter.ts`.
  - The pattern is narrower. It drops `not available`, bare `unsupported` and bare `not supported`. It keeps `model_not_found`, `unsupported[_ ]model`, and "model ... not found / does not exist / is not supported / do(es) not have access". The gap between "model" and the verdict is at most 80 chars and may not cross a `.`.
  - Only the terminal `turn.failed` event is matched. A non-terminal `error` event (reconnect or capacity notice) goes through `handleStreamEvent` unchanged.
  - The F10 message now ends with `Codex said: "<excerpt>"`. The adapter logs a WARN `Codex rejected the lane model` with `model`, `modelSource` and `codexError`.
  - The excerpt comes from the new `codexTextExcerpt`: whitespace collapsed, secrets redacted, at most 200 chars.
  - `codexModelRejectionMessage` gained a `secrets` parameter.
- **M1. Reasoning effort dropped on retry.** `model_reasoning_effort=` is now in `ESSENTIAL_ENTRY_PREFIXES` (`codex/codex-config-rejection.ts`). It is a validated enum, so it is not a plausible rejection cause.
- **M2. Sticky essential-only mode after a user-config failure.** I took the review's smallest fix.
  - The adapter's `configRejected: boolean` is now `essentialAfter: string | undefined`, holding the rejection stderr.
  - When the essential-key attempt is also rejected, the cause is outside Ptah's overrides. `essentialAfter` is cleared and a WARN is logged: "Codex rejected the essential lane config too; the cause is outside Ptah's overrides (check the user's Codex config.toml). Later turns use the full lane config again".
  - The failure is then reported as a normal error, which shows the real Codex text.
  - Later `continue()` turns carry the budgets again.
  - When the essential retry succeeds, the essential mode still persists, as before.
  - `onLaneConfigRejected` now fires at most once per handle, as its interface doc says, even if a later turn is rejected again.
  - A cost I accepted: on a persistently broken user config, each `continue()` turn makes two failed spawns. Neither reaches a model.
- **M3. Retry re-enabled the user's MCP servers silently.** The `mcp_servers={...}` user-server entry is now essential and stays on the retry, so user servers stay disabled.
  - It is dropped only when Codex names a user server as the cause. The new `codexRejectionNamesUserServer` checks for an `` in `mcp_servers.<name>` `` key with a name other than `ptah`, which is the shape of the captured `exec-unloaded-server-disable` fixture.
  - Without that drop, the retry would fail the same way.
  - In that case the WARN carries `userServersReEnabled: true`, and the info segment and stream notice add: "Codex named one of your MCP servers as the cause, so your own MCP servers are enabled for this lane".
  - `essentialCodexConfigEntries(entries, stderr)` now takes the stderr.
  - The notice text was also corrected. It now says "Codex rejected the lane config; this run drops the lane budget and prefix keys, ...", where it used to claim "a lane budget key".

### Files

- MODIFIED `codex/codex-model-rejection.ts`: narrower pattern, `codexTextExcerpt`, quoted original text, `secrets` parameter.
- CREATED `codex/codex-model-rejection.spec.ts`. Covers:
  - 4 rejection shapes recognised
  - 4 non-rejections ignored: capacity, bare unsupported, reconnect, cross-sentence
  - redaction and cap
  - the default-model wording
  - the excerpt cap
- MODIFIED `codex/codex-config-rejection.ts`: essential set now includes effort and the user-server entry; adds `codexRejectionNamesUserServer`; `essentialCodexConfigEntries` takes `stderr`.
- MODIFIED `codex/codex-config-rejection.spec.ts`:
  - `codexRejectionNamesUserServer` is true on the fixture, and false for a budget key, for no named key, and for `mcp_servers.ptah.url`
  - the essential set keeps effort and the user-server entry
  - the user-server entry is dropped when a user server is named
  - the old essential-set case was replaced, not kept alongside
- MODIFIED `codex-cli.adapter.ts`: `modelRejection` is limited to `turn.failed` and logs; `essentialAfter` and `rejectionAnnounced` replace `configRejected`; the second rejection clears the state; adds the user-server notice and the new notice text.
- MODIFIED `codex-cli.adapter.spec.ts`. Case changes:
  - Retry case updated to expect effort `high` and `mcp_servers={"github"={enabled=false}}` on the retry, the new notice, and `userServersReEnabled: false`.
  - New M3 case: the unloaded-server fixture drops the entry, keeps effort, and the info segment and WARN say user servers are enabled.
  - New M2 case: two rejections, then `continue()` carries `model_auto_compact_token_limit=120000` and `tool_output_token_limit=2500`. The callback fires once and the "essential lane config too" WARN is logged.
  - New case: after a successful essential retry, `continue()` stays essential and keeps effort.
  - F10 case updated: the quoted Codex text is in the segment, and the WARN carries `model`, `modelSource` and `codexError`.
  - New S1 cases: a capacity notice and a bare-unsupported `turn.failed` do not get the F10 advice, and a non-terminal `error` event with model wording goes through the normal path.

### Verification

The command as given, `npx nx run-many -t typecheck,test,lint -p @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers --maxWorkers=2`, fails in the typecheck target with `error TS5023: Unknown compiler option '--maxWorkers=2'`. Nx forwards the flag to `tsc` even without `--`; this is the known tooling issue recorded above. I therefore split it:

| Command                                                                                                                                          | Result                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers`                                            | "Successfully ran targets typecheck, lint for 2 projects" |
| `npx nx run-many -t test -p @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers --maxWorkers=2 --skip-nx-cache --output-style=static` | "Successfully ran target test for 2 projects"             |

Test results:

| Project           | Suites         | Tests                                         |
| ----------------- | -------------- | --------------------------------------------- |
| cli-agent-runtime | 83/83 passed   | 1662 passed, 1 skipped (was 82 suites / 1640) |
| rpc-handlers      | 136/136 passed | 3932 passed, 7 skipped (unchanged)            |

### Deviations and residual risk

- **M3 depends on a named key.** If Codex rejects the user-server entry without naming `mcp_servers.<name>`, the retry keeps the entry and fails again. That failure is shown as a normal error, and by M2 later turns go back to the full config. I chose this over silently re-enabling servers. The one captured shape does name the key.
- **Model rejection reported only as `error`.** If Codex ever reports a model rejection only in an `error` event and never in `turn.failed`, the raw text reaches the user without the F10 advice. That is visible, not hidden.
- **Not done, per the instruction:** Moderate 4 and both Minors.
