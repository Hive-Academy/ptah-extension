# TASK_2026_707 PR 1 backend fix round 1

## Previous lane's partial edits

The working tree already contained the mixed-result `statusReason` mapping, per-endpoint cache entries, an owner-keyed in-flight promise, a streamed body cap, the Ollama parser split, and CLI error categories. These edits were untested when handed off. The reader was still 315 lines, and the CLI sign-in matcher missed the explicit “not logged into Antigravity” and bare “login” phrases. The shared type already had one definition containing the exact requested reason union.

## Defects fixed and verified

1. **Mixed Ollama auth rejection:** `ollama-cloud-plan-usage.reader.ts:216,248` keeps valid windows or usage and exposes `balance-auth-rejected` or `usage-auth-rejected`. Both rejected endpoints remain `unsupported-auth`; `plan-limit.types.ts:184` defines the exact shared union once. Tests: `balance HTTP %i with usage OK stays available and says %s` and `usage HTTP %i with balance OK keeps the windows and says usage-auth-rejected` (`ollama-cloud-plan-usage.reader.spec.ts:463,479`).
2. **Balance failure, cooldown and concurrency:** `ollama-cloud-plan-usage.reader.ts:80,139,149,248` gives a usable usage-only reading `balance-unavailable`, caches each endpoint through its own cooldown, and shares one in-flight request pair per owner. Tests: `an unreadable balance body with usage OK says balance-unavailable`, `429 on one endpoint only delays that endpoint`, and `concurrent reads of one owner share one request pair` (`ollama-cloud-plan-usage.reader.spec.ts:473,523,561`).
4. **CLI failure classification:** `antigravity-cli-usage.adapter.ts:183,190` distinguishes missing binary, timeout/killed, sign-in text, non-zero exit, and generic failure. The matcher now accepts “not logged into Antigravity” and “login”; failed output is never parsed as usage. Tests: `classifies %s as %s` and `never parses a failing run output as usage` (`antigravity-cli-usage.adapter.spec.ts:147,156`). The 10 s abort, argv array, 64 KiB cap and strict tab parser remain in place.
5. **Bounded Ollama response parsing and split:** `ollama-cloud-usage.parsers.ts:20` counts streamed bytes and cancels on overflow; its null-body fallback checks the text byte length. Test: `a body over the cap is cancelled mid-stream, not buffered` (`ollama-cloud-plan-usage.reader.spec.ts:499`). The reader is now 279 lines and parser 220 lines, each under 300.

## Verification

- Targeted Jest: 2 suites passed, 70 tests passed; `--coverage=false --maxWorkers=1`.
- `NX_NO_CLOUD=true npx nx typecheck auth-providers --parallel=1`: succeeded for `@ptah-extension/auth-providers`.
- Scoped `ptah_get_diagnostics` after edits: 0 errors, clean coverage.
- Jest emitted a Node warning about loading the TypeScript Jest config as an ES module; the command exited 0.

## Decisions

- Kept the previous lane's independent endpoint outcomes and owner-keyed in-flight promise. Options were to discard partial data or share one global cooldown. The review and mixed-result requirements require retaining good data and retrying each endpoint after its own cooldown. Reversible.
- Moved the bounded JSON response reader into the existing Ollama parser file. Options were line compaction or another helper file; the parser owns JSON decoding and this keeps both requested files under 300 lines. Reversible.
- Recognized explicit sign-in words only on failed CLI process output. Options were broad stderr parsing or treating every non-zero exit as sign-in; the requested contract limits sign-in to clear phrases and forbids parsing failure output as usage. Reversible.

## Limitations

The response-body-null fallback must call `Response.text()` because no stream is exposed; its resulting text is still rejected when it exceeds 256 KiB. No work remains in this batch.
