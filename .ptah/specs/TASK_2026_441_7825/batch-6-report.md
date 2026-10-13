# Batch 6 report

## Files changed

- `tools/mcp-bench/fixtures/memory-skills/skill-triggers.v1.jsonl` — deleted.
- `tools/mcp-bench/fixtures/memory-skills/skill-triggers.v2.jsonl` — added 22 rows, preserving the other rows byte for byte, LF line endings, and trailing LF.
- `tools/mcp-bench/fixtures/memory-skills/MANIFEST.json` — replaced the retired entry and hash.
- `tools/mcp-bench/src/memory-skills/suites/skills/trigger-human-eval.ts` — updated default target, version, and expected count.
- `tools/mcp-bench/src/memory-skills/ground-truth/committed-u4-labels.spec.ts` — updated fixture and 22 row assertions.
- `tools/mcp-bench/src/memory-skills/suites/skills/namer-and-trigger.suite.spec.ts` — updated temp fixture paths and version/count assertions.

## Hash

The manifest uses SHA-256 of raw file bytes via `sha256File`, not canonical JSONL. New hash: `6c43ca137984d675208563b74920c2c79d1240c95b8921ebf9c2bebd8735405e`.

## Verification

Command: `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/ground-truth/committed-u4-labels.spec.ts tools/mcp-bench/src/memory-skills/ground-truth/fixture-manifest.spec.ts tools/mcp-bench/src/memory-skills/ground-truth/seeded-session-generator.spec.ts tools/mcp-bench/src/memory-skills/suites/skills/namer-and-trigger.suite.spec.ts tools/mcp-bench/src/memory-skills/projection.spec.ts --coverage=false --maxWorkers=2`

Result: 5 suites passed; 72 tests passed; 0 failed. The first run failed because the worktree lacks a local `node_modules/marked`; the successful run used a temporary Jest mapper to the parent checkout's installed module, which was then removed. Jest also warned that a worker did not exit gracefully.

Whole-worktree searches excluding `node_modules`, `.git`, `.nx`, and `.ptah`: removed skill identifier, 0 hits; retired v1 fixture name, 0 hits.

Verdict: **COMPLETE**.
