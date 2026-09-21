# Implementation notes — TASK_2026_515_b7c3

## What was confirmed first

`context.md` asked me to confirm the premise rather than trust it. I did:

- `BackgroundAgentCompletedEvent` exists at
  `libs/shared/src/lib/types/execution/stream-background.ts:68-84`. It requires
  `toolCallId` ("Links to the parent Task tool_use"), is documented as emitted
  when "the SubagentStop hook fires", and carries `result`, `cost`, `duration`
  and `tabId`. Nothing in `libs/backend/**` constructs it for a CLI lane.
- The producer search agrees: the only CLI-lane lifecycle broadcast is
  `MESSAGE_TYPES.AGENT_MONITOR_EXITED`, sent from
  `libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts` — and that
  wiring returns early when `TOKENS.WEBVIEW_MANAGER` is not registered, so it
  cannot be the mechanism for a headless host.

## The transport, and why the mechanism was not ambiguous

I did not write an `implementation-plan.md`. The repository gave a clear steer,
so setting out options would have been theatre: `AgentReportRouter`
(`libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-report-router.service.ts`)
already drives a chat session from this exact lib, in the child → parent
direction, through `IAgentAdapter.sendMessageToSession`
(`libs/shared/src/lib/types/ai-provider.types.ts:330`). Its own header states
the reasoning: "No new port and no new lib: `IAgentAdapter` already carries both
`isSessionActive` and `sendMessageToSession`".

So `LaneCompletionNotifier`
(`libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts`)
uses the same transport and the same `<...>` envelope shape, and the
orchestrator meets one mental model for "something arrived from a lane".

**Why not the existing event.** `background_agent_completed` does not fit, and I
did not bend it:

1. It is keyed on `toolCallId`, the id of the `Task` tool call that spawned an
   SDK subagent. A CLI lane has no `Task` tool call.
2. Its producer is the SDK `SubagentStop` hook. A rival CLI process raises no
   SDK hook.
3. Its consumer is the webview tray
   (`libs/frontend/chat/.../background-agent-tray.component.ts`), reached by a
   webview broadcast. A signal that needs an open webview is not a solution —
   `context.md` said so, and the CLI host has no webview at all.
4. It carries no CLI, no exit code and nothing about deliverables, which is the
   half of the signal the task actually asked for.

**No RPC namespace was added**, so the dual-registration rule did not apply. I
verified the runtime guard anyway: `ALLOWED_METHOD_PREFIXES` is at
`libs/backend/vscode-core/src/messaging/rpc-handler.ts:44` in this worktree, not
`:46` as `context.md` says — the array opens on line 44 and `'session:'` is line
45. Nothing there needed changing.

## What the signal carries

`LaneCompletionSignal` (`libs/shared/src/lib/types/agent-process.types.ts`):

| Field | Why it is there |
| --- | --- |
| `agentId`, `cli`, `agentLabel`, `role` | Which lane, in words a person and a model both recognize |
| `status`, `exitCode` | The process outcome — necessary, not sufficient |
| `startedAt`, `completedAt`, `durationMs` | How long it ran |
| `taskFolder`, `taskHeadline` | What it was asked to do |
| `deliverables[]` | Per declared path: `exists`, `bytes`, `writtenAfterSpawn` |
| `verdict` | `delivered` / `no-deliverable` / `unverified` / `failed` |
| `reportsDelivered` | How many `ptah_agent_report` bodies reached the parent |
| `cliSessionId` | Present when a resume is possible |

`verdict` is the field the orchestrator acts on, and it is what makes the known
hazard visible: a lane that exits 0 without writing a declared deliverable is
`no-deliverable`, and the envelope says "treat the task as NOT done ... Do not
report this lane as complete." An existing but zero-byte file counts as missing,
and a file whose mtime predates the spawn is flagged `NOT written by this run`.

Deliverables are declared per spawn with the new `deliverables` parameter. When
nothing is declared the verdict is `unverified` — deliberately not `delivered`,
and the envelope asks the caller to declare them next time.

## How the three hosts are covered

`LaneCompletionNotifier` is registered in `registerCliAgentRuntimeServices`
(`libs/backend/cli-agent-runtime/src/lib/di/register.ts`), which is the ONE
function all three hosts call:

- VS Code — `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:201`
- Electron — `apps/ptah-electron/src/di/phase-2-libraries.ts:255`
- Headless CLI — `libs/backend/cli-engine/src/lib/container.ts:677`

All three call `registerSdkServices` (which registers `TOKENS.AGENT_ADAPTER`)
BEFORE that line — 149, 183 and 629 respectively — so the notifier's optional
adapter injection is satisfied in every host. Nothing in the path touches a
concrete platform adapter: the filesystem is reached through
`PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER`, a `platform-core` port.

