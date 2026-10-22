# AGY diagnostics revision 1

## Changes by defect

- **D1:** `antigravity-cli.adapter.ts:167` accepts any `result.error` JSON shape. `antigravity-result-diagnostics.ts:33-43` displays only a string or string `code`/`message` from an object. Tests at `antigravity-cli.adapter.spec.ts:961,1033` cover ERROR with `error: 123` and SUCCESS with `error: null`.
- **D2:** `antigravity-result-diagnostics.ts:3-9` redacts cookie, set-cookie, and session keys and inline text, including `Cookie:` headers. The failed-result test at `antigravity-cli.adapter.spec.ts:977-1018` checks nested cookie/session fields and a split stderr cookie header.
- **D3:** `antigravity-cli.adapter.ts:855-862` resolves failed stream turns with 1 when the result arrives and ends stdin. The close handler at `:922-946` still emits captured stderr and exit evidence. The test at `antigravity-cli.adapter.spec.ts:961` awaits completion before closing the fake child and verifies continuation is unavailable.
- **D4:** `antigravity-cli.adapter.ts:748-751,984-990` resets failed-result state and error buffers for each turn. At `:929-946`, successful exit-0 turns with only `AGY_ERROR` evidence receive a warning and no close-time `[Error]` segment. The test at `antigravity-cli.adapter.spec.ts:1042` covers an anomalous later SUCCESS and AGY_ERROR.
- **D5:** `antigravity-cli.adapter.ts:916` preserves the flush handler's failure code, even when the process exits zero. The test at `antigravity-cli.adapter.spec.ts:1114` covers an unterminated malformed result.
- **D9:** `antigravity-cli.adapter.ts:870-925` buffers stderr through line completion and redacts AGY_ERROR before output and segment emission. The split-line test at `antigravity-cli.adapter.spec.ts:977-1018` checks the transcript for secrets.
- **D6 (partial):** `antigravity-cli.adapter.ts:893` retains the start of an overlong incomplete stderr line so its AGY_ERROR prefix remains detectable.
- **D7:** `antigravity-cli.adapter.ts:935` skips the generic nonzero-exit segment when the failed-result close detail already reports the exit.
- **D8:** `antigravity-cli.adapter.ts:1124` suppresses phantom tool-call segments for ERROR-state tool steps.
- **D10:** `antigravity-cli.adapter.ts:940-946` settles the process and turn before calling the logger, so a logger exception cannot leave those promises pending.

## Verification

Command: `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.spec.ts --coverage=false --maxWorkers=1`

```text
Test Suites: 1 passed, 1 total
Tests:       56 passed, 56 total
Snapshots:   0 total
Time:        16.737 s
```

Scoped `ptah_get_diagnostics` was called after edits for the three changed TypeScript files. It reported the TypeScript check unavailable after 45 seconds; no diagnostics result was produced. No Nx, build, lint, serve, or e2e command was run.

## Decisions

- **Failed-turn completion:** Chose immediate result-time settlement with late close evidence over a bounded grace timer. The pre-diff adapter settled at result time and the review identifies hangs as the regression. Reversible.
- **Unknown error values:** Kept the full unknown value in the parsed event for diagnostics, while formatting only known string fields for the user. This preserves the prior passthrough event contract. Reversible.
- **Stderr buffering:** Redacted completed AGY_ERROR lines before transcript emission, including values split across stream chunks. This changes stderr emission timing to line completion. Reversible.
- **Successful AGY_ERROR:** Warned through the injected logger and retained exit 0 without a close-time error segment. The review requires turn outcome and segments to agree. Reversible.

## Not done

- D6's ERROR-step payload memory cap and 1 KiB captured-line truncation remain; both require more than a one-line change and were outside this revision's requested fixes.
- Scoped TypeScript diagnostics remained unavailable after the service timeout.
