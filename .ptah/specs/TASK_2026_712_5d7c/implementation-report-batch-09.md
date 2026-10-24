# Batch 09 implementation report

Implemented the shared native lane option, permission and stream/handle seams. The existing registry now calls both seams. Verification is pending CI; no test/build/lint/typecheck commands were run.

## Files changed

- D:/projects/ptah-extension/.claude-worktrees/provider-accounts/libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-options.ts
- D:/projects/ptah-extension/.claude-worktrees/provider-accounts/libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts
- D:/projects/ptah-extension/.claude-worktrees/provider-accounts/libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/provider-accounts/libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts
- D:/projects/ptah-extension/.claude-worktrees/provider-accounts/libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.service.ts

The only additional written file is this requested report. No task status, existing spec, mailbox implementation, SDK runner, registration or host feature was edited. No git commands, network requests or real provider binaries were run.

## Extraction map

Ranges refer to the registry as read at the start of this lane (the plan's older ranges had shifted).

| Old source/range | New symbol / responsibility |
| --- | --- |
| Registry 752?890 | `buildClaudeSdkLaneOptions`: stderr classification, replay/name args and complete effective SDK options |
| Registry 1352?1408 | `resolveClaudeLanePermissionOptions`: exact level mapping, safe session parsing, lazy agent resolver and raw routing hint |
| Registry 891?998, abort listener 748?750 | `ClaudeSdkLaneRunner.run`: query launch, one stream loop, pending turns, owner settlement gate, session replay, handle callbacks, continuation and cleanup |
| Registry env assignment at 880 | `buildClaudeLaneEnv` in spawn-options service: `applyClaudeAccountRouteEnv(buildSafeEnv(authEnv), accountRoute)` |

Registry keeps configured provider/key/tier resolution, capability/harness preparation, assembly, seeded `createPromptMailbox(task)`, callback infrastructure and plan-limit construction. The runner receives the complete effective options, caller-owned mailbox, callbacks and lifecycle context. No `PtahCliConfig` is accepted or manufactured by either seam. `runInteractive` is untouched. Registry is shorter than before extraction; all three new files are below 400 lines.

## Native option parity (acceptance 1)

| Concern | Preserved path | New spec evidence |
| --- | --- | --- |
| MCP | `assembly.mcpServers` forwarded unchanged, including Ptah | complete native options; continuation only and Ptah MCP |
| Hooks | `assembly.hooks` forwarded by identity | complete native options |
| Role / system prompt | assembly content, standalone or claude_code preset append | complete native options; standalone role content |
| cwd / model / effort | caller values retained | complete native options |
| Output style | same `buildFlagSettingsArg`, absence preserved | complete native options; omitted output-style |
| Strict policy | same capability-isolation spread and capability flags | complete native options |
| Settings | same flag builder, crossSessionInbound accept, auto-compact and capability flags | complete native options |
| extraArgs / name | replay flag and same session-name builder inputs | complete native options |
| Replay / resume | replay-user-messages null flag, optional resume | complete native options; missing resume |
| Persistence | includePartialMessages and persistSession true; same settingSources | complete native options |
| Executable / spawn ownership | supplied CLI path and injected processSpawner | complete native options |
| stderr | same classifier callback supplied to SDK and processSpawner | complete native options |
| Account env hook | named route applied after safe env; no later env spread | named routing after safe env |

## Specs by acceptance item

All new specs live in `claude-sdk-lane-runner.spec.ts`. These are written assertions, not a claim that the suite passed.

1. `preserves complete native options without a PtahCliConfig`; `preserves standalone role content, missing resume, and omitted output-style`; `applies named routing after safe env and never overwrites it`.
2. Parameterized `maps %s explicitly to %s, bridging every non-YOLO level` covers yolo, auto-edit, ask and plan. `routes permissions through the safe-parsed resume session ahead of parent` covers precedence. Named routing does not grant a bypass.
3. `settles each queued turn once and waits for quota ownership`; `replays the resolved session, forwards stream callbacks and attaches lazy agent identity`; `closes on abort and settles pending turns with cleanup when the stream ends`; `settles pending turns on unexpected stream rejection`.
4. `forwards effective options and seeded mailbox with continuation only and Ptah MCP` asserts continuation true, absent steer/interrupt, interrupt capability false, and Ptah MCP retained in effective options. Adapter-level supportsMcp declaration is outside this batch's owned files; this extraction does not disable or change it.
5. `preserves complete native options without a PtahCliConfig` constructs the independent typed input directly; runner fixture likewise uses only effective options and lifecycle context.

Existing registry specs remain unchanged, including permission-routing, capabilities, output-style, auto-compact, off-thread spawn, inbound-peer and plan-limit suites.

## Decisions

- **Runtime-local plain class and pure option functions.** Options: new DI service/registration or per-spawn plain class. Evidence: plan 164?172 explicitly requires runtime-local seams; PtahCliStreamLoop already uses a per-spawn plain class. Selected plain class with injected constructor dependencies, without registration changes. Reversible.
- **Use existing public agent-sdk dependency.** Options: reuse public helper or introduce a new dependency. Evidence: original registry imports SDK types, buildSafeEnv, permission handler and loader from `@ptah-extension/agent-sdk`; that barrel exports `applyClaudeAccountRouteEnv`. Reused the existing dependency direction. Reversible.
- **Keep callback storage and seeded mailbox caller-owned.** Options: move creation into runner or preserve caller ownership. Evidence: plan explicitly gives runner caller-owned prompt and stream callbacks; existing mailbox seeds its queue synchronously. Runner accepts that mailbox unchanged and closes it on abort/end. Reversible.
- **Release abort listener on terminal completion/startup failure.** The previous anonymous listener could not be removed; the extracted runner uses a named once-listener and removes it when done. SDK abort still owns child termination, with no invented PID or interrupt capability. This fulfills batch cleanup requirements without changing turn verdicts. Reversible.
- **Leave verification to CI when diagnostics unavailable.** Explicit task forbids nx/jest/tsc/lint/build. No native fallback compiler/test was run.

## Verification and limitations

- Applied the installed Prettier parser/formatter to owned TypeScript files; parsing succeeded.
- `ptah_ast_analyze` on extracted options reported parseStatus ok and zero error nodes.
- Scoped `ptah_get_diagnostics` requests for the changed files repeatedly returned unavailable: TypeScript check still running after 45 seconds, files unchecked. This is NOT a clean diagnostics result. No further polling loop was used.
- Source inspection caught and corrected the spec spawn fixture's required AbortSignal and supplied the full capability-list fixture before delivery.
- No existing or new Jest specs were executed. CI must typecheck and run the new lane specs plus unchanged registry regression specs before declaring acceptance verified.
- Named-route admission/certification and first-class Claude adapter wiring belong to later batches. The typed env hook is ready for their admitted route; configured registry calls retain their existing auth behavior.
- No other unfinished implementation item is known within this batch's owned scope.
