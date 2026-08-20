---
id: TASK_2026_174
status: done
type: BUGFIX
title: terminal:create spawns an arbitrary renderer-supplied executable
description: The webview supplies params.shell, which reaches node-pty's spawn() with no validation or allowlist. Any code able to issue a terminal:create RPC call can execute an arbitrary binary with the user's privileges and the workspace as cwd. Add a shell allowlist at the RPC boundary with an explicit, documented input-narrowing delta.
assignee:
depends_on: [TASK_2026_171]
executor:
claim:
created: 2026-08-03T00:00:00.000Z
updated: 2026-08-03T00:00:00.000Z
---

## Description

### Origin

Found during the TASK_2026_171 P3 audit and recorded there as risk **R7**. It was deliberately left unfixed across five batches: 171 was a relocation whose binding constraint was "Electron behaviour and test baseline must not change at any phase boundary", and adding validation inside a move commit would have hidden a real behavioural change inside a diff that claimed to be a pure relocation. Filed here so the deferral is a decision with an owner rather than an omission.

### The defect

`TerminalRpcHandlers.registerCreate` passes the renderer-supplied `shell` straight through:

```ts
// libs/backend/rpc-handlers/src/lib/handlers/terminal-rpc.handlers.ts
const cwd = params?.cwd || wsRoot || homedir();
const result = this.ptyManager.create({
  cwd,
  shell: params?.shell, // <- unvalidated, straight from the webview
  name: params?.name,
});
```

and `PtyManagerService.create` hands it to `node-pty`:

```ts
// apps/ptah-electron/src/services/pty-manager.service.ts:81,89
const shell = options.shell || defaultShell();
const proc = pty.spawn(shell, [], { cwd, ... });
```

`pty.spawn` executes that string as a program. There is no allowlist, no path check, no existence check, and no Zod schema on the method at all — `TerminalRpcHandlers` ships no `*-rpc.schema.ts`.

`params.cwd` has the same shape of problem: it is renderer-supplied and used verbatim as the spawn working directory, with no containment to the workspace root.

### Why it matters

The renderer is the Angular webview, which renders AI-generated content. The trust boundary between "content the model produced" and "argv the host executes" is exactly one unvalidated RPC field wide. Impact is arbitrary code execution with the user's privileges — not a privilege escalation, but a full bypass of the reason the webview runs sandboxed with `contextIsolation` at all.

Reachability, to be confirmed in phase 1 rather than assumed: any path that can issue `terminal:create` inherits this. That includes the webview terminal UI and — needs checking — the MCP code-execution surface in `vscode-lm-tools` and any gateway-driven session that can reach the RPC layer.

This is a defect in the currently shipped product. It is not introduced by TASK_2026_171.

### Scope

**Host gating limits blast radius**: `terminal:*` requires the `pty` capability, which is `true` only on Electron (`apps/ptah-electron/src/rpc-host-profile.ts`). VS Code and CLI/TUI leave it off and assert it absent in their `expected-absent.ts`. So this is an Electron-desktop defect, not a VS Code Marketplace one.

### Phases

- **P1 — Establish reach.** Enumerate every caller able to issue `terminal:create`. Confirm or refute the webview / MCP-code-exec / gateway paths. If a non-interactive path can reach it, severity rises and the fix must land before the next desktop release. Deliverable is a reachability table, not prose.
- **P2 — Allowlist + schema.** Add `terminal-rpc.schema.ts` (the lib requires Zod at boundaries; this handler has none). Validate `shell` against a resolved allowlist of known shells per platform, defaulting to the host default when absent. Reject unknown values rather than silently substituting — a silent fallback turns an attack into a confusing UX bug and hides the signal. Contain `cwd` to the workspace root or home.
- **P3 — Regression coverage.** Tests asserting a non-allowlisted `shell` is rejected and never reaches `pty.spawn`, and that `cwd` outside the permitted roots is rejected. Assert against the spawn call, not just the RPC return value.

### Constraints

- **This task deliberately changes accepted input.** That is the point, and it is the one thing TASK_2026_171 could not do. State the narrowing explicitly in the PR: which `shell` values were accepted before and are refused after. A user with an exotic but legitimate shell will notice.
- Do not weaken the allowlist to preserve an existing test. If a test depends on spawning an arbitrary binary, that test encodes the defect.
- `catch (error: unknown)`. Zod at the boundary. No `@ts-ignore`.
- Electron is the only host that serves these methods — do not add `pty` capability to another profile as part of this work.

### Acceptance criteria

1. A reachability table naming every caller that can reach `terminal:create`, each marked confirmed or refuted by inspection.
2. `terminal:create` rejects a `shell` outside the platform allowlist, and the rejection is asserted at the `pty.spawn` call site, not only at the RPC return.
3. `terminal:create` rejects a `cwd` outside the workspace root and home directory.
4. `terminal-rpc.schema.ts` exists and both methods validate through it.
5. The input-narrowing delta is documented in the PR body with before/after accepted values.
6. `rpc-handlers` and `ptah-electron` suites green; cross-project passed-test sum does not decrease.

### Related

- `TASK_2026_171` — origin (risk R7); also filed follow-ups for Zod schemas on `layout:*` / `terminal:*` and the `as unknown as Error` logger casts, which overlap P2 here.
