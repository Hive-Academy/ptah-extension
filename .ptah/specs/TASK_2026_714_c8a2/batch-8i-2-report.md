# Batch 8i-2: native Codex local start probe (D7)

Written only. The probe, Codex executable (including --version), typechecker, diagnostics, tests, builds and Electron were NOT run. No model turn was requested. The coordinator owns execution and verification; this report does not claim a typecheck pass or a D7 reproduction.

## Files written

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/scripts/codex-start-probe.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/scripts/codex-start-probe.tsconfig.json
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-8i-2-report.md

No other files were written. In particular, the existing uncommitted `CodexProcessFailureError` export in `libs/backend/codex-runtime/src/index.ts` is KEPT, unchanged: the probe imports that class from `@ptah-extension/codex-runtime` and uses it to extract the failed protocol method.

Pre-existing work observed and left untouched: changes to `.ptah/specs/TASK_2026_714_c8a2/batches.md`, `.ptah/specs/TASK_2026_714_c8a2/decisions.md`, and the runtime index, plus the untracked `batch-8i-1-report.md`. No commit or other git mutation was performed.

## Probe walkthrough

Paths below are relative to W = D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration.

1. `scripts/codex-start-probe.ts:1` documents both commands; `:66` parses --codex, --cwd, --model and --no-user-mcp. Invalid arguments fail without echoing their values.
2. `scripts/codex-start-probe.ts:81` uses the shared native resolver directly from its leaf module, avoiding the Electron composition module and agent-sdk barrel. It mirrors the Electron dev ancestor search for node_modules and realpath containment check. An absolute --codex override bypasses bundle containment, but never the reviewed digest/version checks.
3. `scripts/codex-start-probe.ts:160` loads the platform pin, hashes the executable before executing it, compares SHA-256, then reads --version with a ten-second timeout and verifies its exact identity. Raw execFile failure output is deliberately withheld because Node may embed child stderr in its error message.
4. `scripts/codex-start-probe.ts:173` snapshots realpaths and missing paths like the host and invokes the real buildCodexExecutionProfile. CODEX_HOME comes from the environment or homedir()/.codex; the builder performs the shared normalizeCodexHomeKey normalization, including Windows lowercasing. The cwd defaults to process.cwd().
5. `scripts/codex-start-probe.ts:105` reads only MCP table names from config.toml for suppression; it never prints configuration values. `:123` implements the process port, rechecks launchGuard.fileContents immediately before spawn, and appends native overrides to the requested app-server args. It preserves the requested cwd/environment/arguments and detached flag, uses hidden windows and piped stdio, and returns whenSpawned. Failed/unreadable guards produce an ELAUNCHGUARD error event with no OS child. Unsupported file identity guards are refused.
6. `scripts/codex-start-probe.ts:195` supplies an in-memory identity store retaining inactive identities and comparing complete identity fields before deactivation. `:204` constructs the real CodexRuntime with this store, a deny-all approval sink, Date.now and disposable timers, and a logger that prints debug/info/warn/error immediately. An unexpected approval prints a diagnostic and sets exit code 1.
7. `scripts/codex-start-probe.ts:211` calls only runtime.open(profile), exercising initialize and thread/start through the real runtime. `:214` closes the context and runtime in nested finally blocks, including failed opens. There are no turn, steer, compact or resume calls. Success reports only the first eight thread-id characters and elapsed milliseconds beyond the step status lines.
8. `scripts/codex-start-probe.ts:25` prints sanitized flat runtime logger metadata as received. `:31` prints failure class/message, failedMethod, rpcCode, class/message-only cause chain and runtime-provided bounded redacted stderrTail (2048 bytes on the runtime error log). Unavailable method/code are explicit, stderr is empty before process diagnostics exist, non-Error values are omitted, and SyntaxError excerpts are withheld. `:52` prints START and OK/FAIL per step. Exit code is 0 on success or 1 on failure.
9. `scripts/codex-start-probe.tsconfig.json:1` extends the base paths configuration, selects CommonJS/node resolution, strict mode and Node types, and includes only this probe as a root file. Imported dependencies necessarily participate in typechecking. No emitted files or new dependencies are required.

## Exact commands

Run the two variants separately, from W. Optional --model <model-id>, --cwd <directory>, or --codex <absolute-native-binary> can be appended identically to both commands.

PowerShell:

