# TASK_2026_620 Closeout: Small Memory-Skills Fixes

## Changes

- `tools/mcp-bench/src/memory-skills/doubles/recorded-curator-llm.ts:197` now applies the two model-free `resolve` outcomes before replay fault lookup or record-mode provider dispatch. The shared implementation is at `:226`.
- `tools/mcp-bench/src/memory-skills/doubles/recorded-curator-llm.spec.ts:140` proves faults keyed to both model-free resolve shapes do not fire. Existing resolve-fault tests now use a related candidate so they remain provider-bound fault coverage.
- `tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts:213` adds a narrow test seam for the diagnostics writer. `acceptRecording` passes it through at `:386`, and `rejectRecording` at `:746` writes diagnostics best-effort, emits one stderr line on failure, discards staged cassettes, then rethrows the original `RecordingRejectedError`.
- `tools/mcp-bench/src/memory-skills/host/memory-skills-host.spec.ts:884` covers a diagnostics-write failure and verifies the staged curator cassette is removed while the provenance `RecordingRejectedError` is preserved.
- `tools/mcp-bench/src/memory-skills/ground-truth/fixture-manifest.spec.ts:152` checks each durable fact against a memory row with `question` as `subject` and `statement` as `content`. It passed for every fact; fixtures and `MANIFEST.json` were not changed.
- `tools/mcp-bench/src/memory-skills/suites/memory/extraction.suite.spec.ts:87` updates the self-match-share docblock to describe the fixture-faithful question/statement memory and the extract-all baseline it bounds.

## Checks run

- `npx prettier --write` on the six changed source/spec files: completed successfully; the final pass reported all unchanged.
- `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/doubles/recorded-curator-llm.spec.ts tools/mcp-bench/src/memory-skills/host/memory-skills-host.spec.ts tools/mcp-bench/src/memory-skills/ground-truth/fixture-manifest.spec.ts tools/mcp-bench/src/memory-skills/suites/memory/extraction.suite.spec.ts --coverage=false --maxWorkers=2`: passed — 4 suites, 75 tests, 0 snapshots; 140.203 s. The injected writer failure emitted the expected one-line stderr note. Jest also emitted a Windows native-module cache `EPERM` warning, but all tests passed.
- `npx tsc -p tools/mcp-bench/tsconfig.json --noEmit`: passed with exit code 0 and no diagnostics.
- `git diff --check`: passed with no output.

No benchmark, build, serve, e2e, package, or workspace-wide command was run. `dist/` was not changed.
