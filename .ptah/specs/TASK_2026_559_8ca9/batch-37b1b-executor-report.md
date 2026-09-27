# Batch 37b1b executor report: formatter rendering and spawner adapter proof (Lane K)

Worktree `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-k`, branch `fix/task-559-lane-k`. Base: fe3648eff plus
the uncommitted 37b1a changes (WI and PC), which were not edited. No git command changed state. The tree is left dirty.

`MCP` = `libs/backend/vscode-lm-tools/src/lib/code-execution`.

## Files

| Status   | File                                                         | Change |
| -------- | ------------------------------------------------------------ | ------ |
| MODIFIED | `MCP/mcp-core/mcp-response-formatter.ts`                     | Reads `goVet`, `unmappedFindings` and `diagnosticsTruncated` from the payload, checks them (fail closed), and names each as a Coverage-line qualifier. Adds a `**Go vet:**` line right under the Coverage line on all three arms |
| MODIFIED | `MCP/mcp-core/mcp-response-formatter.spec.ts`                | New describe block with 68 cases, including the FB case and a real budget-cut case |
| MODIFIED | `MCP/types.ts` (deviation 1)                                 | `DiagnosticsPayload` gains optional `goVet` (`DiagnosticsCoverageFields['goVet']`), `unmappedFindings` and `diagnosticsTruncated` |
| MODIFIED | `MCP/namespace-builders/core-namespace.builders.ts` (deviation 1) | Forwards the three fields on both arms. `diagnosticsTruncated` is forwarded only when it is true |
| MODIFIED | `MCP/namespace-builders/core-namespace.builders.spec.ts` (deviation 1) | 3 cases: forwarding on each arm through to the formatter, and the fields left out when absent |
| MODIFIED | `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.spec.ts` | Windows case for an absolute `go.exe`: runs the file directly, with no `cmd.exe` |

## Task 37b1b.1: rendering

- **Coverage-line qualifiers.** They are built in `checkerQualifiers`, next to the coverage reasons, so any one of
  them makes `bare` false:
  - `go vet not run (<code>)` or `go vet failed (<code>)` when the status is not `checked`.
  - `go vet limitation (<code>)` for a checked run that carries a reason. This is skipped for `unmapped-findings`
    when the count is present, because the count is already named.
  - `N go vet findings could not be placed in the workspace (not listed)`. It says "checker" instead of "go vet" when
    no `goVet` is present.
  - `diagnostics truncated: the go vet listed only its first findings, more exist`.
- **The `**Go vet:**` line.** It uses the O2 §5.4 texts exactly:
  - Consent off: "Go files were syntax-checked only; `go vet` is off for this workspace. Enable it in Settings → Tools
    (desktop app) or run `ptah config go-vet on` in this workspace."
  - Stale: "…consent for this workspace is out of date (<reason>). Re-enable it in …". The reason is written in words:
    `go-changed` becomes "the Go toolchain changed", and likewise for `root-moved` and `root-replaced`.
  - Checked: "syntax check plus `go vet` (N files vetted); `go vet` is not a type check." Go vet is never labelled
    type-checked.
  - Otherwise: "syntax-checked only; `go vet` did not run" or "`go vet` failed", followed by `: <words>`.
  - Every `GoVetReason`, including the r1 six, has fixed words, and so does the provider's `checker-error`.
- **Fail closed.** The following are all named in the answer and are never read as clean:
  - an unknown reason code (`reason "x" not recognised`, clipped);
  - a malformed `goVet` (wrong status, a negative or non-integer `checkedFiles`, a non-string reason);
  - a non-count `unmappedFindings`;
  - a non-false `diagnosticsTruncated`.
- **Placement.** The qualifiers sit in the Coverage line, and the go vet line follows it. Both come before Requested
  files and Not checked, and on the unavailable arm before the unbounded `**Reason:**`. Diagnostics stay
  `preformatted`: the budget cuts them and never reduces them. The spec runs the real `applyToolResultBudget` on a
  400-finding answer and checks that the qualifiers and the stale line survive the cut.
