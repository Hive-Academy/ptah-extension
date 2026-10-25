# Code Logic Review, Batch 1e (command identity relaxation)

Verdict: APPROVED (with Moderate/Minor follow-ups). Score 8/10. Blocking 0, Serious 0, Moderate 2, Minor 4.

Scope: `git diff HEAD -- libs/backend/codex-runtime/tools/` (evidence-harness.ts, evidence-failure-notes.ts, evidence-harness.spec.ts), plus surrounding runCase/onRequest/notification code read in place. Nothing executed (read-only). Reported checks (92/92, typecheck, lint) taken as given.

## 1. commandMatches (evidence-harness.ts:856-878)

Logic: exact equality returns true; otherwise requires win32, `expected` free of `"`, string input, and a full-anchored regex
`^"(<drive:\ or drive:/ or \\host\share\><no " CR LF>*)" -Command "([^" CR LF]*)"$`, then path basename `[\\/](powershell|pwsh)\.exe$` (case-insensitive), then `wrapper[2] === expected` (exact, case-sensitive).

Adversarial walk-through (all reasoned against the regex, not run):
- Embedded newline/CR in path or inner: excluded by `[^"\r\n]`. A trailing `\n` fails because JS `$` without the `m` flag only matches at end of input (spec covers trailing newline, line 80).
- `"` inside path: the path class excludes it, so the match cannot extend past the first closing quote; the `" -Command "` literal must follow immediately. Rejected (spec line 83).
- `;`, `&`, or any trailing text after the inner command: inner capture must be byte-identical to `expected`, and the closing `"` must be the last character. Extra text inside the quotes changes the capture and fails; text after fails the `$`. Because `expected` has no `"`, the inner capture cannot be split by a quote trick (this is why the `expected.includes('"')` guard matters; it is also enforced at construction, :1091).
- `-Command` variants: `-command`, `-c`, `-NoProfile -Command`, `-EncodedCommand` all fail the literal (case-sensitive). Fine (strict side).
- Case/unicode: the inner is compared with `===` so case and unicode lookalikes in the command fail. Case-insensitivity applies only to the basename check. A unicode lookalike in the path (for example `pwsh.exe` with a Cyrillic char) fails the basename test. Fullwidth/homoglyph slash variants are not `[\\/]`, so rejected.
- Basename tricks: `C:\evilpwsh.exe` fails (needs a separator before the name); `C:pwsh.exe` (drive-relative) and `powershell.exe` (bare) fail the prefix; `C:\pwsh.exe` passes (wrapper[1] still contains `\pwsh.exe`), which is correct.
- `C:\evil\powershell.exe`: accepted. Judgement: acceptable for this harness. The shell argv[0] is chosen by the Codex binary from its own environment, not by the model; the model only supplies the inner command, which is pinned exactly. The gate's job is command identity, not binary provenance. See Moderate 1 for a cheap tightening.
- UNC: accepted (`\\server\share\pwsh.exe`, spec line 62 asserts it). Same reasoning, but this is the widest part of the accepted set (remote executable); see Moderate 1.
- Redundant `wrapper[0] === observed` (:874) is harmless dead logic.
- Non-win32 and non-string observed: only exact equality. Correct.

No input other than the exact command or the exact wrapper form returns true. I could not construct a bypass.

## 2. Both gates use it

Grep of the file: command comparisons exist only at :944 (markerApprovalDecision, the actual accept/decline), :1206 (diagnostic shape recording before the decision), :1261 (item/started|completed notification, throws 'Unexpected command'). `noteWrapper` (:1133) only appends a note. No remaining `!== expectedCommand` gate. `markerApprovalDecision` returns 'accept' only through commandMatches for command/boundary kinds; non-matching returns 'decline'. The decision at :1200-1215 is computed independently of the selected policy, and the notification gate throws regardless. Approving a non-matching command is not possible through this path.

Residual: markerApprovalDecision/commandMatches default `platform = process.platform`; the decision-level spec cases (:834-960) do not feed a wrapper string, so wrapper acceptance through the real decision function is untested (Minor 3).

## 3. Marker script file

