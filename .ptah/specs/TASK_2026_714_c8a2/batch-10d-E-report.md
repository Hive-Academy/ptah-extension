# Batch 10d.E report

## Summary

Electron binds `CODEX_ADAPTER_FACTORY` before CLI runtime registration. Codex lanes select `CodexAppServerLaneAdapter` by default, use the host's reviewed bundled executable and App Server scope, and own a separate runtime/context per lane open. The chat capability gate still controls chat. Lane profiles use `consumer: 'lane'`; the core profile builder supplies workspace-write for the lane cwd, network access false, and approval policy never. The native adapter's existing approval sink declines requests immediately and emits only kind and a validated tool name. Factory `create()` constructs an adapter only; storage, binary inspection, and process work are deferred.

## Files changed (absolute paths)

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\apps\ptah-electron\src\di\codex-lane-composition.ts` — new host factory, lane profile/home, binary, identity, and scoped runtime ports.
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\apps\ptah-electron\src\di\codex-runtime-composition.ts` — allow a lane scope while keeping the chat gate.
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\apps\ptah-electron\src\di\codex-runtime-composition.spec.ts` — independent lane/chat runtime and approval-sink scope case.
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\apps\ptah-electron\src\di\phase-2-libraries.ts` — register the lane factory ahead of CLI services.
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\apps\ptah-electron\src\di\container.smoke.spec.ts` — production-order fixture and factory selection assertion.
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-detection.service.ts` — unavailable adapter display name `Codex CLI`.
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane-auth.ts` — credential probe accepts the resolved lane home.
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane-auth.spec.ts` — explicit-home precedence case.
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane.adapter.ts` — pass lane home to credential/catalog probes and user MCP discovery.
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane.adapter.spec.ts` — shared-home credential and catalog case.
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-10d-E-report.md` — this report.

## Preserve-row mapping

| Preserve row | Code | Spec evidence |
| --- | --- | --- |
| Resume by session id and account binding | Electron lane composition reuses `createCodexThreadIdentityStore` with `SessionMetadataStore`, reads by thread id, and reuses the stored context id; native adapter validates full identity and retains account callbacks. | Existing native adapter resume/account cases; no new host storage round-trip case. |
| Approval and sandbox selection | Host supplies a separate approval sink; adapter declines requests with kind/name-only output; `consumer: 'lane'` reaches core restricted policy. | Native adapter approval-kind and sandbox cases; Electron scope separation case. |
| Detection | Electron binary probe resolves the same bundled executable and reviewed pin, then uses cached `inspectElectronCodexBinary`; adapter construction does no inspection or spawn. | Electron composition scope no-spawn case; existing native adapter detection cases; new DI selection assertion. |
| Credential | Resolved `CODEX_HOME` is passed to the read-only credential probe; no fallback after an explicit home fails. | New credential explicit-home and adapter shared-home cases. |
| Model selection | Lane model comes from spawn options or the existing Ptah default; catalog opens a separate lane context using the same home and curated fallback stays in the adapter. | Existing native adapter model/catalog cases; new shared-home case. |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Bind native adapter in Electron only | Host DI binding or change shared default | Optional 10c factory preserves other hosts; Electron registers before CLI services. | Yes, remove host binding. |
| Reuse chat's scope factory with a lane consumer parameter | Duplicate runtime registration or extend scope factory | Child container owns each runtime and approval sink; chat gate remains on chat scopes. | Yes. |
| Reuse SDK session metadata for full thread identity | Existing store or new host store | `createCodexThreadIdentityStore` persists full identity and protects binding/generation. | Yes, via port replacement. |
| Pass home through narrow native ports | Global environment fallback or explicit home | Credential, catalog, and user MCP reads now use the profile's selected home. | Yes. |

## Proposed Removals

None.

## Clarifications Needed

None.

## Pattern notes for 10d.C (CLI/TUI) and 10d.V (VS Code)

Bind `CODEX_ADAPTER_FACTORY` before `registerCliAgentRuntimeServices`. Keep `create()` free of process and storage work. Give each lane open a child-owned App Server runtime/context, a `consumer: 'lane'` profile, the selected account home, the host's executable pin, and the existing thread identity store. Pass the same home to credentials, catalog, and user MCP discovery. Keep chat routing gates and scope ownership separate. The native adapter already owns the declining lane approval sink; do not connect parent-chat cards.

## Not done

No tests, typecheck, lint, build, Nx, npm, or diagnostics were run because the task expressly forbids them. The new Electron unit cases have not been executed. A host-level test with an open chat context and a changing lane profile, and a real App Server observation, remain for coordinator verification; the current unit case proves separate runtime and sink instances but does not open a Codex process. CLI skill discovery was unavailable; `.claude/skills/agent-lanes/SKILL.md` was read directly. `rg` was access denied, so source inspection used PowerShell reads.
