# Code logic review — Phase P1-B (Batches 8–11)

Reviewer family: xAI
Implementer family: OpenAI
Review family: xAI on OpenAI (static, read-only; CI runs tests)
Score: 5/10
Verdict: REVISE
Counts: 1 blocking, 1 serious, 2 moderate, 2 failure modes

Scope read: `git diff 7fd7e5fa5..HEAD` for `libs/backend/agent-sdk` and `libs/backend/cli-agent-runtime` (18 files, +2315/−361). Full reads of the new production modules and the registry spawn/callback sections the diff calls. Acceptance: `batches.md` lines 213–272 and `implementation-plan.md` lines 160–188. D13 is not treated as a defect: `ClaudeCliAdapter.runSdk` throws when `accountAdmission` is set (`claude-cli.adapter.ts:102-108`) and does not acquire a lease. No `nx` / jest / tsc. `ptah_get_diagnostics` was not run; the ptah MCP tool list was not available in this session.

What separates 5 from 7–8: native option, permission, and stream-loop extraction matches the previous registry spawn for the fields Batch 9 names, and ambient application returns the same object. What separates 5 from 3–4: the miss is at the named-env and prompt-gate boundaries, not in the extracted native lane.

## Five logic questions

1. Silent success: a named main or one-shot child can still be pointed at the host credential store by `CLAUDE_SECURESTORAGE_CONFIG_DIR` after `applyClaudeAccountRouteEnv` reports a routed env. A follow-up `continue()` that lands after the stream `then` closes the mailbox is drained with the previous exit code.
2. User action: a second user turn on one named prompt iterable is refused (`push` returns false) and the iterator then ends, so the SDK sees end-of-input. Two fresh Claude lane runs with no parent session share the permission routing hint `claude`.
3. Wrong answer without an error: an explicit `reasoningEffort` with no model is dropped and the SDK default effort is used, with no “Not applied” log. A late subscriber on the new Claude lane loses structured segments past 5000; the native registry does not cap that buffer.
4. Dependency failure: `queryFn` throw closes the mailbox, disposes callbacks, and ends plan limits, then the registry `catch` still stops the proxy. `lanePlanLimits.settled` is only resolved, never rejected, so a turn wait does not hang on a rejected owner read. Admission remains a throw, not a typed code and not an ambient retry.
5. Unspecified but required by the plan’s “before push” sentence: one admission that ends the iterable cannot be the long-lived prompt channel Batch 17 has to push into. Account-scoped model cache is Batch 12+ (`batches.md` line 308) and is not a finding here.

## Findings

### 1. Blocking — named launch env still inherits the host credential namespace

`libs/backend/agent-sdk/src/lib/helpers/claude-account-route-env.ts:48-66`
`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1337-1354`
`libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:606-623`

`applyClaudeAccountRouteEnv` copies the completed child env, sets `CLAUDE_CONFIG_DIR`, and deletes only `CONFLICTING_SELECTORS`. That list matches `CLAUDE_ACCOUNT_SELECTOR_KEYS` minus `CLAUDE_CONFIG_DIR`. It does not mention `CLAUDE_SECURESTORAGE_CONFIG_DIR`.

The main builder and the one-shot builder spread `process.env` and then call the helper. Any host value of `CLAUDE_SECURESTORAGE_CONFIG_DIR` is therefore still on `options.env`. Installed `@anthropic-ai/claude-agent-sdk` `sdk.mjs` `J9` uses that variable, when it is not `undefined`, as the credential namespace and does not consult `CLAUDE_CONFIG_DIR`. On Windows the same bundle, when it has a config directory, writes:

`CLAUDE_SECURESTORAGE_CONFIG_DIR = options.env.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? options.env.CLAUDE_CONFIG_DIR ?? …`

So a named route whose env object omitted the key still receives the host value, ahead of the named directory. The child config dir is the selected account and the credential store is the ambient one. No error is raised.

The safe lane path is narrower: `buildClaudeLaneEnv` starts from `buildSafeEnv`, which does not copy this key. The failure is the two constructors Batch 8 was required to seal, and any later named caller that passes a full environment through the helper.

Suggested fix: for `kind === 'named'`, set `CLAUDE_SECURESTORAGE_CONFIG_DIR` to `route.canonicalConfigDir` (so the SDK’s Windows `?? process.env` fallback hits the named dir) and delete every other casing. Apply the same prefix drop `certifyClaudeAccountEnvironment` already uses (`CLAUDE`, `ANTHROPIC`, `AWS_`, `GOOGLE_`, `AZURE_`, `CLOUD_`, `BEDROCK`, `VERTEX`) to every remaining key except the two directory keys just set. Refuse an empty or whitespace `canonicalConfigDir` instead of writing it. Add a fixture that puts `CLAUDE_SECURESTORAGE_CONFIG_DIR` on the base env and expects the named directory.

### 2. Serious — one admission ends the prompt iterable, so a later approved turn cannot be pushed

`libs/backend/agent-sdk/src/lib/helpers/named-account-prompt-gate.ts:55-66`
`libs/backend/agent-sdk/src/lib/helpers/named-account-prompt-gate.ts:86-99`

