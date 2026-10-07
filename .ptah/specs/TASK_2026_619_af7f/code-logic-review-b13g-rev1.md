# Code logic review - TASK_2026_619 Batch 13g revision 1

Score: 8/10. Verdict: APPROVED. No BLOCKING or SERIOUS findings.

Scope: all of `open-handle-probe.ts` lines 39-460 and 600-655, the whole spec, the diff, the rev1 report and the real-probe script. Jest was not run; the result is pending in another lane.

## Status of prior findings

| Prior finding | Status | Evidence |
| --- | --- | --- |
| SERIOUS-1: encoded command length unverified, "724" figure wrong | FIXED | The spec at `open-handle-probe.spec.ts:178-190` builds the command line from the exported `WINDOWS_PROBE_SCRIPT` constant with the same `Buffer.from(..., 'utf16le').toString('base64')` as `open-handle-probe.ts:276`. It asserts length < 30,000. The reported real figures are 23,028 base64 chars and 23,110 for the full command line, so my estimate of 27-32K was too high. The margin to 32,767 is about 9.6K. |
| SERIOUS-2: `OutputEncoding` setter unguarded; `InputEncoding` not set | FIXED | `open-handle-probe.ts:150-153` wraps both setters in `try { ... } catch { }`. The preference lines at 146-149 stay outside the try. The spec at 158-176 pins the exact block and its position before `[Console]::Out.Write`. |
| MODERATE-1: split-chunk spec exercised a wrapper, not `runCaptured` | FIXED | `runCaptured` is exported (`open-handle-probe.ts:620`). The spec at 67-91 uses a real Node child with a split write, a non-zero exit with stderr, and a timeout. If `setEncoding('utf8')` were restored, `Buffer.concat` would throw on string chunks and the first test would fail. |
| MODERATE-2: diagnostic filename collision | FIXED | `open-handle-probe.ts:444` adds `randomBytes(4)` to the stem. |
| MODERATE-3: BOM tolerance | FIXED | `open-handle-probe.ts:407-409` strips one leading U+FEFF after `Buffer.toString`, which does not strip a BOM itself. The spec at 125-133 covers it. |
| MINOR: spec count | Moot. | |
| MINOR: tmp files are never cleaned up and are not mode 0600 | Not fixed, and this is justified. Files are written only on a parse failure. The spec cleans its own directory. | |
| MINOR: `tmpdir` spy could fail open | Not fixed; see MINOR-2 below. | |

The prior note that the garbage/trailing-output cause is unproven still stands. Whether the three preference variables remove that cause is only evidenced by one clean live run (see MODERATE-1 below).

## Real-probe script check

`b13g-rev1-real-probe.js` extracts the template from the on-disk `open-handle-probe.ts`:

- It starts at the marker `export const WINDOWS_PROBE_SCRIPT = String.raw\``.
- It ends at the first `\n\`;`, which is source line 314.
- Lines 145-314 contain no backtick and no `${`, so `String.raw` interpolation cannot change the script.
- CRLF is normalized to LF, which matches the cooked template.
- It encodes with the same utf16le/base64 as the product code and uses the same flags.

So it built the command from the updated constant and was not a stale copy. It is the real script, run through a fresh spawn rather than through `runCaptured`; the behavioral difference is nil. It requests tree mode only, so the evidence does not cover:

- holders mode;
- non-ASCII stdin;
- no-console launch.

The 115,896-byte reply parsing with empty stderr is solid evidence that progress/CLIXML suppression works.

## Regression checks

- **try/catch scope:** it wraps only the two console setters. `Add-Type` and the rest of the body keep `$ErrorActionPreference = 'Stop'` and still terminate non-zero, so probe-body errors are not swallowed. OK.
- **InputEncoding versus the stdin JSON read:**
  - On .NET Framework, a redirected `Console.In` is built from `InputEncoding`, and the setter resets the cached reader. The setters run before the first read, so ordering is correct.
  - It now decodes Node's UTF-8 correctly, which fixes a non-ASCII path in holders mode.
  - If `SetConsoleCP` throws without a console, the catch leaves the default code page. That is the old behaviour, not worse.
  - The tree-mode live run has ASCII-only stdin, so it neither proves nor disproves this.