- Written at :1081-1085 with `{flag:'wx', mode:0o600}` in `experiment.root`, name `${item.id}-marker.cjs`, same pattern as the fixture (:1074). `wx` makes a collision fail loudly; ids are unique per case.
- argv: `node <file> <root> <target>` gives argv[2]=root, argv[3]=target. Correct (the old `-e` form used [1],[2]).
- Cleanup: lives in `experiment.root`, removed by createExperiment cleanup (:289) unless `--keep`; same lifecycle as the MCP fixture.
- Sandbox reads: the read-only policy (`readOnly`, :1401) permits reading; the fixture `.cjs` in the same directory already runs this way. The script is outside `workspace`, so a workspace-write model cannot modify it. No evidence of a problem; not run live (the orchestrator owns the live spike).
- Redaction: `markerScript` is passed to recordCommandShape (:1210, :1265, :1289) and replaced with `<MARKER_SCRIPT>` (failure-notes :151-154) with quote variants before generic path redaction. expectedCommand is not otherwise written to artifacts (only used in the prompt and comparisons). Errors thrown are fixed strings.
- Behavioural change worth noting: writeFileSync (:1081) happens before the `try`, so an exception there skips the guard/deadline setup (fine, nothing is open yet) but also leaves no result note; acceptable.

## 4. harnessFailed

Set in `catch` wrapping the whole main try body (:1461-1463) and rethrown, read in `finally` (:1466-1471). Every gate failure (Unexpected command, identity/safety, protocol, abort from guard/deadline via rpc rejection, usage missing) propagates as a throw through that try, so the note is suppressed. The flag only guards a note push; it is not read by any pass/fail logic. Failures before `turnId` is set are already suppressed by `!!turnId`. One soft path: `interrupt()` after a legitimate early outcome is not a failure, so the note can still appear when appropriate. Only the pure function is tested (spec 1157-1158); the catch wiring itself is not.

## 5. Shape redaction

failure-notes :147-150 replaces any double-quoted absolute path (drive or UNC) ending in powershell.exe|pwsh.exe|cmd.exe|bash|sh with `"<PATH>\<basename>"` before other redaction, so directories (including paths with spaces) are not leaked for those shells. `$1` keeps the original casing of the basename. Gaps: (a) quoted paths to other shells fall to the generic `[A-Za-z]:[\\/][^\s...]*` redaction, which stops at a space and can leak trailing directory fragments (Minor 4); (b) `"C:\pwsh.exe"` (root dir) does not match because the drive prefix consumes the only separator, so it is left unredacted but contains no directory (harmless).

## 6. Specs

Good: exact-match, per-platform, accept table including case and forward slash and UNC, a 11-row rejection table (relative, drive-relative, cmd, bash, extra flags, trailing text, trailing newline, case-changed inner, inner suffix, quote in path), double-quote inner, and non-win32. They test the function, so they assert real behavior. Weak or missing: the "builds a file-backed marker command" test is source-text `toContain` (brittle, proves nothing at runtime); no row for `C:\evilpwsh.exe`, lowercase `-command`, `\r` in path, or `;` after the closing quote; no decision-level test of wrapper acceptance; wrapper note and harnessFailed wiring untested.

## Findings

Moderate
1. evidence-harness.ts:863-877 (and spec :62): any absolute powershell.exe/pwsh.exe, including UNC and any directory (temp, experiment.root), is accepted. Not a bypass of the command pin, but it widens trust to binary location. Fix: reject UNC and paths under `experiment.root`/`tmpdir()`, or compare against the shell path Codex reports in its config/initialize if available; at minimum record the sanitized basename+dir class in a note.
2. evidence-harness.ts:1131-1463: harnessFailed suppresses the missing-approval note for every throw, including a deadline abort. Intentional and documented, but a real "no approval requested" regression that coincides with any later failure is now invisible. Acceptable; mention in the run report.

Minor
3. evidence-harness.spec.ts:834-960: no wrapper case through markerApprovalDecision; decision uses `process.platform` default so non-Windows CI cannot exercise it unless platform is injected.
4. evidence-failure-notes.ts:147: only listed shells are basename-preserved; other quoted paths with spaces can leak directory fragments in notes.
5. evidence-harness.ts:874: redundant `wrapper[0] === observed`.
6. evidence-harness.spec.ts:100-108: source-text assertions in place of behavioral ones; add rows listed under item 6 above.

## Five questions (brief)

1. Silent failure: harnessFailed hides a note on any throw (Moderate 2); no success-looking wrong result.
2. User action: running with `--keep` leaves the script in the temp root (as before for the fixture).
3. Wrong-answer input: none found for the gate; a shell path with a space and unlisted name leaks fragments into notes only.
4. Dependency: if Codex changes display format (`-NoProfile`, cmd wrapper), the gate fails closed with a diagnostic shape; correct failure direction.
5. Missing: provenance of the shell binary; behavioural test of the marker script invocation under node (not executed in this review; live run 6c should confirm argv[2]/[3] and read-only readability).
