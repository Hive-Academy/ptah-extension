# Task 10d.fix-A — shared cached Codex executable inspection (TASK_2026_714_c8a2, revise round 1)

W = D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration
T = W\.ptah\specs\TASK_2026_714_c8a2

## HARD RULES (read first)

- Do NOT run verify, tests, typecheck, lint, build, nx, npm or ptah_get_diagnostics. Do NOT commit, push or run
  history-changing or discarding git (stash, reset, restore, checkout, clean). The coordinator runs all checks.
- Also apply every rule in T\task-10d-common-rules.md (section HARD RULES).
- Do not convert line endings. Edit only the lines you must change. UTF-8 without BOM.
- Touch ONLY the files in Scope. Other uncommitted changes in W (10d.C, 10d.V) belong to other writers: never
  revert or edit them.

## Objective

Reviews C-1, C-5, V-1 and C-6/V-6 in T\code-logic-review-10d-CV.md ask for ONE host-neutral, cached inspection of
the native Codex executable. Today there are copies: Electron `inspectElectronCodexBinary`
(W\apps\ptah-electron\src\di\codex-runtime-composition.ts:151-197, cached by path/size/mtime, shares in-flight
work, drops failures), `NativeCodexLaneBinaryProbe`
(W\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane-binary.ts), the CLI
probe (W\libs\backend\cli-engine\src\lib\codex-lane-runtime-composition.ts) and `inspectVsCodeCodexBinary`
(W\apps\ptah-extension-vscode\src\di\codex-lane-runtime-composition.ts). Add the shared helper in
`@ptah-extension/codex-runtime`. Do NOT adopt it in any host in this task (later lanes do that).

## Specification

New file W\libs\backend\codex-runtime\src\lib\codex-executable-inspection.ts, exported from
W\libs\backend\codex-runtime\src\index.ts:

```ts
export interface CodexExecutableInspection {
  readonly executablePath: string; // realpath of the input
  readonly sha256: string;         // measured, lowercase hex
  readonly versionOutput: string;  // `codex-cli ${pin.pinnedVersion}` unless readVersion is given
}
export type CodexExecutableInspectionErrorCode =
  | 'codex-executable-missing' | 'codex-pin-unavailable' | 'codex-digest-mismatch';
export class CodexExecutableInspectionError extends Error { readonly code: CodexExecutableInspectionErrorCode }
export function inspectCodexExecutable(
  executablePath: string,
  platform: { readonly platform: string; readonly arch: string },
  options?: { readonly readVersion?: (path: string) => Promise<string> },
): Promise<CodexExecutableInspection>;
```

Rules:
1. Pin from `findCodexExecutablePin(platform.platform, platform.arch)`; none -> error code `codex-pin-unavailable`.
2. `realpath` + `stat` the input; missing or not a file -> `codex-executable-missing` (keep the cause).
3. Cache key: (realpath, size, mtimeMs, pin.binarySha256, pin.pinnedVersion). Concurrent calls with the same key
   share one in-flight promise. A failed inspection is removed from the cache so a later call retries.
   A changed size or mtime gives a new hash (the old entry for that realpath is replaced, so the map does not grow
   without bound).
4. Stream SHA-256 (no full read into memory). Compare case-insensitive with the pin; mismatch ->
   `codex-digest-mismatch`. The error message must name the condition (for example "Codex executable digest does
   not match the reviewed pin") so a log line shows it; never put file contents in the message.
5. `versionOutput`: `options.readVersion` result when given (the Electron path, which spawns `--version` once per
   key), else `codex-cli ${pin.pinnedVersion}` (valid because the digest identifies the build). The value must pass
   `verifyCodexBinary` (W\libs\backend\codex-runtime\src\lib\codex-protocol-manifest.ts:19-35) for a matching pin.
6. Export a test-only reset only if needed for specs; prefer a cache keyed so specs use new tmp files instead.
7. No vscode/electron imports. Node `fs`, `crypto`, `stream` only.

Spec W\libs\backend\codex-runtime\src\lib\codex-executable-inspection.spec.ts (Windows + Linux portable, files
under `os.tmpdir()` via `fs.mkdtemp`, cleanup in afterEach). Mock the pin with `jest.mock` of the pin module or a
pin for `process.platform/process.arch` computed from the fixture bytes. Cases: match returns realpath + digest +
pin version line; a second call does not re-read (spy on the hash or count `readVersion` calls); two concurrent
calls share one read; size/mtime change re-hashes; mismatch -> code `codex-digest-mismatch` and a retry after the
file is fixed succeeds; missing file -> `codex-executable-missing`; no pin -> `codex-pin-unavailable`;
`readVersion` output is returned.

## Scope (only these files)

- W\libs\backend\codex-runtime\src\lib\codex-executable-inspection.ts (new)
- W\libs\backend\codex-runtime\src\lib\codex-executable-inspection.spec.ts (new)
- W\libs\backend\codex-runtime\src\index.ts (one export line)

## Deliverable

**Deliverable**: D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-10d-fix-A-report.md
Write it early as a skeleton. Content: files changed, the exported API, how each rule 1-7 is met (file:line),
`## Decisions`, anything not done. Reply `WROTE: <path>` plus one headline line.
