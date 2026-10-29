# Security review - Batch 8q-1 (TASK_2026_714_c8a2)

Files: codex-read-only-command.ts / .spec.ts, codex-chat-approval-sink.ts / .spec.ts (agent-sdk, codex-app-server).
Method: read the diff and the full classifier and sink request path; no tests or tools were run (per instructions).

## Verdict: APPROVE - score 8.5/10

Blocking: 0. Serious: 0. Moderate: 0. Minor: 4.

## Attack matrix (classifier, platform win32)

| Attack | Result | Evidence |
| --- | --- | --- |
| Non-ASCII dashes U+2013/2014/2015, any non-ASCII | Rejected before parsing: `forbidden` has `[^\x20-\x7e]` | ts:12, 52 |
| Parameter abbreviations (-Lit, -Tot, -Pa), `-Path:value`, `-Raw:$false`, `--%`, bare `-` | Rejected: exact lowercase match against a fixed allowlist; anything else hits the final `else return undefined` | ts:121-148 |
| Case variants | Accepted only as the same allowlisted names (`toLowerCase`) | ts:128 |
| Duplicate parameters, TotalCount+Head/First, -Path+-LiteralPath, positional+named path | Rejected (`seen`, `countSeen`, `pathValue !== undefined`) | ts:123, 129-139 |
| `-Wait`, `-Stream`, `-Filter`, `-Include`, `-Recurse`, `-Force`, `-Encoding`, `-ReadCount`, `-Credential` | Rejected as unknown (no blocking, no ADS, no recursion) | ts:131-146, spec 40-72 |
| Wildcards `* ?` anywhere; `[ ]` for -Path / positional | Rejected; brackets allowed only for the single -LiteralPath value, where PowerShell treats them literally | ts:97-98, 183, 189 |
| Provider paths `Env:`, `HKLM:`, `FileSystem::`, drive-relative `C:foo`, `C:`, ADS `f:s`, `\\?\`, UNC | Rejected: any colon other than `X:\path-without-colon`, any leading `\` or `//` | ts:104-106 |
| `~`, `a,b` multi-path, arrays | Rejected (`startsWith('~')`, comma on win32) | ts:97-99 |
| `..` escape, absolute outside | `path.win32.resolve` plus `pathWithin(threadCwd)`; sink then realpaths cwd and each path (symlink/junction gate) | ts:107-108; sink 171-192 |
| Reserved device names (CON, NUL.txt, COM1), trailing dot or space | Rejected per segment; `$`-suffixed names die on `$` | ts:101-103, 12 |
| Integers: leading zeros, huge, signed, unicode digits | `^\d{1,6}$` (ASCII only in JS); leading zeros are harmless; 7+ digits and signs rejected | ts:134 |
| -Tail with -TotalCount, -Raw with -TotalCount | Accepted; both are read-only and bounded or no worse than the existing unbounded Get-Content | ts:133-139 |
| Switch swallowing a value (-Name/-File/-Directory/-Raw) | The next token is re-parsed as a path or parameter, never skipped; only `paths` values reach containment | ts:140-143 |
| `-Path -Raw` (dash-prefixed value) | Value `-Raw` rejected by `startsWith('-')` | ts:188 |
| Get-ChildItem with no path | Lists process cwd; `cwd` itself is checked lexically and by realpath (`targets = [cwd, ...]`). The assumption that the process cwd equals the request cwd is pre-existing (the old grammar already allowed this) | ts:150, sink 180 |
| Quoted dash tokens (`'-Path'`) | Tokenizer drops the quote flag, so the classifier treats the token as a parameter while PowerShell treats it as a positional string. I traced this: every divergence ends in a PowerShell binding error or a literal name inside cwd (e.g. `Get-ChildItem src '-Name'` makes PowerShell use a Filter of `-Name`). No path is hidden from the containment check; no escape found | ts:49-86 |
| Code execution, writes, network | No allowlisted parameter takes a script block, credential, or URL; `$ ; & ` { } ( )` are forbidden characters; Set-Content etc. are not in the command set | ts:5-12 |
| Blocking forever | `-Wait` rejected; no pipe-reading device names. Residual: a file inside cwd that is a FIFO or an enormous file (see Minor 1) | - |

## Sink log (reason line)

- `logReadOnlyNotAccepted` (sink.ts:159-169) emits only a closed-union `reason`, a fixed `code`, and three booleans. No command, cwd, path or token is passed; the catch branch (118) and the path-not-inside branch (148) use the same helper. Specs assert the serialized logger args exclude command text, path and cwd (spec diff lines 42-46, 67-70, 92-95).
- Accept and decline decisions: the refactor splits the old boolean into `levelIsAsk` and `detailsPass` but keeps the same conjunction and the same classifier call (sink.ts:123-129). The `classified && cwd string && threadCwd` branch and the realpath gate are unchanged. Only the new log call was added to the fall-through paths. No decision change outside the grammar.
- -Head/-First: the lane cites Microsoft Learn Get-Content (5.1), -TotalCount aliases First and Head. This matches my knowledge of the documented aliases; I did not re-fetch it. Acceptance is only exact alias names, and sharing one slot with -TotalCount is correct.

## Spec runtime on Linux CI

The grammar specs call `classifyReadOnlyCommand(..., 'win32', ...)` with explicit `C:\...` paths, and the classifier uses `path.win32`, so they run and assert on Linux (spec lines 20-70). The sink log specs build the sink with platform win32 (spec line 74) and run everywhere. Only the real-temp-folder TotalCount spec is skipped off Windows (sink spec line 145, `it.skip`); that is an intentional, disclosed skip and the lexical grammar is covered elsewhere. Not all specs are skipped.

## Findings

### Minor 1 - Unbounded read size on accepted commands
`Get-Content -Raw` or plain `Get-Content` on a very large (or FIFO) file inside cwd can use memory or time. Pre-existing for plain Get-Content; -Raw adds nothing new in kind. Accept; the user can cancel the turn.

### Minor 2 - Mislabelled reason in the cwd-URI catch
sink.ts:118 reports `cwd-uri-invalid` for any command request, even when the level is not `ask` or the details gate would have failed first. Diagnostic accuracy only; no security impact. Likewise line 154 labels a missing `threadCwd` as `cwd-uri-invalid`.

### Minor 3 - Quote information is lost in tokenize
Tokens carry `quoted` but stages keep only `value` (ts:214-218), so a quoted `'-Raw'` is parsed as a parameter. Not exploitable today (see matrix) and the allowlist is exact, but a future parameter that takes a path-like value would make this divergence worth closing by rejecting quoted dash-leading tokens.

### Minor 4 - Info log on every non-command fall-through
`not-command` fires for each file-change request. Content-free, so only log volume.

## Residual uncertainty
The real PowerShell binding behaviour for the quoted-dash divergence was reasoned from the documented parameter positions, not executed. The process-cwd equals request-cwd assumption for no-path Get-ChildItem is inherited from the earlier grammar.