```powershell
Set-Location 'D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration'
npx ts-node --transpile-only -P scripts/codex-start-probe.tsconfig.json -r tsconfig-paths/register scripts/codex-start-probe.ts
npx ts-node --transpile-only -P scripts/codex-start-probe.tsconfig.json -r tsconfig-paths/register scripts/codex-start-probe.ts --no-user-mcp
```

Bash on Windows (Git Bash):

```bash
cd 'D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration'
npx ts-node --transpile-only -P scripts/codex-start-probe.tsconfig.json -r tsconfig-paths/register scripts/codex-start-probe.ts
npx ts-node --transpile-only -P scripts/codex-start-probe.tsconfig.json -r tsconfig-paths/register scripts/codex-start-probe.ts --no-user-mcp
```

Team-leader typecheck command, NOT executed by this agent:

```text
npx tsc --noEmit -p scripts/codex-start-probe.tsconfig.json
```

## Decisions

- **Real host profile builder, isolated identity.** The host implementation at `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:227` supplies session identity, provider/workspace, home, cwd, model and optional presentation fields to buildCodexExecutionProfile. This probe uses a random context ID, consumer chat, providerId codex and workspaceId equal to the requested absolute cwd. It does not load Ptah's stored workspace provider/account selection. Those identity fields do not change initialize/thread/start parameters. No resume identity is supplied.
- **Fresh ask defaults.** The real builder supplies granular sandbox/rules/skill/permissions/MCP approvals, read-only sandbox, no network access and user approvals reviewer for permissionLevel ask. MCP servers, attachments and instruction sources are empty. Effort, enhanced prompt and output style remain absent. The system prompt is the allowed short placeholder. The optional Ptah UI fence/developer prompt is omitted because the probe has no UI or Ptah tools. These presentation fields are the intentional deviations from a fully prepared Electron chat.
- **Model fallback.** Model is required by the builder. Without --model the probe uses gpt-6.1-sol, matching the current first static Codex model used by resolveNativeCodexModel for default/unrecognized model requests (`libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts:268`, `libs/shared/src/lib/providers/entries/codex-provider-entry.ts:45`). An explicit --model is passed as an exact native ID without the host's catalog/tier remapping. To match the live-test selection, append `--model gpt-5.6-luna` to both commands. No model turn is sent.
- **Native MCP suppression.** Only the variant appends repeated `-c mcp_servers.NAME.enabled=false` to app-server args. The baseline uses unmodified args. Evidence from the pinned rust-v0.155.1 sources: [CliConfigOverrides](https://raw.githubusercontent.com/openai/codex/rust-v0.155.1/codex-rs/utils/cli/src/config_override.rs) defines global, repeatable -c/--config overrides, dotted paths, and TOML boolean values; [MCP configuration types](https://raw.githubusercontent.com/openai/codex/rust-v0.155.1/codex-rs/config/src/mcp_types.rs) defines the server enabled setting. This changes the child's effective native configuration without changing CodexRuntime.open, library code, config.toml, home, or authentication. Server names alone are printed.
- **Header-only limits.** The regex handles bare and simple single/double-quoted alphanumeric/underscore/hyphen server names and bare nested subtables. Ambiguous dotted or escaped quoted names are refused instead of silently emitting a wrong override. It is deliberately not a TOML parser: inline MCP maps, quoted mcp_servers root keys and servers from other config layers are outside this variant's scope. A missing config.toml means zero names; other read errors fail. The specified D7 node_repl and ptah headers are supported. The file is read to scan headers but no values or file contents are logged. Native config-layer precedence and actual suppression remain for the coordinator to observe.
- **Spawner scope.** A direct Node spawn is appropriate for this dev-only synchronous probe of a verified native executable; no wrapper, PATH command or Electron binary is launched. It does not implement the production worker-thread offloading or generic .cmd resolution. Unsupported guard kinds are refused. Hash checks retain the host guard's normal non-atomic check-before-spawn semantics. The user's real home remains in use, so native thread/start may persist native thread metadata; the Ptah identity store is memory-only.
- **Existing error export retained.** No index edit was needed. Error messages reuse the runtime redactor, parser excerpts are suppressed, and the sanitized logger tail supplies stderr diagnostics without exposing raw child streams.

## Not done

No execution, typecheck, lint, tests, diagnostics, build, Electron launch, package operation, installation, live model request or D7 behavior fix. Source inspection and writing only. The only reviewed executable pin currently in the repository is win32/x64 0.155.1; unsupported platforms fail before executing the binary. The report file is written as the explicitly requested deliverable in addition to the source/config scope.