- **Length spec meaningful:** yes. It computes from the real exported constant, and the threshold sits 2.7K above the current size and 2.7K below the OS limit. The spec rebuilds the command line instead of calling a shared helper (`open-handle-probe.ts:268-279`), so the spec and the product args could drift (see MINOR-1).
- **`runCaptured` tests on win32 CI:**
  - They use `process.execPath` with `-e`.
  - The first test passes a script containing double quotes from `JSON.stringify` and Arabic/emoji text. libuv quotes Windows arguments correctly and sends them as UTF-16, so it is OK.
  - The timeout test is robust, because a timeout is expected whatever the startup time.
  - `child.kill()` on Windows terminates the `setInterval` node child.
  - Behaviour is the same on Linux.
- **Temp-file cleanup:** the `describe` block creates its directory with `mkdtemp` and removes it in `afterEach`. `restoreAllMocks` runs before `rm`. The write-failure case injects a writer and writes no files.
- **Holders mode and API:**
  - The new script lines sit before the mode branch, so holders gets the same preferences and encodings. Holders logic is unchanged.
  - `WindowsHandleProbe.holders` (line 321) and `treeOpenPaths` (line 364) both pass stderr into `parseReply`.
  - `parseWindowsTreeReply` still accepts `string | Buffer` with an added optional writer, so existing callers and `host-launcher.spec.ts` are compatible.
  - New exports: `WINDOWS_PROBE_SCRIPT`, `runCaptured`. `runCaptured` returns `{stdout: Buffer, stderr}` and has an optional timeout parameter. It has no other callers.

## New findings

### MODERATE-1: no recovery from extra host output; the root cause is only suppressed
- File: `open-handle-probe.ts:406-424`.
- Detail: `parseReply` still fails hard on any extra bytes around the JSON. The raw bytes are now saved, which is good, but a sample dropped by a stray host line on a loaded machine still fails the whole sample.
- Fix: optionally try the last non-empty line, or the first `{` to last `}` slice, as a fallback and record that it was used. Otherwise note in the batch that a recurrence will be diagnosable but not tolerated.

### MODERATE-2 (unverified paths): holders mode, non-ASCII stdin and a detached host were not exercised live
- File: `b13g-rev1-real-probe.js:56`.
- Detail: the live check sends a tree request only. The InputEncoding change affects the holders request path under a non-ASCII `~/.ptah`.
- Fix: run the real script once with `{mode:'holders', paths:[<a non-ASCII temp path>]}` and assert the path round-trips, or add this as a Windows-only integration spec.

### MINOR-1: spec duplicates the argument list rather than sharing it
- File: `open-handle-probe.spec.ts:178-190` against `open-handle-probe.ts:268-279`.
- Fix: export a small `windowsProbeArgs()` and use it in both places.

### MINOR-2: `tmpdir` spy can fail open
- File: `open-handle-probe.spec.ts:98`.
- Detail: if the spy stops applying (for example a change of transpiler), the files go to the real temp directory and the tests still pass.
- Fix: assert `stdoutPath.startsWith(diagnosticDirectory)`.

### MINOR-3: stderr/exit race in the non-zero-exit test
- File: `open-handle-probe.spec.ts:82`.
- Detail: it writes to stderr and calls `process.exit(7)` immediately. Piped stderr writes could in principle be truncated on a platform where they are asynchronous.
- Fix: use `process.exitCode = 7` or write with a callback before exiting.

### MINOR-4: the split test could pass with a coalesced chunk
- File: `open-handle-probe.spec.ts:68-78`.
- Detail: the 10 ms gap makes two chunks very likely but not guaranteed. This weakens the test but does not make it flaky, because it passes either way.

## Five logic questions (brief)

1. **Silent failure:** none new. Diagnostics write failures are folded into the thrown error (`open-handle-probe.ts:451-453`), so the parse failure is never masked.
2. **Unexpected user action:** none.
3. **Wrong answer from input:** a double BOM, or a BOM plus other output, still errors (not silently wrong).
4. **Dependency failure:** the timeout, exit and spawn-error paths in `runCaptured` are unchanged and now tested.
5. **Missing:** holders/non-ASCII live evidence (MODERATE-2), and the Jest result, which is pending.

## Verdict

APPROVED, 8/10. Every prior finding is fixed or justifiably deferred, and the live run exercised the real updated script and parsed 115,896 bytes with empty stderr. It is not 9: the unexercised holders/non-ASCII path, the lack of tolerance for extra output, and the unconfirmed Jest result keep it at 8. Approval assumes the pending Jest run passes; if it fails on the new `runCaptured` or `tmpdir` tests, reopen.
