# Batch 9 report

## Files changed

- `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts:126-127,297-310,368-393,422-430,790-859`: added the direct pause read, migrated provider/model/timeout reads, retained the public settings arguments, and removed the now-unused private settings argument. The existing query abort, stream, timeout cleanup, and failure path remain in place.
- `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.spec.ts:554-813`: updated model, provider, auth, and timeout expectations for the migrated keys; added a paused workspace case and verified auth errors are not included in the auth-resolution log.
- `skill-registry-catalog.service.ts` and `trajectory-extractor.ts` and their specs: no edit. The catalog still links candidate IDs; the extractor reads JSONL and has no settings or candidate/judge injection.

## Keys read and defaults

| Key | Reader | Default |
| --- | --- | --- |
| `skillSynthesis.enabled` | `isEligible`, `generateProposal` | Enabled unless explicitly `false`, matching the registered `true` default. |
| `skills.enhancement.provider` | `generateCandidate` | Empty string; use active provider. |
| `skills.enhancement.model` | `generateCandidate` | `inherit`; resolve active provider model, or `haiku` tier for an explicit provider. |
| `skills.enhancement.timeoutMs` | `generateCandidate` | 120,000 ms; finite numeric values clamped to 15,000–600,000 ms. |

The defaults and exact key names were checked against `libs/backend/platform-core/src/file-settings-keys.ts`. Configuration calls pass no default argument, so file-settings defaults remain authoritative.

## Injections

- Kept `SkillCandidateStore` in the enhancer: eligibility, proposal usage counts, prompt stats, and recent session lookup still call it. Kept `SkillJudgeService`: proposal judgment and gating still call it. These paths are scheduled for later consumer cuts, and removing either injection here would break live behavior.
- Kept `SkillCandidateStore` in the catalog: `syncFromClones` still resolves and links synthesized candidate IDs. Removing it requires the batch 44 catalog cut and registration changes outside this batch.
- `TrajectoryExtractor` has neither injection.

## Decisions

- **Pause semantics:** An explicit `false` blocks eligibility and proposal generation, including manual generation. Options were gate only automatic calls or gate all enhancement calls. The plan calls `skillSynthesis.enabled` the manual enhancement pause key, so the latter is used. Reversible in this service.
- **Retain live injections:** Options were remove candidate/judge dependencies now with new data paths, or keep them while the old proposal and catalog paths remain live. The batch restricts edits to six files and batch 44 owns the consumer cut; retained. Reversible after that cut.
- **Auth logging:** On resolver failure, log the slug and configured provider without exception text, since error messages can contain credentials. Reversible.

## Verification

No tests, typecheck, lint, Nx, build, or diagnostics were run, as directed. Both edited source files have LF line endings. The orchestrator owns the project test/typecheck gate.