`push` returns false unless `state === 'held'`. `commit` leaves `held` forever. The draining `next()` that finds an empty queue calls `close()`, which completes the iterator. The unit test at `named-account-prompt-gate.spec.ts:138-155` encodes “new gate for the follow-up”.

The plan’s prompt channel is one async iterable for the query (`implementation-plan.md` line 185: subsequent turns obtain a fresh identity approval before push). After the first commit the SDK’s eager `next()` drains the batch and then receives `{ done: true }`. A second user message cannot wait on this iterable for a second approval. `createPromptMailbox` stays open until `close` and is what `continue()` pushes into (`claude-sdk-lane-runner.ts:180-187`). Replacing that mailbox with this gate, which Batch 17 is told to do, ends the named session after the first committed batch. Close/abort before commit does not yield, and that part matches the batch.

Suggested fix: keep the iterator open after `commit`. Further `push` calls queue into a new held batch that does not yield until another `commit`. `reject`, `close`, abort, and `iterator.return` stay the only paths that drop the queue and end iteration. Do not call `close()` from the empty-queue read.

### 3. Moderate — fresh Claude runs share one permission routing hint

`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts:141`
`libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-options.ts:126-132`

`buildClaudeSdkLaneOptions` uses resume session, then parent session, then `routingId`. The adapter always passes `routingId: 'claude'`. A spawn with neither session id therefore builds `canUseTool` with routing hint `claude`. `SdkPermissionHandler.createCallback` stores that hint on lifecycle events and looks up unattended policy with `unattendedPolicies.get(routingHint)` (`sdk-permission-handler.ts:508-509`). Two concurrent system-lane runs are the same hint. The lazy agent resolver still separates prompts after `setAgentId`, which is why this is not a cross-run allow. The native registry passes `ptah-cli:${id}` (`ptah-cli-registry.ts:751`), so this is new on the adapter path only.

Suggested fix: pass a per-spawn id (`claude:${agentId}` or a generated run id) as `routingId` when resume and parent are absent.

### 4. Moderate — explicit effort is discarded when the model is omitted, and the new lane caps segments the registry does not

`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts:226`
`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts:191-192`
`libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:1305-1307`

`resolveEffort` returns `undefined` immediately when `model` is empty, before the candidate loop and before the “Not applied — configured precedence remains in effect” log (`claude-cli.adapter.ts:245-247`). `runSdk` then `delete`s `options.model` (`claude-cli.adapter.ts:151`) so the SDK picks its default model at its default effort. A caller who set `reasoningEffort: 'high'` and omitted `model` gets neither the effort nor an explanation.

Separately, the adapter’s pre-subscribe segment buffer drops the oldest entry at 5000. `createCallbackInfrastructure` caps only the stream-event buffer (`ptah-cli-registry.ts:1338-1340`) and pushes every segment (`ptah-cli-registry.ts:1305-1307`). A Claude system-lane run that emits more than 5000 segments before the subscriber attaches silently loses the earliest structured segments. The extracted registry path does not.

Suggested fix: resolve effort against the SDK scale even when the model string is empty, and log the existing “Not applied” line when the explicit value is unsupported. Remove the segment-buffer cap so `emitSegment` matches `createCallbackInfrastructure`, or call that helper from the adapter instead of a second copy.

## Parity check (Batch 9)

The registry spawn now calls `buildClaudeSdkLaneOptions` and `ClaudeSdkLaneRunner.run` (`ptah-cli-registry.ts:742-779`). Removed capabilities and where they live:

| Previous registry behavior | Now | Verdict |
| --- | --- | --- |
| Preset vs standalone system prompt, claude_code tools | `claude-sdk-lane-options.ts:104-115` | Preserved |
| `mcpServers`, hooks, `capabilityIsolation` | `claude-sdk-lane-options.ts:116-117, 144` | Preserved |
| `buildFlagSettingsArg` with output style, `'accept'`, auto-compact, capability flags | `claude-sdk-lane-options.ts:117-123` | Preserved |
| `replay-user-messages` and `--name` extraArgs, including the warn vs debug split | `claude-sdk-lane-options.ts:75-97` | Preserved. Log field `agentConfigId` is now `routingId` (`ptah-cli:${id}`), not the bare id |
| Permission map yolo / auto-edit / ask / plan; YOLO sets `allowDangerouslySkipPermissions` and skips `canUseTool`; other levels use `SessionId.safeParse` plus the raw hint | `claude-sdk-lane-options.ts:149-212` | Preserved. Registry still passes `ptah-cli:${id}` |
| `settingSources: ['user','project','local']`, partial messages, `persistSession`, conditional `resume` | `claude-sdk-lane-options.ts:134-137` | Preserved |
| Env from `buildSafeEnv(authEnv)` after option assembly, no later spread | `buildClaudeLaneEnv` at `claude-sdk-lane-options.ts:138` | Preserved for omitted route: `applyClaudeAccountRouteEnv` returns the same object when `kind !== 'named'` (`claude-account-route-env.ts:48`) |
| stderr classifier and `spawnClaudeCodeProcess` | `claude-sdk-lane-options.ts:65-73, 139-143` | Preserved |
| Executable from `getCliJsPath()` | `ptah-cli-registry.ts:758` | Preserved |
| One stream loop, session-resolved replay, `setAgentId` attaches plan limits, `continue` enqueues a turn and `mailbox.push` | `claude-sdk-lane-runner.ts:97-188` | Preserved |
| Turn resolve waits on `lanePlanLimits.settled`; stream failure returns exit 1; drain settles remaining turns once | `claude-sdk-lane-runner.ts:115-148` | Preserved. `settled` cannot reject (`ptah-cli-lane-plan-limits.ts:120-121`) |
| `supportsContinuation: true`; no steer, interrupt, or `getPid` | `claude-sdk-lane-runner.ts:176-177` and the omitted `getPid` comment at `151-160` | Preserved |
| Abort closes the mailbox | `claude-sdk-lane-runner.ts:72-74` | Preserved, now `{ once: true }` |
| Seeded `createPromptMailbox(task)` on the native path | `ptah-cli-registry.ts:741` | Preserved. Named gate is not wired here |
| Callback buffers from `createCallbackInfrastructure` | Registry still uses them (`ptah-cli-registry.ts:714-726`) | Preserved on the native path. The new adapter reimplemented them; see finding 4 |

