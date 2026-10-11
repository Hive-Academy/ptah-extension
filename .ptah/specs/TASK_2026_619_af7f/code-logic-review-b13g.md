# Code logic review - TASK_2026_619 Batch 13g

Score: 6/10. Verdict: REVISE.

Scope: `tools/mcp-bench/src/transport/open-handle-probe.ts` and `open-handle-probe.spec.ts`, read in the worktree. I compared them with b13g.diff, the lane report, and other users of the module (`host-launcher.spec.ts`). The diff was readable and is not UTF-16. Nothing was executed. The reviewer tools are read-only, so I could not measure the encoded length or run the probe.

Line numbers: the Read tool returned outline-reduced views of the .ts file, so line numbers outside the Grep output are approximate. Anchors that came from Grep (`runCaptured` ~615, `parseReply` ~402, `saveRawProbeReply` ~441) are exact.

## (a) Script truncation and the "724 base64 chars" claim

- The script was not truncated or replaced. The diff has exactly one script hunk (`@@ -139 +141`), which adds 4 lines after `$ErrorActionPreference = 'Stop'`. The next hunk starts at old line 307, after the script's closing backtick.
- I read the whole script in the worktree. All of these are present and unchanged:
  - The C# `PtahBenchProbe` class with `Holders`, `OpenPaths`, `Unprobed`, `UnprobedLines`, and the `FILE_TYPE_DISK` check with the per-handle `Thread` and `Join(perHandleTimeoutMs)` worker.
  - The `Win32_Process` table via `Get-CimInstance`.
  - The holders branch.
  - The tree-growth loop with the creation-time guards.
  - The final `[Console]::Out.Write(ConvertTo-Json -Compress -Depth 4)`.
  - The `{processes, holders | open, unprobed}` JSON shape.
- 724 is certainly a mismeasurement. The script is about 200 lines of dense C# and PowerShell, roughly 10-12K chars. UTF-16LE then base64 gives about 27-32K base64 chars, not 724. 724 chars would encode only about 270 characters of script.
- I could not measure the real figure. That matters because the Windows `CreateProcess` command-line limit is 32,767 chars, and the 4 added lines (about 190 chars) add roughly 500 base64 chars. An earlier `cmd /c` attempt rejected the command line as too long, so the script is already well above 8,191. The original command line was evidently under 32,767, because the smoke ran. The margin is unknown.
- Nothing in the lane report shows that the real probe was run after the change. The lane's "724" figure must not be accepted as evidence.

## Findings

### SERIOUS-1: encoded command-line length is unverified, and the stated figure is wrong
- File: `open-handle-probe.ts` ~`runWindowsProbe` (the `-EncodedCommand` argument) and `WINDOWS_PROBE_SCRIPT`; the lane report states 724.
- Impact: if the encoded script is within a few KB of 32,767, this batch or the next small edit pushes it over. `spawn` then fails with ENAMETOOLONG on every sample, which looks like a total probe failure.
- Fix:
  - Add a spec asserting `Buffer.from(WINDOWS_PROBE_SCRIPT, 'utf16le').toString('base64').length` is under about 30,000.
  - Record the real number in the lane report.
  - Run the real probe once on Windows.
  - If the margin is thin, pass the script some other way, for example a temp `.ps1` file with `-File`, or stdin.

### SERIOUS-2: `[Console]::OutputEncoding = ...` is unguarded under `$ErrorActionPreference = 'Stop'`
- File: `open-handle-probe.ts` WINDOWS_PROBE_SCRIPT, line 5 of the script.
- Scenario:
  - The setter calls `SetConsoleOutputCP`. It is known to throw `IOException: The handle is invalid` when the process has no console handle.
  - `windowsHide: true` (CREATE_NO_WINDOW) normally gives the child a console, so this is probably fine on the happy path.
  - The probe is spawned from a bench host that may itself be detached, and the lane never ran the script. Nothing proves the setter is safe in every launch context.
  - A throw there is a terminating error that exits non-zero, so every sample becomes "open-handle probe exited 1". That is worse than the bug being fixed.
- Does the setting work when stdout is redirected? Probably yes. The .NET setter resets the cached `Console.Out`, so the later `[Console]::Out.Write` picks up the new encoding. `UTF8Encoding($false)` emits no BOM.
- Fix: wrap it as `try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }`. Add a spec assertion that it sits inside a `try`.
- Also fix, or at least document: `[Console]::In.ReadToEnd()` still decodes stdin with the console input code page, not UTF-8, while Node writes UTF-8. A non-ASCII path in holders mode (for example a non-ASCII username under `~/.ptah`) is mangled, so `Holders` gets a wrong path. Set `[Console]::InputEncoding` in the same guarded block, or read the bytes of stdin explicitly. This is pre-existing, but the batch only fixes the output half.

### MODERATE-1: the split-chunk spec exercises `concatProbeStdout`, not `runCaptured`
- File: `open-handle-probe.spec.ts` ~122-128 against `open-handle-probe.ts` ~611-644.
- Detail: the test splits a UTF-8 emoji at +2 bytes and parses the result. That is a real multi-byte split. But it only proves that `Buffer.concat` followed by `toString` works, and `concatProbeStdout` is a one-line wrapper exported for the test. If someone restores `child.stdout.setEncoding('utf8')` in `runCaptured`, the test still passes.
- Fix: add a spec that mocks `child_process.spawn` with a fake child whose stdout emits split Buffers, and drives `runCaptured` through `WindowsHandleProbe.treeOpenPaths`. That would also cover stderr, timeout and non-zero exit, which have no coverage at all.

