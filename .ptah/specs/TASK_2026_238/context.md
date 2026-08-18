# Context — TASK_2026_238

## How this surfaced

A codex CLI lane spawned during TASK_2026_237's requirements phase failed
immediately with exit code 1:

```
[Codex SDK Error] spawn C:\Users\abdal\AppData\Local\Programs\Ptah\resources\app.asar\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe ENOENT
```

The user reported that codex had worked in a recent Tribunal run, so the failure
was verified before being accepted as a defect. It is a real bug on
`ak/tui-defects` — not environmental, and not a stale host build.

## Root cause

`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts:228-235`
builds binary candidates with a hardcoded path segment:

```ts
const relFromOpenAi = path.join(pkgDir, 'vendor', targetTriple, 'codex', binaryName);
```

The binary actually ships at `vendor/<triple>/bin/codex.exe` — confirmed on disk,
298,668,336 bytes, dated Aug 10. **Every** candidate in
`resolveCodexNativeBinary()` carries the same wrong `codex/` segment, so the
function returns `undefined` 100% of the time on this machine, and
`codexPathOverride` is never set (`:475-478`).

`@openai/codex-sdk@0.147.0` then self-resolves. Its `resolveNativePackage()`
(`dist/index.js:453-467`) tries `bin/<binary>` first and `codex/<binary>` only as
a legacy fallback — which is why the reported error path contains `\bin\`, a
string Ptah's own resolver can never emit. That confirms the override was absent.

The resolver was written against the pre-0.147 vendor layout. `package.json:111`
pins `"@openai/codex-sdk": "^0.147.0"`, so a caret bump moved the vendor
directory out from under it.

## Why it looked intermittent

There is one spawn path, not two — `cli-detection.service.ts:38` registers a
single `CodexCliAdapter` instance shared by the Tribunal panel and the
`ptah_agent_spawn` MCP tool. The divergence is packaging, not code.

The SDK fallback lands on a real, spawnable binary whenever `require.resolve`
runs against a real `node_modules` tree (dev Electron, `electron:serve`). It
yields a non-spawnable path where module resolution is not on the real
filesystem. `apps/ptah-electron/electron-builder.yml:52-58` unpacks
`codex-win32-x64/**` via `asarUnpack` precisely because a binary inside
`app.asar` passes `isFile()` through the asar shim but cannot be spawned.

Ptah's resolver exists to hand the SDK a real-filesystem path — its first
candidate does the `app.asar` → `app.asar.unpacked` rewrite. The wrong path
segment disables exactly that safety net. The failure is therefore invisible in
the environment most likely to be used for development.

_Caveat_: the asar leg is inferred from the elided error path prefix, not
directly observed. The root cause in `codex-cli.adapter.ts:228-235` stands
independently of it.

## Fix

`codex-cli.adapter.ts:228-235` — emit **two** relative paths per candidate root,
`vendor/<triple>/bin/<binary>` first and legacy `vendor/<triple>/codex/<binary>`
second, pushing both into `candidates`. The existing `existsSync` loop at
`:315-317` then selects whichever exists, so old and new vendor layouts both
resolve.

Mirror the same change in `opencode-cli.adapter.ts:380-382`, whose fallback
documents itself as following this strategy and carries the same defect.

## Verification

- Unit test pinning that both layout variants are emitted per candidate root.
- `ptah_agent_spawn { cli: "codex" }` succeeds from the packaged app, not only
  from `electron:serve`.
- Confirm the resolved path is under `app.asar.unpacked`, not `app.asar`, in a
  packaged build.

## Related

- Blocks the codex-only CLI delegation mode chosen for **TASK_2026_237**.
- Secondary observation, not part of this fix:
  `dist/apps/ptah-extension-vscode/main.mjs` was dated Aug 10, predating
  `59d9a7aec` (Aug 12) and `d57c9dbb6` (Aug 13). The VS Code host is stale, but
  rebuilding does not fix this defect — the bug is in current source.
