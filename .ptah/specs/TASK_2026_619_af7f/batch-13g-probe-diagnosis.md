# Windows probe JSON diagnosis (TASK_2026_619)

## Reproduction

- Read `WINDOWS_PROBE_SCRIPT` from W unchanged and wrote it to `L\\probe.ps1`.
- A Node harness in L spawned exactly `powershell.exe -NoProfile -NonInteractive
  -ExecutionPolicy Bypass -EncodedCommand <UTF-16LE/base64 script>` with
  `stdio: ['pipe','pipe','pipe']`, `windowsHide: true`, and tree request
  `{"mode":"tree","rootPid":<parent PowerShell PID>,"perHandleTimeoutMs":250}`.
- It captured `Buffer` chunks before decoding to `probe-stdout*.bin` and stderr
  to `probe-stderr*.txt`; `probe-stdout.bin` and `probe-stderr.txt` are run 0.

## Results

| run | launch | stdout bytes | JSON.parse |
| --- | --- | ---: | --- |
| 0 | direct hidden pipe | 144,809 | OK |
| 1 | direct hidden pipe | 144,839 | OK |
| 2 | direct hidden pipe | 144,024 | OK |
| 3 | direct hidden pipe | 144,415 | OK |
| 4 | `cmd /c chcp 437 & powershell ...` | 0 | not applicable |

Run 4 could not be a valid encoded-command test: `cmd.exe` rejected the command
line as too long (stderr: `The command line is too long.`). Runs 0--3 already
use `windowsHide: true`, the same hidden-child setting as `runCaptured`.

The first bytes of every successful raw reply are the incident prefix:
`{"processes":[{"createdMs":1791287782118,"commandLine":null,"pid":0,...`.
UTF-8 decoding and `JSON.parse` succeeded each time, so there is no failure
position/context to show. No invalid UTF-8, control character, lone surrogate,
or truncation was observed.

## Root-cause assessment

Not reproduced; therefore the incident cannot be conclusively classified from
the supplied 200-character prefix. `runCaptured` has no `maxBuffer`/size limit:
it appends all stdout chunks, and only has a 60,000-ms timeout. Thus output
truncation by this function is excluded. The prefix also excludes *leading*
non-JSON text.

The strongest remaining candidate is **trailing non-JSON PowerShell host
output** (warning/progress/information) after the JSON body. Evidence: this
same probe emitted two `Preparing modules for first use` progress records as
CLIXML on stderr (616 bytes) in every direct launch; host-stream routing is
environment dependent, and the script suppresses none of those streams. This
is a candidate, not proof; raw bytes from a failed run are required to settle it.

## Smallest proposed fix (do not apply)

In `WINDOWS_PROBE_SCRIPT`, immediately after `$ErrorActionPreference`:

```diff
 $ErrorActionPreference = 'Stop'
+$ProgressPreference = 'SilentlyContinue'
+$WarningPreference = 'SilentlyContinue'
+$InformationPreference = 'SilentlyContinue'
+[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
```

Keep `ConvertTo-Json -Compress -Depth 4`: it already emits one compact JSON
value. The preferences prevent host records contaminating stdout; explicit
UTF-8 makes Node's existing `setEncoding('utf8')` contract deterministic.
Do not add a size limit: none exists today.

For definitive diagnostics, preserve bytes rather than a decoded string:

```diff
-import { readdir, readFile, readlink } from 'node:fs/promises';
+import { writeFileSync } from 'node:fs';
+import { readdir, readFile, readlink } from 'node:fs/promises';
+import { tmpdir } from 'node:os';
+import { join, resolve } from 'node:path';
-import { resolve } from 'node:path';
+// runCaptured: remove stdout.setEncoding; collect Buffer chunks; resolve(Buffer.concat(stdout)).
+function parseReply(stdout: string | Buffer): Record<string, unknown> {
+  const text = typeof stdout === 'string' ? stdout : stdout.toString('utf8');
   try { /* JSON.parse(text) */ } catch {
+    const raw = join(tmpdir(), `ptah-open-handle-probe-${process.pid}-${Date.now()}.bin`);
+    writeFileSync(raw, Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout, 'utf8'));
+    throw new Error(`open-handle probe returned no JSON; raw reply: ${raw}: ${text.slice(0, 200)}`);
   }
 }
```

Pass the Buffer returned by `runWindowsProbe` to `parseReply`/`parseWindowsTreeReply`
(accept `string | Buffer` there) so this truly saves the original bytes.

## Spec cases to add (`open-handle-probe.spec.ts`)

1. `parseWindowsTreeReply` accepts a valid UTF-8 Buffer reply.
2. A valid JSON object plus `WARNING: ...` is rejected and reports a saved raw
   reply path whose bytes equal the input Buffer.
3. A leading progress/warning record plus JSON is likewise rejected/saved.
4. A process command line containing non-ASCII and escaped control characters
   round-trips through the UTF-8 JSON reply.
5. Probe-script contract test asserts `ProgressPreference`, `WarningPreference`,
   `InformationPreference`, and UTF-8 output encoding are set before output.