### MODERATE-2: diagnostic file names can collide
- File: `open-handle-probe.ts` ~`saveRawProbeReply`, `ptah-open-handle-probe-${process.pid}-${Date.now()}`.
- Detail: two parse failures in the same millisecond in one process (holders and tree runs can overlap) share a stem. `writeFileSync` overwrites silently, and the first failure's evidence is lost.
- Fix: add a counter or random suffix, or use `mkdtemp`, or pass flag `'wx'`.

### MODERATE-3: no BOM tolerance in parsing, and no recovery
- File: `open-handle-probe.ts` `parseReply`, `rawStdout.toString('utf8')`.
- Detail: a leading BOM (U+FEFF) fails `JSON.parse`. The old `setEncoding('utf8')` also kept the BOM, so this is not a regression. It remains a realistic failure if the encoding line does not take effect, and especially if it is wrapped in try/catch as recommended above.
- Fix: strip a leading `﻿`.
- The batch only adds diagnostics. It does not make the reply tolerant of extra host output, for example by taking the last `{...}` line. The original failure's start looked like valid JSON (`{"processes":[...`), so trailing or interleaved output is the likelier cause. Whether the three preference variables remove it is unproven. Say so in the batch notes.

### MINOR
- Spec count: the old spec had 5 tests and the new spec has 6 (`it.each` counts as 2), which is 11, not the lane's 12 "across 2 suites". The diff shows no removed or weakened lines. The old tests are intact, and the diff adds only imports and a new describe block. The extra test is unexplained, probably counted from the other suite.
- Stdout and stderr are saved raw to a world-readable-by-user tmp directory. They contain process command lines, which may include secrets or tokens, and the files are never cleaned up. They are written only on parse failure, so there is no leak in normal runs. Note this in the docs, or restrict the file mode with `{ mode: 0o600 }`.
- The saved stderr is truncated to the last 2,000 chars by `runCaptured`. The error does not say so.
- The preference-order spec compares string positions against `[Console]::Out.Write`. It does not prove that nothing before the encoding line writes output (`$ErrorActionPreference` is first and silent). It is acceptable.
- `jest.spyOn(require('node:os'), 'tmpdir')` depends on ts-jest's CJS named-import behaviour. It passed per the lane report. If it does not apply, the files go to the real tmp dir and the test still passes, so it fails open.

## (c) Holders mode, linux path, other callers of runCaptured
- The script change is shared. The new lines are at the top, before the `if ($request.mode -eq 'holders')` branch, so holders mode gets the same preferences and encoding. Its logic is unchanged.
- `WindowsHandleProbe.holders` now destructures `{stdout, stderr}` and calls `parseReply(stdout, stderr)`. Correct.
- The linux `ProcFsHandleProbe` does not call `runCaptured`. Grep shows only `runWindowsProbe` calls it, so the Buffer change touches no other caller.
- `parseWindowsTreeReply` accepts `string | Buffer`, so `host-launcher.spec.ts` (lines 1082 and 1104, which pass strings) is compatible.
- `runCaptured` keeps the stderr 2,000-char tail, the 60 s timeout with `kill`, `error` handling and the non-zero-exit rejection. The only behaviour change is `done({stdout, stderr})`.
- Small leftover: after a timeout rejection, a later `close` event still calls `done` or `reject` on the settled promise. That is harmless and was already the case.

## (d) Diagnostic file writes
- The writes are synchronous (`fs.writeFileSync`). They run only inside the catch of a parse failure, so there is no cost in normal runs.
- The `stdout.bin` write is followed by the `stderr.txt` write inside one try. If the second fails, the first file exists but the message says "raw reply not saved". That is minor, because the stdout file is orphaned.
- Error propagation is correct. A failed write returns `raw reply not saved: <reason>` and does not throw. The original parse error message keeps the prefix "open-handle probe returned no JSON", the length and the first and last 200 chars. The length reported is bytes while the slices are chars, which is fine and labelled.
- The files do not leak in normal runs. Names are unique per process and millisecond, not strictly unique (MODERATE-2).

## (e) Spec quality
- Real failure path: yes. The trailing and leading garbage cases use the real `writeFileSync` and compare the saved bytes with the input. The write-failure case uses an injected writer.
- Real decode path: partly. A multi-byte split is tested, but not through `runCaptured` (MODERATE-1).
- Nothing was removed or weakened. All 5 old tests are intact.
- Missing: the encoded-length guard, a try/catch assertion for the encoding line, and any test of `runCaptured`.

## Five logic questions
1. Silent failure: no new silent failures. A failed diagnostic write is reported in the error message.
2. Unexpected user action: none relevant. Stdin paths with non-ASCII characters can be mangled (SERIOUS-2).
3. Wrong answer from input: a BOM or mixed host output gives a parse failure, not a wrong answer. A mis-decoded stdin path would make a holder query return no holders silently.
4. Dependency failure: PowerShell exits non-zero when the encoding setter throws. The bench then fails every sample.
5. Missing: a command-line length guard, a try/catch around the encoding line, and an end-to-end probe run on Windows.

## Verdict
REVISE. Score 6/10.

- The script is intact. Buffer handling and the diagnostics are logically sound, and no existing spec was weakened.
- The remaining risks are in the Windows launch itself and are unverified: the unguarded encoding setter and the unmeasured command-line length. The lane's "724" figure is wrong.
- Required before approval: SERIOUS-1 and SERIOUS-2. Strongly recommended: MODERATE-1 and MODERATE-2.
