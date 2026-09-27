# Lane K closing-review fix report — TASK_2026_559_8ca9

Review: `reviews/lane-k-closing-review.md` (REVISE 4/10, 4 Blocking). All four Blocking findings are fixed and each is
pinned by a regression spec. The Moderate finding 5 (attributing unmapped findings for a real `foo_test` package) is
carried to Batch 38 as directed and was not touched.

Worktree `task-559-lane-k`, base HEAD 2ff8aded0. No git commands were run. Temporary edit scripts were written under
`%TEMP%` and deleted afterwards; the Nx log is kept at `%TEMP%/lk_nx.log`.

Abbreviations: `EC` = `libs/backend/workspace-intelligence/src/diagnostics/external-checkers`,
`RH` = `libs/backend/rpc-handlers/src/lib/handlers`. Line numbers refer to the files as they are now.

## Finding 1 (Blocking) — revocation was stale across running CLI instances

**Cause.** Consent sat under a key in the host's `workspace-state.json`. `CliStateStorage` (and `ElectronStateStorage`)
answer `get` from a snapshot loaded when the store is constructed, and rewrite the whole object whenever any key is
saved. A revoke by another process was therefore invisible, and an unrelated write could put the revoked key back.

**Change.** Consent is now its own durable record file, owned by `GoVetConsentStore`:
`<userData>/go-vet-consent/<sha256(resolved root, win32 case-folded)>.json`.

- `EC/go-vet-consent-store.ts:178` (`read`): the file is read from disk at every decision. Nothing is cached.
- `:235` (`revoke`): deletes the file.
- `:243` (`hasRecord`): the revoke read-back. If existence cannot be established, it answers "present", so an uncertain
  revoke is never reported as done.
- Only a root the host registered can hold consent (`isRegistered`, which uses the same lookup as before), and a
  user-data directory inside the root still denies consent.
- No other state key shares the file, so a whole-object write elsewhere cannot restore it.
- `RH/diagnostics-consent-rpc.handlers.ts:309`: the revoke read-back checks that the file is gone
  (`!hasRecord && read → off`).
- `GO_VET_CONSENT_KEY` is replaced by `GO_VET_CONSENT_DIR` (`libs/backend/workspace-intelligence/src/index.ts`).

**Regression specs**

- `EC/go-vet-consent-store.spec.ts:393`: store A grants; store B, a second host over the same user-data directory,
  revokes; A's next read is `off`; an unrelated write to A's host state leaves it `off` and does not recreate the file.
- `RH/diagnostics-consent-rpc.handlers.spec.ts:411`: a running host with a real checker is at the spawn stage. A second
  host revokes. The running host's GET then answers `off`, the checker answers `no-consent` without spawning, and an
  unrelated `update` restores nothing.

## Finding 2 (Blocking) — a failed grant write remained an effective in-memory grant

**Change.** `EC/go-vet-consent-store.ts:218-229` (`grant`) writes the record to a unique temporary file (`flag: 'wx'`),
then renames it over the record. The temporary file is removed in `finally`. Readers see the record only after the
rename has committed it; nothing is held in memory, so a failed write publishes nothing and the effective state is
whatever the disk holds. The handler already answers `persist-failed` when the write throws or the read-back disagrees.

**Regression specs**

- `EC/go-vet-consent-store.spec.ts:411`: the record directory is blocked by a file, so the write fails on disk; grant
  rejects and `read` answers `off`.
- `:421`: a failed re-grant (the rename fails) leaves the committed record byte-identical and no `.tmp` file behind.
  The newer binary reads `stale/go-changed`, never `on`.
- `RH/diagnostics-consent-rpc.handlers.spec.ts:523`: the reviewer's scenario, with a real filesystem failure. SET
  answers `persist-failed`, GET answers `off`, the checker answers `no-consent` and the spawner is never reached. There
  is no audit line, and no path appears in the warning.

## Finding 3 (Blocking) — files Go excludes were reported as vetted

**Change** (`EC/go-file-membership.ts`)

- `:235`: the file name must end in exactly `.go`. Otherwise it is `not-go-source`, because go/build matches extensions
  case-sensitively; this covers `IGNORED.GO` and `Mixed.Go`.
- `:253`: `package documentation` gives `documentation-package`, which go/build skips. The scanner now returns
  `packageName`.
- `//go:build ignore` generator files were already `build-constraints`; they now have an explicit regression.
- `EC/go-vet-checker.ts`: new reason codes and fixed texts `not-go-source` and `documentation-package`.
- A `doc.go` that belongs to the package itself (`package a`) is still credited, which is correct.

**Regression specs** (`EC/go-vet-checker.spec.ts:617` onward; each is requested next to a buildable `a/a.go`)

- `a/IGNORED.GO` → `not-go-source`.
- `a/Mixed.Go` → `not-go-source`.
- `package documentation` → `documentation-package`.
- `//go:build ignore` + `package main` → `build-constraints`.
- `:652`: a `doc.go` in `package a` is credited.

## Finding 4 (Blocking) — GET/SET could authorize a replaced folder or binary

**Change**

- **Types** (`libs/shared/src/lib/types/rpc.types.ts`):
  - GET gains `confirmToken` (`:3463`).
  - SET gains `confirmToken`, required when enabling (`:3480`).
  - The SET error union gains `go-changed`.
  - SET success gains `goBinary`: the binary the committed record binds.
