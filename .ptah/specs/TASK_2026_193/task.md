---
id: TASK_2026_193
status: done
type: BUGFIX
title: Code-exec sandbox reaches real Node process via constructor.constructor
description: The execute_code MCP sandbox uses AsyncFunction, not a hard sandbox, and does not freeze the realm. ({}).constructor.constructor reaches the real Node process. No onward gadget to a dangerous sink exists today, so it is not currently exploitable, but it is a latent escape running model-influenced code. Assess exploitability and decide harden-vs-accept.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-09T00:00:00.000Z
updated: 2026-08-09T00:00:00.000Z
---

## Description

### Origin

Adjacent finding from the TASK_2026_174 P1 audit (`research-report.md`,
"Adjacent findings" #2, and severity §9 caveat). Filed separately because it is
not the `terminal:create` defect and it is not currently exploitable — but it
is the reason one of 174's REFUTED rows (the MCP code-exec path) is refuted "by
absence of an onward gadget" rather than "by containment", which is a weaker
guarantee worth converting. (Originally filed as TASK_2026_189; re-filed here
after a concurrent session reused that ID.)

### The finding

`libs/backend/vscode-lm-tools/src/lib/code-execution/code-execution.engine.ts:24`
states "we trust our own code". The engine runs `execute_code` payloads via
`AsyncFunction`, not VM2 or a locked realm, and does not freeze intrinsics.
`({}).constructor.constructor` therefore reaches the real Node `process` /
`Function` constructor from inside the sandbox.

`execute_code` is a **model-influenced** surface: the content run there is
AI-generated. So this is untrusted-ish code executing in a realm that is not
actually isolated.

### Why it is not (yet) a live exploit

174's P1 traced why it stops short of a dangerous sink today:

- `require` is not global — esbuild binds it locally
  (`apps/ptah-electron/esbuild.config.cjs:65`), so the sandbox cannot pull in
  arbitrary modules.
- Nothing assigns the DI container onto `globalThis`, so the sandbox cannot
  reach `PLATFORM_TOKENS.PTY_HOST` or other capabilities.

So the escape reaches `process` but has no ready gadget onward to a spawn/FS
sink. That containment is incidental, not designed — a future change that puts
a module loader or a container reference in scope would immediately weaponize it.

### Scope

- **P1 — Exploitability assessment.** Enumerate what `({}).constructor.constructor`
  and the reachable `process` actually expose today (env exfil? `process.binding`?
  `process.mainModule`? event emitters?). Confirm or refute a path to a real sink
  from the current global surface. Deliverable is a reachability finding, not a
  vibe.
- **P2 — Decide: harden or accept-and-document.** Options: a genuine isolate
  (worker/VM boundary), freezing intrinsics + scrubbing the realm, or an explicit
  documented risk-acceptance with a guard test that fails if `require` or the DI
  container ever enters sandbox scope. Given `execute_code` runs AI-generated
  code, lean toward real isolation, but weigh cost.

### Acceptance criteria

1. A written exploitability assessment: what `process` reachability grants today,
   with citations, and whether any onward sink is reachable.
2. A decision (harden vs documented acceptance) with rationale.
3. If accept-and-document: a guard test that breaks the day `require` / the DI
   container / any spawn capability enters sandbox global scope, so the
   "refuted by absence of a gadget" guarantee cannot silently regress.

### Related

- `TASK_2026_174` — origin (P1 adjacent finding #2; the MCP-code-exec REFUTED row
  rests on this containment).
