# Batch 50 report

Created `scripts/prune-skill-history.ts` and `scripts/export-skill-pipeline-archive.ts`, with focused specs. The prune script was absent in this worktree despite the task description saying it existed. No tests, typecheck, lint, build, or script invocation was run, as requested.

## OP-1 dry-run commands

Run with Ptah closed and a quiescent SQLite database. Substitute the user's actual DB path and an audited provenance JSON path:

```powershell
npx ts-node --project scripts/tsconfig.json scripts/export-skill-pipeline-archive.ts --db "<user-db.sqlite>" --output-root "<private-temp-archive-dir>"
npx ts-node --project scripts/tsconfig.json scripts/prune-skill-history.ts --provenance "<audited-provenance.json>" --manifest "<private-temp-prune-manifest.json>"
```

The export prints its archive path, private database copy path, and each table's presence, row count, and SHA-256. The prune dry-run prints every selected file's absolute path and SHA-256 and writes the same manifest. Its default root is `~/.ptah/user`; `--root` is available for isolated fixtures. An audited provenance file is an array of `{ "snapshot": "<absolute path>", "source": "<absolute upstream path>", "sidecar": "<absolute origin sidecar path>", "operation": "seed", "sourceHash": "sha256:<hex>" }`; `fast-forward` is also accepted. The historical snapshot format itself contains no operation tag, so this ledger must be independently established before any nonempty prune.

Only after OP-1 confirmation and the verified archive receipt is available, the user can apply the exact manifest:

```powershell
npx ts-node --project scripts/tsconfig.json scripts/prune-skill-history.ts --apply --provenance "<audited-provenance.json>" --manifest "<private-temp-prune-manifest.json>" --archive-receipt "<archive-dir>/receipt.json"
```

## Safety guards and spec coverage

| Guard | Implementation | Spec |
| --- | --- | --- |
| Snapshot path remains inside user `.history`, with no symlink traversal | `checkedPath` in prune script | dry-run fixture and changed-hash case |
| Only audited seed/fast-forward entries qualify; snapshot and upstream must match the sidecar source hash; diverged/enhanced entries are excluded | `dryRun` | dry-run manifest and user-edit preservation |
| Apply requires a verified batch 15 archive receipt and a manifest; it re-derives eligibility and checks all hashes before deleting any file | `applyManifest` | missing receipt/manifest, unknown hash, changed hash |
| Source DB is copied before any SQLite connection; only the copy is opened, read-only; WAL/journal sidecars are refused | `exportArchive` | temp SQLite export and sidecar refusal |
| Source size, mtime, and SHA-256 are checked after export; receipt and JSONL are verified from disk | `exportArchive` and batch 15 verifier | source invariants, counts, digest, receipt |
| Archive root and directory use mode 0700; copy, JSONL and receipt use mode 0600 | export and batch 15 writer | mode assertions on non-Windows |

Windows mode bits do not enforce owner-only ACLs; put the archive and prune manifest in a private user directory and review its ACL before sharing or retaining it.

## Archive table list and source

The export reuses `archiveSkillPipeline` and `verifySkillPipelineArchive` from `libs/backend/persistence-sqlite/src/lib/skill-pipeline-archive.ts`; its ordered list is also the `ARCHIVE_TABLES` expected by `tools/mcp-bench/src/memory-skills/data/candidate-row-diff.ts`: `skill_candidates`, `skill_suggestions`, `skill_synthesis_queue`, `skill_synthesis_budget`, `skill_invocations`, `skill_synthesis_workspace_cursor`, `skill_candidates_vec`, and `job_runs` (only the four pipeline job IDs). Absent tables are recorded as absent. If the vector table exists, the export loads `sqlite-vec` or fails.

## Decisions

- Require an independently audited provenance ledger because neither the mirror's snapshot tree nor its origin sidecar records whether a historical snapshot came from seed, fast-forward, rebase, revert, or user edit. A matching timestamp or hash alone cannot prove that operation.
- Reuse the batch 15 writer and receipt format exactly. The database copy is retained next to the archive directory as rollback evidence.
- Refuse active SQLite sidecars rather than risk an inconsistent file copy.

## Clarifications Needed

- Supply or audit the provenance ledger for any snapshots to prune. Without it, the safe manifest is empty; this script cannot infer historical operation provenance from existing files.
- The existing batch 15 writer omits `scheduled_jobs` rows and serializes Buffer values using Node's JSON Buffer object instead of base64. The requested file scope excludes that writer. These format gaps need correction before treating this export as the full plan-section-5 archive for a destructive 0057 drop.
