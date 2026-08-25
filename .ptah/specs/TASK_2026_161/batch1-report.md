# TASK_2026_161 — Batch 1 Implementation Note

Scope: single file `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts` (items A + B from issue #430). No other files touched. No git.

## Item A — Eliminate concurrent-opencode.json race via OPENCODE_CONFIG_CONTENT

- Deleted `configureMcpServer`, `cleanupMcpEntry`, and the static `mcpConfigPath` methods.
- Removed the top-of-`runSdk()` `configureMcpServer(...)` await block.
- Removed the end-of-`runSdk()` `done.then(() => cleanupMcpEntry(...))` block.
- Added private helper `buildMcpConfigContent(port: number): string` returning
  `JSON.stringify({ mcp: { ptah: { type: 'remote', url: 'http://localhost:${port}', enabled: true } } })`.
- In `runSdk()` built `const env: NodeJS.ProcessEnv = {}` and set
  `env['OPENCODE_CONFIG_CONTENT']` from the helper when `options.mcpPort` is present,
  then passed `env` into the existing `spawnCli(binary, args, { cwd, env })` call.
  `spawnCli` already merges `options.env` over `process.env` + `CLI_CLEAN_ENV`
  (cli-adapter.utils.ts:56), so no spawn plumbing changed.
- Removed now-unused `writeFile` from the `fs/promises` import; kept `readFile`
  (still used by `ensureTokensFresh`, line 308). `join` from `path` still used by
  `authPaths` (lines 289/293) — kept.
- Updated the class header doc comment (MCP-config bullet) and the `supportsMcp`
  field comment to describe the per-process `OPENCODE_CONFIG_CONTENT` approach.

## Item B — Make Windows native-binary fallback reachable

- Replaced the `if (!options.binaryPath)`-gated `resolveOpencodeNativeBinary()`
  call with an unconditional `resolveOpencodeNativeBinary(options.binaryPath)`
  (detected path passed as a resolution hint), overriding `binary` only when a
  native `.exe` is found — mirroring `CodexCliAdapter.resolveCodexNativeBinary()`.
- Updated the adjacent comment: no longer "used only when no explicit path was
  provided"; now describes always attempting native resolution and preferring the
  native `.exe` when it exists (rationale: open upstream #28920/#36737).

## Verification

- `npx tsc --noEmit -p libs/backend/cli-agent-runtime/tsconfig.lib.json` — passed, no output (no type errors).
- Grep for `configureMcpServer|cleanupMcpEntry|mcpConfigPath|writeFile` in the file — no matches (no dangling references, no unused import).

## Deviations

None. Implemented exactly as specified.
