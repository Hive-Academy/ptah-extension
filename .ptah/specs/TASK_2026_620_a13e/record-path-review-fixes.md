# TASK_2026_620: record-path review fixes

## Changes

- `tools/mcp-bench/src/memory-skills/suites/memory/extraction.suite.ts:690-704`
  now requires at least one evaluated record before `allPass` can be true. An
  empty extraction fixture therefore produces `verdict: 'fail'`, rather than a
  vacuous pass. `extraction.suite.spec.ts:544-556` covers an empty facts file
  with a trusted matcher.
- `tools/mcp-bench/src/memory-skills/host/redact-secrets.ts:4-31` now accepts
  sensitive-key/value pairs separated by whitespace as well as `:` or `=`.
  It also redacts an unquoted `authorization:` value through the end of its
  line, while excluding quoted JSON-style authorization keys from that
  line-wide rule. `redact-secrets.spec.ts:24-31` adds the requested `apiKey`,
  `token`, and multi-word Authorization cases.
- `tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts:469-499`
  records a single redacted, newline-normalized retention note for each log
  file that cannot be read, then continues collecting the other files. The
  injected reader keeps the production default and makes the failure path
  deterministic in `memory-skills-host.spec.ts:788-800`.

## Checks

- `npx prettier --write` on the six changed source/spec files: passed.
- `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/host/redact-secrets.spec.ts --coverage=false --maxWorkers=2`: passed, 1 suite / 13 tests.
- `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/host/memory-skills-host.spec.ts --coverage=false --maxWorkers=2`: passed, 1 suite / 29 tests. Its existing intentional host-log write-failure test emits `Unable to retain redacted host log.` to stderr.
- `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/suites/memory/extraction.suite.spec.ts -t "fails instead of passing" --coverage=false --maxWorkers=2`: passed, 1 selected test (12 skipped).
- `npx tsc -p tools/mcp-bench/tsconfig.json --noEmit`: passed.
- `git diff --check`: passed.

An initial combined Jest invocation caught a missing `writeFileSync` test
import; it was added before the passing checks above. The full extraction
spec file was not retained as a completed run because its CPU-heavy existing
test set exceeded this session's command-output window; the new empty-case
test itself passed in the scoped selection above.