The manager calls the notifier from every terminal path: `handleExit`,
`handleTimeout` and `stop()`. The timeout call is made BEFORE the kill, because
on the SDK path the kill is an abort whose `done` promise is what reaches
`handleExit` — an adapter that never settles it would otherwise leave a timeout
unsignalled, which is the silence this task exists to end. The duplicate guard
is keyed `${agentId}:${completedAt}`, so those two paths collapse to one signal
while a continued lane's second ending is signalled as the new event it is.

One behaviour change went with it: `stop()` now stamps `status: 'stopped'`
before `killProcess` instead of after. With the stamp after the kill,
`handleExit` ran first, saw `status === 'running'` and relabelled a
user-requested stop as `failed` — on the record as well as on the signal.

## Prompts and skill (part 2)

- `renderLaneCompletionContract`
  (`libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-reporting-contract.ts`)
  is ONE text with two call sites: `buildTaskPrompt` for every rival CLI
  adapter, and the `ptahCliId` branch of `agent-namespace.builder.ts` for Ptah
  CLI lanes, whose task string goes to the SDK verbatim and never reaches
  `buildTaskPrompt`. It names the declared deliverables and tells the lane to
  call `ptah_agent_report` before its final message.
- `ptah_agent_spawn`'s description now says the caller does not need to poll,
  describes the pushed signal and the `no-deliverable` verdict, and documents
  `deliverables`. `ptah_agent_report`'s description asks the lane to report once
  before exiting.
- `ptah-system-prompt.constant.ts` replaces the poll step of its workflow
  example with the push signal, adds a verdict table and a worked
  `deliverables` example.
- `.claude/skills/agent-lanes/SKILL.md` §4 is rewritten around the signal, with
  the verdict table and a "do not poll in a loop" rule. **Poll-based reading is
  kept, not deleted**, with the three cases it is still needed for: no signal
  arrived (the refusal reasons), an adapter that reports nothing useful
  (`opencode` has no messaging support at all), and any verdict other than
  `delivered`. §2 documents `deliverables`, §3 adds "report before exiting", §5
  adds the `no-deliverable` recovery row.
- `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/agent-lanes/SKILL.md`
  was byte-identical to the repo skill before this change and is kept in step.

## Verification actually observed

Run from this worktree, with `--skip-nx-cache`:

```
npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools
  → Successfully ran target test for 3 projects
    (cli-agent-runtime alone: 63 suites passed, 986 passed / 1 skipped)

npx nx run-many -t lint typecheck -p @ptah-extension/shared @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools
  → Successfully ran targets lint, typecheck for 3 projects

npx nx run-many -t typecheck -p @ptah-extension/rpc-handlers @ptah-extension/cli-engine ptah-extension-vscode ptah-electron ptah-cli
  → Successfully ran target typecheck for 5 projects
```

New tests:

- `lane-completion-notifier.service.spec.ts` — normal completion, failure,
  timeout, stop, **exit 0 with a missing deliverable**, exit 0 with an EMPTY
  deliverable, a partially-written set, a stale artifact from an earlier run, an
  unreadable deliverable, every refusal reason, the one-signal-per-ending rule,
  and the envelope's escaping.
- `agent-process-manager.service.spec.ts` › `lane completion signal` — the
  manager signals on completion, failure, timeout and stop, carries the declared
  deliverables, and passes the delivered-report count.
- `cli-adapter.utils.spec.ts` — the contract names every declared deliverable.
- `agent-report-router.service.spec.ts` — a DELIVERED report is counted, and a
  refused one is not.

## What I could not verify

- **No end-to-end run.** I did not spawn a real CLI lane and watch a real
  `<agent-lane-completed>` turn land in a real session. That needs an installed
  CLI, an authenticated provider and a live host, none of which exist in this
  worktree. Everything above is unit-level plus a type check across the three
  hosts' composition roots.
- **Whether a lane actually obeys the contract.** The prompt text asks each lane
  to call `ptah_agent_report` before exiting. Whether a given vendor's model
  does so is a measurement, not a guarantee — which is why the mechanism does
  not depend on it: the signal fires from the process manager whether the lane
  reports or not, and `reportsDelivered: 0` is how the orchestrator learns the
  lane said nothing.
- **Real filesystem behaviour of the deliverable check.** The specs use a fake
  `IFileSystemProvider`. `mtime` semantics on a network drive, and the exact
  `stat` failure modes of each platform adapter, are untested here.
- **The Ptah CLI branch's appended prompt was not observed on a live spawn.**
  The builder spec pins that the registry receives `task + contract`, but no
  real Ptah CLI agent was started.
