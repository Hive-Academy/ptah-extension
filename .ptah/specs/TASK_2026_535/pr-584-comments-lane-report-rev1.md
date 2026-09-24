## Changes

Addressed review finding 2 after checking the review against the resolver and its `runSdk` caller.

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:151`: Replace the resolver description with one short paragraph documenting detected-install isolation and fallbacks only without a detected path.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:175`: Return `undefined` immediately for detected `.exe` paths, case-insensitively.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:181`: Return the first existing detected-install candidate, or `undefined`, without consulting Electron resources, module-resolved packages or APPDATA. Those fallbacks remain unchanged when no detected path is supplied.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.spec.ts:1029`: Add native-path preservation tests, revise detected-wrapper expectations, and explicitly test fallbacks without a detected path.

The unchanged `runSdk` code at `opencode-cli.adapter.ts:568` retains `options.binaryPath` when native resolution returns `undefined`. No other adapter behavior was edited.

## Tests

Added and passed:

- `keeps a detected .exe binary even when native candidates exist`
- `keeps a detected .EXE binary even when native candidates exist`
- `keeps a detected .ExE binary even when native candidates exist`
- `falls back to module-resolved when no detected path is given`
- `falls back to APPDATA when no detected path is given`

Changed only the two old assertions that expected a foreign fallback despite an explicit detected path:

- `falls back to module-resolved when no detected-path candidate exists` became `ignores module-resolved when a detected .cmd has no detected-path candidate`.
- `falls back to APPDATA when no detected-path candidate exists` became `ignores APPDATA when a detected .cmd has no detected-path candidate`.

Both now expect `undefined` instead of the foreign candidate so the caller preserves the detected `.cmd`. Both passed. The existing detected-install priority tests and both asar-unpacked tests remain unchanged and passed with the project suite. Tests reuse the existing Windows/x64 stubs and portable path fixtures.

## Not changed

Review finding 1, the scoped `@opencode/cli` / `@opencode/cli-windows-*` package layout, remains a pre-existing follow-up as requested. Package names and candidate layouts were not changed. `runSdk`, `resolveDirectSpawn`, and standalone probing were not changed.

## Verification

Header: **1 project**, `@ptah-extension/cli-agent-runtime`.

Ran once:

```text
npx nx run-many -t test lint typecheck -p @ptah-extension/cli-agent-runtime --skip-nx-cache
```

Combined output was captured and the final 20 lines displayed with PowerShell `Select-Object -Last 20`, equivalent to the requested `2>&1 | tail -n 20`.

```text
PASS nx run @ptah-extension/cli-agent-runtime:typecheck
PASS nx run @ptah-extension/cli-agent-runtime:test
PASS nx run @ptah-extension/cli-agent-runtime:lint
NX   Successfully ran targets test, lint, typecheck for project @ptah-extension/cli-agent-runtime
Exit code: 0
Run duration: 56.5s
Cache: Skipped (--skip-nx-cache)
git diff --check: passed
```

Modified TypeScript files and this report use LF. No new `as any` or `@ts-ignore`; no commit, push, branch change, or destructive git command performed. Starting HEAD was `9f7a1c52c` with a clean working tree.

## Lane-introduced constraints

none
