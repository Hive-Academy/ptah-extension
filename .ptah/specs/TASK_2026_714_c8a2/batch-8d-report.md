# Batch 8d: VS Code compatible bindings

VS Code retains the legacy SDK chat composition. No production binding or UI change was needed.

## Files (absolute)

- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\apps\ptah-extension-vscode\src\di\expected-resolvable.ts — adds symbol lists for all six host-overridable SDK ports and the derived null adapters/controls/router. Symbols remain separate from the handler-class list whose test names use `.name`.
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\apps\ptah-extension-vscode\src\di\container.smoke.spec.ts — extends the real `registerSdkServices` smoke fixture: every listed token is registered and resolves; optional ports and derived services resolve null; capabilities equal `{ nativeCodex: false }`; every `CODEX_RUNTIME_TOKENS` token is absent, including inherited registrations. Calls the real `wireAgentAdapterAliases` and verifies `TOKENS.AGENT_ADAPTER` selects the legacy SDK token's instance. That instance is a test collaborator, not a constructed full SDK adapter. Existing structured-decision singleton checks remain.
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\apps\ptah-extension-vscode\src\di\rpc-surface.spec.ts — asserts the real derived VS Code RPC surface still serves `chat:sendMessage`, `config:model-switch`, `config:effort-set`, and `config:autopilot-toggle`.
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\apps\ptah-extension-vscode\src\di\surface-composition.spec.ts — pins production phase 2's SDK registration and adapter alias wiring; scans VS Code production TypeScript (excluding specs and the token expectation fixture) for native runtime registration, dev-route plumbing, and host overrides of the six optional SDK ports. Existing surface sharing tests remain.
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8d-report.md — this report.

`phase-2-libraries.ts` was inspected and left unchanged. No edits outside the allowed files; no dependency on the concurrent Electron control-port factory.

## Decisions

1. **Keep LEGACY_SESSION_CONTROL_PORTS unbound by VS Code.** Options: retain SDK null defaults, or bind legacy controls in the host. Evidence: `registerCodexChatServices` supplies null defaults; `SESSION_RUNTIME_ROUTER` remains null without identity/legacy/native controls; `config-rpc.handlers.ts` explicitly falls back to SDK operations plus its own settings persistence for model, autopilot permission, and effort when runtime controls are null. Nothing requires a new host binding. Reversible: a future host composition change can supply ports with dedicated behavior tests.
2. **No devRoute argument or native runtime registration in VS Code.** Options: omit native runtime composition entirely, or register it with a null override. Evidence: grep of VS Code production source found neither devRoute nor native runtime registration; phase 2 calls `registerSdkServices` and `wireAgentAdapterAliases`. Batch 8a M2 forbids a non-null override outside Electron; omission preserves that constraint. Reversible through a separately authorized native rollout. Other hosts were outside this batch's audit.
3. **Retain the existing minimal-container testing boundary.** Options: use SDK registration plus a production-source guard, or bootstrap the complete VS Code extension. The existing smoke fixture isolates platform dependencies; the new assertions use real SDK factories and alias wiring, while the source guard catches accidental VS Code host overrides. This does not claim full extension activation or config RPC end-to-end coverage. Reversible if a complete host fixture becomes available.

## Verification

- Mandatory command: `npm run verify -- -p ptah-extension-vscode`.
- Result: failed. Acquired the FIFO lock after 140 seconds (within the three-minute cutoff); verifier released it after 318.7 seconds of execution. Nx reported 35 tasks, 31 succeeded, 2 cached, 2 failed, and 2 skipped. The shell returned exit 1; the verifier's final line reported exit code 130. No rerun.
- Failures: `@ptah-extension/rpc-handlers:build` and `ptah-extension-vscode:typecheck` both report TS2554 at `libs/backend/rpc-handlers/src/lib/chat/codex-host/native-session-controls.ts:236:41` and `:267:43`: `executeSlashCommand` expects three arguments but receives two. This is concurrent work outside the allowed scope and was not changed. The new Jest assertions were not validated by this run.
- Scope: the npm header showed `node scripts/verify.mjs -p ptah-extension-vscode`; the child command confirmed that single project with `--parallel=1`. Nx did not emit a literal "1 project" header, so that requested header check could not be confirmed. The mandated verifier automatically scheduled dependency builds; no separate build command was invoked.
- Existing failure logs read once, without rerunning: `C:\Users\abdal\.nx\8b7110c7390b9603\cache\terminalOutputs\2081725478399315017` and `C:\Users\abdal\.nx\8b7110c7390b9603\cache\terminalOutputs\2017903782311498720`.
- Lightweight checks: `git diff --check` passed. TypeScript parser check passed for all four changed TypeScript files. Production-source scan passed: no devRoute or native host bindings. These checks do not replace lint, typecheck, or Jest.
- No separate build, serve, dev, e2e, packaging, dependency installation, or direct workspace-wide verification command was run. The team leader must run the deciding verification after the concurrent compile errors are resolved.
