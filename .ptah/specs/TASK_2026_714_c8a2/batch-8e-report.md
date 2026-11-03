# Batch 8e: CLI legacy composition

## Files (absolute)

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-engine\src\lib\codex-runtime-composition.spec.ts` — created.
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-engine\src\lib\surface-composition.spec.ts` — modified.
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\apps\ptah-cli\src\di\expected-resolvable.ts` — modified.
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8e-report.md` — created (this report).

`libs/backend/cli-engine/src/lib/container.ts` was inspected and left unchanged: its existing bindings already meet this batch's requirements.

## Tests and expectations

- New composition spec, two environment cases (dev switch absent and `PTAH_CODEX_RUNTIME_DEV=1`): runs the public `registerSdkServices` and `wireAgentAdapterAliases` against a child container. Checks all six optional port/capability defaults, null derived native adapter/router/controls, `nativeCodex: false`, and absence of every `CODEX_RUNTIME_TOKENS` registration (including inherited registrations). The agent alias returns the same registered legacy SDK adapter twice without initializing it. Only the process-owning legacy adapter is replaced by an identity sentinel; logger/config-watch/secret-watch collaborators are test doubles. This is a registration test, not full CLI bootstrap or a live SDK session test.
- New composition spec, source contract: checks the production SDK registration precedes alias wiring and scans cli-engine production TypeScript for native bindings, Codex runtime registration, override-reader calls, and devRoute arguments. This includes lane/gateway composition code. No such registration or dev-route use was found by the production-only grep.
- Surface composition spec: resolves the existing surface state and real surface RPC registration with no Codex runtime tokens. Existing round-trip and degraded-host cases remain. Replaced the pre-existing logger double cast with registration/resolution through the test container.
- CLI expectations file: explicitly lists nullable SDK chat/control tokens and the false native capability, separately from the handler-class list (whose consumer uses class names).

## Decisions

1. **Keep LEGACY_SESSION_CONTROL_PORTS host-unbound.** Options: retain the SDK null provider, or add a CLI legacy-control factory. Evidence: `registerCodexChatServices` defaults the port and derived controls/router to null; `ConfigRpcHandlers` has optional runtime controls and branches to existing behavior when they are null (config-rpc.handlers.ts:101,206,351,743). The CLI already uses the legacy SDK alias. No dependency requires a concrete controls port for this batch. Reversible: a future explicitly scoped host migration can supply the factory before first resolution.
2. **No container.ts edit or devRoute argument.** Options: preserve the existing composition, or introduce native registration just to pass null. Evidence: production cli-engine contains no `registerCodexRuntime`, `CODEX_RUNTIME_TOKENS`, `readCodexDevRouteOverride`, or devRoute argument. Existing SDK registration and alias wiring at container.ts:701,770 select the legacy path. The M2 restriction is satisfied by never supplying an override; the DevRouteOverride runtime token is absent. Reversible: future native composition must retain a null override outside Electron and update the explicit source contract.
3. **Test the registration seam instead of full CLI startup.** Options: focused real registration plus source-call-site checks, or bootstrap persistence, messaging, licensing, and SDK processes. Existing CLI composition specs use the focused approach. This keeps verification bounded and checks the relevant DI behavior directly. Limitation: it does not exercise a live chat turn. Reversible: add a full host smoke test in a separately authorized batch.

## Verification

- Required command: `npm run verify -- -p @ptah-extension/cli-engine,ptah-cli`.
- Result: **not run: lock**. Started at 09:48:47 UTC; the single completion check at 09:51:51 UTC showed it still waiting. Interrupted with Ctrl+C at 09:52:05 UTC after approximately 3 minutes 18 seconds; verify confirmed it left the queue (exit 1). Initial queue position was 3 behind `@ptah-extension/chat`; final position was 1 behind `ptah-extension-vscode`. No checks ran. The team leader must run the deciding verification.
- The command echoes exactly the two requested project names. The Nx `2 projects` header never appeared because verification did not acquire the lock; the header could not be confirmed. Tests, lint, and typecheck are unverified.
- `git diff --check -- libs/backend/cli-engine/src/lib/surface-composition.spec.ts apps/ptah-cli/src/di/expected-resolvable.ts` passed. Production-only grep found no native runtime registration/override usage. No forbidden casts or suppression directives remain in the three edited TypeScript files.
- No build, serve, e2e, dependency install, or workspace-wide verification was run. Other writers' files were left untouched.
