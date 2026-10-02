# Batch 17 Report — TASK_2026_576_e16a

## Files Changed

- `libs/backend/vscode-core/src/services/git-review-reader.service.ts`
- `libs/backend/vscode-core/src/services/git-review-reader.service.spec.ts`

## Summary of Changes

Updated `GitReviewReaderService.readBlob` to align with `GitInfoService.readBlob`:

1. **Capped `git show` output** to `GIT_DIFF_MAX_SIDE_BYTES` (2 MiB) via `maxOutputBytes` passed to `bufferGitRunner`.
2. **Reused blob classification** by returning `classifyBlobBytes(show.stdout)` on exit 0, which now handles `too-large`, `lfs-pointer`, `binary`, and `content` outcomes from a single chokepoint.
3. **Handled oversized blobs** by catching `GitOutputLimitError` and returning `{ outcome: 'too-large', byteLength }`, where `byteLength` comes from `git cat-file -s <spec>` (falling back to the cap if the size probe fails).
4. **Preserved existing behavior** for `absent`, `submodule`, and generic `error` outcomes.
5. **Removed the local `BINARY_SNIFF_BYTES` constant**; binary sniffing now lives in the shared `git-blob-classifier`.
6. **Added a private `blobSize` helper** mirroring the implementation in `GitInfoService`.

### Tests Added

Added four new test cases to `git-review-reader.service.spec.ts`:

1. Blob past the per-side cap reports `too-large` with its real byte size from `cat-file -s`.
2. `too-large` falls back to `GIT_DIFF_MAX_SIDE_BYTES` when the size probe fails.
3. A Git LFS pointer blob is classified as `lfs-pointer` with the correct `oid` and `size`.
4. `bufferGitRunner` is invoked with `maxOutputBytes: GIT_DIFF_MAX_SIDE_BYTES`.

## Verification

Command run:

```bash
npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-core
```

Results:

- `typecheck`: passed
- `test`: passed
- `lint`: passed

Run duration: ~33s. All three targets completed successfully.

## Deviations

None. Changes match the requested scope and pattern.

## Out-of-Scope Observations

None.
