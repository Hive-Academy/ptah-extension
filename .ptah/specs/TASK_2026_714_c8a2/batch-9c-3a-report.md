# Batch 9c-3a: Codex approval presentation extraction

## Changes

- Moved pending prompt correlation, timer cleanup, attention release, lifecycle publication, and native decline handling from `codex-chat-host-ports.ts:244-356` to `codex-chat-approval-presentation.ts:42-125`.
- Moved card presentation, the 60-second unroutable deny timer, dismissal, and cancellation from old `codex-chat-host-ports.ts:544-662` to `codex-chat-approval-presentation.ts:126-213`. The system-abort reason formerly at old lines 133-142 is built at new lines 170-175.
- Moved permission response handling, including the `aborted` lifecycle event for rejected or throwing router replies, from old `codex-chat-host-ports.ts:663-728` to `codex-chat-approval-presentation.ts:214-249`.
- `createCodexChatHostPorts` now composes the presentation at lines 225-244 and wires its two methods at lines 429-430. Its exported names, returned shape, and native Ptah MCP attachment remain in place. The router, `tabId`, lifecycle, attention, and messaging ports read host dependencies at call time, preserving existing live lookups.

## Ports

`CodexApprovalPresentationPorts` supplies `logger`, `approvals.respond`, `tabId`, `broadcastMessage`, optional `promptLifecycle.publish`, optional `hostAttention.resolve`, `setTimer`, and `clearTimer`. The factory returns `presentation` plus `handlePermissionResponse`.

## Files and evidence

| File | Final raw lines |
| --- | ---: |
| `codex-chat-host-ports.ts` | 450 |
| `codex-chat-approval-presentation.ts` | 252 |
| `codex-chat-approval-presentation.spec.ts` | 161 |

The new spec covers timeout denial and `timed-out` publication; accepted responses and `allowed` publication; rejected and throwing responses and `aborted` publication; and timer removal when taking a dismissed prompt. The existing host-port spec was left unchanged. The source files were checked for UTF-8 without BOM and LF line endings. The host diff shows no edit to the native profile's Ptah MCP block. No Nx, Jest, TypeScript, lint, build, or diagnostics command ran, per lane rules; the coordinator owns execution checks.

Skill discovery was available through the workspace CLI skill directory. I read `agent-lanes`, the matching lane mechanics skill; no locally invocable TypeScript refactoring skill was available.

## Behavior risk

Execution checks remain pending with the coordinator. The extraction keeps the original ordering of state removal, attention release, native response, UI message, and lifecycle publication. The only meaningful risk is an integration mismatch that static review cannot expose until the coordinator runs the existing and new specs.