Delta, not a missing capability: on normal stream end the runner now `mailbox.close()`s and removes the abort listener (`claude-sdk-lane-runner.ts:136-138`). The old `then` only disposed callbacks, stopped the proxy, ended plan limits, and drained turns. A `continue()` that arrives after that `close` and before the drain microtask pushes nothing (`ptah-cli-prompt-mailbox.ts:58-60`) and is then resolved with the finished run’s exit code (`claude-sdk-lane-runner.ts:143-147`). The old drain already completed that promise; the new `close` makes the dropped text certain. Not blocking because the process has already finished.

No removed capability was absent from the new native path. Finding 1 is not a Batch 9 extraction miss; the registry does not pass `accountRoute`.

## Public API style

Production files in this diff do not use `any` or `as unknown as`. `as unknown as Logger` is only in `claude-sdk-lane-runner.spec.ts:27`. The lane spec also casts a route that lacks `claudeAccountRouteCertification` (`claude-sdk-lane-runner.spec.ts:158-167`); the helper never checks that brand at runtime (`claude-account-route-env.ts:48`).

`libs/backend/agent-sdk/src/index.ts:452-453` exports `applyClaudeAccountRouteEnv` and `export *` from the prompt gate. `libs/backend/agent-sdk/src/lib/helpers/index.ts:263-264` does the same. Both are type-only against `@ptah-extension/auth-providers-tokens` for the route. Cross-lib imports in the new runtime files use `@ptah-extension/agent-sdk`, `@ptah-extension/shared`, and `@ptah-extension/vscode-core`. No deep import into another lib’s `src`.

`ClaudeCliAdapterContract` and `ClaudeCliCommandOptions` (`cli-adapter.interface.ts:25-37`) extend the existing adapter types. `accountAdmission` is an optional selection request, not an env bag. `supportsMcp = true` matches the other SDK adapters as a class capability; per-run servers still come from `assembleSpawnOptions`.

`ClaudeSdkLaneRunner` and `ClaudeCliAdapter` are registered as class tokens (`di/register.ts:90-101`), with a comment that symbol tokens wait for the Batch 26 roster. The rest of that function uses `CLI_AGENT_RUNTIME_TOKENS`. The class-token exception is local and explained. `accountRoute?: Parameters<typeof buildClaudeLaneEnv>[1]` (`claude-sdk-lane-options.ts:22`, `ptah-cli-spawn-options.service.ts:400`) is accurate and unnamed; `ClaudeAccountRoute` would be the clearer public field type.

`defaults()` in `di/register.ts:122-126` returns only `chatEffort`. The adapter’s `defaults.model` and `defaults.effort` precedence steps are therefore dead in the host. That matches “no hard-coded model id” only if no lane model setting exists yet. It is not a separate finding.

## Decisions

- D13 / Batch 11: throwing when `accountAdmission` is present, and not leasing, is the required fail-closed hold. Not a finding.
- Named env vs the finite selector list: the helper matches `CLAUDE_ACCOUNT_SELECTOR_KEYS`, and the plan names that list. The acceptance “polluted base env cannot override named route” still fails for `CLAUDE_SECURESTORAGE_CONFIG_DIR`, which this SDK reads as the credential namespace. Counted as Blocking rather than deferred certification, because the main and one-shot constructors copy `process.env` and this phase is the last env write.
- Prompt gate one-shot vs a fresh gate object: the batch test treats a follow-up as a new gate. The plan also says the named lane pushes later turns on the same async prompt input. A second gate cannot be substituted into an iterator the SDK has already started. Counted as Serious.
- Account-scoped `getNativeClaudeModels` is owned by a later batch (`batches.md` line 308). `listModels` returning `[]` on failure is the specified unknown catalog. Not a finding.
