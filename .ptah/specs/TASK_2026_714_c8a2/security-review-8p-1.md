# Security Review - Batch 8p-1 (TASK_2026_714_c8a2)

Scope: uncommitted diff of `codex-read-only-command.ts`, `codex-chat-approval-sink.ts` and their specs
(under `libs/backend/agent-sdk/src/lib/codex-app-server/`), plus `codex-approval-bridge.ts` response
building and the zod request schema in `codex-protocol-methods.ts`. Read-only review; nothing was run.

## Summary

| Metric | Value |
| --- | --- |
| Score | 8/10 |
| Verdict | APPROVED WITH NOTES |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 3 |
| Minor | 4 |

I found no input that the new unwrap or the sink accepts and that could write, execute arbitrary code,
exfiltrate, or read outside the thread folder, assuming the process environment is trusted.

## D20 constraints

All still hold:
- Deny-by-default allowlist: the unwrap only returns a body for a trusted wrapper. Every other shape returns
  `undefined` (reject) or falls through to the same allowlist (`codex-read-only-command.ts:26,32,34,37`).
- Manual chat only: `permissionLevel() === 'ask'` is unchanged (`sink.ts:120`).
- One request at a time: unchanged.
- Never `acceptForSession` or an exec-policy amendment: the sink returns the literal `'accept'` (`sink.ts:139`).
  The bridge answers `item/commandExecution/requestApproval` with `{ decision }` only (`codex-approval-bridge.ts:480-482`).
  The result schema is `z.strictObject({ decision })` (`codex-protocol-methods.ts:197`).
  Nothing in the codex-runtime sources builds `acceptWithExecpolicyAmendment`, so the amendment cannot be applied.

## 1. PowerShell wrapper unwrap

Executable parsing (`ro-command.ts:21-32`):
- Quotes: both `"` and `'` are accepted for argv[0] only.
- `\\` doubled backslashes, `/` and `..`: `path.win32.normalize` collapses them and the result must equal the
  trusted path exactly after lower-casing. Accepting these is harmless: Windows resolves them to the same file.
  A `..` through a junction would be a concern, but `System32\WindowsPowerShell\v1.0` has no junctions in a stock install.
