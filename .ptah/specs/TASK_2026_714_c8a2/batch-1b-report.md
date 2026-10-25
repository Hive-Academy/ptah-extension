# Batch 1b bounded evidence-harness fix

Changed only the two assigned source/spec files and this report.

- `libs/backend/codex-runtime/tools/evidence-harness.ts:20`: shared header accepts optional nonnegative integer `emittedAtMs`; all four envelope schemas retain `.strict()` and their existing field validation.
- `libs/backend/codex-runtime/tools/evidence-harness.ts:46`: explicit allowlist contains only fixed harness-authored failure messages. `recordCaseFailure` at line 102 uses realm-safe structural checks, deduplicates notes, and records other failures as `unclassified error (<safe error name>)` without their message or stack.
- `libs/backend/codex-runtime/tools/evidence-harness.ts:113`: decoder retains only rejected top-level key names, filtered by `/^[A-Za-z0-9_./:-]+$/` and capped at ten. Frame values and Zod diagnostics are not retained in notes. Invalid JSON and oversized frames do not expose key diagnostics.
- `libs/backend/codex-runtime/tools/evidence-harness.ts:339`: frame failures record the fixed reason and permitted key names. First asynchronous child failure is recorded at line 352; normal teardown does not add a false failure. The case catch at line 816 now records a sanitized reason.
- `libs/backend/codex-runtime/tools/evidence-harness.spec.ts:27`: added newline-delimited timestamp notification coverage, invalid timestamp and unknown-field rejection, fake-child failure notes with key filtering/cap and no values, realm-safe unknown-error sanitization/deduplication, and normal teardown coverage.

## Decisions

- Use an explicit message allowlist rather than generic string redaction: fixed harness messages are reviewable; arbitrary dependency messages can contain secrets. Evidence: existing literal Error sites and the requested privacy constraint. Reversible locally.
- Allow only known error names; normalize unknown/custom names to `Error`. An arbitrary name can itself contain credentials or paths. Options were raw names, pattern-filtered names, or known names; known names best enforce the requested confidentiality. Reversible locally.
- Reuse existing fakeChild and structural test style; no new dependency, process execution, or test infrastructure.

## Verification and open doubt

The required `ptah_get_diagnostics` call was scoped to the two edited files and returned zero errors/warnings with clean coverage; it reported `typescript-compiler` as its source. No native nx, jest, tsc, lint, build, Codex binary, or git command was run. Regression specs were written but not executed; the orchestrator must run scoped checks under its shared slot. No real app-server run is claimed. The provided notification's unspecified params were represented as `{}` in the decoder regression.
