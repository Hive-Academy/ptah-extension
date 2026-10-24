# Batch 1f report

Implemented the requested harness command and diagnostic changes in the assigned worktree.

## Changes

- `libs/backend/codex-runtime/tools/evidence-harness.ts:882`: extracted the existing command construction into testable `markerCommand`. On win32 all four command paths use forward slashes; double quotes and remaining backslashes fail with allowlisted literal errors. Native paths used for checks remain unchanged.
- `libs/backend/codex-runtime/tools/evidence-harness.ts:1105`: expectedCommand uses process.execPath, marker script, experiment root and target through that helper. The prompt at line 1416 interpolates that same command.
- `libs/backend/codex-runtime/tools/evidence-harness.ts:636`: MARKER_WRITER resolves root and target before traversal, ensuring its string comparison of parent against realpath root works with forward-slash input. Symlink, confinement, exclusive-create and repeat checks remain intact.
- `libs/backend/codex-runtime/tools/evidence-failure-notes.ts:45`: allowlisted the backslash invariant error.
- `libs/backend/codex-runtime/tools/evidence-failure-notes.ts:150`: added slash variants specifically for marker-script redaction. Existing node/root/workspace replacement machinery already includes these variants.
- `libs/backend/codex-runtime/tools/evidence-failure-notes.ts:180`: classification now compares original observed and expected text, strips only the exact accepted PowerShell wrapper shape, and checks doubled backslashes, slash direction, case only, whitespace, quoting, wrapper, other in order. Only labels enter the difference note. Equality is excluded from difference categories; identical unwrapped text falls through to other.
- `libs/backend/codex-runtime/tools/evidence-harness.ts:858`: commandMatches remains unchanged; no normalization was added to identity or approval gates. Turn/usage/deadline/cleanup gates remain unchanged.

## Specs

Added in `libs/backend/codex-runtime/tools/evidence-harness.spec.ts`:

- Line 114: builds Windows command paths with forward slashes and no double quotes.
- Line 132: rejects doubled backslashes and slash variants at the identity gate.
- Line 144: writes a confined marker with forward-slash root and target paths. Extracts the actual MARKER_WRITER literal and invokes it in a VM context against a temporary directory, with cleanup in finally.
- Line 177: parameterized classification cases cover every label and an accepted wrapper containing doubled inner backslashes, and assert private path text is absent from notes.
- Forward-slash redaction spec verifies NODE, MARKER_SCRIPT, ROOT and WORKSPACE placeholders.
- Updated the existing construction assertion for the extracted helper, wrapper-label assertions to the new wrapper label, and accepted-wrapper classification to other after exact stripping.

## Decisions

- Extract command construction into a small exported helper in the existing harness rather than testing only source text. Evidence: existing harness exports testable gate helpers; this lets the spec explicitly select win32 on any host. Reversible internal change.
- Normalize marker arguments with path.resolve rather than relax the parent/root comparison. Evidence: MARKER_WRITER compared path.dirname(target) directly with fs.realpathSync(root), which can differ by slash direction on Windows. Reversible, preserves confinement.
- Expand marker-script variants separately before general path redaction. Evidence: the script previously used variants(markerScript), unlike the general path list that already generated slash variants. This preserves the specific placeholder before ROOT replacement. Reversible.
- Classify raw commands before redaction and require an actual difference for each normalization label. Evidence: redaction can erase differing paths, and whitespace collapsing in shape() previously erased diagnostic distinctions. These are diagnostic-only comparisons and never approval inputs. Reversible.
- Use the requested wrapper label consistently in these specs; accepted wrapper plus identical inner text is other, since it has no unsupported wrapper or inner difference. Reversible diagnostic labeling.

## Verification and limitations

- Scoped ptah_get_diagnostics on all three edited TypeScript files after final edits: zero errors, zero warnings, coverage clean.
- No nx, Jest, tsc CLI, lint, formatter, package-manager, build, Codex binary or model execution was performed. Specs are added but unrun; Windows runtime acceptance remains unverified until the orchestrator runs them.
- No Git operations or unrelated source edits were performed. Existing source content was preserved outside the described edits; unrelated working-tree changes were not inventoried because this lane does not run Git.
- ptah_search_files returned zero instruction-file matches under libs; one native rg fallback likewise found none.
- Only the three assigned source/spec files and this requested report were written. No task state was edited.
