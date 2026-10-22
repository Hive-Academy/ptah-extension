# Batch 48 report

## What changed

- Corrected the rubric sampler's data source to `snapshots/pre-0057/receipt.json`. It now uses the batch 47 `readArchiveTable` reader for candidate, queue, and suggestion JSONL rows, with receipt and SHA-256 verification. Candidate metadata, transcript turn maxima, and suggestion fields retain their prior shapes.
- Derived promoted skill names from archived candidate rows with `status: promoted` instead of a source constant. The two removed hard-coded slugs were `execute-phase-gated-task` and `extract-and-relocate-angular-component-feature`.
- Updated the sampler spec to use synthetic promoted names. The existing `snapshotSha256` output field now contains the verified candidate JSONL digest, preserving the output key.

## Acceptance rg result

`rg -n 'skill_candidates|FROM skill_|SELECT' tools/mcp-bench/src/memory-skills/labelling/select-rubric-sample.ts` returned two references: a documentation comment for `skill_candidates.name` and the `readArchiveTable(receiptPath, 'skill_candidates')` call. It returned no `FROM skill_` or `SELECT` hits and no live SQL against a 0057 table. Neither removed slug appears in the sampler or its spec.

## Decisions

- Use archived `status: promoted` as the source of promoted names while keeping the existing promoted stratum and deterministic selection logic.
- Preserve the `snapshotSha256` result key for consumers; its value is the verified candidate archive digest.
- Do not run tests, typecheck, lint, build, serve, or e2e, as instructed.

## Clarifications Needed

none
