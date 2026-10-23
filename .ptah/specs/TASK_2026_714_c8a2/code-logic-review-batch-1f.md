# Code Logic Review - Batch 1f (TASK_2026_714_c8a2)

Verdict: APPROVED, 7/10. 0 Blocking, 0 Serious, 2 Moderate, 3 Minor.
Scope read: full diff of `libs/backend/codex-runtime/tools/`, `commandMatches`, `MARKER_WRITER`, `recordCommandShape`, the new specs. No checks run (read-only).

## Checks requested

1. markerCommand (evidence-harness.ts:882-901): OK. On win32 each path is converted to forward slashes only for the command text. File checks and `writeFileSync` still use the real `join()` paths in `runCase` (the `markerScript` variable). The double-quote check throws the allowlisted 'Command path contains a double quote'. 'Command path contains a backslash' is added to `failureMessages` (evidence-failure-notes.ts:45). The backslash throw is unreachable on win32, because every backslash was just replaced (see Minor 1). It is a harmless belt-and-braces check.
2. MARKER_WRITER (evidence-harness.ts:636-637): protections not weakened. `path.resolve` is lexical only. It does not follow symlinks, so `lstatSync(root).isSymbolicLink()`, the per-ancestor `lstat`/`realpath` within-checks, `O_EXCL|O_NOFOLLOW` and the re-checks all run on the same objects as before. The only behavioural change is that `..` segments and a trailing slash are now normalised before `path.dirname(target)` and the `lstat(root)` call. That makes the parent walk stricter, not looser. A target outside the root still fails `within()`. On Windows `path.resolve('C:/a/b')` gives `C:\a\b`, the same real path. The MCP fixture also calls `writeMarker`, and the added resolves are harmless there.
3. commandMatches (evidence-harness.ts:858-880): not in the diff and still exact. Exact equality, or exactly the powershell/pwsh wrapper with an inner command equal to `expected`, on win32 only. The gate was not loosened.
4. Labels: they come from a fixed set and never include command text. The order is doubled backslashes, slash direction, case only, whitespace, quoting, wrapper, other. The wrapped command is unwrapped first, so the labels are computed on the inner command. See Moderate 1 for a gap in the doubled-backslash label.
5. Redaction (evidence-failure-notes.ts:152-158): the marker script is replaced in as-is, forward-slash and backslash variants, and the path list already had slash variants. The new spec at evidence-harness.spec.ts:~228 asserts all four forward-slash paths map to `<NODE>`, `<MARKER_SCRIPT>`, `<ROOT>` and `<WORKSPACE>`.
6. Specs: the gate-rejection test, the forward-slash writer test and the redaction test assert real behaviour. The weaker ones are noted below.

## Findings

### Moderate 1 - the doubled-backslash label cannot fire for the command Batch 1f now emits (evidence-failure-notes.ts:206-208)
The check is `inner.replace(/\\\\/g, '\\') === expected`. `expected` is now all forward slashes on win32, so it can only match when the observed command has no backslashes at all. If Codex or the model again reports a doubled-backslash command, collapsing gives single backslashes, which is not equal to the forward-slash expected value. The "slash direction" check then fails too, because `\\` becomes `//`. The label falls to "other", so run 6d would lose exactly the diagnostic the batch was meant to add.
The label specs (spec ~line 180-200) pass only because they supply backslash `expected` strings, which `markerCommand` can no longer produce on win32. The spec therefore tests an impossible input.
Fix: normalise both sides before comparing. For example `collapse = (v) => v.replace(/\\\\/g, '\\')`, then compare `collapse(inner).replace(/\\/g, '/') === expected.replace(/\\/g, '/')`. Check "doubled" by testing `inner.includes('\\\\')` first. Add a spec row with observed doubled backslashes and forward-slash expected.

### Moderate 2 - no negative writer test through forward-slash input (evidence-harness.spec.ts ~124-170)
Only the happy path with forward slashes is tested: a confined marker is written. The new `path.resolve` lines changed the input handling, but nothing shows that a forward-slash `target` outside the root, `root/../x`, or a symlinked parent is still refused. I reasoned that the protections hold, but the evidence is by reading, not by test. Add two or three refusals using forward-slash paths.

### Minor
1. evidence-harness.ts:898 - the backslash throw is dead on win32. On other platforms backslashes are legitimate and are not checked. The invariant is true by construction, so a spec for it is impossible.
2. evidence-harness.spec.ts:~104-110 - `readFileSync` of the source plus `toContain` assertions test text, not behaviour. They break on formatting changes and prove nothing at runtime.
3. The "rejects doubled backslashes" spec relies on the earlier `expected` fixture containing backslashes. Make that dependency explicit, or it passes vacuously the day the fixture changes to forward slashes.

## Five questions (short)
- Silent failure: none new. A mismatch still stops the run with a coded note.
- Unexpected action: a model that rewrites the path to backslashes is now stopped by the exact gate and labelled "slash direction" (single) or "other" (doubled; see Moderate 1).
- Wrong answer: none. Win32 UNC paths become `//server/share`, which PowerShell accepts. Single quotes in paths are doubled. `$` and backtick are safe inside single quotes.
- Dependency failure: not changed.
- Missing: the doubled-backslash diagnostic noted above.