- **Compact block.** `compactCoverage` is unchanged, and the checker limits are prose only. A spec checks that the
  block stays within 1,000 characters (the Decision 21 bound) and carries no `goVet`.
- **Wording.** VS Code wording is unchanged. VS Code sends no `goVet`, so it gets no go vet line; a spec covers this.
  No user-facing string has a quoted token after "from".

## Task 37b1b.2: spawner adapter proof

On win32, `node.exe` is hard-linked (or copied, if the link fails) as `<tmp>/bin/go.exe`. It is spawned through
`spawnProcess` with `['vet','-json','./a']`, `cwd` = the module directory, and a from-scratch env with no `PATHEXT`. The
message posted to the worker has:

- command `=== go.exe`;
- args equal to the input;
- no `cmd.exe` and no `/d /s /c`;
- `windowsVerbatimArguments: false`.

It also ran: stderr names `<mod>\vet`. The case is skipped on other OSes, following the sibling `.cmd` case.

## FB evidence

| Check | Result |
| --- | --- |
| Formatter spec run against `git show HEAD:…/mcp-response-formatter.ts`; the file was restored and `cmp` confirmed it | **66 failed**, 91 passed. The FB case "a payload with unmappedFindings: 2 and no diagnostics is not a clean answer" printed a bare "No issues found" on the base. The 2 new cases that passed on the base are preservation cases: the VS Code no-go-vet-line case and the compact-bound case. After the change: all pass |
| Builder spec run against the base `types.ts` and `core-namespace.builders.ts` | The suite fails to compile (`goVet` is not on `DiagnosticsPayload`). After the change: passes |
| Spawner case, mutation: `forceShell: true` added to the host `parseCommand` call; the file was restored and `cmp` confirmed it | **1 failed**: received `C:\WINDOWS\system32\cmd.exe`. Restored: passes. This is a proof spec of existing behaviour (O2 §4.1), so it passes on the base as well |

## Verification (tail only)

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/vscode-lm-tools @ptah-extension/agent-sdk --skip-nx-cache --parallel=2`
  printed "Successfully ran targets test, lint, typecheck for 2 projects" (6 tasks).
  - The first run failed 9 vscode-lm-tools suites with `language-aware-diagnostics-provider.ts:804 TS2554`. At that
    moment the file was being edited by another agent in this worktree (mtime 18:50:21; `process-tree-reaper.ts` was
    also touched, and it is not in the 37b1a report).
  - Once `tsc` on workspace-intelligence was clean, the re-run passed. I did not touch those files.
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache` succeeded for both projects.
- `nx run ptah-electron:validate-deps --skip-nx-cache` printed "All external imports are covered by package.json
  dependencies".
- `nx run degradation-audit:lint --skip-nx-cache` printed "TOTAL 300". vscode-lm-tools has 2 (baseline 2) and agent-sdk
  has 4 (baseline 4).
- `ptah-core-prompt.ts` and `NATIVE_AGENT_TOOL_POLICY` are unchanged (empty diff).
- No `as any` or `@ts-ignore` was added. No catch in a source file was added. The one spec catch uses optional binding
  and rethrows through the copy fallback.
- Prettier was applied. The fixtures have no import shapes, and the temp roots are removed in `afterEach`/`afterAll`.

## Deviations

1. **Three files outside the listed two are changed** (4 vscode-lm-tools files and 1 agent-sdk file, so 6 files in 2
   libs, within the batch limit).
   - `DiagnosticsPayload` and the diagnostics namespace carried only `coverage` and `notChecked`. Without forwarding,
     the provider's `goVet`, `unmappedFindings` and `diagnosticsTruncated` could never reach the formatter in
     production, and the formatter change would be dead code.
   - The forwarding is additive and is pinned by the builder spec.

## Out-of-scope observations

- `getErrors()` filters out warnings, so vet findings (warnings) are not listed in an errors-only call. The answer is
  still never bare: the coverage is syntax-only and the go vet line is shown. A caller may still read
  "Errors: 0" as the whole story.
- A concurrent editor was active in `workspace-intelligence` and `platform-core` during this batch (see Verification).
  The team leader should confirm that the 37b1a state it commits is the one reviewed.