- **Store** (`EC/go-vet-consent-store.ts:259`, `confirmToken(root, binary)`): returns `<rootHash>.<binaryHash>`.
  - The root hash covers `realpath(root)` and `dev:ino`; the binary hash covers the canonical path, size and mtime.
  - `recordRootToken(record)` gives the root hash of a stored record.
- **Handler** (`RH/diagnostics-consent-rpc.handlers.ts`):
  - GET returns the token (`:164`).
  - An enabling SET without a token is `invalid-params` (`:192`).
  - Before anything is written, the token is recomputed for the active root and the binary resolved now (`:209-217`). A
    different root part is `workspace-changed`; a different binary part is `go-changed`.
  - After the awaited write, `targetMovedAfterGrant` (`:238`, `:277`) resolves the binary again and checks the committed
    record's root identity against the confirmed one. If either changed, the record is removed and the call refuses
    (`go-changed` / `workspace-changed`), so success is never reported for a target the user did not see.
  - Success returns `goBinary` (`:268`).
  - A revoke is never refused for a changed target.
- **CLI** (`apps/ptah-cli/src/cli/commands/config.ts:586`): `on` sends the GET's root and `confirmToken`, and reports
  the `goBinary` the host committed rather than the one it displayed.
- **Electron card** (`libs/frontend/chat/src/lib/settings/ptah-ai/go-vet-consent-config.component.ts`):
  - Captures the token when the confirmation opens (`:446`) and sends it with the displayed root (`:474`).
  - Shows the committed binary after success.
  - Has a fixed `go-changed` message; the refusal reverts the toggle and triggers a fresh GET.

**Regression specs**

- `RH/diagnostics-consent-rpc.handlers.spec.ts:659` (the reviewer's probes):
  - Binary changed after GET → `go-changed`, nothing written.
  - Folder replaced at the same path → `workspace-changed`, nothing written. The inode check is guarded against volumes
    that reuse ids.
  - Junction re-pointed after GET → `workspace-changed`.
  - Binary changed while the grant was being written → `go-changed`, record removed, no audit line.
- `EC/go-vet-consent-store.spec.ts:444`: the token parts react to root identity and binary independently.
- `apps/ptah-cli/src/cli/commands/config.spec.ts`: SET carries the GET token; the committed binary is shown (`:582`);
  `go-changed` gives exit 1.
- `…/go-vet-consent-config.component.spec.ts:299`: `go-changed` reverts, shows the message and re-fetches the new
  binary. `:327`: the committed binary is shown. The enable test asserts that the displayed token is sent.
- Existing handler cases 1-11 and Decision 25 were updated to enable through GET, then SET with its token. The
  "enable without a token" case was added to the `invalid-params` table.

**Residual (not claimed fixed).** The reviewer's note on the interval between the consent gate (`go-vet-checker.ts`)
and the off-thread worker starting the process is unchanged. No consent token crosses the worker boundary. Consent is
still re-read immediately before each spawn, and the run's working directory is canonical. An atomic
filesystem-identity contract through the launch remains a trust-model item for Batch 38 or O2.

## FB evidence (mutation: fix disabled → spec fails; restored → passes)

| Finding | Mutation                                                                                                            | Specs                                                                   | Mutated                                                | Restored    |
| ------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------ | ----------- |
| 1, 2    | Store reads from an in-memory snapshot that `grant` updates before persisting (the pre-fix `CliStateStorage` semantics) | store "closing review"; handler "closing review 1" and "closing review 2" | **3 failed** / 4; **1 failed** / 1; **1 failed** / 1   | all passed  |
| 3       | Exact-`.go` and `documentation` rules removed                                                                       | checker "upper-case / mixed-case / documentation file"                  | **3 failed** / 3                                       | 3 passed    |
| 4       | SET binds only the pathname (token comparison and post-write recheck disabled)                                      | handler "closing review 4"                                              | **4 failed** / 4                                       | 4 passed    |

## Verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence
  @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/chat ptah-cli ptah-electron --skip-nx-cache`
  took 7m 35s. Every lint and typecheck target succeeded (lint: 0 errors). Every test target passed except
  `@ptah-extension/rpc-handlers:test`: 1 failed / 3,300 passed, and the one failure is the known pre-existing flake
  `harness-skill-selection-rpc.service.spec.ts` "never writes state.json". It fails the same way when run on its own,
  and this lane does not touch it. workspace-intelligence: 1,784 passed, 10 skipped. The consent handler suite passes
  25/25, the CLI config suite 38/38 and the card suite 18/18.
- `nx run ptah-electron:validate-deps --skip-nx-cache` → "All external imports are covered by package.json
  dependencies".
- `nx run degradation-audit:lint --skip-nx-cache` → "TOTAL 300"; workspace-intelligence 1 and rpc-handlers 1, both
  equal to baseline.
- Real Go is still absent, so the hostile integration spec is skipped. Its fixtures grant through the new
  file-backed store unchanged.

## Contract changes for the verification review

- Consent storage moved from the `ptah.diagnostics.goVet.consent` key in `workspace-state.json` to the store-owned
  record file under the host user-data directory. The registered-root requirement, the user-data-inside-root guard, the
  record shape and the staleness rules are unchanged. Records written by earlier Lane K builds (never released) are
  not read; the user re-enables once.
- The RPC contract gains `confirmToken` (GET, and SET when enabling), the SET error `go-changed`, and `goBinary` on SET
  success. O2 §3 should record these changes.
