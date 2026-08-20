# Findings — TASK_2026_193 (code-exec sandbox realm escape)

> Engine actual location: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/code-execution.engine.ts` (not the path quoted in the spec).

## P1 — Exploitability: the "no onward sink" premise is REFUTED. This was a LIVE RCE + secret-exfil path.

Replicated the exact `AsyncFunction` sandbox construction and probed it (Node 24 locally; repo targets Node ≥20). `({}).constructor.constructor` is the host `Function` constructor, which recompiles code in the **host global scope** where `process` is a real global — parameter-shadowing (`process=undefined`) does nothing. What the reachable `process` grants **today**, with **no `require` and no DI container**:

- `process.env` — 74 keys incl. `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` → secret exfiltration, direct read.
- `process.getBuiltinModule("child_process").execSync(...)` — executed a child process, captured stdout (`RCE-A pid=16948`). Stable API since Node 20.16/22.3, loads any builtin **without `require`**.
- `process.binding("spawn_sync").spawn(...)` — spawned a child, status=0 (`RCE-B ok`). Legacy gadget, still works in current Node.
- `process.dlopen` present (native-addon load gadget). `process.mainModule` is `undefined` (ESM), `globalThis.require` is `undefined` — confirming `apps/ptah-electron/esbuild.config.cjs:65` binds `require` locally.

TASK_2026_174's refutation was incomplete: it closed the `require`/container routes but missed `getBuiltinModule` and `binding`, which reach `child_process` directly. `execute_code` runs with **no approval gate** (`protocol-dispatcher.ts:428` → `:1660` calls `executeCode` directly). The surface is prompt-injectable AI-generated code, so this was a live escape, not a latent one.

## P2 — Decision: HARDEN with a genuine `vm` realm + JSON marshaling membrane

Per the task's own escalation rule (P1 found real sinks).

**Rejected:** freezing intrinsics (can't remove `process` from the host global without breaking Ptah; escape recompiles in host scope anyway); worker/child-process isolate as the _immediate_ fix (strongest, but requires serializing the entire deep `ptah.*` tree across a thread boundary — large change, high regression risk). Worker isolate recommended as a defense-in-depth **follow-up**.

**Chosen (contained to the engine):** run code in a fresh `node:vm` context whose global scope has no `process`/`require`/`global`, so `({}).constructor.constructor` resolves to the _context's_ `Function` and the escape dead-ends. `ptah.*` stays usable through a membrane where only one host reference (an argument bridge) crosses, held in a closure that is never a context global (sandbox code cannot name it), and every crossing value is marshaled as a JSON string — no host object/function/promise/Error reference is handed to sandbox code. Every known leak vector (`ptah.constructor.constructor`, method/return-value/prototype/promise `.constructor`, thrown-error `.constructor`, direct `bridge`/`logConsole` access) was empirically attacked — all dead-end. Timers re-provided as context-native wrappers passing/returning only numbers, force-cleared on settle.

**Residual risk (documented):** `node:vm` is a strong barrier against the documented gadgets but is not a provable boundary (V8 contextify bugs have existed historically). Accepted because the input is model-generated (not a live adversary chaining novel V8 CVEs) and the membrane removes every reachable host reference by construction. Escalate to a worker isolate if ever exposed to fully untrusted input.

## Files changed

- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/code-execution.engine.ts` — `executeCode` rewritten to run inside a `vm` realm behind the JSON membrane. Public `executeCode` signature, `wrapCodeForExecution`, `serializeResult` unchanged. Removed dead host-realm `createValidatedProxy`/`createNamespaceProxy`.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/code-execution.sandbox-escape.spec.ts` — new mandatory guard test (acceptance criterion 3). Fails the day host `process`, a working module loader (`require`/`getBuiltinModule`), a spawn capability (`binding("spawn_sync")`), `process.env`, or any host-realm object reference (incl. the `bridge`) becomes reachable from sandbox scope.

## Verification

- `npx nx typecheck vscode-lm-tools` — Success.
- `npx nx test vscode-lm-tools` (full, `--skip-nx-cache`) — 37 suites, 737 tests passed (incl. 10 new escape-guard tests).
- `npx nx lint vscode-lm-tools` — 0 errors (17 pre-existing warnings in unrelated files).