- `\\?\` and `\\server\share`: `normalize` keeps the prefix, so the strings differ and they are rejected.
  The same applies to SysWOW64, Sysnative, 8.3 short names, other drives, `pwsh.exe` full paths and a
  `powershel1.exe` typo (spec 72-76).
- Trailing dot or space, and `::$DATA`: `powershell.exe.` and `powershell.exe::$DATA` do not match `shellPath`
  (`$` anchor). They fall through as a non-wrapper, and the first token then fails the allowlist.
  A space inside a path segment (`v1.0 \`) fails the string compare. All of these reject.
- Wrapper regex `^(?:-NoProfile(?: +-NoLogo)? +)?-(?:Command|c) +(["'])([\s\S]*)\1$` is anchored and allows a
  single quoted body. Display-versus-argv mismatch:
  - `argv[2]` is the body. Extra argv elements after the body render as a further quoted token. The greedy
    capture then swallows that token's quotes, so `body.includes(match[1])` rejects it.
  - A mixed-quote tail leaves the final character different from the opening quote, so the regex does not match.
  - Spec 84 covers the first case. A rendering where the body itself contains the wrapper quote is rejected (`:37`).
  - I found no way for the classified text to differ from the executed text. This still depends on Codex's join
    being a plain quote-wrap, which the live evidence (live-test-p8i row A) supports but I could not verify against Codex source.

Findings:

### Moderate M-1: SystemRoot trust is only shape-checked
`ro-command.ts:28-31`. `systemRoot` comes from `process.env.SystemRoot ?? windir` (`sink.ts:93`). The check is
only "drive-letter absolute". If that env var is ever wrong or attacker-influenced, for example `C:\Users\x\ws\evil`,
then `<root>\System32\WindowsPowerShell\v1.0\powershell.exe` is trusted. Planting that file in the thread folder
would give code execution as an auto-accept. This needs prior control of Ptah's own environment, so the likelihood is low.
Fix: add a defence in depth to `trustedPath`. Require the normalized executable not to be within `threadCwd`
(`pathWithin`). Better, also require `systemRoot` to be a single-segment drive-root path (`/^[a-z]:[\\/]+[^\\/]+[\\/]*$/i`).
Add one spec for each.

### Moderate M-2: bare `powershell` / `pwsh` is still accepted, and it resolves through the search path
`ro-command.ts:24,32`. A bare name is resolved by Codex's spawn: Rust `Command` searches the app dir, system
dirs and PATH, but not cwd. If PATH contains `.` or a workspace directory, a planted `powershell.exe` or
`pwsh.exe` runs. This is carried over from 8o-4. The live argv is always the full System32 path, so the bare form
adds risk without buying live coverage. Fix: accept bare names only when a spec-driven need exists. Otherwise
remove `bare` and keep the trusted full path. If bare names are kept, document the PATH assumption.

### Moderate M-3: `-NoProfile` is now optional (profiles load)
`ro-command.ts:33`. With no `-NoProfile`, the user's `$PROFILE` runs before the allowlisted body. It is the
user's own file, not workspace-controlled, so the risk is bounded. The classified body still does not describe
everything that executes: a profile can shadow `Get-Content`, `cat` or `rg`. This does not break D20 as written.
It is a residual risk, and the live test showed the profile is the only reason `-NoProfile` was dropped.
Fix: accept the profile risk in `decisions.md` explicitly (a profile that can shadow commands already controls any
command the user would approve by clicking). Optionally require `-NoProfile` when the profile file exists, or log
a warning.

### Moderate M-4 (new, see item 2): `reason` / escalation signal ignored
The removed `proposedExecpolicyAmendment == null` guard was an indirect signal that Codex was asking about a command
it considered non-trivial or escalated. The sink also never looks at `details['reason']`, which Codex sets for
sandbox-escalation retries ("retry without sandbox?"). Such a request is auto-accepted if the command is on the
allowlist. The effect is bounded to allowlisted, in-folder, read-only commands, but it runs unsandboxed. Extra
schema fields are not rejected, because the zod object is not strict (`codex-protocol-methods.ts:177`), so a newer
Codex adding `additionalPermissions` would also be silently accepted.
Fix: when `details.reason` is a non-empty string, or any key outside the known set is present, present the card. Add a spec.
Note: this makes the Moderate count above 3 in practice (M-1 to M-4); I list M-4 here for the record.

## 2. Ignoring a proposed exec-policy amendment (A2-1)

Confirmed safe. `sink.ts:119-126` drops the guard. The sink returns plain `'accept'`.
The bridge maps that to `{ decision: 'accept' }` and only records a reusable rule for `acceptForSession`
(`codex-approval-bridge.ts:362-371`). The amendment content (`z.array(string)`, schema line 186) is never read
or echoed back, so it cannot differ from the command in a way that matters. Accepting once is exactly what the
command itself asked for. `proposedNetworkPolicyAmendments`, `networkApprovalContext`, `environmentId` and
`kind: writeStdin` still force the card (`sink.ts:121-124`).

## 3. `file:` URI cwd

`sink.ts:111-118`. `fileURLToPath(cwd, { windows: platform === 'win32' })`:
- `file://host/share` becomes `\\host\share`, which the classifier rejects (`command.ts:160`). On posix a host
  throws, which shows the card.
- `%2F` / `%5C` encodings throw (Node `ERR_INVALID_FILE_URL_PATH`), which shows the card. Other percent escapes
  are decoded before classification.
- A drive-relative `file:///C:foo` becomes `C:foo`, which is not absolute, so `pathWithin` returns false.
- Uppercase `FILE:` is not converted, is not absolute, and is rejected. This is fail-closed.
- The converted `cwd` is what `classifyReadOnlyCommand` and `acceptIfRealPathsStayInside` both receive
  (`sink.ts:125,127-128`), so lexical containment and the realpath check apply to the converted path.
- The catch is fail-closed (card). A query or hash on the URI is dropped by Node.
No finding.

## 4. M4 `seen` cleanup and M5 `setImmediate`

- M4: `seen` is cleared on the accepted and aborted-while-resolving paths (`sink.ts:131-135`). Each later
  request with the same key is classified again from scratch, so there is no stale-accept shortcut. In-flight
  duplicates are still declined, since `seen` holds until the promise resolves. A card path is unchanged.
  No replay risk.
- M5: the follow-up posts after the decline is resolved (`:255-275`). Errors are caught and logged. A synchronous throw from
  `followUp.post` is captured by the `async` wrapper. Minor: the immediate callback is not cancelled on dispose
  (see Minor 3).

## Other observations

- Minor 1: the `file:` conversion catch is commented as `optional-capability`. It is really a fail-closed
  security catch; the label confuses the degradation audit.
- Minor 2: TOCTOU between the realpath check and Codex's execution remains (a symlink created in between).
  Pre-existing and accepted; mention it in decisions.
- Minor 3: `setImmediate` follow-up is not cancelled on dispose (`sink.ts:255`); a late post may happen after
  teardown. The followUp owner should tolerate it.
- Minor 4: spec gaps (item 5).

## 5. Spec coverage

Covered: the live full-path argv (spec 54-66) with `-Command`, `-c`, case variants, quotes, doubled backslashes and `..`;
rejects for D:, SysWOW64, typo, 8.3, pwsh full path, `-EncodedCommand`, `-ExecutionPolicy`, `-File`, `-NonInteractive`,
`-NoLogo` alone, missing body, unquoted body, extra argv, outside path (70-85); SystemRoot missing, empty or relative (90-95);
sink `file:` valid and invalid (sink spec 129, 138).
Missing:
1. `\\?\C:\...\powershell.exe`, `\\server\share\...\powershell.exe`, Sysnative, forward-slash variant,
   `powershell.exe.` and `powershell.exe::$DATA` (all reject today, but not pinned).
2. SystemRoot inside the thread folder or multi-segment (needs M-1 fix).
3. `reason` set and unknown-field requests (needs M-4 fix).
4. A sink spec asserting that `proposedExecpolicyAmendment` present still returns plain `'accept'` and that the
   response is `{decision:'accept'}` (the bridge-level assertion belongs in `codex-runtime.spec.ts`).
5. `seen` clear and re-request after accept, and the abort-during-resolve path.
6. Windows `file://host/share` UNC on the sink.

## Verdict

APPROVED WITH NOTES. D20 holds. No Blocking or Serious issue. Before merge, apply M-4 (escalation `reason` and
unknown-field guard) and M-1 (SystemRoot hardening); both are small. M-2 and M-3 can be recorded as decisions.
Score 8/10: the unwrap is strict and fails closed in every form I tried, and the deductions are for the removed
amendment signal, the environment-sourced trust root, and missing specs for the rejected path shapes.
