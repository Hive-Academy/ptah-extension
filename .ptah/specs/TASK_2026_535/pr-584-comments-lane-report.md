# PR 584 comments — Codex lane report

## Finding

Valid at the starting HEAD `8561d97d8`; now fixed.
Inspection confirmed that `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:178` originally queued Electron resources, module-resolved packages and APPDATA before the detected-install candidates at original line 216.
The first existing candidate won at original line 225.
`runSdk` replaces the detected binary with this result (current file:572) and probes that selected binary for standalone support (current file:585), so an older fallback could shadow a newer detected installation.

## Changes

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:155`: Document detected-directory and nested opencode-ai priority, followed by the existing fallbacks.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:180`: Move both detected-path candidates before all other candidates; preserve their internal order and every fallback.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.spec.ts:968`: Add portable path fixtures and restore APPDATA alongside the existing Windows/x64 process stubs.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.spec.ts:1011`: Add four parameterized priority and fallback regression cases in the existing resolver describe.

No other adapter behavior changed. Both modified TypeScript files use LF; no new `as any` or `@ts-ignore`.

## Tests

Added and passed:

- `prefers the detected-path candidate in its own directory over module-resolved and APPDATA candidates`
- `prefers the detected-path candidate in nested opencode-ai over module-resolved and APPDATA candidates`
- `falls back to module-resolved when no detected-path candidate exists`
- `falls back to APPDATA when no detected-path candidate exists`

Existing project tests also passed, including both asar-unpacked tests. No old assertion changed: none encoded the old detected-path priority.

## Verification

Scope: **1 project**, `@ptah-extension/cli-agent-runtime`.

Ran `npx nx run-many -t test lint typecheck -p @ptah-extension/cli-agent-runtime --skip-nx-cache`; PowerShell captured combined output and displayed its final 30 lines using `Select-Object -Last 30` (the equivalent of the requested `tail -n 30`).

```text
NX   Running targets test, lint, typecheck for project @ptah-extension/cli-agent-runtime:
- @ptah-extension/cli-agent-runtime
PASS nx run @ptah-extension/cli-agent-runtime:typecheck
PASS nx run @ptah-extension/cli-agent-runtime:test
PASS nx run @ptah-extension/cli-agent-runtime:lint
NX   Successfully ran targets test, lint, typecheck for project @ptah-extension/cli-agent-runtime
Exit code: 0
Run duration: 47.0s
Cache: Skipped (--skip-nx-cache)
git diff --check: passed
```

## Lane-introduced constraints

none

## git status

Branch: `fix/opencode-standalone`; HEAD: `8561d97d8`. No commit, push, branch change, or destructive git command performed.

```text
 M libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.spec.ts
 M libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts
?? .ptah/specs/TASK_2026_535/pr-584-comments-lane-report.md
```

Report written to `D:\projects\ptah-extension\.claude-worktrees\opencode-standalone\.ptah\specs\TASK_2026_535\pr-584-comments-lane-report.md`.
